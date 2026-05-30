import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import {
  DAILY_CREDITS_BY_TIER,
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { normalizeDisplayName, resolveDisplayName } from '../../lib/display-name';
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
      displayName: resolveDisplayName(profile),
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
        genDiscount: memberActive && profile.membership_tier && profile.membership_tier !== 'lite'
          ? { basic: '9折', standard: '8折', pro: '7折' }[profile.membership_tier!]
          : null
      },
      firstSubOfferUsed: profile.first_sub_offer_used,
      trialFreeUsed: profile.trial_free_used,
      lifetimeCreditsSpent: profile.lifetime_credits_spent ?? 0,
      dailyCreditsByTier: DAILY_CREDITS_BY_TIER,
      lumpCreditsByTier: { lite: 0, basic: 130, standard: 320, pro: 700 }
    }
  });
});

const displayNameBody = z.object({
  displayName: z.string().min(1).max(20)
});

meRoutes.patch('/display-name', async c => {
  const user = c.get('user');
  const body = displayNameBody.parse(await c.req.json());
  const name = normalizeDisplayName(body.displayName);
  if (!name) {
    return c.json(
      {
        ok: false,
        code: 'INVALID_NAME',
        message: '昵称需 2～20 字，仅支持中文、字母、数字、下划线或连字符'
      },
      400
    );
  }
  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('profiles')
    .update({ display_name: name })
    .eq('user_id', user.id)
    .select('display_name')
    .single();
  if (error) {
    if (error.code === '23505') {
      return c.json({ ok: false, code: 'NAME_TAKEN', message: '该昵称已被使用' }, 409);
    }
    throw error;
  }
  return c.json({ ok: true, data: { displayName: data.display_name } });
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
