import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { defaultDisplayName } from './display-name';

export type Profile = {
  user_id: string;
  credits: number;
  membership_tier: 'lite' | 'basic' | 'standard' | 'pro' | null;
  membership_until: string | null;
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
  if (data) return ensureProfileDisplayName(admin, data as Profile);

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
  return new Date(profile.membership_until).getTime() > Date.now();
}

export function membershipGenMultiplier(tier: Profile['membership_tier']): number {
  if (!tier || tier === 'lite') return 1;
  const map = { basic: 0.9, standard: 0.8, pro: 0.7 } as const;
  return map[tier] ?? 1;
}

export const POINTS_PER_YUAN = 100;
export { MIN_GENERATION_CHARGE, computeGenerationCost, baseResolutionCost, IMAGE_MODELS } from './pricing';
