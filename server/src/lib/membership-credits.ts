import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';

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

/** 中国时区自然日 YYYY-MM-DD */
export function chinaDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    d
  );
}

export function spendableCredits(profile: Profile): number {
  const daily =
    profile.daily_credits_date === chinaDateKey() ? profile.daily_credits : 0;
  return profile.credits + daily;
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
  const nextDaily = sameDay
    ? Math.max(profile.daily_credits || 0, amount)
    : amount;
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
  profile: Profile
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

  const amount = TIER_LUMP_CREDITS[profile.membership_tier] ?? 0;
  if (amount > 0) {
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: profile.user_id,
      p_delta: amount,
      p_reason: 'subscription_grant',
      p_ref_id: `bundle:${periodKey}`,
      p_meta: { tier: profile.membership_tier, mode: 'bundle' }
    });
    if (creditErr) throw creditErr;
  }

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
  const nextDaily = sameDay
    ? Math.max(profile.daily_credits || 0, amount)
    : amount;

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
  return data as Profile;
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

  if (profile.daily_credits_date === chinaDateKey() && profile.daily_credits > 0 && left > 0) {
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
    if (error) throw error;
    profile = await getOrCreateProfile(admin, userId);
  }

  if (reason === 'image_generation' && amount > 0) {
    await incrementLifetimeCreditsSpent(admin, userId, amount);
    profile = await getOrCreateProfile(admin, userId);
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
