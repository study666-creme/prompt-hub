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

/**
 * 写一条积分流水；写失败不抛（扣费/发放主流程优先），仅记录日志供排查。
 * 所有每日积分（daily_credits）的发放、扣减、退款、过期清零都必须经过这里，
 * 否则积分明细（credit_ledger）里看不到对应的余额变动。
 */
async function insertLedgerRow(
  admin: SupabaseClient,
  row: {
    user_id: string;
    delta: number;
    balance_after: number;
    reason: string;
    ref_id: string;
    meta: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await admin.from('credit_ledger').insert(row);
    if (error) {
      console.error('[credits] ledger insert failed:', error, {
        userId: row.user_id,
        reason: row.reason,
        refId: row.ref_id,
        delta: row.delta
      });
    }
  } catch (e) {
    // 留痕失败绝不阻断积分发放/扣减主链路（例如降级环境无 credit_ledger 权限）
    console.error('[credits] ledger insert threw:', e instanceof Error ? e.message : String(e), {
      userId: row.user_id,
      reason: row.reason,
      refId: row.ref_id
    });
  }
}

/**
 * 每日积分日切留痕：上一日剩余记一条过期清零流水（如有），实际入账记一条
 * 发放流水。balance_after 统一用可花总额（永久 + 当日剩余），与钱包顶栏一致。
 */
export async function writeDailyGrantLedger(
  admin: SupabaseClient,
  args: {
    userId: string;
    today: string;
    /** 发放前永久积分余额（发放只动 daily 池，可直接取更新后 credits） */
    permanent: number;
    /** 上一日剩余被作废的数额（sameDay 重复领取时为 0） */
    expiredStale: number;
    /** 实际新增入账（同日重复领取取大不叠加时可能为 0） */
    granted: number;
    /** 发放后当日剩余 */
    dailyAfter: number;
    reason: string;
    refId: string;
    extraMeta?: Record<string, unknown>;
  }
): Promise<void> {
  if (args.expiredStale > 0) {
    await insertLedgerRow(admin, {
      user_id: args.userId,
      delta: -args.expiredStale,
      balance_after: roundCredits(args.permanent),
      reason: 'daily_expire',
      ref_id: `${args.refId}:expire`,
      meta: {
        pool: 'daily',
        expired: args.expiredStale,
        date: args.today,
        note: '上一日剩余每日积分过期清零',
        ...(args.extraMeta ?? {})
      }
    });
  }
  if (args.granted > 0) {
    await insertLedgerRow(admin, {
      user_id: args.userId,
      delta: args.granted,
      balance_after: roundCredits(args.permanent + args.dailyAfter),
      reason: args.reason,
      ref_id: args.refId,
      meta: {
        pool: 'daily',
        dailyAfter: args.dailyAfter,
        permanentAfter: args.permanent,
        date: args.today,
        ...(args.extraMeta ?? {})
      }
    });
  }
}

/** 任务中心每日 5 积分：写入当日有效额度（可与会员日积分叠加取较大值） */
export async function grantUniversalDailyBonus(
  admin: SupabaseClient,
  userId: string,
  amount = 5,
  before?: Profile
): Promise<Profile> {
  const today = chinaDateKey();
  // 流水留痕需要 before 快照：优先复用调用方已持有的 profile，避免额外读
  const profileBefore = before ?? (await getOrCreateProfile(admin, userId));
  const sameDayBefore = profileBefore.daily_credits_date === today;
  const storedDailyBefore = Number(profileBefore.daily_credits) || 0;
  const prevUsable = sameDayBefore ? storedDailyBefore : 0;
  const expiredStale = sameDayBefore ? 0 : storedDailyBefore;
  const { data, error } = await admin.rpc('grant_user_daily_credits', {
    p_user_id: userId,
    p_amount: roundCredits(amount),
    p_mode: 'universal'
  });
  if (error) throw error;
  const updated = data as Profile;
  const granted = Math.max(0, (Number(updated.daily_credits) || 0) - prevUsable);
  await writeDailyGrantLedger(admin, {
    userId,
    today,
    permanent: Number(updated.credits) || 0,
    expiredStale,
    granted,
    dailyAfter: Number(updated.daily_credits) || 0,
    reason: 'daily_checkin',
    refId: `daily-bonus:${userId}:${today}`
  });
  return updated;
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

  const today = chinaDateKey();
  // 流水留痕：before 值来自入参 profile（调用方在锁内刷新过），after 由 RPC 返回
  const sameDay = profile.daily_credits_date === today;
  const storedDaily = Number(profile.daily_credits) || 0;
  const prevUsable = sameDay ? storedDaily : 0;
  const expiredStale = sameDay ? 0 : storedDaily;
  const { data, error } = await admin.rpc('grant_user_daily_credits', {
    p_user_id: profile.user_id,
    p_amount: roundCredits(amount),
    p_mode: 'member'
  });
  if (error) throw error;
  const updated = data as Profile;
  const granted = Math.max(0, (Number(updated.daily_credits) || 0) - prevUsable);
  await writeDailyGrantLedger(admin, {
    userId: profile.user_id,
    today,
    permanent: Number(updated.credits) || 0,
    expiredStale,
    granted,
    dailyAfter: Number(updated.daily_credits) || 0,
    reason: 'daily_grant',
    refId: `daily-grant:${profile.user_id}:${today}`,
    extraMeta: { tier: profile.membership_tier ?? null }
  });
  return updated;
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
  if (!Number.isFinite(rawAmount)) {
    throw new Error('amount_invalid');
  }
  amount = roundCredits(rawAmount);
  if (amount <= 0) {
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
  };}

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
  if (error) throw error;}

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
