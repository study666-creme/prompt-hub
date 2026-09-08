import { Hono } from 'hono';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminLedgerRoutes = new Hono<{ Bindings: Env }>();

adminLedgerRoutes.use('*', requireAdminSecret);
adminLedgerRoutes.use('*', rateLimit(60, 60_000));

type LedgerRow = {
  id: number | string;
  user_id: string;
  delta: number | string;
  balance_after: number | string;
  reason: string | null;
  ref_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

/** 给流水行补上用户名+邮箱，让运营能直接定位是谁。display_name 批量查，email 逐个 auth 查（限去重后数量）。 */
async function attachUsers(
  admin: ReturnType<typeof createAdminClient>,
  rows: LedgerRow[]
): Promise<Array<LedgerRow & { userName: string; userEmail: string }>> {
  const ids = [...new Set(rows.map(r => String(r.user_id || '')).filter(Boolean))];
  const names = new Map<string, string>();
  const emails = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', ids);
    for (const p of profiles ?? []) names.set(String(p.user_id), String(p.display_name || ''));
    // 邮箱只在 auth 侧，逐个查（去重后最多 50 个，够一屏）
    for (const id of ids.slice(0, 50)) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(id);
        if (u?.user?.email) emails.set(id, String(u.user.email));
      } catch { /* 邮箱缺失不阻断 */ }
    }
  }
  return rows.map(r => ({
    ...r,
    userName: names.get(String(r.user_id)) || '',
    userEmail: emails.get(String(r.user_id)) || ''
  }));
}

const REASONS = [
  'payment_topup',
  'admin_manual',
  'subscription_grant',
  'generation_refund',
  'redemption',
  'generation_charge',
  'daily_grant',
  'milestone_reward',
  'invite_reward'
];

/** 积分流水浏览：按用户 / 原因 / 时间范围筛选 */
adminLedgerRoutes.get('/', async c => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const userId = c.req.query('userId') || '';
  const reason = c.req.query('reason') || '';
  const since = c.req.query('since') || '';

  const admin = createAdminClient(c.env);
  let query = admin
    .from('credit_ledger')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);
  if (reason) query = query.eq('reason', reason);
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) query = query.gte('created_at', d.toISOString());
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as LedgerRow[];
  const enriched = await attachUsers(admin, rows);

  return c.json({
    ok: true,
    data: {
      items: enriched,
      total: count ?? 0,
      limit,
      offset,
      reasons: REASONS
    }
  });
});

/** 单用户流水（用户详情页直链） */
adminLedgerRoutes.get('/users/:userId', async c => {
  const userId = c.req.param('userId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('credit_ledger')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return c.json({ ok: true, data: { items: data ?? [], userId } });
});

/** 流水导出 CSV */
adminLedgerRoutes.get('/export', async c => {
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('credit_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;

  // 用户名批量关联（去重 id 一次查 profiles），便于导出后直接看是谁
  const rows = (data ?? []) as LedgerRow[];
  const ids = [...new Set(rows.map(r => String(r.user_id || '')).filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: ps } = await admin.from('profiles').select('user_id, display_name').in('user_id', ids.slice(i, i + 500));
    for (const p of ps ?? []) names.set(String(p.user_id), String(p.display_name || ''));
  }

  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'id,user_id,user_name,delta,balance_after,reason,ref_id,created_at';
  const lines = rows.map((row) =>
    [row.id, row.user_id, esc(names.get(String(row.user_id)) || ''), row.delta, row.balance_after, esc(row.reason), esc(row.ref_id), row.created_at].join(',')
  );

  return new Response([header, ...lines].join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="credit-ledger.csv"'
    }
  });
});
