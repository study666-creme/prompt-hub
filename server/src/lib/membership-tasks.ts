import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';
import {
  chinaDateKey,
  dailyCreditsForTier,
  syncMembershipCredits
} from './membership-credits';

export type TaskKey =
  | 'login_desktop'
  | 'login_mobile'
  | 'pwa_install'
  | 'bind_phone'
  | 'community_publish_5'
  | 'community_publish_15'
  | 'cards_count_25'
  | 'spend_1000'
  | 'spend_2000'
  | `spend_${number}`;

export type TaskFlags = {
  login_desktop?: boolean;
  login_mobile?: boolean;
  pwa_installed?: boolean;
  community_qualified_count?: number;
  cards_count_synced?: number;
};

const REPEATABLE_SPEND_START = 5000;
const REPEATABLE_SPEND_STEP = 3000;

export function parseTaskFlags(profile: Profile): TaskFlags {
  const raw = profile.membership_task_flags;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as TaskFlags;
}

export function spendMilestoneKeys(lifetimeSpent: number): string[] {
  const keys: string[] = [];
  if (lifetimeSpent >= 1000) keys.push('spend_1000');
  if (lifetimeSpent >= 2000) keys.push('spend_2000');
  let t = REPEATABLE_SPEND_START;
  while (t <= lifetimeSpent) {
    keys.push(`spend_${t}`);
    t += REPEATABLE_SPEND_STEP;
  }
  return keys;
}

export function nextSpendMilestone(lifetimeSpent: number): number | null {
  if (lifetimeSpent < 1000) return 1000;
  if (lifetimeSpent < 2000) return 2000;
  let t = REPEATABLE_SPEND_START;
  while (t <= lifetimeSpent) t += REPEATABLE_SPEND_STEP;
  return t;
}

export function taskRewardForKey(
  key: string
): { days: number; credits: number; title: string; description: string } | null {
  const staticTasks: Record<
    string,
    { days: number; credits: number; title: string; description: string }
  > = {
    login_desktop: {
      days: 1,
      credits: 0,
      title: '电脑网页登录',
      description: '在电脑浏览器登录账号'
    },
    login_mobile: {
      days: 1,
      credits: 0,
      title: '手机端登录',
      description: '在手机浏览器登录账号'
    },
    pwa_install: {
      days: 2,
      credits: 10,
      title: '添加到桌面',
      description: '将本站添加到手机主屏幕（PWA）'
    },
    bind_phone: {
      days: 1,
      credits: 0,
      title: '绑定手机号',
      description: '完成手机号验证绑定'
    },
    community_publish_5: {
      days: 1,
      credits: 0,
      title: '社区发布 5 张',
      description: '发布 5 张有效社区卡片（含图、有效提示词）'
    },
    community_publish_15: {
      days: 1,
      credits: 0,
      title: '社区再发布 10 张',
      description: '累计发布 15 张有效社区卡片'
    },
    cards_count_25: {
      days: 1,
      credits: 0,
      title: '卡片库达 25 张',
      description: '卡片库首次达到 25 张（不含已删除）'
    },
    spend_1000: {
      days: 1,
      credits: 0,
      title: '累计消耗 1000 积分',
      description: '生图等累计消耗达 1000 积分'
    },
    spend_2000: {
      days: 1,
      credits: 0,
      title: '累计消耗 2000 积分',
      description: '生图等累计消耗达 2000 积分'
    }
  };
  if (staticTasks[key]) return staticTasks[key];
  const m = /^spend_(\d+)$/.exec(key);
  if (m) {
    const n = Number(m[1]);
    if (n >= REPEATABLE_SPEND_START && (n - REPEATABLE_SPEND_START) % REPEATABLE_SPEND_STEP === 0) {
      return {
        days: 1,
        credits: 0,
        title: `累计消耗 ${n} 积分`,
        description: `生图等累计消耗达 ${n} 积分`
      };
    }
  }
  return null;
}

/** 有效社区作品：有图、提示词足够长、非乱码/重复字符 */
export function isQualifyingCommunityPost(post: {
  prompt?: string;
  image?: string | null;
  title?: string;
}): boolean {
  const prompt = String(post.prompt || post.title || '').trim();
  if (prompt.length < 24) return false;
  if (/^[\d\s\W]+$/.test(prompt)) return false;
  if (/(.)\1{10,}/u.test(prompt)) return false;
  const compact = prompt.replace(/\s/g, '');
  if (new Set(compact).size < 6) return false;
  const img = post.image;
  if (!img || typeof img !== 'string') return false;
  if (img.length < 8) return false;
  return true;
}

export function countQualifyingPosts(
  posts: { prompt?: string; image?: string | null; title?: string }[]
): number {
  const seen = new Set<string>();
  let n = 0;
  for (const p of posts) {
    if (!isQualifyingCommunityPost(p)) continue;
    const key = String(p.prompt || p.title || '')
      .trim()
      .slice(0, 200)
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    n += 1;
  }
  return n;
}

export function isTaskProgressMet(
  key: string,
  flags: TaskFlags,
  profile: Profile,
  phoneVerified: boolean
): boolean {
  const spent = profile.lifetime_credits_spent ?? 0;
  switch (key) {
    case 'login_desktop':
      return !!flags.login_desktop;
    case 'login_mobile':
      return !!flags.login_mobile;
    case 'pwa_install':
      return !!flags.pwa_installed;
    case 'bind_phone':
      return phoneVerified;
    case 'community_publish_5':
      return (flags.community_qualified_count ?? 0) >= 5;
    case 'community_publish_15':
      return (flags.community_qualified_count ?? 0) >= 15;
    case 'cards_count_25':
      return (flags.cards_count_synced ?? 0) >= 25;
    case 'spend_1000':
      return spent >= 1000;
    case 'spend_2000':
      return spent >= 2000;
    default: {
      const m = /^spend_(\d+)$/.exec(key);
      if (m) return spent >= Number(m[1]);
      return false;
    }
  }
}

