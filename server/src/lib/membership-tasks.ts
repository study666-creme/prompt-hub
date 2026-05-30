import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile, isMembershipActive } from './supabase';
import {
  chinaDateKey,
  claimMemberDailyCredits,
  dailyCreditsForTier,
  grantUniversalDailyBonus,
  syncMembershipCredits
} from './membership-credits';

export const COMMUNITY_QUALIFY_PROMPT_LEN = 15;

export class PhoneRequiredError extends Error {
  constructor() {
    super('phone_required');
    this.name = 'PhoneRequiredError';
  }
}

export function assertPhoneVerified(phoneVerified: boolean) {
  if (!phoneVerified) throw new PhoneRequiredError();
}
export type TaskKey =
  | 'login_desktop'
  | 'login_mobile'
  | 'pwa_install'
  | 'bind_phone'
  | 'community_publish_5'
  | 'community_publish_15'
  | 'warehouse_quick_preview_fav'
  | 'community_quick_preview_fav'
  | 'extension_save_card'
  | 'asset_studio_chat'
  | 'asset_studio_link_card'
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
  warehouse_quick_preview_used?: boolean;
  warehouse_quick_preview_goto_gen?: boolean;
  warehouse_quick_preview_favorited?: boolean;
  community_quick_preview_used?: boolean;
  community_quick_preview_favorited?: boolean;
  extension_card_saved?: boolean;
  asset_studio_chat_used?: boolean;
  asset_studio_link_card?: boolean;
  sign_streak?: number;
  last_sign_date?: string;
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

export function isDailyBonusTaskKey(key: string): boolean {
  return key.startsWith('daily_bonus_');
}

export function dailyBonusTaskKey(d = new Date()): string {
  return `daily_bonus_${chinaDateKey(d)}`;
}

export function isMemberDailyTaskKey(key: string): boolean {
  return key.startsWith('member_daily_');
}

export function memberDailyTaskKey(d = new Date()): string {
  return `member_daily_${chinaDateKey(d)}`;
}

export function taskRewardForKey(
  key: string
): { days: number; credits: number; title: string; description: string } | null {
  if (isDailyBonusTaskKey(key)) {
    return {
      days: 0,
      credits: 5,
      title: '每日免费积分',
      description: '领取 5 积分即计入连续签到，满 7 天额外 +10 积分（积分仅限当天使用）'
    };
  }
  if (isMemberDailyTaskKey(key)) {
    return {
      days: 0,
      credits: 0,
      title: '会员每日积分',
      description: '按会员档位领取当日有效积分'
    };
  }
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
      credits: 0,
      title: '添加到桌面',
      description: '从手机桌面图标打开本站（添加到主屏幕后点开即可）'
    },
    redeem_invite_code: {
      days: 1,
      credits: 50,
      title: '填写邀请码',
      description: '填写好友邀请码，双方各得 1 天基础会员 + 50 积分（须先绑定手机号，每人仅一次）'
    },
    bind_phone: {
      days: 1,
      credits: 0,
      title: '绑定手机号',
      description: '完成手机号验证绑定（邀请码兑换须先绑定）'
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
      description: '完成上一档后，累计再发布 10 张有效社区卡片（共 15 张）'
    },
    warehouse_quick_preview_fav: {
      days: 1,
      credits: 0,
      title: '卡片库快速预览并去生图',
      description: '在卡片库打开左上角「快速预览」，在预览中点击「去生图」'
    },
    community_quick_preview_fav: {
      days: 1,
      credits: 0,
      title: '社区快速预览并收藏',
      description: '在社区打开左上角「快速预览」，在预览中收藏一张作品到卡片库'
    },
    extension_save_card: {
      days: 3,
      credits: 0,
      title: '浏览器插件保存卡片',
      description: '登录浏览器插件，在任意网页用插件保存 1 张卡片到仓库'
    },
    asset_studio_chat: {
      days: 1,
      credits: 0,
      title: '资产创作 AI 对话',
      description: '在资产创作工作台向 AI 发起一次对话（消耗积分按实际 token 计费）'
    },
    asset_studio_link_card: {
      days: 2,
      credits: 0,
      title: '资产创作关联卡片',
      description: '在资产创作将卡片库卡片拖入文档「关联图」框，完成一次文档关联'
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
        title: n >= REPEATABLE_SPEND_START ? `每消耗 ${REPEATABLE_SPEND_STEP} 积分（已达 ${n}）` : `累计消耗 ${n} 积分`,
        description:
          n >= REPEATABLE_SPEND_START
            ? `生图等累计消耗每满 ${REPEATABLE_SPEND_STEP} 积分可领 1 天（当前档位 ${n}）`
            : `生图等累计消耗达 ${n} 积分`
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
  if (prompt.length < COMMUNITY_QUALIFY_PROMPT_LEN) return false;
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
  if (isDailyBonusTaskKey(key)) return true;
  if (isMemberDailyTaskKey(key)) {
    return (
      isMembershipActive(profile) &&
      profile.credit_grant_mode === 'daily' &&
      !!profile.membership_tier
    );
  }
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
    case 'redeem_invite_code': {
      const referred = (profile as Profile & { referred_by?: string | null }).referred_by;
      return !!referred;
    }
    case 'community_publish_5':
      return (flags.community_qualified_count ?? 0) >= 5;
    case 'community_publish_15':
      return (flags.community_qualified_count ?? 0) >= 15;
    case 'warehouse_quick_preview_fav':
      return !!(flags.warehouse_quick_preview_used && flags.warehouse_quick_preview_goto_gen);
    case 'community_quick_preview_fav':
      return !!(flags.community_quick_preview_used && flags.community_quick_preview_favorited);
    case 'extension_save_card':
      return !!flags.extension_card_saved;
    case 'asset_studio_chat':
      return !!flags.asset_studio_chat_used;
    case 'asset_studio_link_card':
      return !!flags.asset_studio_link_card;
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

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('user_id', profile.user_id)
    .select()
    .single();
  if (error) {
    const pgMsg =
      typeof error.message === 'string'
        ? error.message
        : 'extend_membership_failed';
    throw new Error(pgMsg);
  }
  return data as Profile;
}

