import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  listPublicCommunityFeed,
  likeCommunityPost,
  resolvePublicImageRef,
  syncAuthorCommunityPosts,
  unpublishCommunityPost,
  upsertCommunityPost,
  type CommunityPostPayload
} from '../../lib/community-feed';
import { moderateCommunityContent } from '../../lib/community-moderation';
import { resolveVisionApiBindings } from '../../lib/vision-chat';
import { tryGrantLikeMilestone } from '../../lib/like-milestone';
import {
  listCommunityNotifications,
  pushCommunityNotification
} from '../../lib/community-notify';
import {
  buildCommunityGachaQuota,
  consumeCommunityGachaDraw
} from '../../lib/community-gacha';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { applyCorsHeaders } from '../../lib/cors-headers';
import { diagnoseSupabaseUpstream } from '../../lib/supabase-upstream';
import { rateLimit } from '../../middleware/rate-limit';

const bodySchema = z.object({
  postId: z.string().min(1).max(128),
  likes: z.number().int().min(0).max(10_000_000)
});

const postBodySchema = z.object({
  id: z.string().min(1).max(128),
  sourceCardId: z.string().max(128).optional().nullable(),
  authorName: z.string().max(80).optional(),
  title: z.string().max(200).optional(),
  prompt: z.string().min(1).max(20000),
  image: z.string().max(4000).optional().nullable(),
  likes: z.number().int().min(0).max(10_000_000).optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional()
});

const syncBodySchema = z.object({
  posts: z.array(postBodySchema).max(80)
});

const notifyBodySchema = z.object({
  targetUserId: z.string().uuid(),
  type: z.enum(['like', 'favorite', 'follow']),
  postId: z.string().max(128).optional().nullable(),
  postTitle: z.string().max(120).optional().nullable(),
  message: z.string().max(240).optional().nullable(),
  actorName: z.string().max(80).optional().nullable()
});

export const communityRoutes = new Hono<{ Bindings: Env }>();

communityRoutes.use('*', rateLimit(180, 60_000));

function isMissingCommunityTable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '');
  return /community_posts|does not exist|schema cache/i.test(msg);
}

/** 全站公开社区流（游客 / 所有登录用户） */
export async function communityFeedHandler(c: Context<{ Bindings: Env }>) {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 60)));
  const offset = Math.max(0, Number(c.req.query('offset') || 0));
  const admin = createAdminClient(c.env);
  try {
    const posts = await listPublicCommunityFeed(admin, limit, offset, {
      repairAuthors: false,
      runMaintenance: false
    });
    c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    applyCorsHeaders(c);
    const hasMore = posts.length >= limit;
    return c.json({
      ok: true,
      data: { posts, limit, offset, nextOffset: offset + posts.length, hasMore }
    });
  } catch (e) {
    applyCorsHeaders(c);
    const upstreamHint = await diagnoseSupabaseUpstream(c.env);
    if (upstreamHint) {
      throw new ApiError(503, 'SUPABASE_UPSTREAM', upstreamHint);
    }
    if (isMissingCommunityTable(e)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请在 Supabase 执行迁移 20260528180000_community_posts_public.sql'
      );
    }
    throw e;
  }
}

async function assertCommunityPublishAllowed(
  c: Context<{ Bindings: Env }>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  payload: CommunityPostPayload,
  opts?: { skipVision?: boolean }
) {
  const resolvedImage = await resolvePublicImageRef(admin, userId, payload, c.env);
  let visionKey: string | undefined;
  let visionBase: string | undefined;
  let skipVision = false;
  try {
    const vision = resolveVisionApiBindings(c.env);
    visionKey = vision.apiKey;
    visionBase = vision.baseUrl;
  } catch {
    skipVision = true;
  }
  const mod = await moderateCommunityContent({
    admin,
    prompt: payload.prompt,
    imageRef: resolvedImage || payload.image,
    visionApiKey: visionKey,
    visionApiBaseUrl: visionBase,
    skipVision: opts?.skipVision === true || skipVision
  });
  if (!mod.safe) {
    throw new ApiError(400, 'CONTENT_REJECTED', mod.reason || '内容不符合社区规范');
  }
}

/** 发布 / 更新自己的社区帖到全站 Feed */
communityRoutes.post('/posts', async c => {
  const user = c.get('user');
  const parsed = postBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '帖子参数无效');
  }
  const admin = createAdminClient(c.env);
  try {
    await assertCommunityPublishAllowed(c, admin, user.id, parsed.data as CommunityPostPayload);
    const post = await upsertCommunityPost(admin, user.id, parsed.data as CommunityPostPayload, c.env);
    return c.json({ ok: true, data: { post } });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const msg = String((e as Error).message || e);
    if (isMissingCommunityTable(e)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '社区表未就绪，请执行数据库迁移');
    }
    throw new ApiError(400, 'PUBLISH_FAILED', msg.slice(0, 180));
  }
});

