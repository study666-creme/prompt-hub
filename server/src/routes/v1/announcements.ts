import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireAuth } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { createAdminClient } from '../../lib/supabase';

export const announcementRoutes = new Hono<{ Bindings: Env }>();

type Announcement = {
  id: string;
  text: string;
  startAt: string;
  endAt?: string | null;
  active?: boolean;
};

type UserDataRow = { user_id: string; data: Record<string, unknown> | null };

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 返回当前生效的通知 + 调用者今日是否已读。已读按 id+日期记在 user_data。 */
announcementRoutes.get('/', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);

  const { data: ss, error: ssErr } = await admin
    .from('site_settings')
    .select('value')
    .eq('key', 'announcements')
    .maybeSingle();
  if (ssErr) throw ssErr;
  const list = (Array.isArray(ss?.value) ? ss!.value : []) as Announcement[];

  const now = Date.now();
  const active = list.filter(a => a.active !== false && (!a.startAt || new Date(a.startAt).getTime() <= now) && (!a.endAt || new Date(a.endAt).getTime() >= now));

  const { data: ud } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();
  const data = asObject(ud?.data);
  const seen = asObject(data.announcements_seen);
  const today = new Date().toISOString().slice(0, 10);

  const items = active.map(a => {
    const lastSeen = String(seen[a.id] || '');
    const readToday = lastSeen === today;
    return { id: a.id, text: a.text, readToday };
  });

  return c.json({ ok: true, data: { items, hasUnread: items.some(i => !i.readToday) } });
});

/** 标记一条通知今日已读（幂等：重复调用同一天只记一次）。 */
announcementRoutes.post('/:id/seen', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const today = new Date().toISOString().slice(0, 10);

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
