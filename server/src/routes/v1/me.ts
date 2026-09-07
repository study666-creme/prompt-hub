import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import {
  DAILY_CREDITS_BY_TIER,
  membershipCreditsPayload,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { normalizeDisplayName, resolveDisplayName } from '../../lib/display-name';
import { buildCommunityGachaQuota } from '../../lib/community-gacha';
import { buildInspirationDrawQuota } from '../../lib/inspiration-draw';
import { IMAGE_MODEL_CATALOG } from '../../lib/image-models-catalog';
import { MJ_ACTION_LABEL_ZH } from '../../lib/midjourney-models';
import {
  assertStorageDelta,
  storagePayloadForProfile,
  storagePolicySummary
} from '../../lib/storage-quota';
import { createAdminClient, getOrCreateProfile, isMembershipActive, membershipGenDiscountLabel } from '../../lib/supabase';
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
        queuedTier: profile.membership_queued_tier || null,
        queuedUntil: profile.membership_queued_until || null,
        active: memberActive,
        genDiscount: memberActive && profile.membership_tier && profile.membership_tier !== 'lite'
          ? membershipGenDiscountLabel(profile.membership_tier)
          : null
      },
      firstSubOfferUsed: profile.first_sub_offer_used,
      trialFreeUsed: profile.trial_free_used,
      lifetimeCreditsSpent: profile.lifetime_credits_spent ?? 0,
      dailyCreditsByTier: DAILY_CREDITS_BY_TIER,
      lumpCreditsByTier: { lite: 0, basic: 130, standard: 320, pro: 700 },
      inspirationDraw: buildInspirationDrawQuota(profile),
      communityGacha: buildCommunityGachaQuota(profile),
      storage: storagePayloadForProfile(profile),
      storagePolicy: storagePolicySummary()
    }
  });
});

const storageDeltaBody = z.object({
  delta: z.number().int().min(0).max(60 * 1024 * 1024)
});

meRoutes.post('/storage/delta', async c => {
  const user = c.get('user');
  const body = storageDeltaBody.parse(await c.req.json().catch(() => ({})));
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  try {
    assertStorageDelta(profile, body.delta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '云存储空间不足';
    return c.json({ ok: false, code: 'STORAGE_QUOTA', message: msg }, 402);
  }
  const usedBytes = Math.max(0, Number(profile.storage_bytes) || 0) + body.delta;
  const { error } = await admin
    .from('profiles')
    .update({ storage_bytes: usedBytes })
    .eq('user_id', user.id);
  if (error) throw error;
  const next = { ...profile, storage_bytes: usedBytes };
  return c.json({
    ok: true,
    data: storagePayloadForProfile(next)
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
  video_generation: '视频生成',
  video_generation_refund: '视频退款',
  prompt_reverse: '参考图反推',
  prompt_fission: '图片裂变分析',
  prompt_optimize: '提示词优化',
  prompt_purify_describe: '画质净化读图',
  chat_generation: 'AI 对话',
  payment_topup: '充值',
  subscription_grant: '订阅开通',
  like_milestone: '点赞奖励',
  daily_grant: '每日会员积分',
  daily_expire: '每日积分过期清零',
  membership_task: '会员任务奖励',
  invite_redeem: '邀请奖励',
  checkin_streak_bonus: '连续签到奖励（每 7 天）',
  daily_checkin: '每日签到'
};

const PUBLIC_LEDGER_MODEL_IDS = new Set([
  ...IMAGE_MODEL_CATALOG.map(model => model.id),
  'creative-5-5',
  'creative-5-6',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'motion-video',
  'motion-video-1-5',
  'motion-video-1-5-fast'
]);

const PUBLIC_LEDGER_PHASES: Record<string, string> = {
  submit: 'submit',
  submit_error: 'submit',
  generation: 'generation',
  upstream_failed: 'generation',
  payment: 'payment'
};

export function projectPublicLedgerMeta(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const projected: Record<string, string | number> = {};
  const model = String(source.model || '').trim();
  if (PUBLIC_LEDGER_MODEL_IDS.has(model)) projected.model = model;
  const resolution = String(source.resolution || '').trim().toLowerCase();
  if (/^(?:1k|2k|4k|480p|720p|1080p|1440p|2160p)$/.test(resolution)) {
    projected.resolution = resolution;
  }
  const count = Number(source.count);
  if (Number.isInteger(count) && count > 0 && count <= 100) projected.count = count;
  const mjAction = String(source.mjAction || '').trim();
  if (Object.prototype.hasOwnProperty.call(MJ_ACTION_LABEL_ZH, mjAction)) {
    projected.mjAction = mjAction;
  }
  const phase = PUBLIC_LEDGER_PHASES[String(source.phase || '').trim()];
  if (phase) projected.phase = phase;
  return projected;
}

export function projectPublicLedgerItem(row: Record<string, unknown>) {
  const rawReason = String(row.reason || '');
  const knownReason = Object.prototype.hasOwnProperty.call(REASON_LABELS, rawReason);
  return {
    id: row.id,
    delta: row.delta,
    balanceAfter: row.balance_after,
    reason: knownReason ? rawReason : 'other',
    reasonLabel: knownReason ? REASON_LABELS[rawReason] : '积分变动',
    meta: projectPublicLedgerMeta(row.meta),
    createdAt: row.created_at
  };
}

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
      items: (data ?? []).map(row => projectPublicLedgerItem(row))
    }
  });
});
