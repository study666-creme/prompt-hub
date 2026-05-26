import { Hono } from 'hono';
import type { Env } from '../../env';
import { createAdminClient, getOrCreateProfile, isMembershipActive } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

export const meRoutes = new Hono<{ Bindings: Env }>();

meRoutes.use('*', rateLimit(120, 60_000));

meRoutes.get('/', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  const memberActive = isMembershipActive(profile);

  return c.json({
    ok: true,
    data: {
      userId: user.id,
      email: user.email ?? null,
      credits: profile.credits,
      membership: {
        tier: memberActive ? profile.membership_tier : null,
        until: profile.membership_until,
        active: memberActive,
        genDiscount: memberActive && profile.membership_tier
          ? { basic: '9折', standard: '8折', pro: '7折' }[profile.membership_tier!]
          : null
      },
      firstSubOfferUsed: profile.first_sub_offer_used
    }
  });
});

const REASON_LABELS: Record<string, string> = {
  activation_code: '激活码兑换',
  image_generation: '图片生成',
  image_generation_refund: '生图退款',
  payment_topup: '充值',
  subscription_grant: '订阅开通',
  like_milestone: '点赞奖励'
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
