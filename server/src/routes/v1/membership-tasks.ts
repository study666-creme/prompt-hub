import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { isSchemaMigrationError, extractErrorMessage } from '../../lib/cors-headers';
import {
  buildTaskHub,
  buildTaskList,
  ensureTaskMembershipDailyMode,
  claimDailyCheckin,
  claimMembershipTask,
  countQualifyingPosts,
  detectDeviceFromUa,
  listClaimedKeys,
  mergeTaskFlags,
  parseTaskFlags,
  PhoneRequiredError
} from '../../lib/membership-tasks';
import { ensureInviteCode, redeemInviteCode } from '../../lib/invite-codes';
import { membershipCreditsPayload, syncMembershipCredits } from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const syncBodySchema = z.object({
  cardsCount: z.number().int().min(0).max(50_000).optional(),
  pwaInstalled: z.boolean().optional(),
  quickPreviewWarehouseUsed: z.boolean().optional(),
  quickPreviewWarehouseGotoGen: z.boolean().optional(),
  quickPreviewWarehouseFavorited: z.boolean().optional(),
  quickPreviewCommunityUsed: z.boolean().optional(),
  quickPreviewCommunityFavorited: z.boolean().optional(),
  assetStudioLinkCard: z.boolean().optional(),
  inspirationDrawUsed: z.boolean().optional(),
  communityGachaCollectUsed: z.boolean().optional(),
  communityPosts: z
    .array(
      z.object({
        prompt: z.string().max(8000).optional(),
        title: z.string().max(500).optional(),
        image: z.string().max(2048).nullable().optional()
      })
    )
    .max(500)
    .optional()
});

const claimParamsSchema = z.object({
  taskKey: z.string().min(1).max(64)
});

const inviteBodySchema = z.object({
  code: z.string().min(3).max(32)
});

export const membershipTaskRoutes = new Hono<{ Bindings: Env }>();

function siteUrlFromRequest(c: {
  req: { url: string; header: (n: string) => string | undefined };
  env: Env;
}): string {
  const envSite = c.env.PUBLIC_SITE_URL;
  if (envSite && String(envSite).trim()) return String(envSite).trim().replace(/\/$/, '');
  const origin = c.req.header('origin');
  if (origin) return origin.replace(/\/$/, '');
  try {
    const u = new URL(c.req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://prompt-hub.cn';
  }
}

async function hasMini99Redemption(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data } = await admin
    .from('code_redemptions')
    .select('code')
    .eq('user_id', userId)
    .eq('code', 'MINI-99-3D')
    .maybeSingle();
  return !!data;
}

async function loadTaskPayload(
  c: {
    req: { url: string; header: (n: string) => string | undefined };
    env: Env;
  },
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; phoneVerified: boolean },
  ua: string
) {
  let profile = await getOrCreateProfile(admin, user.id);
  let flags = parseTaskFlags(profile);
  const device = detectDeviceFromUa(ua);
  const devicePatch: Partial<Record<string, boolean>> = {};
  if (device === 'desktop' && !flags.login_desktop) devicePatch.login_desktop = true;
  if (device === 'mobile' && !flags.login_mobile) devicePatch.login_mobile = true;
  if (Object.keys(devicePatch).length) {
    try {
      flags = await mergeTaskFlags(admin, user.id, devicePatch);
      profile = await getOrCreateProfile(admin, user.id);
    } catch (mergeErr) {
      if (isSchemaMigrationError(mergeErr)) {
        throw new ApiError(
          503,
          'MIGRATION_REQUIRED',
          '请在 Supabase SQL 编辑器执行迁移 20260528140000_invite_signin_hub.sql'
        );
      }
      console.error('membership task device flag merge failed', mergeErr);
    }
  }

  const claimed = await listClaimedKeys(admin, user.id).catch((claimErr) => {
    if (isSchemaMigrationError(claimErr)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请在 Supabase SQL 编辑器执行迁移 20260528120000_membership_tasks.sql'
      );
    }
    console.error('membership_task_claims read failed', claimErr);
    return new Set<string>();
  });

  const inviteCode = await ensureInviteCode(admin, profile);
  profile = await getOrCreateProfile(admin, user.id);
  profile = await ensureTaskMembershipDailyMode(admin, profile);
  const referred = !!(profile as { referred_by?: string | null }).referred_by;
  const siteUrl = siteUrlFromRequest(c);
  const hub = buildTaskHub(profile, flags, claimed, user.phoneVerified, {
    inviteCode,
    siteUrl,
    referred
  });
  const list = buildTaskList(profile, flags, claimed, user.phoneVerified, {
    mini99Redeemed: await hasMini99Redemption(admin, user.id),
    includeDailyInList: false
  });

  return { hub, list };
}