export function checkinTaskKey(d = new Date()): string {
  return `checkin_${chinaDateKey(d)}`;
}

export function isCheckinTaskKey(key: string): boolean {
  return key.startsWith('checkin_');
}

function yesterdayDateKey(todayKey: string): string {
  const [y, m, d] = todayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return chinaDateKey(dt);
}

export function readSignStreak(flags: TaskFlags): number {
  return Math.max(0, Number(flags.sign_streak) || 0);
}

export function hasCheckedInToday(flags: TaskFlags, d = new Date()): boolean {
  return flags.last_sign_date === chinaDateKey(d);
}

/** 每日领取积分或旧版签到接口共用：一天只计一次连续签到 */
export async function applySignStreakForToday(
  admin: SupabaseClient,
  userId: string,
  flags: TaskFlags,
  claimed: Set<string>
): Promise<{
  flags: TaskFlags;
  streak: number;
  bonusCredits: number;
  alreadySigned: boolean;
}> {
  const today = chinaDateKey();
  const taskKey = checkinTaskKey();
  const streakNow = readSignStreak(flags);
  if (flags.last_sign_date === today || claimed.has(taskKey)) {
    return { flags, streak: streakNow, bonusCredits: 0, alreadySigned: true };
  }

  const yesterday = yesterdayDateKey(today);
  const streak = flags.last_sign_date === yesterday ? streakNow + 1 : 1;
  const newFlags = await mergeTaskFlags(admin, userId, {
    sign_streak: streak,
    last_sign_date: today
  });

  const { error: insErr } = await admin.from('membership_task_claims').insert({
    user_id: userId,
    task_key: taskKey,
    reward_days: 0,
    reward_credits: 0,
    meta: { streak, type: 'checkin' }
  });
  if (insErr) {
    if (insErr.code === '23505') {
      return {
        flags: newFlags,
        streak: readSignStreak(newFlags),
        bonusCredits: 0,
        alreadySigned: true
      };
    }
    throw insErr;
  }

  let bonusCredits = 0;
  if (streak > 0 && streak % 7 === 0) {
    bonusCredits = 10;
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: bonusCredits,
      p_reason: 'checkin_streak_bonus',
      p_ref_id: taskKey,
      p_meta: { streak }
    });
    if (creditErr) throw creditErr;
  }

  return { flags: newFlags, streak, bonusCredits, alreadySigned: false };
}

