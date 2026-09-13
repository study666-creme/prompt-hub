import { Hono } from 'hono';
import type { Env } from '../../env';
import { optionalAuth } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { createAdminClient } from '../../lib/supabase';

export const announcementRoutes = new Hono<{ Bindings: Env }>();

announcementRoutes.use('*', optionalAuth);

type Announcement = {
  id: string;
  text: string;
  startAt: string;
  endAt?: string | null;
  active?: boolean;
  /** 受众：all=站点+画布，warehouse=仅卡片库，canvas=仅画布；缺省按 all 兼容旧数据 */
  scope?: 'all' | 'warehouse' | 'canvas';
};

const VALID_SCOPES = new Set(['all', 'warehouse', 'canvas']);

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizeScope(v: unknown): 'all' | 'warehouse' | 'canvas' {
  return VALID_SCOPES.has(String(v)) ? (v as 'all' | 'warehouse' | 'canvas') : 'all';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 已读记录放 KV（ann_seen:{userId}），不再写 user_data.data：
 * 客户端整包上传 user_data.data 时会把服务端写入的 announcements_seen 抹掉，
 * 导致公告当天反复弹出并遮挡全站（2026-09-13 生产实测）。KV 缺失时回退旧行为。
 */
function annSeenKvKey(userId: string): string {
  return `ann_seen:${userId}`;
}

async function readSeenMap(
  env: Env,
  userId: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<Record<string, string>> {
  if (env.PROMPT_HUB_METRICS) {
    try {
      const raw = await env.PROMPT_HUB_METRICS.get(annSeenKvKey(userId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return asObject(parsed) as Record<string, string>;
      }
    } catch {
      // KV 读取失败时回退 user_data 旧记录，不让公告接口整体失败
    }
  }
  const { data: ud } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  return asObject(asObject(ud?.data).announcements_seen) as Record<string, string>;
}

/**
 * 返回当前生效的通知 + 调用者今日是否已读。已读按 id+日期记在 KV，兼容读取旧 user_data 记录。
 * 公开只读（画布端未登录也要拉公告）；scope=warehouse|canvas 时按受众过滤，
 * 未登录时 readToday 恒为 false，由客户端本地兜底。
 */
announcementRoutes.get('/', rateLimit(120, 60_000), async c => {
  const admin = createAdminClient(c.env);
  const user = c.get('user') as { id: string } | undefined;

  const { data: ss, error: ssErr } = await admin
    .from('site_settings')
    .select('value')
    .eq('key', 'announcements')
    .maybeSingle();
  if (ssErr) throw ssErr;
  const list = (Array.isArray(ss?.value) ? ss!.value : []) as Announcement[];

  const now = Date.now();
  const active = list.filter(a => a.active !== false && (!a.startAt || new Date(a.startAt).getTime() <= now) && (!a.endAt || new Date(a.endAt).getTime() >= now));

  const scopeParam = String(c.req.query('scope') || '').trim();
  const scopeFilter = VALID_SCOPES.has(scopeParam) && scopeParam !== 'all' ? scopeParam : null;
  const scoped = scopeFilter
    ? active.filter(a => {
        const s = normalizeScope(a.scope);
        return s === 'all' || s === scopeFilter;
      })
    : active;

  const seen = user ? await readSeenMap(c.env, user.id, admin) : {};
  const today = todayKey();

  const items = scoped.map(a => {
    const lastSeen = user ? String(seen[a.id] || '') : '';
    const readToday = lastSeen === today;
    return { id: a.id, text: a.text, readToday, scope: normalizeScope(a.scope) };
  });

  return c.json({ ok: true, data: { items, hasUnread: items.some(i => !i.readToday) } });
});

/** 标记一条通知今日已读（需登录；幂等：重复调用同一天只记一次）。 */
announcementRoutes.post('/:id/seen', rateLimit(120, 60_000), async c => {
  const user = c.get('user') as { id: string } | undefined;
  if (!user?.id) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401);
  }
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const today = todayKey();

  if (c.env.PROMPT_HUB_METRICS) {
    const seen = await readSeenMap(c.env, user.id, admin);
    seen[id] = today;
    // 已读记录 40 天过期：服务端只关心"今天"，过期后自然重新计算
    await c.env.PROMPT_HUB_METRICS.put(annSeenKvKey(user.id), JSON.stringify(seen), { expirationTtl: 40 * 24 * 3600 });
    return c.json({ ok: true, data: { id, readToday: true } });
  }

  const { data: ud } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();
  const data = asObject(ud?.data);
  const seen = asObject(data.announcements_seen);
  seen[id] = today;

  const next = { ...data, announcements_seen: seen };
  const { error } = await admin
    .from('user_data')
    .upsert({ user_id: user.id, data: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;

  return c.json({ ok: true, data: { id, readToday: true } });
});
