import { Hono } from 'hono';
import type { Env } from '../../env';
import { writeAudit } from '../../middleware/admin-audit';
import {
  adminDeleteCommunityPost,
  adminUnpublishCommunityPost,
  getCommunityAdminStats,
  listCommunityPostsForAdmin,
  previewPurgeGhosts,
  repairMisattributedCommunityAuthors,
  restoreCommunityPostToUserLibrary,
  unpublishDuplicateCommunityPosts,
  unpublishGhostCommunityPosts,
  unpublishOrphanSourceCardPosts
} from '../../lib/community-feed';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminCommunityRoutes = new Hono<{ Bindings: Env }>();

adminCommunityRoutes.use('*', requireAdminSecret);
adminCommunityRoutes.use('*', rateLimit(120, 60_000));

function apiOriginFromRequest(c: { req: { url: string } }): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return '';
  }
}

adminCommunityRoutes.get('/stats', async (c) => {
  const admin = createAdminClient(c.env);
  const stats = await getCommunityAdminStats(admin);
  return c.json({ ok: true, data: stats });
});

adminCommunityRoutes.get('/posts', async (c) => {
  const limit = Number(c.req.query('limit') || 40);
  const offset = Number(c.req.query('offset') || 0);
  const q = c.req.query('q') || '';
  const viewQ = String(c.req.query('view') || '').trim();
  const orphanOnly = c.req.query('orphanOnly') === '1';
  let view: 'published' | 'unpublished' | 'library-missing' | undefined;
  if (viewQ === 'unpublished' || viewQ === 'library-missing' || viewQ === 'published') {
    view = viewQ;
  }
  const publishedOnly = c.req.query('published') === '0' ? false : undefined;
  const admin = createAdminClient(c.env);
  const data = await listCommunityPostsForAdmin(admin, {
    limit,
    offset,
    publishedOnly,
    q,
    orphanOnly,
    view,
    apiOrigin: apiOriginFromRequest(c)
  });
  return c.json({ ok: true, data });
});

adminCommunityRoutes.post('/posts/:id/restore', async (c) => {
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  const result = await restoreCommunityPostToUserLibrary(admin, postId);
  await writeAudit(c, {
    action: 'community.post_restore',
    targetType: 'community_post',
    targetId: postId,
    after: result
  });
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/:id/unpublish', async (c) => {
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  await adminUnpublishCommunityPost(admin, postId);
  await writeAudit(c, {
    action: 'community.post_unpublish',
    targetType: 'community_post',
    targetId: postId,
    after: { published: false }
  });
  return c.json({ ok: true, data: { id: postId, published: false } });
});

adminCommunityRoutes.post('/posts/:id/delete', async (c) => {
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const body = (await c.req.json().catch(() => ({}))) as { deleteStorage?: boolean };
  const admin = createAdminClient(c.env);
  const result = await adminDeleteCommunityPost(admin, c.env, postId, {
    deleteStorage: body.deleteStorage !== false
  });
  await writeAudit(c, {
    action: 'community.post_delete',
    targetType: 'community_post',
    targetId: postId,
    detail: { deleteStorage: body.deleteStorage !== false, ...result }
  });
  return c.json({ ok: true, data: result });
});

/** 下架 Storage 无文件、无效作者、重复 source_card_id、卡片库已删的社区帖（预览不落库） */
adminCommunityRoutes.get('/purge-ghosts/preview', async (c) => {
  const admin = createAdminClient(c.env);
  const data = await previewPurgeGhosts(admin, c.env);
  return c.json({ ok: true, data });
});

adminCommunityRoutes.post('/purge-ghosts', async (c) => {
  const repairAuthors = c.req.query('repairAuthors') !== '0';
  const admin = createAdminClient(c.env);

  let repairedAuthors = 0;
  if (repairAuthors) {
    repairedAuthors = await repairMisattributedCommunityAuthors(admin);
  }
  const unpublishedOrphans = await unpublishOrphanSourceCardPosts(admin);
  const unpublishedMissing = await unpublishGhostCommunityPosts(admin, c.env);
  const unpublishedDuplicates = await unpublishDuplicateCommunityPosts(admin);

  const stats = await getCommunityAdminStats(admin);

  await writeAudit(c, {
    action: 'community.purge_ghosts',
    targetType: 'community_batch',
    detail: { repairedAuthors, unpublishedOrphans, unpublishedMissing, unpublishedDuplicates }
  });

  return c.json({
    ok: true,
    data: {
      repairedAuthors,
      unpublishedOrphans,
      unpublishedMissing,
      unpublishedDuplicates,
      unpublishedTotal:
        unpublishedOrphans + unpublishedMissing + unpublishedDuplicates,
      publishedRemaining: stats.publishedCount,
      publishedWithImage: stats.publishedWithImage
    }
  });
});
