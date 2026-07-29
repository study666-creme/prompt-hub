import type { SupabaseClient } from '@supabase/supabase-js';
import SparkMD5 from 'spark-md5';
import type { Env } from '../env';
import { ApiError } from './errors';
import { grantBundleForActiveMembership, syncMembershipCredits } from './membership-credits';
import { buildMembershipExtensionPatch } from './membership-tasks';
import { getOrCreateProfile, resolveMembershipRollover, type Profile } from './supabase';

export type EpayMethod = 'alipay' | 'wxpay';
export type CreditGrantMode = 'daily' | 'bundle';
export type PaymentReturnTarget = 'card-library' | 'canvas';

type CreditProduct = { kind: 'credits'; id: string; amountCents: number; credits: number };
type MembershipProduct = { kind: 'membership'; id: string; amountCents: number; tier: NonNullable<Profile['membership_tier']>; days: number };
type CollaborationSeatProduct = { kind: 'collaboration_seat'; id: string; amountCents: number; seats: number };
export type PaymentProduct = CreditProduct | MembershipProduct | CollaborationSeatProduct;
export type StoredPaymentOrder = {
  user_id: string;
  product_kind: 'credits' | 'membership' | 'collaboration_seat';
  product_id: string;
  amount_cents: number;
  credits: number;
  membership_tier: Profile['membership_tier'];
  membership_days: number | null;
  collaboration_seats?: number | null;
  credit_grant_mode: CreditGrantMode | null;
  payment_method: EpayMethod;
  created_at: string;
  state?: 'pending' | 'processing' | 'paid' | 'failed';
  processing_at?: string | null;
  provider_trade_no?: string | null;
  paid_at?: string | null;
  return_url?: string;
  membership_grant_patch?: Record<string, unknown>;
};

const PAYMENT_ORDER_NOTE_PREFIX = 'payment-order:';
export const CUSTOM_CREDIT_PRODUCT_ID = 'points-custom';
export const MIN_CUSTOM_TOP_UP_CENTS = 500;
export const MAX_CUSTOM_TOP_UP_CENTS = 500_000;
export const CREDITS_PER_YUAN = 100;
export const CANVAS_COLLABORATION_SEAT_PRODUCT_ID = 'canvas-collaboration-seat-1';

export function encodePaymentOrderNote(order: StoredPaymentOrder): string {
  return PAYMENT_ORDER_NOTE_PREFIX + JSON.stringify(order);
}

export function decodePaymentOrderNote(note: unknown): StoredPaymentOrder | null {
  const value = String(note || '');
  if (!value.startsWith(PAYMENT_ORDER_NOTE_PREFIX)) return null;
  try {
    const order = JSON.parse(value.slice(PAYMENT_ORDER_NOTE_PREFIX.length));
    return order && typeof order === 'object' ? order as StoredPaymentOrder : null;
  } catch {
    return null;
  }
}

const CREDIT_PRODUCTS: CreditProduct[] = [
  { kind: 'credits', id: 'points-10', amountCents: 1000, credits: 1000 },
  { kind: 'credits', id: 'points-20', amountCents: 2000, credits: 2000 },
  { kind: 'credits', id: 'points-50', amountCents: 5000, credits: 5000 },
  { kind: 'credits', id: 'points-100', amountCents: 10000, credits: 10000 },
  { kind: 'credits', id: 'points-200', amountCents: 20000, credits: 20000 },
  { kind: 'credits', id: 'points-500', amountCents: 50000, credits: 50000 }
];

const MEMBERSHIP_PRODUCTS: MembershipProduct[] = [
  { kind: 'membership', id: 'member-lite-month', amountCents: 600, tier: 'lite', days: 30 },
  { kind: 'membership', id: 'member-basic-month', amountCents: 1290, tier: 'basic', days: 30 },
  { kind: 'membership', id: 'member-standard-month', amountCents: 3190, tier: 'standard', days: 30 },
  { kind: 'membership', id: 'member-pro-month', amountCents: 6390, tier: 'pro', days: 30 }
];

