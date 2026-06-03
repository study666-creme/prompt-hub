import { Hono } from 'hono';
import type { Env } from '../../env';
import {
  repairMisattributedCommunityAuthors,
  unpublishDuplicateCommunityPosts,
  unpublishGhostCommunityPosts
} from '../../lib/community-feed';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminCommunityRoutes = new Hono<{ Bindings: Env }>();

adminCommunityRoutes.use('*', requireAdminSecret);
adminCommunityRoutes.use('*', rateLimit(8, 60_000));

/** 下架 Storage 无文件、无效作者、重复 source_card_id 的社区帖（published=false） */
adminCommunityRoutes.post('/purge-ghosts', async (c) => {
  const repairAuthors = c.req.query('repairAuthors') !== '0';
  const admin = createAdminClient(c.env);

  let repairedAuthors = 0;
  if (repairAuthors) {
    repairedAuthors = await repairMisattributedCommunityAuthors(admin);
  }
  const unpublishedMissing = await unpublishGhostCommunityPosts(admin);
  const unpublishedDuplicates = await unpublishDuplicateCommunityPosts(admin);

  const { count: publishedCount, error: countErr } = await admin
    .from('community_posts')
    .select('id', { count: 'exact', head: true })
    .eq('published', true);
  if (countErr) throw countErr;

  return c.json({
    ok: true,
    data: {
      repairedAuthors,
      unpublishedMissing,
      unpublishedDuplicates,
      unpublishedTotal: unpublishedMissing + unpublishedDuplicates,
      publishedRemaining: publishedCount ?? 0
    }
  });
});
