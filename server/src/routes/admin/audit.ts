import { Hono } from 'hono';
import type { Env } from '../../env';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminAuditRoutes = new Hono<{ Bindings: Env }>();

adminAuditRoutes.use('*', requireAdminSecret);
adminAuditRoutes.use('*', rateLimit(60, 60_000));

/** 管理操作审计查询 */
adminAuditRoutes.get('/', async c => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const action = c.req.query('action') || '';
  const targetType = c.req.query('targetType') || '';
  const targetId = c.req.query('targetId') || '';

  const admin = createAdminClient(c.env);
  let query = admin
    .from('admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (action) query = query.ilike('action', `%${action}%`);
  if (targetType) query = query.eq('target_type', targetType);
  if (targetId) query = query.eq('target_id', targetId);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;

  return c.json({
    ok: true,
    data: { items: data ?? [], total: count ?? 0, limit, offset }
  });
});
