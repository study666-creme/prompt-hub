import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError } from './errors';
import { getOrCreateProfile } from './supabase';

const webhookSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('credits.topup'),
    eventId: z.string().min(8).max(128),
    userId: z.string().uuid(),
    credits: z.number().int().positive().max(1_000_000),
    note: z.string().max(200).optional()
  }),
  z.object({
    type: z.literal('membership.grant'),
    eventId: z.string().min(8).max(128),
    userId: z.string().uuid(),
    tier: z.enum(['basic', 'standard', 'pro']),
    days: z.number().int().positive().max(3650).optional(),
    until: z.string().datetime().optional(),
    credits: z.number().int().nonnegative().max(1_000_000).optional(),
    markFirstSubOfferUsed: z.boolean().optional()
  })
]);

export type PaymentWebhookPayload = z.infer<typeof webhookSchema>;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined
): Promise<void> {
  if (!secret) {
    throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', '支付 webhook 未配置');
  }
  if (!signatureHeader?.startsWith('sha256=')) {
    throw new ApiError(401, 'INVALID_SIGNATURE', '缺少有效签名');
  }
  const expected = await hmacSha256Hex(secret, rawBody);
  const received = signatureHeader.slice(7);
  if (!timingSafeEqualHex(expected, received)) {
    throw new ApiError(401, 'INVALID_SIGNATURE', '签名无效');
  }
}

export async function processPaymentWebhook(
  admin: SupabaseClient,
  payload: PaymentWebhookPayload
): Promise<{ duplicate: boolean; message: string }> {
  const { data: existing } = await admin
    .from('payment_webhook_events')
    .select('event_id')
    .eq('event_id', payload.eventId)
    .maybeSingle();

  if (existing) {
    return { duplicate: true, message: '事件已处理' };
  }

  if (payload.type === 'credits.topup') {
    await getOrCreateProfile(admin, payload.userId);
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: payload.userId,
      p_delta: payload.credits,
      p_reason: 'payment_topup',
      p_ref_id: payload.eventId,
      p_meta: { note: payload.note ?? null }
    });
    if (creditErr) throw creditErr;
  } else {
    const until =
      payload.until ??
      (payload.days
        ? new Date(Date.now() + payload.days * 86400000).toISOString()
        : null);

    await getOrCreateProfile(admin, payload.userId);

    const profilePatch: Record<string, unknown> = {
      membership_tier: payload.tier,
      membership_until: until
    };
    if (payload.markFirstSubOfferUsed) {
      profilePatch.first_sub_offer_used = true;
    }

    const { error: profileErr } = await admin
      .from('profiles')
      .update(profilePatch)
      .eq('user_id', payload.userId);
    if (profileErr) throw profileErr;

    if (payload.credits && payload.credits > 0) {
      const { error: creditErr } = await admin.rpc('apply_credit_delta', {
        p_user_id: payload.userId,
        p_delta: payload.credits,
        p_reason: 'subscription_grant',
        p_ref_id: payload.eventId,
        p_meta: { tier: payload.tier }
      });
      if (creditErr) throw creditErr;
    }
  }

  const { error: logErr } = await admin.from('payment_webhook_events').insert({
    event_id: payload.eventId,
    event_type: payload.type,
    user_id: payload.userId,
    payload
  });
  if (logErr) throw logErr;

  return {
    duplicate: false,
    message: payload.type === 'credits.topup' ? '积分已入账' : '会员已开通'
  };
}

export function parseWebhookBody(raw: unknown): PaymentWebhookPayload {
  const parsed = webhookSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Webhook 载荷无效');
  }
  return parsed.data;
}
