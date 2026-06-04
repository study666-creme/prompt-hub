import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  grantBundleForActiveMembership,
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { extendMembershipDays } from '../../lib/membership-tasks';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

function isShopRechargeCode(note: string | null | undefined): boolean {
  return typeof note === 'string' && /^shop-cr\d/i.test(note);
}

function throwDbError(err: { message?: string; code?: string }, fallback: string): never {
  const msg = String(err.message || '');
  if (
    err.code === '42501' ||
    msg.includes('permission denied') ||
    msg.includes('JWT') ||
    msg.includes('Invalid API key') ||
    msg.includes('Unauthorized')
  ) {
    throw new ApiError(
      503,
      'DB_PERMISSION',
      '数据库权限未配置，请在 Supabase 执行 scripts/apply-grants-once.sql'
    );
  }
  if (msg.includes('apply_credit_delta') || msg.includes('does not exist')) {
    throw new ApiError(
      503,
      'DB_MIGRATION',
      '数据库迁移未完成，请执行 supabase/migrations/20260526000000_backend_core.sql'
    );
  }
  if (msg.includes('membership_queued')) {
    throw new ApiError(
      503,
      'MIGRATION_REQUIRED',
      '请先在 Supabase SQL Editor 执行 supabase/migrations/20260531120000_membership_queued_tier.sql'
    );
  }
  throw new ApiError(500, 'DB_ERROR', fallback);
}

const bodySchema = z.object({
  code: z.string().min(1).max(64),
  creditGrantMode: z.enum(['daily', 'bundle']).optional()
});

export const redeemRoutes = new Hono<{ Bindings: Env }>();

redeemRoutes.use('*', rateLimit(20, 60_000));

