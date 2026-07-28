import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  claimTrialMembership,
  dailyCreditsForTier,
  setMembershipCreditMode,
  type CreditGrantMode,
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import {
  createAdminClient,
  getOrCreateProfile,
  isMembershipActive
} from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const creditModeSchema = z.object({
  creditGrantMode: z.enum(['daily', 'bundle'])
});

export const membershipRoutes = new Hono<{ Bindings: Env }>();

membershipRoutes.use('*', rateLimit(30, 60_000));

function requirePhoneVerified(user: {
  phoneVerified: boolean;
}): void {
  if (!user.phoneVerified) {
    throw new ApiError(
      403,
      'PHONE_REQUIRED',
      '请先绑定并验证手机号后再领取试用（设置 → 账号安全）'
    );
  }
}

membershipRoutes.post('/trial-free', async c => {
  const user = c.get('user');
  requirePhoneVerified(user);

  const admin = createAdminClient(c.env);
  let profile = await getOrCreateProfile(admin, user.id);

  if (profile.trial_free_used) {
    throw new ApiError(400, 'TRIAL_USED', '您已领取过 3 天免费试用');
  }
  if (isMembershipActive(profile)) {
    throw new ApiError(400, 'ALREADY_MEMBER', '当前已是会员，无需重复领取试用');
  }

  const until = new Date(Date.now() + 3 * 86400000).toISOString();
  let activated: typeof profile;
  try {
    activated = await claimTrialMembership(
      admin,
      user.id,
      until,
      dailyCreditsForTier('basic')
    );
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || error);
    if (message.includes('trial_used')) {
      throw new ApiError(400, 'TRIAL_USED', '\u60a8\u5df2\u9886\u53d6\u8fc7 3 \u5929\u514d\u8d39\u8bd5\u7528');
    }
    if (message.includes('already_member')) {
      throw new ApiError(400, 'ALREADY_MEMBER', '\u5f53\u524d\u5df2\u662f\u4f1a\u5458\uff0c\u65e0\u9700\u91cd\u590d\u9886\u53d6\u8bd5\u7528');
    }
    throw error;
  }
  profile = (await syncMembershipCredits(admin, user.id)) || activated;

  return c.json({
    ok: true,
    data: {
      message: `已开通 3 天试用：每日 ${dailyCreditsForTier('basic')} 积分（当日有效）`,
      membership: {
        tier: 'basic',
        until,
        active: true
      },
      ...membershipCreditsPayload(profile)
    }
  });
});

membershipRoutes.post('/credit-mode', async c => {
  const user = c.get('user');
  const parsed = creditModeSchema.safeParse(
    await c.req.json().catch(() => ({}))
  );
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请选择积分领取方式');
  }

  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);

  if (!isMembershipActive(profile)) {
    throw new ApiError(400, 'NOT_MEMBER', '开通会员后可选择积分方式');
  }
  if (profile.membership_tier === 'lite' && parsed.data.creditGrantMode === 'bundle') {
    throw new ApiError(400, 'LITE_DAILY_ONLY', '轻量会员仅支持每日领取积分');
  }

  const mode = parsed.data.creditGrantMode as CreditGrantMode;
  if (profile.credit_grant_mode === mode) {
    const synced = await syncMembershipCredits(admin, user.id);
    return c.json({
      ok: true,
      data: {
        message: '积分方式未变更',
        ...membershipCreditsPayload(synced)
      }
    });
  }

  let updated: typeof profile;
  try {
    updated = await setMembershipCreditMode(admin, user.id, mode);
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || error);
    if (message.includes('membership_inactive')) {
      throw new ApiError(400, 'NOT_MEMBER', '\u5f00\u901a\u4f1a\u5458\u540e\u53ef\u9009\u62e9\u79ef\u5206\u65b9\u5f0f');
    }
    if (message.includes('lite_daily_only')) {
      throw new ApiError(400, 'LITE_DAILY_ONLY', '\u8f7b\u91cf\u4f1a\u5458\u4ec5\u652f\u6301\u6bcf\u65e5\u9886\u53d6\u79ef\u5206');
    }
    throw error;
  }
  const synced = await syncMembershipCredits(admin, user.id);

  return c.json({
    ok: true,
    data: {
      message:
        mode === 'daily'
          ? `已切换为每日 ${dailyCreditsForTier(profile.membership_tier)} 积分（当日有效）`
          : '已切换为一次性到账积分（永久有效，用完为止）',
      ...membershipCreditsPayload(synced || updated)
    }
  });
});