const COLLABORATION_SEAT_PRODUCTS: CollaborationSeatProduct[] = [
  { kind: 'collaboration_seat', id: CANVAS_COLLABORATION_SEAT_PRODUCT_ID, amountCents: 1500, seats: 1 }
];

export const PAYMENT_PRODUCTS = [...CREDIT_PRODUCTS, ...MEMBERSHIP_PRODUCTS, ...COLLABORATION_SEAT_PRODUCTS];

export function collaborationSeatProductEnabled(env: Pick<Env, 'CANVAS_COLLABORATION_SEAT_PRODUCT_ENABLED'>): boolean {
  return /^(?:1|true)$/i.test(env.CANVAS_COLLABORATION_SEAT_PRODUCT_ENABLED?.trim() || '');
}

export function findPaymentProduct(id: string, allowCollaborationSeat = false): PaymentProduct | undefined {
  const product = PAYMENT_PRODUCTS.find(candidate => candidate.id === id);
  return product?.kind === 'collaboration_seat' && !allowCollaborationSeat ? undefined : product;
}

export function createCustomCreditProduct(amountYuan: number): CreditProduct {
  const amountCents = Math.round(amountYuan * 100);
  if (
    !Number.isFinite(amountYuan)
    || Math.abs(amountYuan * 100 - amountCents) > 1e-6
    || amountCents < MIN_CUSTOM_TOP_UP_CENTS
    || amountCents > MAX_CUSTOM_TOP_UP_CENTS
  ) {
    throw new ApiError(
      400,
      'INVALID_CUSTOM_TOP_UP',
      `自定义充值金额必须在 ¥${MIN_CUSTOM_TOP_UP_CENTS / 100} 至 ¥${MAX_CUSTOM_TOP_UP_CENTS / 100} 之间，最多两位小数`
    );
  }
  return {
    kind: 'credits',
    id: CUSTOM_CREDIT_PRODUCT_ID,
    amountCents,
    credits: amountCents
  };
}

function publicSite(env: Env): string {
  return (env.EPAY_PUBLIC_SITE_URL?.trim() || env.PUBLIC_SITE_URL?.trim() || 'https://prompt-hubs.com').replace(/\/+$/, '');
}

function canvasSite(env: Env): string {
  return (env.EPAY_CANVAS_SITE_URL?.trim() || 'https://canvas.prompt-hubs.com').replace(/\/+$/, '');
}

export function resolvePaymentReturnUrl(
  env: Env,
  target?: PaymentReturnTarget,
  path?: string
): string {
  if (target !== 'canvas') return publicSite(env);
  return new URL(path || '/canvas', canvasSite(env) + '/').toString();
}