/** 从全站 Feed 下架自己的帖 */
communityRoutes.delete('/posts/:id', async c => {
  const user = c.get('user');
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  try {
    await unpublishCommunityPost(admin, user.id, postId);
    return c.json({ ok: true, data: { id: postId } });
  } catch (e) {
    if (isMissingCommunityTable(e)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '社区表未就绪，请执行数据库迁移');
    }
    throw e;
  }
});

/** 登录后把本账号已发布帖同步到全站（补历史数据） */
communityRoutes.post('/posts/sync', async c => {
  const user = c.get('user');
  const parsed = syncBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '同步数据无效');
  }
  const admin = createAdminClient(c.env);
  const authorName =
    user.email?.split('@')[0] || '用户';
  try {
    const allowed: CommunityPostPayload[] = [];
    for (const p of parsed.data.posts as CommunityPostPayload[]) {
      try {
        const { data: existingRow } = await admin
          .from('community_posts')
          .select('id')
          .eq('id', String(p.id || ''))
          .maybeSingle();
        await assertCommunityPublishAllowed(c, admin, user.id, p, {
          skipVision: !!existingRow?.id
        });
        allowed.push(p);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONTENT_REJECTED') continue;
        if (e instanceof ApiError) throw e;
      }
    }
    const result = await syncAuthorCommunityPosts(
      admin,
      user.id,
      authorName,
      allowed,
      c.env
    );
    return c.json({ ok: true, data: result });
  } catch (e) {
    if (isMissingCommunityTable(e)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '社区表未就绪，请执行数据库迁移');
    }
    throw new ApiError(500, 'SYNC_FAILED', String((e as Error).message || e).slice(0, 180));
  }
});

/** 点赞（全站计数，每账号每帖一次） */
communityRoutes.post('/posts/:id/like', async c => {
  const user = c.get('user');
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  try {
    const result = await likeCommunityPost(admin, user.id, postId);
    return c.json({
      ok: true,
      data: { likes: result.likes, alreadyLiked: result.alreadyLiked }
    });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (isMissingCommunityTable(e) || /community_post_likes|does not exist/i.test(msg)) {
      throw new ApiError(
        503,
        'MIGRATION_REQUIRED',
        '请执行 20260529140000_community_post_likes.sql'
      );
    }
    if (msg.includes('不能给自己')) {
      throw new ApiError(400, 'SELF_LIKE', msg);
    }
    if (msg.includes('不存在')) {
      throw new ApiError(404, 'NOT_FOUND', msg);
    }
    throw new ApiError(500, 'LIKE_FAILED', msg.slice(0, 180));
  }
});

/** 作者检查自己作品点赞是否达到里程碑并领取积分 */
communityRoutes.post('/like-milestone', async c => {
  const user = c.get('user');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数无效');
  }

  const { postId, likes } = parsed.data;
  const admin = createAdminClient(c.env);
  const result = await tryGrantLikeMilestone(admin, user.id, postId, likes);

  return c.json({ ok: true, data: result });
});

communityRoutes.post('/notify', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const parsed = notifyBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '通知参数无效');
  }
  const admin = createAdminClient(c.env);
  try {
    await pushCommunityNotification(
      admin,
      user.id,
      parsed.data.actorName || user.email || '用户',
      parsed.data
    );
    return c.json({ ok: true, data: { sent: true } });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/community_notifications|does not exist|schema cache/i.test(msg)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '请执行 20260529120000_community_notifications.sql');
    }
    throw new ApiError(500, 'NOTIFY_FAILED', msg.slice(0, 180));
  }
});

communityRoutes.get('/notifications', async c => {
  const user = c.get('user');
  const limit = Math.min(80, Math.max(1, Number(c.req.query('limit') || 40)));
  const admin = createAdminClient(c.env);
  try {
    const items = await listCommunityNotifications(admin, user.id, limit);
    return c.json({ ok: true, data: { items } });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/community_notifications|does not exist|schema cache/i.test(msg)) {
      return c.json({ ok: true, data: { items: [] } });
    }
    throw new ApiError(500, 'NOTIFY_LIST_FAILED', msg.slice(0, 180));
  }
});

communityRoutes.get('/gacha/quota', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  return c.json({ ok: true, data: buildCommunityGachaQuota(profile) });
});

communityRoutes.post('/gacha/draw', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const result = await consumeCommunityGachaDraw(admin, user.id);
  const profile = await getOrCreateProfile(admin, user.id);
  return c.json({
    ok: true,
    data: {
      used: result.used,
      remaining: result.remaining,
      limit: result.limit,
      quota: buildCommunityGachaQuota(profile)
    }
  });
});
