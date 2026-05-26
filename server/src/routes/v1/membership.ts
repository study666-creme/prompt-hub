import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  chinaDateKey,
  DAILY_CREDITS_AMOUNT,
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

  const { data, error } = await admin
    .from('profiles')
    .update({
      membership_tier: 'basic',
      membership_until: until,
      credit_grant_mode: 'daily',
      daily_credits: DAILY_CREDITS_AMOUNT,
      daily_credits_date: chinaDateKey(),
      bundle_granted_until: null,
      trial_free_used: true
    })
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw error;
  profile = (await syncMembershipCredits(admin, user.id)) || (data as typeof profile);

  return c.json({
    ok: true,
    data: {
      message: `已开通 3 天试用：每日 ${DAILY_CREDITS_AMOUNT} 积分（当日有效）`,
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

  const { data, error } = await admin
    .from('profiles')
    .update({
      credit_grant_mode: mode,
      ...(mode === 'daily'
        ? { bundle_granted_until: null }
        : { daily_credits: 0, daily_credits_date: null })
    })
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw error;
  const synced = await syncMembershipCredits(admin, user.id);

  return c.json({
    ok: true,
    data: {
      message:
        mode === 'daily'
          ? `已切换为每日 ${DAILY_CREDITS_AMOUNT} 积分（当日有效）`
          : '已切换为一次性到账积分（永久有效，用完为止）',
      ...membershipCreditsPayload(synced || (data as typeof profile))
    }
  });
});
