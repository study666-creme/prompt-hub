import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';
import { roundCredits } from './credit-math';

export type CreditGrantMode = 'daily' | 'bundle';

/** 兼容旧引用；新逻辑请用 dailyCreditsForTier */
export const DAILY_CREDITS_AMOUNT = 10;

export const DAILY_CREDITS_BY_TIER: Record<
  NonNullable<Profile['membership_tier']>,
  number
> = {
  lite: 10,
  basic: 13,
  standard: 32,
  pro: 64
};

export function dailyCreditsForTier(
  tier: Profile['membership_tier']
): number {
  if (!tier) return DAILY_CREDITS_BY_TIER.basic;
  return DAILY_CREDITS_BY_TIER[tier] ?? 10;
}

export const TIER_LUMP_CREDITS: Record<
  NonNullable<Profile['membership_tier']>,
  number
> = {
  lite: 0,
  basic: 130,
  standard: 320,
  pro: 700
};

/** 标准月卡（30 天）一次性 bundle 总额；仅用于 ≥30 天。短于 30 天应走 daily（兑换侧已强制），此处不做 bundle 发放 */
export function bundleCreditsForMembershipDays(
  tier: Profile['membership_tier'],
  membershipDays: number
): number {
  if (!tier) return 0;
  const fullMonth = TIER_LUMP_CREDITS[tier] ?? 0;
  if (fullMonth <= 0) return 0;
  const days = Math.max(1, Math.min(Math.round(membershipDays), 365));
  if (days < 30) return 0;
  return fullMonth;
}

export type BundleGrantOptions = {
  /** 本次兑换/续期的会员天数；缺省时按 30 天月卡处理（兼容旧调用） */
  membershipDays?: number;
};

/** 中国时区自然日 YYYY-MM-DD */
export function chinaDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    d
  );
}

export function spendableCredits(profile: Profile): number {
  const daily =
    profile.daily_credits_date === chinaDateKey() ? Number(profile.daily_credits) || 0 : 0;
  return Number(profile.credits) + daily;
}

/** 任务中心每日 5 积分：写入当日有效额度（可与会员日积分叠加取较大值） */
export async function grantUniversalDailyBonus(
  admin: SupabaseClient,
  userId: string,
  amount = 5
): Promise<Profile> {
  const { data, error } = await admin.rpc('grant_user_daily_credits', {
    p_user_id: userId,
    p_amount: roundCredits(amount),
    p_mode: 'universal'
  });
  if (error) throw error;
  return data as Profile;
}

export async function refreshDailyCredits(
  admin: SupabaseClient,
  profile: Profile
): Promise<Profile> {
  if (
    !isMembershipActive(profile) ||
    profile.credit_grant_mode !== 'daily'
  ) {
    return profile;
  }
  const amount = dailyCreditsForTier(profile.membership_tier);
  const { data, error } = await admin.rpc('refresh_user_daily_credits', {
    p_user_id: profile.user_id,
    p_amount: roundCredits(amount)
  });

  if (error) throw error;
  return data as Profile;
}

export async function grantBundleForActiveMembership(
  admin: SupabaseClient,
  profile: Profile,
  opts?: BundleGrantOptions
): Promise<Profile> {
  if (
    !isMembershipActive(profile) ||
    profile.credit_grant_mode !== 'bundle' ||
    !profile.membership_tier
  ) {
    return profile;
  }

  const periodKey = profile.membership_until || 'open';
  if (profile.bundle_granted_until === periodKey) return profile;

  const membershipDays = opts?.membershipDays ?? 30;
  const amount = bundleCreditsForMembershipDays(profile.membership_tier, membershipDays);
  if (amount <= 0) return profile;

  const { data, error: creditErr } = await admin.rpc('grant_membership_bundle', {
    p_user_id: profile.user_id,
    p_amount: roundCredits(amount),
    p_reason: 'subscription_grant',
    p_ref_id: `bundle:${periodKey}:${membershipDays}d`,
    p_period_until: profile.membership_until,
    p_meta: {
      tier: profile.membership_tier,
      mode: 'bundle',
      membershipDays
    }
  });
  if (creditErr) throw creditErr;
  return data as Profile;
}

/** 登录 /me 时不再自动发放会员积分（每日积分改在任务中心领取） */
export async function syncMembershipCredits(
  admin: SupabaseClient,
  userId: string
): Promise<Profile> {
  return getOrCreateProfile(admin, userId);
}

/** 任务中心领取当日会员每日积分 */
export async function claimMemberDailyCredits(
  admin: SupabaseClient,
  profile: Profile
): Promise<Profile> {
  if (!isMembershipActive(profile)) throw new Error('membership_inactive');
  if (profile.credit_grant_mode !== 'daily') {
    throw new Error('credit_mode_not_daily');
  }
  const amount = dailyCreditsForTier(profile.membership_tier);
  if (amount <= 0) throw new Error('no_daily_credits');

  const { data, error } = await admin.rpc('grant_user_daily_credits', {
    p_user_id: profile.user_id,
    p_amount: roundCredits(amount),
    p_mode: 'member'
  });
  if (error) throw error;
  return data as Profile;
}

/** Atomically activate the free trial and initialize its daily allowance. */
export async function claimTrialMembership(
  admin: SupabaseClient,
  userId: string,
  membershipUntil: string,
  dailyAmount: number
): Promise<Profile> {
  const { data, error } = await admin.rpc('claim_trial_membership', {
    p_user_id: userId,
    p_membership_until: membershipUntil,
    p_daily_amount: roundCredits(dailyAmount)
  });
  if (error) throw error;
  return data as Profile;
}

