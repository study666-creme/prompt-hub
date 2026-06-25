import { Hono } from 'hono';
import type { Env } from '../../env';
import { deleteStoragePaths, invalidateOrphanScanCache, listBucketOrphanFiles, restoreCardFromOrphanGroup } from '../../lib/admin-media-refs';
import {
  adminDeleteCommunityPost,
  adminUnpublishCommunityPost,
  batchDeleteCommunityPosts,
  batchRestoreCommunityPosts,
  batchUnpublishCommunityPosts,
  getCommunityAdminStats,
  listCommunityPostsForAdmin,
  repairMisattributedCommunityAuthors,
  previewPurgeGhosts,
  restoreCommunityPostToUserLibrary,
  restoreOrphanCommunityPosts,
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

adminCommunityRoutes.get('/bucket-orphans', async (c) => {
  const limit = Number(c.req.query('limit') || 40);
  const offset = Number(c.req.query('offset') || 0);
  const riskQ = String(c.req.query('risk') || '').trim();
  const refresh = c.req.query('refresh') === '1';
  let risk: 'safe' | 'recoverable' | 'relink' | 'all' | undefined;
  if (riskQ === 'safe' || riskQ === 'recoverable' || riskQ === 'relink' || riskQ === 'all') {
    risk = riskQ;
  }
  const admin = createAdminClient(c.env);
  const data = await listBucketOrphanFiles(admin, c.env, apiOriginFromRequest(c), {
    limit,
    offset,
    risk,
    refresh,
    executionCtx: c.executionCtx
  });
  return c.json({ ok: true, data });
});

adminCommunityRoutes.post('/bucket-orphans/restore-card', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    primaryPath?: string;
    risk?: string;
    recoverPostId?: string | null;
    recoverCardId?: string | null;
    recoverUserId?: string | null;
  };
  const primaryPath = String(body.primaryPath || '').trim();
  const risk = String(body.risk || '').trim();
  if (!primaryPath) throw new ApiError(400, 'VALIDATION_ERROR', '请提供 primaryPath');
  if (risk !== 'recoverable' && risk !== 'relink') {
    throw new ApiError(400, 'VALIDATION_ERROR', '仅支持 recoverable 或 relink');
  }
  const admin = createAdminClient(c.env);
  const result = await restoreCardFromOrphanGroup(admin, {
    primaryPath,
    risk,
    recoverPostId: body.recoverPostId,
    recoverCardId: body.recoverCardId,
    recoverUserId: body.recoverUserId
  });
  await invalidateOrphanScanCache();
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/bucket-orphans/delete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { paths?: string[] };
  const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : [];
  if (!paths.length) throw new ApiError(400, 'VALIDATION_ERROR', '请提供 paths');
  if (paths.length > 50) throw new ApiError(400, 'VALIDATION_ERROR', '单次最多删除 50 个文件');
  const admin = createAdminClient(c.env);
  const result = await deleteStoragePaths(admin, c.env, paths);
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/batch-restore', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const admin = createAdminClient(c.env);
  const result = await batchRestoreCommunityPosts(admin, body.ids);
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/batch-unpublish', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const admin = createAdminClient(c.env);
  const result = await batchUnpublishCommunityPosts(admin, body.ids);
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/batch-delete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    ids?: string[];
    deleteStorage?: boolean;
  };
  const admin = createAdminClient(c.env);
  const result = await batchDeleteCommunityPosts(admin, c.env, body.ids, {
    deleteStorage: body.deleteStorage !== false
  });
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/:id/restore', async (c) => {
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  const result = await restoreCommunityPostToUserLibrary(admin, postId);
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/restore-orphans', async (c) => {
  const limit = Number(c.req.query('limit') || 50);
  const authorId = c.req.query('authorId') || undefined;
  const admin = createAdminClient(c.env);
  const result = await restoreOrphanCommunityPosts(admin, { limit, authorId });
  return c.json({ ok: true, data: result });
});

adminCommunityRoutes.post('/posts/:id/unpublish', async (c) => {
  const postId = String(c.req.param('id') || '').trim();
  if (!postId) throw new ApiError(400, 'VALIDATION_ERROR', '缺少帖子 ID');
  const admin = createAdminClient(c.env);
  await adminUnpublishCommunityPost(admin, postId);
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
  return c.json({ ok: true, data: result });
});

/** 下架 Storage 无文件、无效作者、重复 source_card_id、卡片库已删的社区帖 */
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
