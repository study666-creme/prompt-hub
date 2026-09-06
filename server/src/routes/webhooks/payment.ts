import { Hono } from 'hono';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import {
  parseWebhookBody,
  processPaymentWebhook,
  verifyWebhookSignature
} from '../../lib/payment';
import {
  appendPaymentResult,
  completeEpayOrder,
  decodePaymentOrderNote,
  safePaymentReturnUrl
} from '../../lib/epay';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

async function epayParams(c: any): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(c.req.query())) {
    params[name] = String(value);
  }
  if (c.req.method === 'POST') {
    const body = await c.req.parseBody();
    for (const [name, value] of Object.entries(body)) {
      params[name] = String(value);
    }
  }
  return params;
}

async function storedReturnUrl(c: any, params: Record<string, string>): Promise<string> {
  const fallback = safePaymentReturnUrl(c.env, null);
  const orderNo = String(params.out_trade_no || '').trim();
  if (!orderNo) return fallback;
  try {
    const admin = createAdminClient(c.env);
    const { data: durableOrder, error: durableOrderError } = await admin
      .from('payment_orders')
      .select('return_url')
      .eq('order_no', orderNo)
      .maybeSingle();
    if (durableOrderError) throw durableOrderError;
    if (durableOrder?.return_url) {
      return safePaymentReturnUrl(c.env, durableOrder.return_url);
    }
    const { data, error } = await admin
      .from('activation_codes')
      .select('note')
      .eq('code', orderNo)
      .maybeSingle();
    if (error) throw error;
    const order = decodePaymentOrderNote(data?.note);
    return safePaymentReturnUrl(c.env, order?.return_url);
  } catch {
    return fallback;
  }
}

webhookRoutes.on(['GET', 'POST'], '/epay', async c => {
  const key = c.env.EPAY_MERCHANT_KEY?.trim();
  const merchantId = c.env.EPAY_MERCHANT_ID?.trim();
  if (!key || !merchantId) return c.text('fail');
  const params = await epayParams(c);
  try {
    await completeEpayOrder(createAdminClient(c.env), params, {
      merchantId,
      merchantKey: key
    });
    return c.text('success');
  } catch (error) {
    console.error('[payment] callback rejected', error instanceof Error ? error.message : String(error));
    return c.text('fail');
  }
});

webhookRoutes.on(['GET', 'POST'], '/epay/return', async c => {
  const params = await epayParams(c);
  const returnUrl = await storedReturnUrl(c, params);
  const key = c.env.EPAY_MERCHANT_KEY?.trim();
  const merchantId = c.env.EPAY_MERCHANT_ID?.trim();
  if (!key || !merchantId) return c.redirect(appendPaymentResult(returnUrl, 'processing'));
  try {
    await completeEpayOrder(createAdminClient(c.env), params, {
      merchantId,
      merchantKey: key
    });
    return c.redirect(appendPaymentResult(returnUrl, 'success'));
  } catch (error) {
    console.error('[payment] return settlement failed', error instanceof Error ? error.message : String(error));
    return c.redirect(appendPaymentResult(returnUrl, 'processing'));
  }
});

/** 支付回调（微信/Stripe 等网关验签后转发到此） */
webhookRoutes.post('/payment', async c => {
  const secret = c.env.PAYMENT_WEBHOOK_SECRET;
  const rawBody = await c.req.text();
  await verifyWebhookSignature(secret || '', rawBody, c.req.header('X-Webhook-Signature'));

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'JSON 无效');
  }

  const payload = parseWebhookBody(json);
  const admin = createAdminClient(c.env);
  const result = await processPaymentWebhook(admin, payload);

  return c.json({
    ok: true,
    data: { duplicate: result.duplicate, message: result.message }
  });
});
