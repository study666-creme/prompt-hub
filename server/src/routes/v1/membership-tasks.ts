import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { isSchemaMigrationError } from '../../lib/cors-headers';
import {
  buildTaskList,
  claimMembershipTask,
  countQualifyingPosts,
  detectDeviceFromUa,
  listClaimedKeys,
  mergeTaskFlags,
  parseTaskFlags
} from '../../lib/membership-tasks';
import { membershipCreditsPayload, syncMembershipCredits } from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const syncBodySchema = z.object({
  cardsCount: z.number().int().min(0).max(50_000).optional(),
  pwaInstalled: z.boolean().optional(),
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

export const membershipTaskRoutes = new Hono<{ Bindings: Env }>();

membershipTaskRoutes.use('*', rateLimit(180, 60_000));

membershipTaskRoutes.get('/', async c => {
  try {
    const user = c.get('user');
    const admin = createAdminClient(c.env);
    const ua = c.req.header('user-agent') || '';

    const device = detectDeviceFromUa(ua);
    if (device === 'desktop') {
      await mergeTaskFlags(admin, user.id, { login_desktop: true });
    } else if (device === 'mobile') {
      await mergeTaskFlags(admin, user.id, { login_mobile: true });
    }

    const profile = await syncMembershipCredits(admin, user.id);
    const flags = parseTaskFlags(profile);
    const claimed = await listClaimedKeys(admin, user.id);
    const list = buildTaskList(profile, flags, claimed, user.phoneVerified);

    return c.json({
      ok: true,
      data: {
        ...list,
        flags,
        phoneVerified: user.phoneVerified
      }
    });
  } catch (err) {
    if (isSchemaMigrationError(err)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请在 Supabase SQL 编辑器执行迁移 20260528120000_membership_tasks.sql'
      );
    }
    throw err;
  }
});

membershipTaskRoutes.post('/sync', async c => {
  const user = c.get('user');
  const parsed = syncBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数无效');
  }

  const admin = createAdminClient(c.env);
  const patch: Record<string, unknown> = {};

  if (parsed.data.pwaInstalled === true) {
    patch.pwa_installed = true;
  }
  if (typeof parsed.data.cardsCount === 'number') {
    patch.cards_count_synced = parsed.data.cardsCount;
  }
  if (parsed.data.communityPosts?.length) {
    patch.community_qualified_count = countQualifyingPosts(
      parsed.data.communityPosts
    );
  }

  if (Object.keys(patch).length) {
    await mergeTaskFlags(admin, user.id, patch);
  }

  const profile = await getOrCreateProfile(admin, user.id);
  const flags = parseTaskFlags(profile);
  const claimed = await listClaimedKeys(admin, user.id);
  const list = buildTaskList(profile, flags, claimed, user.phoneVerified);

  return c.json({ ok: true, data: list });
});

membershipTaskRoutes.post('/:taskKey/claim', async c => {
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
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'already_claimed') {
      throw new ApiError(400, 'ALREADY_CLAIMED', '该任务奖励已领取');
    }
    if (msg === 'not_ready') {
      throw new ApiError(400, 'NOT_READY', '任务尚未完成，请稍后再试');
    }
    if (msg === 'unknown_task') {
      throw new ApiError(400, 'UNKNOWN_TASK', '未知任务');
    }
    throw e;
  }
});
