import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';

export type CreditGrantMode = 'daily' | 'bundle';

export const DAILY_CREDITS_AMOUNT = 10;

export const TIER_LUMP_CREDITS: Record<
  NonNullable<Profile['membership_tier']>,
  number
> = {
  basic: 100,
  standard: 310,
  pro: 1000
};

/** 中国时区自然日 YYYY-MM-DD */
export function chinaDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    d
  );
}

export function spendableCredits(profile: Profile): number {
  const daily =
    profile.credit_grant_mode === 'daily' &&
    isMembershipActive(profile) &&
    profile.daily_credits_date === chinaDateKey()
      ? profile.daily_credits
      : 0;
  return profile.credits + daily;
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

  const { data, error } = await admin
    .from('profiles')
    .update({
      daily_credits: DAILY_CREDITS_AMOUNT,
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

/** 登录 /me 时同步日积分与一次性积分 */
export async function syncMembershipCredits(
  admin: SupabaseClient,
  userId: string
): Promise<Profile> {
  let profile = await getOrCreateProfile(admin, userId);
  profile = await refreshDailyCredits(admin, profile);
  profile = await grantBundleForActiveMembership(admin, profile);
  return profile;
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

  if (
    profile.credit_grant_mode === 'daily' &&
    profile.daily_credits_date === chinaDateKey() &&
    profile.daily_credits > 0 &&
    left > 0
  ) {
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
  const memberActive = isMembershipActive(profile);
  const today = chinaDateKey();
  const dailyActive =
    memberActive &&
    profile.credit_grant_mode === 'daily' &&
    profile.daily_credits_date === today;

  return {
    creditGrantMode: profile.credit_grant_mode,
    creditsPermanent: profile.credits,
    dailyCredits: dailyActive ? profile.daily_credits : 0,
    creditsSpendable: spendableCredits(profile),
    dailyCreditsNote:
      profile.credit_grant_mode === 'daily'
        ? `每日 ${DAILY_CREDITS_AMOUNT} 积分，当日有效`
        : null
  };
}
