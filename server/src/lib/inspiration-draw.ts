import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { chinaDateKey } from './membership-credits';
import { mergeTaskFlags, parseTaskFlags, type TaskFlags } from './membership-tasks';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';

export const INSPIRE_DRAW_DAILY_LIMIT = {
  free: 10,
  lite: 30
} as const;

export type InspirationDrawTier = 'free' | 'lite' | 'basic' | 'standard' | 'pro';

export type InspirationDrawQuota = {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  tier: InspirationDrawTier;
  label: string;
};

function resolveInspireDrawTier(profile: Profile): InspirationDrawTier {
  if (!isMembershipActive(profile) || !profile.membership_tier) return 'free';
  return profile.membership_tier;
}

export function readInspirationDrawDaily(flags: TaskFlags, d = new Date()) {
  const today = chinaDateKey(d);
  const date =
    typeof flags.inspiration_draw_daily_date === 'string'
      ? flags.inspiration_draw_daily_date
      : '';
  const count =
    date === today ? Math.max(0, Number(flags.inspiration_draw_daily_count) || 0) : 0;
  return { today, count };
}

export function buildInspirationDrawQuota(profile: Profile): InspirationDrawQuota {
  const tier = resolveInspireDrawTier(profile);
  const flags = parseTaskFlags(profile);
  const { count } = readInspirationDrawDaily(flags);

  if (tier === 'basic' || tier === 'standard' || tier === 'pro') {
    return {
      unlimited: true,
      limit: null,
      used: count,
      remaining: null,
      tier,
      label: '基础会员及以上 · 无限'
    };
  }

  if (tier === 'lite') {
    const limit = INSPIRE_DRAW_DAILY_LIMIT.lite;
    const remaining = Math.max(0, limit - count);
    return {
      unlimited: false,
      limit,
      used: count,
      remaining,
      tier,
      label: `轻量会员 · 今日 ${remaining}/${limit} 次`
    };
  }

  const limit = INSPIRE_DRAW_DAILY_LIMIT.free;
  const remaining = Math.max(0, limit - count);
  return {
    unlimited: false,
    limit,
    used: count,
    remaining,
    tier: 'free',
    label: `普通用户 · 今日 ${remaining}/${limit} 次`
  };
}

export function inspireDrawLimitMessage(tier: InspirationDrawTier): string {
  if (tier === 'free') {
    return '今日灵感抽卡已达 10 次上限。开通轻量会员 30 次/天，基础会员及以上无限。';
  }
  if (tier === 'lite') {
    return '今日灵感抽卡已达 30 次上限。升级基础会员可无限抽卡。';
  }
  return '今日灵感抽卡次数已用完';
}

export async function consumeInspirationDraw(
  admin: SupabaseClient,
  userId: string
): Promise<{ profile: Profile; quota: InspirationDrawQuota }> {
  let profile = await getOrCreateProfile(admin, userId);
  const quotaBefore = buildInspirationDrawQuota(profile);
  if (
    !quotaBefore.unlimited &&
    quotaBefore.remaining !== null &&
    quotaBefore.remaining <= 0
  ) {
    throw new ApiError(
      429,
      'INSPIRE_DRAW_LIMIT',
      inspireDrawLimitMessage(quotaBefore.tier)
    );
  }

  const flags = parseTaskFlags(profile);
  const { today, count } = readInspirationDrawDaily(flags);
  await mergeTaskFlags(admin, userId, {
    inspiration_draw_used: true,
    inspiration_draw_daily_date: today,
    inspiration_draw_daily_count: count + 1
  });

  profile = await getOrCreateProfile(admin, userId);
  return { profile, quota: buildInspirationDrawQuota(profile) };
}
