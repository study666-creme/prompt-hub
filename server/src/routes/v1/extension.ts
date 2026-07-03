import { Hono } from 'hono';

import { z } from 'zod';

import type { Env } from '../../env';

import { ApiError } from '../../lib/errors';

import {

  appendQuickCard,

  collectUserGroups,

  listUserCardsForExtension,

  listUserTags,

  readDefaultPublishCommunity,

  readShowTrimBlackBorderTool,

  type ExtensionCardListItem

} from '../../lib/extension-card';

import { storagePathFromRef } from '../../lib/image-archive';

import {

  buildPrivateMediaCdnUrl,

  signingPathForVariant

} from '../../lib/media-cdn';

import { mergeTaskFlags } from '../../lib/membership-tasks';

import { membershipCreditsPayload, syncMembershipCredits } from '../../lib/membership-credits';

import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';

import { ensureWarehouseJobThumb } from '../../lib/warehouse-thumb';

import { rateLimit } from '../../middleware/rate-limit';



const quickCardSchema = z.object({

  prompt: z.string().max(20000).optional().default(''),

  title: z.string().max(200).optional(),

  imageBase64: z.string().max(7_000_000).optional().nullable(),

  sourceUrl: z.string().max(500).optional().nullable(),

  tags: z.array(z.string().max(40)).max(20).optional(),

  publishToCommunity: z.boolean().optional()

});



export const extensionRoutes = new Hono<{ Bindings: Env }>();



extensionRoutes.use('*', rateLimit(40, 60_000));



function assertOwnStoragePath(userId: string, path: string): void {

  const clean = path.replace(/^\//, '');

  if (!clean.startsWith(`${userId}/`)) {

    throw new ApiError(403, 'FORBIDDEN', '无权访问该资源');

  }

}



async function buildExtensionCardThumb(

  c: Parameters<typeof ensureWarehouseJobThumb>[0],

  userId: string,

  card: ExtensionCardListItem

): Promise<string> {

  if (card.genJobId) {

    try {

      const out = await ensureWarehouseJobThumb(c, userId, card.genJobId);

      if (out?.url) return out.url;

    } catch {

      /* fall through to storage ref */

    }

  }

  const path = storagePathFromRef(card.imageRef);

  if (!path) return '';

  try {

    assertOwnStoragePath(userId, path);

    const signPath = signingPathForVariant(path, 'grid');

    return await buildPrivateMediaCdnUrl(c, signPath);

  } catch {

    if (card.genJobId) {

      try {

        const out = await ensureWarehouseJobThumb(c, userId, card.genJobId);

        return out?.url || '';

      } catch {

        return '';

      }

    }

    return '';

  }

}



extensionRoutes.get('/cards', async c => {

  const user = c.get('user');

  const page = Math.max(1, Number(c.req.query('page')) || 1);

  const limit = Math.min(48, Math.max(1, Number(c.req.query('limit')) || 24));

  const q = String(c.req.query('q') || '').trim();

  const group = String(c.req.query('group') || '').trim();

  const tag = String(c.req.query('tag') || '').trim();

  const admin = createAdminClient(c.env);

  try {

    const listed = await listUserCardsForExtension(admin, user.id, { page, limit, q, group, tag });

    const cards = await Promise.all(

      listed.cards.map(async (card) => {

        const thumbUrl = await buildExtensionCardThumb(c, user.id, card);

        return { ...card, thumbUrl };

      })

    );

    return c.json({

      ok: true,

      data: {

        cards,

        total: listed.total,

        page: listed.page,

        limit: listed.limit

      }

    });

  } catch (e) {

    const msg = String((e as Error).message || e);

    if (/permission denied.*user_data/i.test(msg)) {

      throw new ApiError(

        503,

        'DB_PERMISSION',

        '请在 Supabase 执行 20260530100000_user_data_service_role.sql'

      );

    }

    throw new ApiError(500, 'CARDS_LIST_FAILED', msg.slice(0, 180));

  }

});



extensionRoutes.get('/status', async c => {

  const user = c.get('user');

  const admin = createAdminClient(c.env);

  const profile = await syncMembershipCredits(admin, user.id);

  const credits = membershipCreditsPayload(profile);

  const { data: row } = await admin

    .from('user_data')

    .select('data')

    .eq('user_id', user.id)

    .maybeSingle();

  const payload = (row?.data || {}) as Parameters<typeof readDefaultPublishCommunity>[0];

  return c.json({

    ok: true,

    data: {

      userId: user.id,

      email: user.email ?? null,

      memberActive: !!profile.membership_tier && (

        !profile.membership_until

        || new Date(profile.membership_until).getTime() > Date.now()

      ),

      credits: credits.creditsSpendable,

      creditsPermanent: credits.creditsPermanent,

      dailyCredits: credits.dailyCredits,

      defaultPublishCommunity: readDefaultPublishCommunity(payload),

      showTrimBlackBorderTool: readShowTrimBlackBorderTool(payload)

    }

  });

});



extensionRoutes.get('/tags', async c => {

  const user = c.get('user');

  const admin = createAdminClient(c.env);

  try {

    const tags = await listUserTags(admin, user.id);

    return c.json({ ok: true, data: { tags } });

  } catch (e) {

    const msg = String((e as Error).message || e);

    if (/permission denied.*user_data/i.test(msg)) {

      throw new ApiError(

        503,

        'DB_PERMISSION',

        '请在 Supabase 执行 20260530100000_user_data_service_role.sql'

      );

    }

    throw new ApiError(500, 'TAGS_FAILED', msg.slice(0, 180));

  }

});



extensionRoutes.get('/groups', async c => {

  const user = c.get('user');

  const admin = createAdminClient(c.env);

  try {

    const { data: row, error } = await admin

      .from('user_data')

      .select('data')

      .eq('user_id', user.id)

      .maybeSingle();

    if (error) throw error;

    const groups = collectUserGroups((row?.data || {}) as { customGroups?: unknown[]; cards?: unknown[] });

    return c.json({ ok: true, data: { groups } });

  } catch (e) {

    const msg = String((e as Error).message || e);

    if (/permission denied.*user_data/i.test(msg)) {

      throw new ApiError(

        503,

        'DB_PERMISSION',

        '请在 Supabase 执行 20260530100000_user_data_service_role.sql'

      );

    }

    throw new ApiError(500, 'GROUPS_FAILED', msg.slice(0, 180));

  }

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

    void mergeTaskFlags(admin, user.id, { extension_card_saved: true }).catch((err) => {

      console.error('extension task flag merge failed', err);

    });

    const message = result.publishedToCommunity

      ? '已保存到仓库并公开到社区'

      : (result.publishNote || '已保存到 Prompt Hub 仓库');

    return c.json({

      ok: true,

      data: {

        message,

        cardId: result.cardId,

        cardCount: result.cardCount,

        publishedToCommunity: result.publishedToCommunity,

        communityPostId: result.communityPostId

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


