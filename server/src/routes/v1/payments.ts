import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createEpayCheckout, decodePaymentOrderNote, encodePaymentOrderNote, findPaymentProduct, PAYMENT_PRODUCTS, type StoredPaymentOrder } from '../../lib/epay';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const checkoutSchema = z.object({
  productId: z.string().min(1).max(64),
  paymentMethod: z.enum(['alipay', 'wxpay']),
  creditGrantMode: z.enum(['daily', 'bundle']).optional()
});

export const paymentRoutes = new Hono<{ Bindings: Env }>();
paymentRoutes.use('*', rateLimit(30, 60_000));

paymentRoutes.get('/products', c => c.json({
  ok: true,
  data: PAYMENT_PRODUCTS.map(product => product.kind === 'credits'
    ? { kind: product.kind, id: product.id, amount: product.amountCents / 100, credits: product.credits }
    : { kind: product.kind, id: product.id, amount: product.amountCents / 100, tier: product.tier, days: product.days })
}));

paymentRoutes.post('/checkout', async c => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请选择有效的商品和支付方式');
  const product = findPaymentProduct(parsed.data.productId);
  if (!product) throw new ApiError(400, 'PRODUCT_NOT_FOUND', '商品不存在或已下架');
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const orderNo = 'PAY' + Date.now().toString(36).toUpperCase() + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const mode = product.kind === 'membership' && product.tier !== 'lite'
    ? (parsed.data.creditGrantMode || 'daily')
    : 'daily';
  const orderPayload: StoredPaymentOrder = {
    user_id: user.id,
    product_kind: product.kind,
    product_id: product.id,
    amount_cents: product.amountCents,
    credits: product.kind === 'credits' ? product.credits : 0,
    membership_tier: product.kind === 'membership' ? product.tier : null,
    membership_days: product.kind === 'membership' ? product.days : null,
    credit_grant_mode: product.kind === 'membership' ? mode : null,
    payment_method: parsed.data.paymentMethod,
    created_at: new Date().toISOString(),
    state: 'pending'
  };
  const { error: insertError } = await admin.from('activation_codes').insert({
    code: orderNo,
    credits: 0,
    max_uses: 1,
    used_count: 0,
    active: false,
    note: encodePaymentOrderNote(orderPayload)
  });
  if (insertError) throw insertError;

  try {
    const checkoutUrl = await createEpayCheckout(c.env, {
      orderNo,
      method: parsed.data.paymentMethod,
      amountCents: product.amountCents,
      name: product.kind === 'credits' ? '站内积分充值' : '会员服务',
      clientIp: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined
    });
    return c.json({ ok: true, data: { orderNo, checkoutUrl } });
  } catch (error) {
    await admin.from('activation_codes').update({
      used_count: 1,
      note: encodePaymentOrderNote({ ...orderPayload, state: 'failed' })
    }).eq('code', orderNo);
    throw error;
  }
});

paymentRoutes.get('/orders/:orderNo', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('activation_codes')
    .select('code,used_count,note,created_at')
    .eq('code', c.req.param('orderNo'))
    .maybeSingle();
  if (error) throw error;
  const order = decodePaymentOrderNote(data?.note);
  if (!data || !order || order.user_id !== user.id) throw new ApiError(404, 'ORDER_NOT_FOUND', '订单不存在');
  return c.json({
    ok: true,
    data: {
      orderNo: data.code,
      status: order.state || (data.used_count ? 'processing' : 'pending'),
      productKind: order.product_kind,
      productId: order.product_id,
      amount: Number(order.amount_cents || 0) / 100,
      paidAt: order.paid_at || null,
      createdAt: order.created_at || data.created_at
    }
  });
});