membershipTaskRoutes.get('/', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  try {
    const { hub, list } = await loadTaskPayload(c, admin, user, c.req.header('user-agent') || '');
    return c.json({
      ok: true,
      data: {
        ...list,
        hub,
        phoneVerified: user.phoneVerified
      }
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (isSchemaMigrationError(err)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请在 Supabase SQL 编辑器执行迁移 20260528120000_membership_tasks.sql'
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(500, 'TASKS_LOAD_FAILED', msg.slice(0, 180));
  }
});

membershipTaskRoutes.post('/sync', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const parsed = syncBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数无效');
  }

  const admin = createAdminClient(c.env);
  const patch: Record<string, unknown> = {};
  const ua = c.req.header('user-agent') || '';
  const device = detectDeviceFromUa(ua);
  if (device === 'desktop') patch.login_desktop = true;
  else if (device === 'mobile') patch.login_mobile = true;

  if (parsed.data.pwaInstalled === true) patch.pwa_installed = true;
  if (typeof parsed.data.cardsCount === 'number') patch.cards_count_synced = parsed.data.cardsCount;
  if (parsed.data.quickPreviewWarehouseUsed === true) patch.warehouse_quick_preview_used = true;
  if (parsed.data.quickPreviewWarehouseGotoGen === true) {
    patch.warehouse_quick_preview_goto_gen = true;
  }
  if (parsed.data.quickPreviewWarehouseFavorited === true) {
    patch.warehouse_quick_preview_favorited = true;
  }
  if (parsed.data.quickPreviewCommunityUsed === true) patch.community_quick_preview_used = true;
  if (parsed.data.quickPreviewCommunityFavorited === true) {
    patch.community_quick_preview_favorited = true;
  }
  if (parsed.data.assetStudioLinkCard === true) patch.asset_studio_link_card = true;
  if (parsed.data.inspirationDrawUsed === true) patch.inspiration_draw_used = true;
  if (parsed.data.communityGachaCollectUsed === true) patch.community_gacha_collect_used = true;
  if (parsed.data.communityPosts?.length) {
    patch.community_qualified_count = countQualifyingPosts(parsed.data.communityPosts);
  }

  if (Object.keys(patch).length) {
    try {
      await mergeTaskFlags(admin, user.id, patch);
    } catch (mergeErr) {
      if (isSchemaMigrationError(mergeErr)) {
        throw new ApiError(
          503,
          'MIGRATION_REQUIRED',
          '请在 Supabase SQL 编辑器执行迁移 20260528120000_membership_tasks.sql'
        );
      }
      console.error('membership tasks sync merge failed', mergeErr);
    }
  }

  const { hub, list } = await loadTaskPayload(c, admin, user, ua);
  return c.json({ ok: true, data: { ...list, hub } });
});