export async function mergeTaskFlags(
  admin: SupabaseClient,
  userId: string,
  patch: Partial<TaskFlags>
): Promise<TaskFlags> {
  const profile = await getOrCreateProfile(admin, userId);
  const prev = parseTaskFlags(profile);
  const next: TaskFlags = {
    ...prev,
    ...patch,
    community_qualified_count: Math.max(
      prev.community_qualified_count ?? 0,
      patch.community_qualified_count ?? 0
    ),
    cards_count_synced: Math.max(
      prev.cards_count_synced ?? 0,
      patch.cards_count_synced ?? 0
    )
  };
  const { error } = await admin
    .from('profiles')
    .update({ membership_task_flags: next })
    .eq('user_id', userId);
  if (error) throw error;
  return next;
}

export async function listClaimedKeys(
  admin: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data, error } = await admin
    .from('membership_task_claims')
    .select('task_key')
    .eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.task_key));
}

export async function extendMembershipDays(
  admin: SupabaseClient,
  profile: Profile,
  days: number,
  tier: NonNullable<Profile['membership_tier']> = 'basic'
): Promise<Profile> {
  const now = Date.now();
  const curUntil = profile.membership_until
    ? new Date(profile.membership_until).getTime()
    : 0;
  const base = Math.max(now, curUntil);
  const until = new Date(base + days * 86400000).toISOString();

  const patch: Record<string, unknown> = {
    membership_tier: tier,
    membership_until: until
  };
  if (!profile.credit_grant_mode) {
    patch.credit_grant_mode = 'daily';
    patch.daily_credits = dailyCreditsForTier(tier);
    patch.daily_credits_date = chinaDateKey();
  }

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('user_id', profile.user_id)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function claimMembershipTask(
  admin: SupabaseClient,
  userId: string,
  taskKey: string,
  phoneVerified: boolean
): Promise<{ message: string; profile: Profile }> {
  const reward = taskRewardForKey(taskKey);
  if (!reward) throw new Error('unknown_task');

  let profile = await getOrCreateProfile(admin, userId);
  const flags = parseTaskFlags(profile);
  const claimed = await listClaimedKeys(admin, userId);

  if (claimed.has(taskKey)) throw new Error('already_claimed');
  if (!isTaskProgressMet(taskKey, flags, profile, phoneVerified)) {
    throw new Error('not_ready');
  }

  const { error: insErr } = await admin.from('membership_task_claims').insert({
    user_id: userId,
    task_key: taskKey,
    reward_days: reward.days,
    reward_credits: reward.credits,
    meta: { title: reward.title }
  });
  if (insErr) {
    if (insErr.code === '23505') throw new Error('already_claimed');
    throw insErr;
  }

  if (reward.days > 0) {
    profile = await extendMembershipDays(admin, profile, reward.days, 'basic');
  }
  if (reward.credits > 0) {
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: reward.credits,
      p_reason: 'membership_task',
      p_ref_id: taskKey,
      p_meta: { taskKey, days: reward.days }
    });
    if (creditErr) throw creditErr;
  }

  profile = await syncMembershipCredits(admin, userId);
  const parts: string[] = [];
  if (reward.days) parts.push(`${reward.days} 天基础会员`);
  if (reward.credits) parts.push(`${reward.credits} 积分`);
  return {
    message: `已领取：${parts.join(' + ') || '奖励'}`,
    profile
  };
}

export function buildTaskList(
  profile: Profile,
  flags: TaskFlags,
  claimed: Set<string>,
  phoneVerified: boolean
) {
  const spent = profile.lifetime_credits_spent ?? 0;
  const keys = [
    'login_desktop',
    'login_mobile',
    'pwa_install',
    'bind_phone',
    'community_publish_5',
    'community_publish_15',
    'cards_count_25',
    ...spendMilestoneKeys(spent)
  ];

  const items = keys.map(key => {
    const reward = taskRewardForKey(key)!;
    const claimedAt = claimed.has(key);
    const ready = !claimedAt && isTaskProgressMet(key, flags, profile, phoneVerified);
    let progress: string | null = null;
    if (key === 'community_publish_5') {
      progress = `${Math.min(flags.community_qualified_count ?? 0, 5)}/5`;
    } else if (key === 'community_publish_15') {
      progress = `${Math.min(flags.community_qualified_count ?? 0, 15)}/15`;
    } else if (key === 'cards_count_25') {
      progress = `${Math.min(flags.cards_count_synced ?? 0, 25)}/25`;
    } else if (key.startsWith('spend_')) {
      const th = Number(key.replace('spend_', ''));
      progress = `${spent}/${th}`;
    }
    return {
      key,
      title: reward.title,
      description: reward.description,
      rewardDays: reward.days,
      rewardCredits: reward.credits,
      claimed: claimedAt,
      ready,
      progress
    };
  });

  const nextSpend = nextSpendMilestone(spent);
  return { items, lifetimeCreditsSpent: spent, nextSpendMilestone: nextSpend };
}

export function detectDeviceFromUa(ua: string): 'desktop' | 'mobile' | null {
  const s = ua.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|webos|blackberry/i.test(s)) return 'mobile';
  return 'desktop';
}
