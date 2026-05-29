import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  listPublicCommunityFeed,
  syncAuthorCommunityPosts,
  unpublishCommunityPost,
  upsertCommunityPost,
  type CommunityPostPayload
} from '../../lib/community-feed';
import { tryGrantLikeMilestone } from '../../lib/like-milestone';
import { createAdminClient } from '../../lib/supabase';
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

export const communityRoutes = new Hono<{ Bindings: Env }>();

communityRoutes.use('*', rateLimit(60, 60_000));

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
    const posts = await listPublicCommunityFeed(admin, limit, offset);
    return c.json({ ok: true, data: { posts, limit, offset } });
  } catch (e) {
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

/** 发布 / 更新自己的社区帖到全站 Feed */
communityRoutes.post('/posts', async c => {
  const user = c.get('user');
  const parsed = postBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '帖子参数无效');
  }
  const admin = createAdminClient(c.env);
  try {
    const post = await upsertCommunityPost(admin, user.id, parsed.data as CommunityPostPayload);
    return c.json({ ok: true, data: { post } });
  } catch (e) {
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
    const synced = await syncAuthorCommunityPosts(
      admin,
      user.id,
      authorName,
      parsed.data.posts as CommunityPostPayload[]
    );
    return c.json({ ok: true, data: { synced } });
  } catch (e) {
    if (isMissingCommunityTable(e)) {
      throw new ApiError(503, 'MIGRATION_REQUIRED', '社区表未就绪，请执行数据库迁移');
    }
    throw new ApiError(500, 'SYNC_FAILED', String((e as Error).message || e).slice(0, 180));
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