/** Atomically switch daily/bundle membership credits under the wallet lock. */
export async function setMembershipCreditMode(
  admin: SupabaseClient,
  userId: string,
  mode: CreditGrantMode
): Promise<Profile> {
  const { data, error } = await admin.rpc('set_membership_credit_mode', {
    p_user_id: userId,
    p_mode: mode
  });
  if (error) throw error;
  return data as Profile;
}

export type DebitSplit = { fromDaily: number; fromPermanent: number };

type CreditOperationResponse = {
  profile?: unknown;
  split?: unknown;
  replayed?: unknown;
};

function readCreditOperationResponse(data: unknown): CreditOperationResponse {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('credit_operation_invalid_response');
  }
  return value as CreditOperationResponse;
}

function readOperationNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOperationProfile(data: unknown): Profile {
  const payload = readCreditOperationResponse(data);
  if (!payload.profile || typeof payload.profile !== 'object' || Array.isArray(payload.profile)) {
    throw new Error('credit_operation_invalid_response');
  }
  return payload.profile as Profile;
}

function readDebitSplit(data: unknown): DebitSplit {
  const payload = readCreditOperationResponse(data);
  const split = payload.split && typeof payload.split === 'object' && !Array.isArray(payload.split)
    ? payload.split as Record<string, unknown>
    : {};
  return {
    fromDaily: Math.max(0, readOperationNumber(split.fromDaily)),
    fromPermanent: Math.max(0, readOperationNumber(split.fromPermanent))
  };
}

export async function deductUserCredits(
  admin: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  refId: string,
  meta: Record<string, unknown> = {}
): Promise<{ profile: Profile; split: DebitSplit; replayed?: boolean }> {
  const rawAmount = Number(amount);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    throw new Error('amount_invalid');
  }
  amount = roundCredits(rawAmount);
  if (amount <= 0) {
    // 计费安全：0 元“扣费”不再是静默成功。只有显式声明的免费场景
    // （免费图模型，当前已退役，仅防历史重放）允许通过；其余 0 金额
    // 一律视为计价事故并报错，任务不得在未扣费状态下继续。
    const metaModel = String(meta.model || '');
    const isLegacyFreeImage = reason === 'image_generation' && /free/i.test(metaModel);
    if (!isLegacyFreeImage) {
      throw new Error('amount_must_be_positive');
    }
    const profile = await syncMembershipCredits(admin, userId);
    return { profile, split: { fromDaily: 0, fromPermanent: 0 } };
  }

  const { data, error } = await admin.rpc('consume_user_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId,
    p_meta: meta
  });
  if (error) throw error;
  const payload = readCreditOperationResponse(data);
  return {
    profile: readOperationProfile(data),
    split: readDebitSplit(data),
    replayed: payload.replayed === true
  };
}

export async function refundUserCredits(
  admin: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  refId: string,
  split: DebitSplit,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const rawAmount = Number(amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;
  const refundAmount = roundCredits(rawAmount);
  if (refundAmount <= 0) return;

  const rawDaily = Number(split?.fromDaily);
  const rawPermanent = Number(split?.fromPermanent);
  const requestedDaily = Number.isFinite(rawDaily) ? Math.max(0, roundCredits(rawDaily)) : 0;
  const requestedPermanent = Number.isFinite(rawPermanent)
    ? Math.max(0, roundCredits(rawPermanent))
    : 0;
  const fromDaily = Math.min(refundAmount, requestedDaily);
  const fromPermanent = Math.min(refundAmount - fromDaily, requestedPermanent);

  const { error } = await admin.rpc('refund_user_credits', {
    p_user_id: userId,
    p_amount: refundAmount,
    p_reason: reason,
    p_ref_id: refId,
    p_from_daily: fromDaily,
    p_from_permanent: fromPermanent,
    p_meta: meta
  });
  if (error) throw error;
}

export function membershipCreditsPayload(profile: Profile) {
  const today = chinaDateKey();
  const dailyActive = profile.daily_credits_date === today && profile.daily_credits > 0;
  const memberActive = isMembershipActive(profile);

  return {
    creditGrantMode: profile.credit_grant_mode,
    creditsPermanent: profile.credits,
    dailyCredits: dailyActive ? profile.daily_credits : 0,
    creditsSpendable: spendableCredits(profile),
    dailyCreditsNote: dailyActive
      ? memberActive && profile.credit_grant_mode === 'daily' && profile.membership_tier
        ? `含今日 ${profile.daily_credits} 积分（当日有效，含会员日额与每日领取）`
        : `含今日 ${profile.daily_credits} 积分（当日有效，未用完次日清零）`
      : memberActive && profile.credit_grant_mode === 'daily' && profile.membership_tier
        ? `每日 ${dailyCreditsForTier(profile.membership_tier)} 积分，请在任务中心领取（当日有效）`
        : null,
    dailyCreditsPerTier: DAILY_CREDITS_BY_TIER
  };
}

/** Legacy compatibility helper; normal paid operations update this in consume_user_credits. */
export async function incrementLifetimeCreditsSpent(
  admin: SupabaseClient,
  userId: string,
  amount: number
): Promise<void> {
  const rawAmount = Number(amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;
  const { error } = await admin.rpc('increment_lifetime_credits_spent', {
    p_user_id: userId,
    p_amount: roundCredits(rawAmount)
  });
  if (error) throw error;
}
