import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

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
  if (row.membership_tier) {
    const days = row.membership_days ?? null;
    const until = days
      ? new Date(Date.now() + days * 86400000)
      : null;
    membershipUntil = until ? until.toISOString() : null;

    const profileBefore = await getOrCreateProfile(admin, user.id);
    const mode =
      parsed.data.creditGrantMode ||
      profileBefore.credit_grant_mode ||
      'bundle';
    const memberPatch: Record<string, unknown> = {
      membership_tier: row.membership_tier,
      membership_until: membershipUntil,
      credit_grant_mode: mode,
      bundle_granted_until: null
    };
    if (row.offer_kind === 'starter_14d') {
      memberPatch.first_sub_offer_used = true;
    }
    if (mode === 'daily') {
      memberPatch.daily_credits = 0;
      memberPatch.daily_credits_date = null;
    }

    await admin.from('profiles').update(memberPatch).eq('user_id', user.id);
    await syncMembershipCredits(admin, user.id);
  }

  const { error: redeemErr } = await admin
    .from('code_redemptions')
    .insert({ code, user_id: user.id });
  if (redeemErr) throwDbError(redeemErr, '写入兑换记录失败');

  const { error: useErr } = await admin
    .from('activation_codes')
    .update({ used_count: row.used_count + 1 })
    .eq('code', code);
  if (useErr) throwDbError(useErr, '更新激活码次数失败');

  const profile = await syncMembershipCredits(admin, user.id);
  const creditsInfo = membershipCreditsPayload(profile);

  const parts: string[] = [];
  if (row.credits > 0) parts.push(`+${row.credits} 积分`);
  if (row.membership_tier) {
    if (row.offer_kind === 'starter_14d') {
      parts.push('已开通 14 天基础会员（¥1.9 续杯）');
    } else {
      parts.push(`已开通${row.membership_tier}会员`);
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
      membershipUntil: profile.membership_until
    }
  });
});
