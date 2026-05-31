import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { chinaDateKey } from './membership-credits';
import { mergeTaskFlags, parseTaskFlags, type TaskFlags } from './membership-tasks';
import type { Profile } from './supabase';
import { getOrCreateProfile } from './supabase';

export const COMMUNITY_GACHA_DAILY_LIMIT = 10;

export function readCommunityGachaDaily(flags: TaskFlags, d = new Date()) {
  const today = chinaDateKey(d);
  const date =
    typeof flags.community_gacha_daily_date === 'string'
      ? flags.community_gacha_daily_date
      : '';
  const count =
    date === today ? Math.max(0, Number(flags.community_gacha_daily_count) || 0) : 0;
  return { today, count };
}

export function buildCommunityGachaQuota(profile: Profile) {
  const flags = parseTaskFlags(profile);
  const { today, count } = readCommunityGachaDaily(flags);
  const limit = COMMUNITY_GACHA_DAILY_LIMIT;
  return {
    limit,
    used: count,
    remaining: Math.max(0, limit - count),
    date: today
  };
}

export async function consumeCommunityGachaDraw(
  admin: SupabaseClient,
  userId: string
): Promise<{ used: number; remaining: number; limit: number }> {
  const profile = await getOrCreateProfile(admin, userId);
  const flags = parseTaskFlags(profile);
  const { today, count } = readCommunityGachaDaily(flags);
  if (count >= COMMUNITY_GACHA_DAILY_LIMIT) {
    throw new ApiError(429, 'GACHA_LIMIT', `今日已抽满 ${COMMUNITY_GACHA_DAILY_LIMIT} 次`);
  }
  const used = count + 1;
  await mergeTaskFlags(admin, userId, {
    community_gacha_daily_date: today,
    community_gacha_daily_count: used
  });
  return {
    used,
    remaining: Math.max(0, COMMUNITY_GACHA_DAILY_LIMIT - used),
    limit: COMMUNITY_GACHA_DAILY_LIMIT
  };
}
