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
  const { error } = await admin.from('credit_ledger').insert(row);
  if (error) {
    console.error('[credits] ledger insert failed:', error, {
      userId: row.user_id,
      reason: row.reason,
      refId: row.ref_id,
      delta: row.delta
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
  amount = 5
): Promise<Profile> {
  const today = chinaDateKey();
  const profile = await getOrCreateProfile(admin, userId);
  const sameDay = profile.daily_credits_date === today;
  const storedDaily = Number(profile.daily_credits) || 0;
  const prevUsable = sameDay ? storedDaily : 0;
  const nextDaily = sameDay ? Math.max(prevUsable, amount) : amount;
  const granted = nextDaily - prevUsable;
  const expiredStale = sameDay ? 0 : storedDaily;
  const { data, error } = await admin
    .from('profiles')
    .update({
      daily_credits: nextDaily,
      daily_credits_date: today,
      credit_grant_mode: profile.credit_grant_mode || 'daily'
    })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  const updated = data as Profile;
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
  const today = chinaDateKey();
  if (profile.daily_credits_date === today) return profile;

  const amount = dailyCreditsForTier(profile.membership_tier);

  const { data, error } = await admin
    .from('profiles')
    .update({
      daily_credits: amount,
      daily_credits_date: today
    })
    .eq('user_id', profile.user_id)
    .select()
    .single();

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

  const { error: creditErr } = await admin.rpc('apply_credit_delta', {
    p_user_id: profile.user_id,
    p_delta: amount,
    p_reason: 'subscription_grant',
    p_ref_id: `bundle:${periodKey}:${membershipDays}d`,
    p_meta: {
      tier: profile.membership_tier,
      mode: 'bundle',
      membershipDays
    }
  });
  if (creditErr) throw creditErr;

  const { data, error } = await admin
    .from('profiles')
    .update({ bundle_granted_until: periodKey })
    .eq('user_id', profile.user_id)
    .select()
    .single();

  if (error) throw error;
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
  const sameDay = profile.daily_credits_date === today;
  const storedDaily = Number(profile.daily_credits) || 0;
  const prevUsable = sameDay ? storedDaily : 0;
  const nextDaily = sameDay ? Math.max(prevUsable, amount) : amount;
  const granted = nextDaily - prevUsable;
  const expiredStale = sameDay ? 0 : storedDaily;

  const { data, error } = await admin
    .from('profiles')
    .update({
      daily_credits: nextDaily,
      daily_credits_date: today
    })
    .eq('user_id', profile.user_id)
    .select()
    .single();
  if (error) throw error;
  const updated = data as Profile;
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

export type DebitSplit = { fromDaily: number; fromPermanent: number };

export async function deductUserCredits(
  admin: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  refId: string,
  meta: Record<string, unknown> = {}
): Promise<{ profile: Profile; split: DebitSplit }> {
  amount = roundCredits(amount);
  if (amount <= 0) {
    const profile = await syncMembershipCredits(admin, userId);
    return { profile, split: { fromDaily: 0, fromPermanent: 0 } };
  }

  let profile = await syncMembershipCredits(admin, userId);
  const total = spendableCredits(profile);
  if (total < amount) {
    throw new Error('insufficient');
  }

  let left = amount;
  let fromDaily = 0;
  const today = chinaDateKey();
  const prevDaily = profile.daily_credits;
  const prevDailyDate = profile.daily_credits_date;

  if (profile.daily_credits_date === today && profile.daily_credits > 0 && left > 0) {
    fromDaily = Math.min(profile.daily_credits, left);
    left -= fromDaily;
    const { data, error } = await admin
      .from('profiles')
      .update({ daily_credits: profile.daily_credits - fromDaily })
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    profile = data as Profile;
  }

  if (left > 0) {
    const { error } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: -left,
      p_reason: reason,
      p_ref_id: refId,
      p_meta: { ...meta, fromDaily, fromPermanent: left }
    });
    if (error) {
      if (fromDaily > 0) {
        await admin
          .from('profiles')
          .update({
            daily_credits: prevDaily,
            daily_credits_date: prevDailyDate
          })
          .eq('user_id', userId);
      }
      throw error;
    }
    profile = await getOrCreateProfile(admin, userId);
  }

  if (reason === 'image_generation' && amount > 0) {
    await incrementLifetimeCreditsSpent(admin, userId, amount);
    profile = await getOrCreateProfile(admin, userId);
  }

  if (fromDaily > 0) {
    // 每日积分扣减也必须留痕：此前只 update profiles.daily_credits、不写
    // credit_ledger，导致积分明细里完全看不到这笔扣费（用户视角 =
    // “扣了钱但没有记录”）。写失败不阻断扣费主链路，仅记录日志。
    const dailyAfter =
      profile.daily_credits_date === today ? Number(profile.daily_credits) || 0 : 0;
    const permanentAfter = Number(profile.credits) || 0;
    await insertLedgerRow(admin, {
      user_id: userId,
      delta: -fromDaily,
      balance_after: roundCredits(permanentAfter + dailyAfter),
      reason,
      ref_id: `${refId}:daily`,
      meta: { ...meta, pool: 'daily', dailyAfter, permanentAfter }
    });
  }

  return { profile, split: { fromDaily, fromPermanent: left } };
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
  if (amount <= 0) return;

  const { fromDaily, fromPermanent } = split;
  const dailyRefund = Math.min(fromDaily, amount);
  const permRefund = Math.min(fromPermanent, amount - dailyRefund);

  if (dailyRefund > 0) {
    const profile = await getOrCreateProfile(admin, userId);
    const today = chinaDateKey();
    const sameDay = profile.daily_credits_date === today;
    const nextDaily = (sameDay ? profile.daily_credits : 0) + dailyRefund;
    await admin
      .from('profiles')
      .update({
        daily_credits: nextDaily,
        daily_credits_date: today,
        credit_grant_mode: profile.credit_grant_mode || 'daily'
      })
      .eq('user_id', userId);
    // 与扣费对称：退回每日积分的部分也写流水，否则明细里“少扣了”对不上。
    const permanentAfter = Number(profile.credits) || 0;
    await insertLedgerRow(admin, {
      user_id: userId,
      delta: dailyRefund,
      balance_after: roundCredits(permanentAfter + nextDaily),
      reason,
      ref_id: `${refId}:daily-refund`,
      meta: {
        ...meta,
        pool: 'daily',
        refund: true,
        dailyAfter: nextDaily,
        permanentAfter
      }
    });
  }

  if (permRefund > 0) {
    const { error } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: permRefund,
      p_reason: reason,
      p_ref_id: refId,
      p_meta: { ...meta, refundDaily: dailyRefund, refundPermanent: permRefund }
    });
    if (error) throw error;
  }
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

export async function incrementLifetimeCreditsSpent(
  admin: SupabaseClient,
  userId: string,
  amount: number
): Promise<void> {
  if (amount <= 0) return;
  const profile = await getOrCreateProfile(admin, userId);
  const next = (profile.lifetime_credits_spent ?? 0) + amount;
  const { error } = await admin
    .from('profiles')
    .update({ lifetime_credits_spent: next })
    .eq('user_id', userId);
  if (error) throw error;
}