export function safePaymentReturnUrl(env: Env, value: unknown): string {
  const fallback = publicSite(env);
  try {
    const url = new URL(String(value || ''));
    const allowedOrigins = [fallback, canvasSite(env)].map(candidate => new URL(candidate).origin);
    return allowedOrigins.includes(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function appendPaymentResult(returnUrl: string, result: 'success' | 'processing'): string {
  const url = new URL(returnUrl);
  url.searchParams.set('payment', result);
  return url.toString();
}

export function signEpay(params: Record<string, string>, key: string): string {
  const content = Object.keys(params)
    .filter(name => name !== 'sign' && name !== 'sign_type' && params[name] !== '')
    .sort()
    .map(name => name + '=' + params[name])
    .join('&');
  return SparkMD5.hash(content + key).toLowerCase();
}

export function verifyEpaySignature(params: Record<string, string>, key: string): boolean {
  const expected = signEpay(params, key);
  const received = String(params.sign || '').toLowerCase();
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

export async function createEpayCheckout(
  env: Env,
  input: { orderNo: string; method: EpayMethod; amountCents: number; name: string; clientIp?: string }
): Promise<string> {
  const pid = env.EPAY_MERCHANT_ID?.trim();
  const key = env.EPAY_MERCHANT_KEY?.trim();
  const base = env.EPAY_API_BASE_URL?.trim().replace(/\/$/, '');
  const callbackBase = env.EPAY_CALLBACK_BASE_URL?.trim().replace(/\/$/, '');
  if (!pid || !key || !base || !callbackBase) throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', '在线支付暂未配置');

  const params: Record<string, string> = {
    pid,
    type: input.method,
    out_trade_no: input.orderNo,
    notify_url: callbackBase + '/api/v1/webhooks/epay',
    return_url: callbackBase + '/api/v1/webhooks/epay/return',
    name: input.name,
    money: (input.amountCents / 100).toFixed(2),
    clientip: input.clientIp || '',
    device: 'pc',
    sign_type: 'MD5'
  };
  params.sign = signEpay(params, key);

  if (!/^https?:\/\/[^\s]+$/i.test(base)) {
    throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', '在线支付地址配置无效');
  }
  const query = Object.entries(params)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${base}/submit.php?${query}`;
}

export type EpayCallbackStatus = 'received' | 'settled' | 'failed';

/** Persist a redacted callback event without allowing monitoring writes to
 * block payment settlement. Repeated callbacks for the same lifecycle state
 * remain idempotent through the event_id conflict key. */
export async function recordEpayCallbackEvent(
  admin: SupabaseClient,
  params: Record<string, string>,
  status: EpayCallbackStatus,
  error?: unknown,
): Promise<void> {
  try {
    const orderNo = String(params.out_trade_no || 'unknown').trim().slice(0, 80) || 'unknown';
    const tradeNo = String(params.trade_no || '').trim().slice(0, 80);
    const fingerprint = SparkMD5.hash(JSON.stringify(Object.keys(params).sort().map(key => [key, params[key]]))).slice(0, 16);
    const eventId = `epay:${orderNo}:${status}:${tradeNo || fingerprint}`.slice(0, 128);
    const payload: Record<string, unknown> = {
      provider: 'epay',
      status,
      orderNo,
      tradeNo: tradeNo || null,
      type: String(params.type || '').slice(0, 24) || null,
      tradeStatus: String(params.trade_status || '').slice(0, 32) || null,
      money: String(params.money || '').slice(0, 32) || null,
      signType: String(params.sign_type || '').slice(0, 16) || null,
      ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 240) } : {})
    };
    const { error: writeError } = await admin.from('payment_webhook_events').upsert({
      event_id: eventId,
      event_type: `epay.${status}`,
      user_id: null,
      payload,
      processed_at: new Date().toISOString()
    }, { onConflict: 'event_id' });
    if (writeError) console.warn('[payment] callback event write failed', writeError);
  } catch (writeError) {
    console.warn('[payment] callback event write failed', writeError);
  }
}

export async function completeEpayOrder(
  admin: SupabaseClient,
  params: Record<string, string>,
  merchant: { merchantId: string; merchantKey: string }
): Promise<void> {
  // Reject unauthenticated traffic before it can create monitoring rows. The
  // settlement path validates again so direct callers remain protected.
  validateEpayCallback(params, merchant);
  await recordEpayCallbackEvent(admin, params, 'received');
  try {
    await settleEpayOrder(admin, params, merchant);
    await recordEpayCallbackEvent(admin, params, 'settled');
  } catch (error) {
    await recordEpayCallbackEvent(admin, params, 'failed', error);
    throw error;
  }
}

async function settleEpayOrder(
  admin: SupabaseClient,
  params: Record<string, string>,
  merchant: { merchantId: string; merchantKey: string }
): Promise<void> {
  const callback = validateEpayCallback(params, merchant);
  if (!verifyEpaySignature(params, merchant.merchantKey)) throw new ApiError(401, 'INVALID_SIGNATURE', '支付通知签名无效');
  if (params.pid !== merchant.merchantId) throw new ApiError(400, 'PAYMENT_MERCHANT_MISMATCH', '支付商户号不匹配');
  if (params.trade_status !== 'TRADE_SUCCESS') throw new ApiError(400, 'PAYMENT_INCOMPLETE', '订单尚未支付成功');
  const orderNo = String(params.out_trade_no || '').trim();
  const { data: durableOrder, error: durableOrderError } = await admin
    .from('payment_orders')
    .select('order_no,product_kind')
    .eq('order_no', orderNo)
    .maybeSingle();
  if (durableOrderError) throw durableOrderError;
  if (durableOrder?.product_kind === 'collaboration_seat') {
    const { error: settlementError } = await admin.rpc('settle_canvas_seat_payment', {
      p_order_no: orderNo,
      p_provider_trade_no: callback.providerTradeNo,
      p_payment_method: params.type,
      p_amount_cents: callback.amountCents,
      p_event_id: `epay:settled:${callback.providerTradeNo}`.slice(0, 128),
      p_event_payload: {
        type: params.type,
        tradeStatus: params.trade_status,
        money: params.money,
        signType: params.sign_type || null
      }
    });
    if (settlementError) throw settlementError;
    return;
  }
  const { data: event, error: orderError } = await admin.from('activation_codes').select('code,used_count,note').eq('code', orderNo).maybeSingle();
  let order = decodePaymentOrderNote(event?.note);
  if (orderError || !event || !order) throw new ApiError(404, 'ORDER_NOT_FOUND', '支付订单不存在');
  if (order.state === 'paid') return;
  if (order.payment_method !== params.type) throw new ApiError(400, 'PAYMENT_METHOD_MISMATCH', '支付方式不匹配');
  if (moneyToCents(params.money) !== order.amount_cents) throw new ApiError(400, 'PAYMENT_AMOUNT_MISMATCH', '支付金额不匹配');

  if (order.state === 'processing') {
    throw new ApiError(409, 'ORDER_PROCESSING', '订单正在处理，请联系客服核查');
  }

  const processingOrder: StoredPaymentOrder = {
    ...order,
    state: 'processing',
    processing_at: new Date().toISOString()
  };
  const { data: claimedEvent, error: claimError } = await admin
    .from('activation_codes')
    .update({ used_count: 1, note: encodePaymentOrderNote(processingOrder) })
    .eq('code', orderNo)
    .eq('used_count', 0)
    .select('code,used_count,note')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimedEvent) {
    const { data: latest } = await admin.from('activation_codes').select('note').eq('code', orderNo).maybeSingle();
    if (decodePaymentOrderNote(latest?.note)?.state === 'paid') return;
    throw new ApiError(409, 'ORDER_PROCESSING', '订单正在处理');
  }
  let claimed = decodePaymentOrderNote(claimedEvent.note) || processingOrder;

  try {
    if (claimed.product_kind === 'credits') {
      const { data: existing } = await admin
        .from('credit_ledger')
        .select('id')
        .eq('user_id', claimed.user_id)
        .eq('reason', 'payment_topup')
        .eq('ref_id', orderNo)
        .maybeSingle();
      if (!existing) {
        const { error } = await admin.rpc('apply_credit_delta', {
          p_user_id: claimed.user_id,
          p_delta: claimed.credits,
          p_reason: 'payment_topup',
          p_ref_id: orderNo,
          p_meta: { productId: claimed.product_id }
        });
        if (error) throw error;
      }
    } else if (claimed.product_kind === 'membership') {
      let profile = await resolveMembershipRollover(admin, await getOrCreateProfile(admin, claimed.user_id));
      const tier = claimed.membership_tier as NonNullable<Profile['membership_tier']>;
      const mode: CreditGrantMode = tier === 'lite' ? 'daily' : (claimed.credit_grant_mode || 'daily');
      let membershipPatch = claimed.membership_grant_patch as Record<string, unknown> | undefined;
      if (!membershipPatch || typeof membershipPatch !== 'object') {
        membershipPatch = buildMembershipExtensionPatch(profile, claimed.membership_days || 30, tier, {
          creditGrantMode: mode
        });
        const { data: recordedEvent, error: recordError } = await admin
          .from('activation_codes')
          .update({ note: encodePaymentOrderNote({ ...claimed, membership_grant_patch: membershipPatch }) })
          .eq('code', orderNo)
          .eq('used_count', 1)
          .select('note')
          .single();
        if (recordError) throw recordError;
        claimed = decodePaymentOrderNote(recordedEvent.note) || { ...claimed, membership_grant_patch: membershipPatch };
      }
      if (!membershipPatch) throw new ApiError(500, 'MEMBERSHIP_PATCH_MISSING', '会员权益变更未准备好');
      const { data: updatedProfile, error: membershipError } = await admin
        .from('profiles')
        .update(membershipPatch)
        .eq('user_id', claimed.user_id)
        .select()
        .single();
      if (membershipError) throw membershipError;
      profile = updatedProfile as Profile;
      if (mode === 'bundle') await grantBundleForActiveMembership(admin, profile, { membershipDays: claimed.membership_days || 30 });
      else await syncMembershipCredits(admin, claimed.user_id);
    } else {
      const seats = claimed.collaboration_seats;
      if (!Number.isSafeInteger(seats) || !seats || seats < 1 || seats > 100) {
        throw new ApiError(500, 'COLLABORATION_SEAT_ORDER_INVALID', '协作席位订单数据无效');
      }
      const providerTradeNo = String(params.trade_no || '').trim();
      if (!providerTradeNo) throw new ApiError(400, 'PAYMENT_TRADE_MISSING', '支付流水号缺失');
      const { error: grantError } = await admin.rpc('canvas_grant_collaboration_seats', {
        p_owner_id: claimed.user_id,
        p_order_no: orderNo,
        p_seat_count: seats,
        p_amount_cents: claimed.amount_cents,
        p_provider_trade_no: providerTradeNo
      });
      if (grantError) throw grantError;
    }
    const paidOrder: StoredPaymentOrder = {
      ...claimed,
      state: 'paid',
      processing_at: null,
      provider_trade_no: params.trade_no || null,
      paid_at: new Date().toISOString()
    };
    const { error: paidError } = await admin.from('activation_codes').update({
      note: encodePaymentOrderNote(paidOrder)
    }).eq('code', orderNo).eq('used_count', 1);
    if (paidError) throw paidError;
  } catch (error) {
    await admin.from('activation_codes').update({
      used_count: 0,
      note: encodePaymentOrderNote({ ...claimed, state: 'pending', processing_at: null })
    }).eq('code', orderNo).eq('used_count', 1);
    throw error;
  }
}

function validateEpayCallback(
  params: Record<string, string>,
  merchant: { merchantId: string; merchantKey: string }
) {
  if (!verifyEpaySignature(params, merchant.merchantKey)) {
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Invalid payment signature');
  }
  if (params.pid !== merchant.merchantId) {
    throw new ApiError(400, 'PAYMENT_MERCHANT_MISMATCH', 'Payment merchant does not match');
  }
  if (params.trade_status !== 'TRADE_SUCCESS') {
    throw new ApiError(400, 'PAYMENT_INCOMPLETE', 'Payment is not complete');
  }
  if (params.sign_type && params.sign_type.toUpperCase() !== 'MD5') {
    throw new ApiError(400, 'PAYMENT_SIGNATURE_TYPE_MISMATCH', 'Payment signature type does not match');
  }
  if (params.type !== 'alipay' && params.type !== 'wxpay') {
    throw new ApiError(400, 'PAYMENT_METHOD_MISMATCH', 'Payment method does not match');
  }
  const orderNo = String(params.out_trade_no || '').trim();
  if (!/^PAY[A-Z0-9-]+$/.test(orderNo) || orderNo.length > 80) {
    throw new ApiError(400, 'ORDER_NOT_FOUND', 'Payment order does not exist');
  }
  const providerTradeNo = String(params.trade_no || '').trim();
  if (!providerTradeNo || providerTradeNo.length > 80) {
    throw new ApiError(400, 'PAYMENT_TRADE_MISSING', 'Payment trade number is missing');
  }
  const amountCents = moneyToCents(params.money);
  if (amountCents < 1) {
    throw new ApiError(400, 'PAYMENT_AMOUNT_INVALID', 'Payment amount is invalid');
  }
  return { orderNo, providerTradeNo, amountCents };
}

export function moneyToCents(value: string | undefined): number {
  const normalized = String(value || '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) return -1;
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : -1;
}