membershipTaskRoutes.post('/checkin', rateLimit(30, 60_000), async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  try {
    const result = await claimDailyCheckin(admin, user.id, user.phoneVerified);
    return c.json({
      ok: true,
      data: {
        message: result.message,
        streak: result.streak,
        bonusCredits: result.bonusCredits,
        ...membershipCreditsPayload(result.profile),
        membership: {
          tier: result.profile.membership_tier,
          until: result.profile.membership_until,
          active: true
        }
      }
    });
  } catch (e) {
    const msg = extractErrorMessage(e);
    if (e instanceof PhoneRequiredError || msg === 'phone_required') {
      throw new ApiError(403, 'PHONE_REQUIRED', '领取任务奖励前须先绑定手机号');
    }
    if (msg === 'already_checked_in') {
      throw new ApiError(400, 'ALREADY_CLAIMED', '今日已领取每日积分（含签到）');
    }
    if (isSchemaMigrationError(e)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '请执行数据库迁移后重试');
    }
    throw new ApiError(500, 'CHECKIN_FAILED', msg.slice(0, 180));
  }
});

membershipTaskRoutes.post('/redeem-invite', rateLimit(20, 60_000), async c => {
  const user = c.get('user');
  const parsed = inviteBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '邀请码格式无效');
  }
  const admin = createAdminClient(c.env);
  if (!user.phoneVerified) {
    throw new ApiError(403, 'PHONE_REQUIRED', '领取任务奖励前须先绑定手机号');
  }
  try {
    const result = await redeemInviteCode(admin, user.id, parsed.data.code);
    const profile = await syncMembershipCredits(admin, user.id);
    return c.json({
      ok: true,
      data: {
        message: result.message,
        ...membershipCreditsPayload(profile),
        membership: {
          tier: profile.membership_tier,
          until: profile.membership_until,
          active: true
        }
      }
    });
  } catch (e) {
    const msg = extractErrorMessage(e);
    if (msg === 'invalid_code') throw new ApiError(400, 'INVALID_CODE', '邀请码无效');
    if (msg === 'self_invite') throw new ApiError(400, 'SELF_INVITE', '不能填写自己的邀请码');
    if (msg === 'already_redeemed') throw new ApiError(400, 'ALREADY_REDEEMED', '你已填写过邀请码');
    if (isSchemaMigrationError(e)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请执行 supabase/migrations/20260528140000_invite_signin_hub.sql'
      );
    }
    throw new ApiError(500, 'INVITE_FAILED', msg.slice(0, 180));
  }
});

membershipTaskRoutes.post('/:taskKey/claim', rateLimit(60, 60_000), async c => {
  const user = c.get('user');
  const taskKey = c.req.param('taskKey');
  const parsed = claimParamsSchema.safeParse({ taskKey });
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '任务无效');
  }

  const admin = createAdminClient(c.env);
  try {
    const result = await claimMembershipTask(
      admin,
      user.id,
      parsed.data.taskKey,
      user.phoneVerified
    );
    return c.json({
      ok: true,
      data: {
        message: result.message,
        ...membershipCreditsPayload(result.profile),
        membership: {
          tier: result.profile.membership_tier,
          until: result.profile.membership_until,
          active: true
        }
      }
    });
  } catch (e) {
    const msg = extractErrorMessage(e);
    if (e instanceof PhoneRequiredError || msg === 'phone_required') {
      throw new ApiError(403, 'PHONE_REQUIRED', '领取任务奖励前须先绑定手机号');
    }
    if (msg === 'already_claimed') {
      throw new ApiError(400, 'ALREADY_CLAIMED', '该任务奖励已领取');
    }
    if (msg === 'not_ready') {
      throw new ApiError(400, 'NOT_READY', '任务尚未完成，请稍后再试');
    }
    if (msg === 'unknown_task') {
      throw new ApiError(400, 'UNKNOWN_TASK', '未知任务');
    }
    if (isSchemaMigrationError(e)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请在 Supabase SQL 编辑器执行：supabase/migrations/20260528120200_membership_task_claims_grants.sql'
      );
    }
    if (e instanceof ApiError) throw e;
    console.error('membership task claim failed', e);
    throw new ApiError(500, 'CLAIM_FAILED', msg.slice(0, 180) || '领取失败，请稍后重试');
  }
});
