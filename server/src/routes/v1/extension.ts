import { Hono } from 'hono';

import { z } from 'zod';

import type { Env } from '../../env';

import { ApiError } from '../../lib/errors';

import {

  appendQuickCard,

  collectUserGroups,

  findUserCardForExtension,

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

import { resolveImageRefForJob } from '../../lib/recover-generation-warehouse';

import { rateLimit } from '../../middleware/rate-limit';



const quickCardSchema = z.object({

  prompt: z.string().max(20000).optional().default(''),

  title: z.string().max(200).optional(),

  imageBase64: z.string().max(7_000_000).optional().nullable(),

  sourceUrl: z.string().max(500).optional().nullable(),

  tags: z.array(z.string().max(40)).max(20).optional(),

  publishToCommunity: z.boolean().optional()

});

const canvasResultSchema = z.object({
  generationJobId: z.string().uuid(),
  artifactIndex: z.literal(0).optional().default(0),
  title: z.string().trim().max(200).optional()
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

/** 签名 URL 本身有小时级 TTL，按 isolate 短缓存可避免翻页/回看时重复做存在性检查。 */
const THUMB_CACHE_TTL_MS = 2 * 60_000;
const THUMB_CACHE_LIMIT = 512;
const thumbCache = new Map<string, { url: string; expiresAt: number }>();

async function buildExtensionCardThumbCached(

  c: Parameters<typeof ensureWarehouseJobThumb>[0],

  userId: string,

  card: ExtensionCardListItem

): Promise<string> {

  const key = `${userId}:${card.id}:${card.imageRef}`;

  const cached = thumbCache.get(key);

  if (cached) {

    if (cached.expiresAt > Date.now()) return cached.url;

    thumbCache.delete(key);

  }

  const url = await buildExtensionCardThumb(c, userId, card);

  if (!url) return '';

  thumbCache.set(key, { url, expiresAt: Date.now() + THUMB_CACHE_TTL_MS });

  while (thumbCache.size > THUMB_CACHE_LIMIT) {

    const oldest = thumbCache.keys().next().value;

    if (oldest === undefined) break;

    thumbCache.delete(oldest);

  }

  return url;

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

        const thumbUrl = await buildExtensionCardThumbCached(c, user.id, card);

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

extensionRoutes.get('/cards/:cardId', async c => {
  const user = c.get('user');
  const parsed = z.string().trim().min(1).max(200).safeParse(c.req.param('cardId'));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '卡片标识无效');

  const admin = createAdminClient(c.env);
  const card = await findUserCardForExtension(admin, user.id, parsed.data);
  if (!card) throw new ApiError(404, 'CARD_NOT_FOUND', '卡片不存在');
  const thumbUrl = await buildExtensionCardThumb(c, user.id, card);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, data: { card: { ...card, thumbUrl } } });
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

    const payload =
      row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Parameters<typeof collectUserGroups>[0])
        : {};
    const groups = collectUserGroups(payload);

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

    const result = await appendQuickCard(admin, user.id, profile, parsed.data, c.env);

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

extensionRoutes.post('/canvas-results', async c => {
  const user = c.get('user');
  const parsed = canvasResultSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '参数无效');

  const admin = createAdminClient(c.env);
  const { data: job, error } = await admin
    .from('generation_requests')
    .select('id,user_id,prompt,status,result_image_url,meta,created_at,resolution')
    .eq('id', parsed.data.generationJobId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB_ERROR', '读取生成任务失败');
  if (!job) throw new ApiError(404, 'GENERATION_NOT_FOUND', '生成任务不存在');
  if (job.status !== 'completed') throw new ApiError(409, 'RESULT_NOT_READY', '生成结果尚未完成');

  const meta = job.meta && typeof job.meta === 'object' && !Array.isArray(job.meta)
    ? job.meta as Record<string, unknown>
    : {};
  const fromCanvas = meta.product === 'canvas'
    || (typeof meta.projectId === 'string' && !!meta.projectId.trim())
    || (typeof meta.nodeId === 'string' && !!meta.nodeId.trim());
  if (!fromCanvas) throw new ApiError(409, 'NOT_CANVAS_RESULT', '该任务不是画布生成结果');

  const imageRef = await resolveImageRefForJob(
    admin,
    user.id,
    parsed.data.generationJobId,
    job,
    c.env
  );
  if (!imageRef) throw new ApiError(409, 'RESULT_NOT_READY', '生成图片仍在归档，请稍后重试');

  const profile = await getOrCreateProfile(admin, user.id);
  const prompt = String(job.prompt || '').trim();
  const result = await appendQuickCard(admin, user.id, profile, {
    prompt,
    title: parsed.data.title || prompt.slice(0, 48) || '画布生成',
    imageRef,
    cardId: `canvas_${parsed.data.generationJobId.replace(/-/g, '_')}`,
    sourceKey: `canvas-result:${parsed.data.generationJobId}:${parsed.data.artifactIndex}`,
    genJobId: parsed.data.generationJobId,
    tags: ['图片生成', '无限画布'],
    publishToCommunity: false,
    customFields: {
      canvasProjectId: typeof meta.projectId === 'string' ? meta.projectId : null,
      canvasNodeId: typeof meta.nodeId === 'string' ? meta.nodeId : null,
      canvasArtifactIndex: parsed.data.artifactIndex
    }
  });

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    ok: true,
    data: {
      message: result.replayed ? '生成结果已在卡片仓库' : '生成结果已保存到卡片仓库',
      cardId: result.cardId,
      cardCount: result.cardCount,
      replayed: result.replayed
    }
  });
});