export async function claimDailyCheckin(
  admin: SupabaseClient,
  userId: string,
  _phoneVerified: boolean
): Promise<{ message: string; profile: Profile; streak: number; bonusCredits: number }> {

  let profile = await getOrCreateProfile(admin, userId);
  const flags = parseTaskFlags(profile);
  const claimed = await listClaimedKeys(admin, userId);
  const sign = await applySignStreakForToday(admin, userId, flags, claimed);
  if (sign.alreadySigned) throw new Error('already_checked_in');

  profile = await syncMembershipCredits(admin, userId);
  const msg =
    sign.bonusCredits > 0
      ? `已连续签到 ${sign.streak} 天，额外获得 ${sign.bonusCredits} 积分`
      : `已连续签到 ${sign.streak} 天`;
  return { message: msg, profile, streak: sign.streak, bonusCredits: sign.bonusCredits };
}

export async function claimMembershipTask(
  admin: SupabaseClient,
  userId: string,
  taskKey: string,
  phoneVerified: boolean
): Promise<{ message: string; profile: Profile }> {
  if (taskKey === 'redeem_invite_code') {
    assertPhoneVerified(phoneVerified);
  }

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
    const pgMsg =
      typeof insErr.message === 'string'
        ? insErr.message
        : typeof (insErr as { details?: string }).details === 'string'
          ? (insErr as { details: string }).details
          : 'claim_insert_failed';
    throw new Error(pgMsg);
  }

  if (reward.days > 0) {
    profile = await extendMembershipDays(admin, profile, reward.days, 'basic');
  }
  let signStreakMsg = '';
  if (isMemberDailyTaskKey(taskKey)) {
    profile = await claimMemberDailyCredits(admin, profile);
  } else if (isDailyBonusTaskKey(taskKey)) {
    profile = await grantUniversalDailyBonus(admin, userId, reward.credits || 5);
    const flagsAfter = parseTaskFlags(profile);
    const claimedAfter = await listClaimedKeys(admin, userId);
    const sign = await applySignStreakForToday(admin, userId, flagsAfter, claimedAfter);
    if (!sign.alreadySigned) {
      signStreakMsg =
        sign.bonusCredits > 0
          ? `，连续签到 ${sign.streak} 天，额外 +${sign.bonusCredits} 积分`
          : `，已连续签到 ${sign.streak} 天`;
    }
  } else if (reward.credits > 0) {
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: userId,
      p_delta: reward.credits,
      p_reason: 'membership_task',
      p_ref_id: taskKey,
      p_meta: { taskKey, days: reward.days }
    });
    if (creditErr) throw creditErr;
  }

  try {
    profile = await syncMembershipCredits(admin, userId);
  } catch (syncErr) {
    console.error('syncMembershipCredits after task claim failed', syncErr);
    profile = await getOrCreateProfile(admin, userId);
  }
  const parts: string[] = [];
  if (reward.days) parts.push(`${reward.days} 天基础会员`);
  if (isMemberDailyTaskKey(taskKey)) {
    parts.push(`${dailyCreditsForTier(profile.membership_tier)} 积分（今日有效）`);
  } else if (isDailyBonusTaskKey(taskKey)) {
    parts.push(`${reward.credits || 5} 积分（今日有效）`);
  } else if (reward.credits) {
    parts.push(`${reward.credits} 积分`);
  }
  return {
    message: `已领取：${parts.join(' + ') || '奖励'}${signStreakMsg}`,
    profile
  };
}

export function nextCommunityPublishKey(claimed: Set<string>): string | null {
  if (!claimed.has('community_publish_5')) return 'community_publish_5';
  if (!claimed.has('community_publish_15')) return 'community_publish_15';
  return null;
}

export function nextSpendTaskKey(spent: number, claimed: Set<string>): string | null {
  const keys: string[] = ['spend_1000', 'spend_2000'];
  let t = REPEATABLE_SPEND_START;
  const horizon = Math.max(spent + REPEATABLE_SPEND_STEP * 2, REPEATABLE_SPEND_START);
  while (t <= horizon) {
    keys.push(`spend_${t}`);
    t += REPEATABLE_SPEND_STEP;
  }
  for (const key of keys) {
    if (!claimed.has(key)) return key;
  }
  const next = nextSpendMilestone(spent);
  return next ? `spend_${next}` : null;
}

export type TaskListItem = {
  key: string;
  title: string;
  description: string;
  rewardDays: number;
  rewardCredits: number;
  claimed: boolean;
  ready: boolean;
  progress: string | null;
  kind: 'claim' | 'promo';
};

