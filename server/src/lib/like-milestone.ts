import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateProfile } from './supabase';

export const LIKE_MILESTONE_REWARDS = [
  { threshold: 1000, credits: 1000, maxClaimsPerUser: 2 },
  { threshold: 100, credits: 100, maxClaimsPerUser: 5 }
] as const;

export type LikeMilestoneResult =
  | {
      granted: true;
      threshold: number;
      credits: number;
      creditsRemaining: number;
      message: string;
    }
  | { granted: false };

export async function tryGrantLikeMilestone(
  admin: SupabaseClient,
  userId: string,
  postId: string,
  likes: number
): Promise<LikeMilestoneResult> {
  const likeCount = Math.max(0, Math.floor(likes));

  for (const m of LIKE_MILESTONE_REWARDS) {
    if (likeCount < m.threshold) continue;

    const { count: userClaimCount, error: countErr } = await admin
      .from('like_milestone_claims')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('threshold', m.threshold);

    if (countErr) throw countErr;
    if ((userClaimCount ?? 0) >= m.maxClaimsPerUser) continue;

    const { data: existing } = await admin
      .from('like_milestone_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .eq('threshold', m.threshold)
      .maybeSingle();

    if (existing) continue;

    const { error: insErr } = await admin.from('like_milestone_claims').insert({
      user_id: userId,
      post_id: postId,
      threshold: m.threshold,
      credits: m.credits
    });

    if (insErr) {
      if (insErr.code === '23505') continue;
      throw insErr;
    }

    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: m.credits,
      p_reason: 'like_milestone',
      p_ref_id: `${postId}:${m.threshold}`,
      p_meta: { postId, threshold: m.threshold, likes: likeCount }
    });

    if (creditErr) {
      await admin
        .from('like_milestone_claims')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', postId)
        .eq('threshold', m.threshold);
      throw creditErr;
    }

    const profile = await getOrCreateProfile(admin, userId);
    return {
      granted: true,
      threshold: m.threshold,
      credits: m.credits,
      creditsRemaining: profile.credits,
      message: `作品获 ${m.threshold} 赞，奖励 ${m.credits} 积分`
    };
  }

  return { granted: false };
}
