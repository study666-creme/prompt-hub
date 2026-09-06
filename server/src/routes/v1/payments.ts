import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  createCustomCreditProduct,
  createEpayCheckout,
  collaborationSeatProductEnabled,
  CUSTOM_CREDIT_PRODUCT_ID,
  decodePaymentOrderNote,
  encodePaymentOrderNote,
  findPaymentProduct,
  MAX_CUSTOM_TOP_UP_CENTS,
  MIN_CUSTOM_TOP_UP_CENTS,
  PAYMENT_PRODUCTS,
  resolvePaymentReturnUrl,
  type StoredPaymentOrder
} from '../../lib/epay';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

export const checkoutSchema = z.object({
  productId: z.string().min(1).max(64),
  // 仅限制新订单；epay 回调仍接受并结算历史 wxpay 订单。
  paymentMethod: z.literal('alipay'),
  // Older clients sent null for a plain credit top-up. Treat it as omitted.
  creditGrantMode: z.enum(['daily', 'bundle']).nullable().optional(),
  customAmount: z.number()
    .finite()
    .min(MIN_CUSTOM_TOP_UP_CENTS / 100)
    .max(MAX_CUSTOM_TOP_UP_CENTS / 100)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, '最多支持两位小数')
    .optional(),
  returnTarget: z.enum(['card-library', 'canvas']).optional(),
  returnPath: z.string().regex(/^\/(?:canvas|image|video)(?:\/[A-Za-z0-9_-]+)?\/?$/).max(200).optional()
});

export const paymentRoutes = new Hono<{ Bindings: Env }>();
paymentRoutes.use('*', rateLimit(30, 60_000));

export const paymentProductsHandler = (c: any) => c.json({
  ok: true,
  data: PAYMENT_PRODUCTS
    .filter(product => product.kind !== 'collaboration_seat' || collaborationSeatProductEnabled(c.env))
    .map(publicPaymentProduct),
  customCreditTopUp: null
});

paymentRoutes.post('/checkout', async c => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请选择有效的商品和支付方式');
  const product = parsed.data.productId === CUSTOM_CREDIT_PRODUCT_ID
    ? (parsed.data.customAmount === undefined
      ? null
      : createCustomCreditProduct(parsed.data.customAmount))
    : findPaymentProduct(parsed.data.productId, collaborationSeatProductEnabled(c.env));
  if (!product) throw new ApiError(400, 'PRODUCT_NOT_FOUND', '商品不存在或已下架');
  if (parsed.data.productId !== CUSTOM_CREDIT_PRODUCT_ID && parsed.data.customAmount !== undefined) {
    throw new ApiError(400, 'INVALID_CUSTOM_TOP_UP', '固定商品不能同时提交自定义金额');
  }
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const orderNo = 'PAY' + Date.now().toString(36).toUpperCase() + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const returnUrl = resolvePaymentReturnUrl(c.env, parsed.data.returnTarget, parsed.data.returnPath);

  if (product.kind === 'collaboration_seat') {
    const createdAt = new Date().toISOString();
    const { error: insertError } = await admin.from('payment_orders').insert({
      order_no: orderNo,
      user_id: user.id,
      provider: 'epay',
      product_kind: product.kind,
      product_id: product.id,
      quantity: product.seats,
      unit_amount_cents: product.amountCents,
      amount_cents: product.amountCents * product.seats,
      payment_method: parsed.data.paymentMethod,
      status: 'pending',
      return_url: returnUrl,
      product_snapshot: {
        kind: product.kind,
        id: product.id,
        seats: product.seats,
        unitAmountCents: product.amountCents
      },
      created_at: createdAt
    });
    if (insertError) throw insertError;

    try {
      const checkoutUrl = await createEpayCheckout(c.env, {
        orderNo,
        method: parsed.data.paymentMethod,
        amountCents: product.amountCents * product.seats,
        name: 'Canvas 协作席位',
        clientIp: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined
      });
      return c.json({ ok: true, data: { orderNo, checkoutUrl } });
    } catch (error) {
      await admin.from('payment_orders').update({
        status: 'failed',
        failed_at: new Date().toISOString()
      }).eq('order_no', orderNo).eq('status', 'pending');
      throw error;
    }
  }

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
    collaboration_seats: null,
    credit_grant_mode: product.kind === 'membership' ? mode : null,
    payment_method: parsed.data.paymentMethod,
    created_at: new Date().toISOString(),
    return_url: returnUrl,
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
      name: product.kind === 'credits'
        ? '站内积分充值'
        : product.kind === 'membership'
          ? '会员服务'
          : 'Canvas 协作席位',
      clientIp: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined
    });
    return c.json({ ok: true, data: { orderNo, checkoutUrl } });
  } catch (error) {
    await admin.from('activation_codes').update({
      used_count: 1,
      note: encodePaymentOrderNote({ ...orderPayload, state: 'failed', processing_at: null })
    }).eq('code', orderNo);
    throw error;
  }
});

function publicPaymentProduct(product: (typeof PAYMENT_PRODUCTS)[number]) {
  if (product.kind === 'credits') {
    return { kind: product.kind, id: product.id, amount: product.amountCents / 100, credits: product.credits };
  }
  if (product.kind === 'membership') {
    return { kind: product.kind, id: product.id, amount: product.amountCents / 100, tier: product.tier, days: product.days };
  }
  return { kind: product.kind, id: product.id, amount: product.amountCents / 100, seats: product.seats };
}

paymentRoutes.get('/orders/:orderNo', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const { data: durableOrder, error: durableOrderError } = await admin
    .from('payment_orders')
    .select('order_no,user_id,status,product_kind,product_id,amount_cents,paid_at,created_at')
    .eq('order_no', c.req.param('orderNo'))
    .eq('user_id', user.id)
    .maybeSingle();
  if (durableOrderError) throw durableOrderError;
  if (durableOrder?.order_no && durableOrder.product_kind === 'collaboration_seat') {
    const status = durableOrder.status === 'pending'
      ? 'pending'
      : durableOrder.status === 'failed'
        ? 'failed'
        : durableOrder.status === 'refunded' || durableOrder.status === 'partially_refunded'
          ? 'refunded'
          : 'paid';
    return c.json({
      ok: true,
      data: {
        orderNo: durableOrder.order_no,
        status,
        productKind: durableOrder.product_kind,
        productId: durableOrder.product_id,
        amount: Number(durableOrder.amount_cents || 0) / 100,
        paidAt: durableOrder.paid_at || null,
        createdAt: durableOrder.created_at
      }
    });
  }

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
