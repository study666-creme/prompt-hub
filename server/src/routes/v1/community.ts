import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { tryGrantLikeMilestone } from '../../lib/like-milestone';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const bodySchema = z.object({
  postId: z.string().min(1).max(128),
  likes: z.number().int().min(0).max(10_000_000)
});

export const communityRoutes = new Hono<{ Bindings: Env }>();

communityRoutes.use('*', rateLimit(60, 60_000));

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
