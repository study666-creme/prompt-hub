import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { writeAudit } from '../../middleware/admin-audit';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import { decodePaymentOrderNote, type StoredPaymentOrder } from '../../lib/epay';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminOrderRoutes = new Hono<{ Bindings: Env }>();

adminOrderRoutes.use('*', requireAdminSecret);
adminOrderRoutes.use('*', rateLimit(60, 60_000));

type OrderRow = {
  order_no: string;
  user_id: string;
  product_kind: 'credits' | 'membership';
  product_id: string;
  amount_cents: number;
  credits: number | string;
  membership_tier: string | null;
  membership_days: number | null;
  payment_method: string;
  state: string;
  provider_trade_no: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

const productTitle = (row: Pick<OrderRow, 'product_kind' | 'credits' | 'membership_tier' | 'membership_days'>) =>
  row.product_kind === 'membership'
    ? `会员 ${row.membership_tier ?? ''}${row.membership_days ? ` · ${row.membership_days}天` : ''}`
    : `积分 ${Number(row.credits) || 0}`;

/** 订单列表：优先读 payment_orders，老订单回退扫 activation_codes.note */
adminOrderRoutes.get('/', async c => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const state = c.req.query('state') || '';
  const userId = c.req.query('userId') || '';
  const kind = c.req.query('kind') || '';

  const admin = createAdminClient(c.env);
  let query = admin
    .from('payment_orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (state) query = query.eq('state', state);
  if (userId) query = query.eq('user_id', userId);
  if (kind === 'credits' || kind === 'membership') query = query.eq('product_kind', kind);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    if (/does not exist|Could not find the table/i.test(String(error.message))) {
      throw new ApiError(503, 'TABLE_NOT_READY', 'payment_orders 表尚未创建，请先执行 20260906200000_admin_console_rework.sql');
    }
    throw error;
  }

  const rows = (data ?? []) as OrderRow[];
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);
    for (const p of profiles ?? []) names.set(String(p.user_id), String(p.display_name || ''));
  }

  return c.json({
    ok: true,
    data: {
      items: rows.map(r => ({
        ...r,
        userName: names.get(r.user_id) || '',
        amountYuan: (r.amount_cents / 100).toFixed(2),
        productTitle: productTitle(r)
      })),
      total: count ?? 0,
      limit,
      offset
    }
  });
});

/**
 * 订单页自检。空表格有太多种原因（表没建、支付没配、真没订单），页面必须
 * 自己说清楚是哪种，否则运营看到「暂无订单」只会以为功能是坏的。
 */
adminOrderRoutes.get('/health', async c => {
  const admin = createAdminClient(c.env);
  const table = await admin
    .from('payment_orders')
    .select('order_no, state, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(1);
  const tableReady = !table.error;
  const legacy = await admin
    .from('activation_codes')
    .select('code', { count: 'exact', head: true })
    .like('note', 'payment-order:%');

  const env = c.env;
  const epayConfigured = Boolean(
    env.EPAY_MERCHANT_ID?.trim() && env.EPAY_MERCHANT_KEY?.trim()
      && env.EPAY_API_BASE_URL?.trim() && env.EPAY_CALLBACK_BASE_URL?.trim()
  );

  return c.json({
    ok: true,
    data: {
      tableReady,
      tableError: table.error?.message ?? null,
      orderCount: table.count ?? 0,
      latestOrderAt: table.data?.[0]?.created_at ?? null,
      legacyOrderCount: legacy.count ?? 0,
      epayConfigured,
      // 支付链路是否完整：缺任一项都无法完成下单，订单表自然一直是空的。
      paymentChecklist: [
        { key: 'merchant', label: '易支付商户 ID / 密钥', ok: Boolean(env.EPAY_MERCHANT_ID?.trim() && env.EPAY_MERCHANT_KEY?.trim()) },
        { key: 'endpoint', label: '易支付接口地址', ok: Boolean(env.EPAY_API_BASE_URL?.trim()) },
        { key: 'callback', label: '回调地址（回调丢失会导致订单停在待支付）', ok: Boolean(env.EPAY_CALLBACK_BASE_URL?.trim()) }
      ]
    }
  });
});

/** 历史订单：从 activation_codes.note 里捞出迁移前的订单（只读，不迁移） */
adminOrderRoutes.get('/legacy-notes', async c => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 100));
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('activation_codes')
    .select('code, note, used_count')
    .like('note', 'payment-order:%')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const items = (data ?? [])
    .map(row => {
      const order = decodePaymentOrderNote(row.note) as StoredPaymentOrder | null;
      if (!order) return null;
      return {
        orderNo: row.code,
        userId: order.user_id,
        productKind: order.product_kind,
        productId: order.product_id,
        amountCents: order.amount_cents,
        amountYuan: (order.amount_cents / 100).toFixed(2),
        credits: order.credits,
        membershipTier: order.membership_tier ?? null,
        membershipDays: order.membership_days ?? null,
        state: order.state ?? 'pending',
        paidAt: order.paid_at ?? null,
        createdAt: order.created_at
      };
    })
    .filter(Boolean);

  return c.json({ ok: true, data: { items, total: items.length } });
});

const manualGrantSchema = z.object({
  userId: z.string().uuid(),
  credits: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(3).max(200)
});

/** 人工补单：幂等键 reason+refId，走 apply_credit_delta 必写流水 */
adminOrderRoutes.post('/manual-grant', async c => {
  const parsed = manualGrantSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数无效：userId / credits（正整数）/ reason 必填');
  }
  const { userId, credits, reason } = parsed.data;
  const refId = `admin-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = createAdminClient(c.env);

  const { data: profile } = await admin
    .from('profiles')
    .select('user_id, credits')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile) throw new ApiError(404, 'NOT_FOUND', '用户不存在');

  const { error: rpcErr } = await admin.rpc('apply_credit_delta', {
    p_user_id: userId,
    p_delta: credits,
    p_reason: 'admin_manual',
    p_ref_id: refId,
    p_meta: { note: reason, by: 'admin-console' }
  });
  if (rpcErr) throw rpcErr;

  const { data: after } = await admin
    .from('profiles')
    .select('credits')
    .eq('user_id', userId)
    .maybeSingle();

  await writeAudit(c, {
    action: 'order.manual_grant',
    targetType: 'user',
    targetId: userId,
    before: { credits: Number(profile.credits) || 0 },
    after: { credits: Number(after?.credits) || 0 },
    detail: { credits, reason, refId }
  });

  return c.json({
    ok: true,
    data: { userId, credits, refId, balanceAfter: Number(after?.credits) || 0 }
  });
});
