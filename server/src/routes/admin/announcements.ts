import { Hono } from 'hono';
import type { Env } from '../../env';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';
import { writeAudit } from '../../middleware/admin-audit';

export const adminAnnouncementRoutes = new Hono<{ Bindings: Env }>();

adminAnnouncementRoutes.use('*', requireAdminSecret);
adminAnnouncementRoutes.use('*', rateLimit(30, 60_000));

type Announcement = {
  id: string;
  text: string;
  startAt?: string | null;
  endAt?: string | null;
  active?: boolean;
};

function asArray(v: unknown): Announcement[] {
  return Array.isArray(v) ? (v as Announcement[]) : [];
}

/** 读取全部通知（含已下线），供后台管理。 */
adminAnnouncementRoutes.get('/', async c => {
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('site_settings').select('value').eq('key', 'announcements').maybeSingle();
  if (error) throw error;
  return c.json({ ok: true, data: { items: asArray(data?.value) } });
});

/** 整体保存通知列表（后台编辑后 PUT）。 */
adminAnnouncementRoutes.put('/', async c => {
  const admin = createAdminClient(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { items?: Announcement[] };
  const items = Array.isArray(body.items)
    ? body.items.map(a => ({
        id: String(a.id || `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        text: String(a.text || '').slice(0, 2000),
        startAt: a.startAt || new Date().toISOString(),
        endAt: a.endAt || null,
        active: a.active !== false
      }))
    : [];
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: 'announcements', value: items, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  await writeAudit(c, {
    action: 'announcements.save',
    targetType: 'announcements',
    detail: { count: items.length, ids: items.map(a => a.id) }
  });
  return c.json({ ok: true, data: { items } });
});