redeemRoutes.post('/', async c => {
  const user = c.get('user');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请输入有效的激活码');
  }

  const code = parsed.data.code.trim().toUpperCase();
  const admin = createAdminClient(c.env);

  const { data: row, error: codeErr } = await admin
    .from('activation_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (codeErr) throwDbError(codeErr, '查询激活码失败');
  if (!row || !row.active) {
    throw new ApiError(400, 'INVALID_CODE', '无效的激活码');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError(400, 'CODE_EXPIRED', '激活码已过期');
  }
  if (row.used_count >= row.max_uses) {
    throw new ApiError(400, 'CODE_EXHAUSTED', '该激活码已达使用上限');
  }

  const { data: existing } = await admin
    .from('code_redemptions')
    .select('id')
    .eq('code', code)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    throw new ApiError(400, 'ALREADY_REDEEMED', '您已使用过该激活码');
  }

  try {
    await getOrCreateProfile(admin, user.id);
  } catch (e) {
    throwDbError(e as { message?: string; code?: string }, '创建用户资料失败');
  }

  const { error: redeemErr } = await admin
    .from('code_redemptions')
    .insert({ code, user_id: user.id });
  if (redeemErr) {
    if (redeemErr.code === '23505') {
      throw new ApiError(400, 'ALREADY_REDEEMED', '您已使用过该激活码');
    }
    throwDbError(redeemErr, '写入兑换记录失败');
  }

  const { data: claimedRow, error: useErr } = await admin
    .from('activation_codes')
    .update({ used_count: row.used_count + 1 })
    .eq('code', code)
    .lt('used_count', row.max_uses)
    .select('used_count')
    .maybeSingle();
  if (useErr) throwDbError(useErr, '更新激活码次数失败');
  if (!claimedRow) {
    throw new ApiError(400, 'CODE_EXHAUSTED', '该激活码已达使用上限');
  }

  if (row.credits > 0) {
    const { error: creditErr } = await admin.rpc('apply_credit_delta', {
      p_user_id: user.id,
      p_delta: row.credits,
      p_reason: 'activation_code',
      p_ref_id: code,
      p_meta: {}
    });
    if (creditErr) {
      if (String(creditErr.message).includes('insufficient')) {
        throw new ApiError(400, 'CREDIT_ERROR', '积分操作失败');
      }
      throwDbError(creditErr, '积分入账失败');
    }
  }

  let membershipUntil: string | null = null;
  const hasMembership =
    !!row.membership_tier || (row.membership_days != null && row.membership_days > 0);
  if (hasMembership) {
    const tier = (row.membership_tier || 'basic') as NonNullable<
      import('../../lib/supabase').Profile['membership_tier']
    >;
    const days = row.membership_days ?? 30;
    const shopRecharge = isShopRechargeCode(row.note);
    const profileBefore = await getOrCreateProfile(admin, user.id);
    const userPickedMode =
      parsed.data.creditGrantMode === 'daily' || parsed.data.creditGrantMode === 'bundle'
        ? parsed.data.creditGrantMode
        : null;
    let mode = tier === 'lite'
      ? 'daily'
      : shopRecharge
        ? 'daily'
        : userPickedMode || profileBefore.credit_grant_mode || 'daily';

    let profileAfter: import('../../lib/supabase').Profile;
    try {
      profileAfter = await extendMembershipDays(admin, profileBefore, days, tier, {
        creditGrantMode: mode
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes('membership_queued')) {
        throw new ApiError(
          503,
          'MIGRATION_REQUIRED',
          '会员排队字段未就绪，请执行 20260531120000_membership_queued_tier.sql；积分已入账'
        );
      }
      throw new ApiError(
        500,
        'MEMBERSHIP_EXTEND_FAILED',
        row.credits > 0
          ? '积分已到账，但会员时长写入失败，请联系客服补全会员'
          : '会员时长写入失败，请稍后重试或联系客服'
      );
    }
    membershipUntil = profileAfter.membership_until;

    const memberPatch: Record<string, unknown> = {
      credit_grant_mode: mode
    };
    if (row.offer_kind === 'starter_14d') {
      memberPatch.first_sub_offer_used = true;
    }

    await admin.from('profiles').update(memberPatch).eq('user_id', user.id);
  }

  let profile = await syncMembershipCredits(admin, user.id);
  if (hasMembership && profile.credit_grant_mode === 'bundle') {
    profile = await grantBundleForActiveMembership(admin, profile);
  }
  const creditsInfo = membershipCreditsPayload(profile);

  const parts: string[] = [];
  if (row.credits > 0) parts.push(`+${row.credits} 积分`);
  if (hasMembership) {
    const tier = row.membership_tier || 'basic';
    const days = row.membership_days ?? 30;
    const tierLabel =
      tier === 'pro' ? '专业' : tier === 'standard' ? '标准' : tier === 'lite' ? '轻量' : '基础';
    if (row.offer_kind === 'mini_3d') {
      parts.push('已开通 3 天基础会员（¥0.99 体验）');
    } else if (row.offer_kind === 'starter_14d') {
      parts.push('已开通 14 天基础会员');
    } else if (isShopRechargeCode(row.note) && row.credits > 0) {
      parts.push(`赠送 ${days} 天${tierLabel}会员（每日积分模式）`);
    } else {
      parts.push(`已开通 ${days} 天${tierLabel}会员`);
    }
    if (profile.credit_grant_mode === 'bundle') {
      parts.push('积分已按一次性到账发放（永久有效）');
    } else if (!shopRecharge) {
      parts.push('会员每日积分请在任务中心领取');
    }
    if (profile.membership_queued_tier && profile.membership_queued_until) {
      const qLabel =
        profile.membership_queued_tier === 'pro'
          ? '专业'
          : profile.membership_queued_tier === 'standard'
            ? '标准'
            : profile.membership_queued_tier === 'lite'
              ? '轻量'
              : '基础';
      parts.push(`${tierLabel}会员先用，到期后自动接续${qLabel}剩余时长`);
    }
  }

  return c.json({
    ok: true,
    data: {
      message: parts.length ? parts.join('，') : '兑换成功',
      credits: creditsInfo.creditsSpendable,
      creditsPermanent: creditsInfo.creditsPermanent,
      dailyCredits: creditsInfo.dailyCredits,
      creditGrantMode: creditsInfo.creditGrantMode,
      membershipTier: profile.membership_tier,
      membershipUntil: profile.membership_until,
      membershipQueuedTier: profile.membership_queued_tier || null,
      membershipQueuedUntil: profile.membership_queued_until || null
    }
  });
});
