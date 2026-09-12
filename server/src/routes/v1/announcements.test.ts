import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  admin: null as Record<string, ReturnType<typeof vi.fn>> | null,
  requireAuth: vi.fn()
}));

vi.mock('../../lib/supabase', () => ({
  createAdminClient: vi.fn(() => mocks.admin)
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: mocks.requireAuth
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

function buildApp(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', USER as never);
    await next();
  });
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

const ANN = [{ id: 'ann-1', text: '测试公告', active: true }];

describe('announcements seen records', () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
  });

  it('marks seen into KV and reports readToday from KV, not user_data', async () => {
    const store: KVStore = new Map();
    const kv = makeKv(store);
    const { admin, upsert } = makeAdmin({ announcements: ANN, userData: { cards: [] } });
    mocks.admin = admin as never;

    const app = buildApp({});
    const post = await app.request('https://api.test/api/v1/announcements/ann-1/seen', { method: 'POST' }, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toMatchObject({ ok: true });

    // 已读写入 KV，不再写会被客户端整包覆盖的 user_data.data
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value] = kv.put.mock.calls[0] as [string, string];
    expect(key).toBe('ann_seen:user-1');
    expect(JSON.parse(value)).toMatchObject({ 'ann-1': expect.any(String) });
    expect(upsert).not.toHaveBeenCalled();

    const get = await app.request('https://api.test/api/v1/announcements', undefined, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    const body = (await get.json()) as { data: { items: { readToday: boolean }[]; hasUnread: boolean } };
    expect(body.data.items[0].readToday).toBe(true);
    expect(body.data.hasUnread).toBe(false);
  });

  it('falls back to legacy user_data seen records when KV has no entry', async () => {
    const store: KVStore = new Map();
    const kv = makeKv(store);
    const today = new Date().toISOString().slice(0, 10);
    const { admin } = makeAdmin({
      announcements: ANN,
      userData: { cards: [], announcements_seen: { 'ann-1': today } }
    });
    mocks.admin = admin as never;

    const app = buildApp({});
    const get = await app.request('https://api.test/api/v1/announcements', undefined, {
      PROMPT_HUB_METRICS: kv
    } as unknown as Env);
    const body = (await get.json()) as { data: { items: { readToday: boolean }[] } };
    expect(body.data.items[0].readToday).toBe(true);
  });

  it('still works without the KV binding via the legacy user_data path', async () => {
    const { admin, upsert } = makeAdmin({ announcements: ANN, userData: { cards: [] } });
    mocks.admin = admin as never;

    const app = buildApp({});
    const post = await app.request('https://api.test/api/v1/announcements/ann-1/seen', { method: 'POST' }, {} as Env);
    expect(post.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const calls = upsert.mock.calls as unknown as [Record<string, unknown>][];
    const arg = calls[0][0] as { data: Record<string, unknown> };
    expect((arg.data.announcements_seen as Record<string, string>)['ann-1']).toBe(
      new Date().toISOString().slice(0, 10)
    );
  });
});
