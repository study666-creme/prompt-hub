import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  admin: null as Record<string, ReturnType<typeof vi.fn>> | null
}));

vi.mock('../../lib/supabase', () => ({
  createAdminClient: vi.fn(() => mocks.admin)
}));

import { announcementRoutes } from './announcements';

type KVStore = Map<string, string>;

function makeKv(store: KVStore) {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    })
  };
}

const USER = { id: 'user-1', phoneVerified: false };

function buildApp(opts: { withUser?: boolean } = {}) {
  const app = new Hono<{ Bindings: Env }>();
  if (opts.withUser !== false) {
    app.use('*', async (c, next) => {
      c.set('user', USER as never);
      await next();
    });
  }
  app.route('/api/v1/announcements', announcementRoutes);
  return app;
}

function makeAdmin(opts: { announcements?: unknown[]; userData?: Record<string, unknown> | null } = {}) {
  const upsert = vi.fn(async () => ({ error: null }));
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'site_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { value: opts.announcements ?? [] }, error: null })
            })
          })
        };
      }
      if (table === 'user_data') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.userData ? { data: opts.userData } : null, error: null })
            })
          }),
          upsert
        };
      }
      throw new Error('unexpected table ' + table);
    })
  };
  return { admin, upsert };
}

const TODAY = new Date().toISOString().slice(0, 10);
const ANN = [
  { id: 'ann-all', text: '全站公告', active: true, scope: 'all' },
  { id: 'ann-wh', text: '仅卡片库', active: true, scope: 'warehouse' },
  { id: 'ann-cv', text: '仅画布', active: true, scope: 'canvas' },
  // 旧数据没有 scope 字段，应按 all 处理
  { id: 'ann-legacy', text: '旧公告', active: true }
];

describe('announcements scope filtering', () => {
  beforeEach(() => {
    const { admin } = makeAdmin({ announcements: ANN });
    mocks.admin = admin as never;
  });

  it('returns warehouse + all items for scope=warehouse', async () => {
    const app = buildApp();
    const res = await app.request('https://api.test/api/v1/announcements?scope=warehouse', undefined, {} as Env);
    const body = (await res.json()) as { data: { items: { id: string }[] } };
    const ids = body.data.items.map(i => i.id).sort();
    expect(ids).toEqual(['ann-all', 'ann-legacy', 'ann-wh']);
  });

  it('returns canvas + all items for scope=canvas', async () => {
    const app = buildApp({ withUser: false });
    const res = await app.request('https://api.test/api/v1/announcements?scope=canvas', undefined, {} as Env);
    const body = (await res.json()) as { data: { items: { id: string; readToday: boolean }[] } };
    const ids = body.data.items.map(i => i.id).sort();
    expect(ids).toEqual(['ann-all', 'ann-cv', 'ann-legacy']);
    // 匿名访问：readToday 恒为 false，由客户端本地兜底
    expect(body.data.items.every(i => i.readToday === false)).toBe(true);
  });

  it('returns all items without a scope param (backward compatible)', async () => {
    const app = buildApp();
    const res = await app.request('https://api.test/api/v1/announcements', undefined, {} as Env);
    const body = (await res.json()) as { data: { items: { id: string }[] } };
    expect(body.data.items).toHaveLength(4);
  });
});

describe('announcements seen records', () => {
  beforeEach(() => {
    const { admin } = makeAdmin({ announcements: ANN, userData: { cards: [] } });
    mocks.admin = admin as never;
  });

  it('marks seen into KV and reports readToday from KV, not user_data', async () => {
    const store: KVStore = new Map();
    const kv = makeKv(store);
    const { upsert } = (() => {
      const r = makeAdmin({ announcements: ANN, userData: { cards: [] } });
      mocks.admin = r.admin as never;
      return r;
    })();

    const app = buildApp();
    const post = await app.request('https://api.test/api/v1/announcements/ann-all/seen', { method: 'POST' }, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toMatchObject({ ok: true });

    // 已读写入 KV，不再写会被客户端整包覆盖的 user_data.data
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value] = kv.put.mock.calls[0] as [string, string];
    expect(key).toBe('ann_seen:user-1');
    expect(JSON.parse(value)).toMatchObject({ 'ann-all': expect.any(String) });
    expect(upsert).not.toHaveBeenCalled();

    const get = await app.request('https://api.test/api/v1/announcements', undefined, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    const body = (await get.json()) as { data: { items: { id: string; readToday: boolean }[]; hasUnread: boolean } };
    const seenItem = body.data.items.find(i => i.id === 'ann-all');
    expect(seenItem?.readToday).toBe(true);
    // 其余公告仍未读 → hasUnread 保持 true
    expect(body.data.hasUnread).toBe(true);
  });

  it('rejects seen marking from anonymous callers', async () => {
    const kv = makeKv(new Map());
    const app = buildApp({ withUser: false });
    const res = await app.request('https://api.test/api/v1/announcements/ann-all/seen', { method: 'POST' }, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    expect(res.status).toBe(401);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('falls back to legacy user_data seen records when KV has no entry', async () => {
    const kv = makeKv(new Map());
    const { admin } = makeAdmin({
      announcements: ANN,
      userData: { cards: [], announcements_seen: { 'ann-all': TODAY } }
    });
    mocks.admin = admin as never;

    const app = buildApp();
    const get = await app.request('https://api.test/api/v1/announcements', undefined, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    const body = (await get.json()) as { data: { items: { id: string; readToday: boolean }[] } };
    const annAll = body.data.items.find(i => i.id === 'ann-all');
    expect(annAll?.readToday).toBe(true);
  });

  it('still works without the KV binding via the legacy user_data path', async () => {
    const { admin, upsert } = makeAdmin({ announcements: ANN, userData: { cards: [] } });
    mocks.admin = admin as never;

    const app = buildApp();
    const post = await app.request('https://api.test/api/v1/announcements/ann-all/seen', { method: 'POST' }, {} as Env);
    expect(post.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const calls = upsert.mock.calls as unknown as [Record<string, unknown>][];
    const arg = calls[0][0] as { data: Record<string, unknown> };
    expect((arg.data.announcements_seen as Record<string, string>)['ann-all']).toBe(TODAY);
  });
});
