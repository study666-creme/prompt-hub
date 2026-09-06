import { Hono } from 'hono';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import {
  parseWebhookBody,
  processPaymentWebhook,
  verifyWebhookSignature
} from '../../lib/payment';
import { completeEpayOrder } from '../../lib/epay';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.on(['GET', 'POST'], '/epay', async c => {
  const key = c.env.EPAY_MERCHANT_KEY?.trim();
  if (!key) return c.text('fail');
  const params: Record<string, string> = {};
  const query = c.req.query();
  Object.entries(query).forEach(([name, value]) => { params[name] = String(value); });
  if (c.req.method === 'POST') {
    const body = await c.req.parseBody();
    Object.entries(body).forEach(([name, value]) => { params[name] = String(value); });
  }
  try {
    await completeEpayOrder(createAdminClient(c.env), params, key);
    return c.text('success');
  } catch (error) {
    console.error('[payment] callback rejected', error instanceof Error ? error.message : String(error));
    return c.text('fail');
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