export type TaskHubData = {
  phoneVerified: boolean;
  siteUrl: string;
  inviteCode: string;
  inviteLink: string;
  referred: boolean;
  signStreak: number;
  checkedInToday: boolean;
  daysToStreakBonus: number;
  dailyBonus: {
    key: string;
    claimed: boolean;
    ready: boolean;
  };
  memberDaily: {
    key: string;
    claimed: boolean;
    ready: boolean;
    amount: number;
  } | null;
};

export function buildTaskHub(
  profile: Profile,
  flags: TaskFlags,
  claimed: Set<string>,
  phoneVerified: boolean,
  opts: { inviteCode: string; siteUrl: string; referred: boolean }
): TaskHubData {
  const dailyKey = dailyBonusTaskKey();
  const memberDailyKey = memberDailyTaskKey();
  const memberActive =
    isMembershipActive(profile) &&
    profile.credit_grant_mode === 'daily' &&
    !!profile.membership_tier;
  const streak = readSignStreak(flags);
  const dailyClaimed = claimed.has(dailyKey);
  const checkedInToday =
    dailyClaimed || hasCheckedInToday(flags) || claimed.has(checkinTaskKey());
  const mod = streak % 7;
  const daysToStreakBonus = checkedInToday ? (mod === 0 ? 7 : 7 - mod) : mod === 0 ? 7 : 7 - mod;
  const code = opts.inviteCode || '';
  const site = opts.siteUrl.replace(/\/$/, '');
  return {
    phoneVerified,
    siteUrl: site,
    inviteCode: code,
    inviteLink: code ? `${site}/?invite=${encodeURIComponent(code)}` : site,
    referred: opts.referred,
    signStreak: streak,
    checkedInToday,
    daysToStreakBonus,
    dailyBonus: {
      key: dailyKey,
      claimed: claimed.has(dailyKey),
      ready: !claimed.has(dailyKey)
    },
    memberDaily: memberActive
      ? {
          key: memberDailyKey,
          claimed: claimed.has(memberDailyKey),
          ready: !claimed.has(memberDailyKey),
          amount: dailyCreditsForTier(profile.membership_tier)
        }
      : null
  };
}

export function buildTaskList(
  profile: Profile,
  flags: TaskFlags,
  claimed: Set<string>,
  phoneVerified: boolean,
  opts?: { mini99Redeemed?: boolean; includeDailyInList?: boolean }
) {
  const spent = profile.lifetime_credits_spent ?? 0;
  const dailyKey = dailyBonusTaskKey();
  const communityKey = nextCommunityPublishKey(claimed);
  const spendKey = nextSpendTaskKey(spent, claimed);
  const keys = [
    'login_desktop',
    'login_mobile',
    'pwa_install',
    'bind_phone',
    communityKey,
    'warehouse_quick_preview_fav',
    'community_quick_preview_fav',
    'extension_save_card',
    'asset_studio_chat',
    'asset_studio_link_card',
    'cards_count_25',
    spendKey
  ].filter((k): k is string => !!k);

  const dailyReward = taskRewardForKey(dailyKey);
  const items: TaskListItem[] = [];
  if (opts?.includeDailyInList && dailyReward) {
    const dailyClaimed = claimed.has(dailyKey);
    items.push({
      key: dailyKey,
      title: dailyReward.title,
      description: dailyReward.description,
      rewardDays: 0,
      rewardCredits: dailyReward.credits,
      claimed: dailyClaimed,
      ready: !dailyClaimed,
      progress: dailyClaimed ? '今日已领' : null,
      kind: 'claim'
    });
  }

  items.push(...keys.flatMap(key => {
    const reward = taskRewardForKey(key);
    if (!reward) return [];
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
      progress,
      kind: 'claim' as const
    };
  }));

  if (!opts?.mini99Redeemed) {
    items.push({
      key: 'mini_99_membership',
      title: '¥0.99 体验三天基础会员',
      description: '淘宝购买后，在生图页「兑换」输入激活码（一人一码，支付后发货）',
      rewardDays: 3,
      rewardCredits: 0,
      claimed: false,
      ready: false,
      progress: null,
      kind: 'promo' as const
    });
  }

  const nextSpend = nextSpendMilestone(spent);
  return { items, lifetimeCreditsSpent: spent, nextSpendMilestone: nextSpend };
}

export function detectDeviceFromUa(ua: string): 'desktop' | 'mobile' | null {
  const s = ua.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|webos|blackberry/i.test(s)) return 'mobile';
  return 'desktop';
}
