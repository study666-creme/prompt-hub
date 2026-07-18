import type { SupabaseClient } from '@supabase/supabase-js';
import SparkMD5 from 'spark-md5';
import type { Env } from '../env';
import { ApiError } from './errors';
import { grantBundleForActiveMembership, syncMembershipCredits } from './membership-credits';
import { buildMembershipExtensionPatch } from './membership-tasks';
import { getOrCreateProfile, resolveMembershipRollover, type Profile } from './supabase';

export type EpayMethod = 'alipay' | 'wxpay';
export type CreditGrantMode = 'daily' | 'bundle';

type CreditProduct = { kind: 'credits'; id: string; amountCents: number; credits: number };
type MembershipProduct = { kind: 'membership'; id: string; amountCents: number; tier: NonNullable<Profile['membership_tier']>; days: number };
export type PaymentProduct = CreditProduct | MembershipProduct;
export type StoredPaymentOrder = {
  user_id: string;
  product_kind: 'credits' | 'membership';
  product_id: string;
  amount_cents: number;
  credits: number;
  membership_tier: Profile['membership_tier'];
  membership_days: number | null;
  credit_grant_mode: CreditGrantMode | null;
  payment_method: EpayMethod;
  created_at: string;
  state?: 'pending' | 'processing' | 'paid' | 'failed';
  provider_trade_no?: string | null;
  paid_at?: string | null;
  membership_grant_patch?: Record<string, unknown>;
};

const PAYMENT_ORDER_NOTE_PREFIX = 'payment-order:';

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

export const PAYMENT_PRODUCTS = [...CREDIT_PRODUCTS, ...MEMBERSHIP_PRODUCTS];

export function findPaymentProduct(id: string): PaymentProduct | undefined {
  return PAYMENT_PRODUCTS.find(product => product.id === id);
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
  const site = env.EPAY_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || 'https://prompt-hubs.com';
  if (!pid || !key || !base || !callbackBase) throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', '在线支付暂未配置');

  const params: Record<string, string> = {
    pid,
    type: input.method,
    out_trade_no: input.orderNo,
    notify_url: callbackBase + '/api/v1/webhooks/epay',
    return_url: site + '/?payment=return&order=' + encodeURIComponent(input.orderNo),
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

export async function completeEpayOrder(admin: SupabaseClient, params: Record<string, string>, merchantKey: string): Promise<void> {
  if (!verifyEpaySignature(params, merchantKey)) throw new ApiError(401, 'INVALID_SIGNATURE', '支付通知签名无效');
  if (params.trade_status !== 'TRADE_SUCCESS') throw new ApiError(400, 'PAYMENT_INCOMPLETE', '订单尚未支付成功');
  const orderNo = String(params.out_trade_no || '').trim();
  const { data: event, error: orderError } = await admin.from('activation_codes').select('code,used_count,note').eq('code', orderNo).maybeSingle();
  const order = decodePaymentOrderNote(event?.note);
  if (orderError || !event || !order) throw new ApiError(404, 'ORDER_NOT_FOUND', '支付订单不存在');
  if (order.state === 'paid') return;
  if (order.payment_method !== params.type) throw new ApiError(400, 'PAYMENT_METHOD_MISMATCH', '支付方式不匹配');
  if (moneyToCents(params.money) !== order.amount_cents) throw new ApiError(400, 'PAYMENT_AMOUNT_MISMATCH', '支付金额不匹配');

  const processingOrder: StoredPaymentOrder = { ...order, state: 'processing' };
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
      const { data: existing } = await admin.from('credit_ledger').select('id').eq('reason', 'payment_topup').eq('ref_id', orderNo).maybeSingle();
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
    } else {
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
    }
    const paidOrder: StoredPaymentOrder = { ...claimed, state: 'paid', provider_trade_no: params.trade_no || null, paid_at: new Date().toISOString() };
    const { error: paidError } = await admin.from('activation_codes').update({
      note: encodePaymentOrderNote(paidOrder)
    }).eq('code', orderNo).eq('used_count', 1);
    if (paidError) throw paidError;
  } catch (error) {
    await admin.from('activation_codes').update({ used_count: 0, note: encodePaymentOrderNote({ ...claimed, state: 'pending' }) }).eq('code', orderNo).eq('used_count', 1);
    throw error;
  }
}

function moneyToCents(value: string | undefined): number {
  const money = Number(value);
  if (!Number.isFinite(money) || money <= 0) return -1;
  return Math.round(money * 100);
}
