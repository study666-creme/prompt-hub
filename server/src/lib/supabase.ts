import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { CREDITS_PER_YUAN } from './credit-math';
import { defaultDisplayName } from './display-name';

export type Profile = {
  user_id: string;
  credits: number;
  membership_tier: 'lite' | 'basic' | 'standard' | 'pro' | null;
  membership_until: string | null;
  membership_queued_tier: 'lite' | 'basic' | 'standard' | 'pro' | null;
  membership_queued_until: string | null;
  first_sub_offer_used: boolean;
  storage_bytes: number;
  credit_grant_mode: 'daily' | 'bundle';
  daily_credits: number;
  daily_credits_date: string | null;
  bundle_granted_until: string | null;
  trial_free_used: boolean;
  lifetime_credits_spent?: number;
  membership_task_flags?: Record<string, unknown>;
  display_name?: string | null;
};

export function createAdminClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin credentials not configured');
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  if (key.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY must be Secret key (sb_secret_), not Publishable'
    );
  }
  return createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function ensureProfileDisplayName(
  admin: SupabaseClient,
  profile: Profile
): Promise<Profile> {
  if (String(profile.display_name || '').trim()) return profile;
  const name = defaultDisplayName(profile.user_id);
  const { data, error } = await admin
    .from('profiles')
    .update({ display_name: name })
    .eq('user_id', profile.user_id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

export const MEMBERSHIP_TIER_RANK = {
  lite: 1,
  basic: 2,
  standard: 3,
  pro: 4
} as const;

export function tierRank(tier: Profile['membership_tier']): number {
  if (!tier) return 0;
  return MEMBERSHIP_TIER_RANK[tier] ?? 0;
}

/** 主档到期后自动切换到排队档 */
export async function resolveMembershipRollover(
  admin: SupabaseClient,
  profile: Profile
): Promise<Profile> {
  const now = Date.now();
  const untilMs = profile.membership_until ? new Date(profile.membership_until).getTime() : 0;
  const primaryActive = !!profile.membership_tier && (!untilMs || untilMs > now);

  if (primaryActive) return profile;

  const qTier = profile.membership_queued_tier;
  const qUntilMs = profile.membership_queued_until
    ? new Date(profile.membership_queued_until).getTime()
    : 0;

  if (qTier && qUntilMs > now) {
    const { data, error } = await admin
      .from('profiles')
      .update({
        membership_tier: qTier,
        membership_until: profile.membership_queued_until,
        membership_queued_tier: null,
        membership_queued_until: null
      })
      .eq('user_id', profile.user_id)
      .select('*')
      .single();
    if (error) return profile;
    return data as Profile;
  }

  if (profile.membership_tier || profile.membership_queued_tier) {
    const { data, error } = await admin
      .from('profiles')
      .update({
        membership_tier: null,
        membership_until: null,
        membership_queued_tier: null,
        membership_queued_until: null
      })
      .eq('user_id', profile.user_id)
      .select('*')
      .single();
    if (error) return profile;
    return data as Profile;
  }

  return profile;
}

export async function getOrCreateProfile(
  admin: SupabaseClient,
  userId: string
): Promise<Profile> {
  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (data) {
    const named = await ensureProfileDisplayName(admin, data as Profile);
    return resolveMembershipRollover(admin, named);
  }

  const { data: inserted, error: insertErr } = await admin
    .from('profiles')
    .insert({ user_id: userId, credits: 0 })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return ensureProfileDisplayName(admin, inserted as Profile);
}

export function isMembershipActive(profile: Profile): boolean {
  if (!profile.membership_tier) return false;
  if (!profile.membership_until) return true;
  if (new Date(profile.membership_until).getTime() > Date.now()) return true;
  if (
    profile.membership_queued_tier &&
    profile.membership_queued_until &&
    new Date(profile.membership_queued_until).getTime() > Date.now()
  ) {
    return true;
  }
  return false;
}

export const MEMBERSHIP_GEN_DISCOUNT_BY_TIER = {
  basic: { multiplier: 0.95, label: '95折' },
  standard: { multiplier: 0.9, label: '9折' },
  pro: { multiplier: 0.85, label: '85折' }
} as const;

export function membershipGenMultiplier(tier: Profile['membership_tier']): number {
  if (!tier || tier === 'lite') return 1;
  return MEMBERSHIP_GEN_DISCOUNT_BY_TIER[tier]?.multiplier ?? 1;
}

export function membershipGenDiscountLabel(tier: Profile['membership_tier']): string | null {
  if (!tier || tier === 'lite') return null;
  return MEMBERSHIP_GEN_DISCOUNT_BY_TIER[tier]?.label ?? null;
}

export const POINTS_PER_YUAN = CREDITS_PER_YUAN;
