import { Hono } from 'hono';
import type { Env } from '../../env';
import {
  DAILY_CREDITS_BY_TIER,
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient, isMembershipActive } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

export const meRoutes = new Hono<{ Bindings: Env }>();

meRoutes.use('*', rateLimit(120, 60_000));

meRoutes.get('/', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const credits = membershipCreditsPayload(profile);

  return c.json({
    ok: true,
    data: {
      userId: user.id,
      email: user.email ?? null,
      phoneVerified: user.phoneVerified,
      credits: credits.creditsSpendable,
      creditsPermanent: credits.creditsPermanent,
      dailyCredits: credits.dailyCredits,
      creditGrantMode: credits.creditGrantMode,
      dailyCreditsNote: credits.dailyCreditsNote,
      membership: {
        tier: memberActive ? profile.membership_tier : null,
        until: profile.membership_until,
        active: memberActive,
        genDiscount: memberActive && profile.membership_tier
          ? { basic: '9折', standard: '8折', pro: '7折' }[profile.membership_tier!]
          : null
      },
      firstSubOfferUsed: profile.first_sub_offer_used,
      trialFreeUsed: profile.trial_free_used,
      lifetimeCreditsSpent: profile.lifetime_credits_spent ?? 0,
      dailyCreditsByTier: DAILY_CREDITS_BY_TIER,
      lumpCreditsByTier: { basic: 100, standard: 310, pro: 620 }
    }
  });
});

const REASON_LABELS: Record<string, string> = {
  activation_code: '激活码兑换',
  image_generation: '图片生成',
  image_generation_refund: '生图退款',
  payment_topup: '充值',
  subscription_grant: '订阅开通',
  like_milestone: '点赞奖励',
  daily_grant: '每日会员积分',
  membership_task: '会员任务奖励'
};

meRoutes.get('/ledger', async c => {
  const user = c.get('user');
  const limitRaw = Number(c.req.query('limit') || 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const admin = createAdminClient(c.env);

  const { data, error } = await admin
    .from('credit_ledger')
    .select('id, delta, balance_after, reason, ref_id, meta, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return c.json({
    ok: true,
    data: {
      items: (data ?? []).map(row => ({
        id: row.id,
        delta: row.delta,
        balanceAfter: row.balance_after,
        reason: row.reason,
        reasonLabel: REASON_LABELS[row.reason] || row.reason,
        refId: row.ref_id,
        meta: row.meta,
        createdAt: row.created_at
      }))
    }
  });
});
