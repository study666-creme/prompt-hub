import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const bodySchema = z.object({
  code: z.string().min(1).max(64)
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

  if (codeErr) throw codeErr;
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

  await getOrCreateProfile(admin, user.id);

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
      throw creditErr;
    }
  }

  let membershipUntil: string | null = null;
  if (row.membership_tier) {
    const days = row.membership_days ?? null;
    const until = days
      ? new Date(Date.now() + days * 86400000)
      : null;
    membershipUntil = until ? until.toISOString() : null;

    await admin
      .from('profiles')
      .update({
        membership_tier: row.membership_tier,
        membership_until: membershipUntil
      })
      .eq('user_id', user.id);
  }

  await admin.from('code_redemptions').insert({ code, user_id: user.id });
  await admin
    .from('activation_codes')
    .update({ used_count: row.used_count + 1 })
    .eq('code', code);

  const profile = await getOrCreateProfile(admin, user.id);

  const parts: string[] = [];
  if (row.credits > 0) parts.push(`+${row.credits} 积分`);
  if (row.membership_tier) parts.push(`已开通${row.membership_tier}会员`);

  return c.json({
    ok: true,
    data: {
      message: parts.length ? parts.join('，') : '兑换成功',
      credits: profile.credits,
      membershipTier: profile.membership_tier,
      membershipUntil: profile.membership_until
    }
  });
});
