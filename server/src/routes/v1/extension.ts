import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { appendQuickCard } from '../../lib/extension-card';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const quickCardSchema = z.object({
  prompt: z.string().max(20000).optional().default(''),
  title: z.string().max(200).optional(),
  imageBase64: z.string().max(7_000_000).optional().nullable(),
  sourceUrl: z.string().max(500).optional().nullable()
});

export const extensionRoutes = new Hono<{ Bindings: Env }>();

extensionRoutes.use('*', rateLimit(40, 60_000));

extensionRoutes.get('/status', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  return c.json({
    ok: true,
    data: {
      userId: user.id,
      email: user.email ?? null,
      memberActive: !!profile.membership_tier && (
        !profile.membership_until
        || new Date(profile.membership_until).getTime() > Date.now()
      )
    }
  });
});

extensionRoutes.post('/quick-card', async c => {
  const user = c.get('user');
  const parsed = quickCardSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数无效');
  }

  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);

  try {
    const result = await appendQuickCard(admin, user.id, profile, parsed.data);
    return c.json({
      ok: true,
      data: {
        message: '已保存到 Prompt Hub 仓库',
        cardId: result.cardId,
        cardCount: result.cardCount
      }
    });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (msg.includes('DB_PERMISSION') || msg.includes('permission denied')) {
      throw new ApiError(503, 'DB_PERMISSION', msg.replace(/^DB_PERMISSION:\s*/, ''));
    }
    if (msg.includes('最多')) throw new ApiError(400, 'CARD_LIMIT', msg);
    if (msg.includes('图片')) throw new ApiError(400, 'IMAGE_ERROR', msg);
    throw new ApiError(500, 'SAVE_FAILED', msg.slice(0, 180));
  }
});
