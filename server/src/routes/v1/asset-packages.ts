import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import {
  claimAssetPackage,
  createAssetPackage,
  getAssetPackageById,
  listEntitlementsForUser,
  listPublishedAssetPackages,
  getPackagePreviewCovers,
  updateAssetPackage
} from '../../lib/asset-packages';
import {
  assertPackageEntitlement,
  getPackageCardsPayload,
  getPackageFolderImages,
  importAssetPackageToWarehouse
} from '../../lib/asset-package-import';
import { ApiError } from '../../lib/errors';
import { createAdminClient, getOrCreateProfile } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';
import type { AuthUser } from '../../middleware/auth';

async function optionalUser(c: { req: { header: (n: string) => string | undefined }; env: Env }): Promise<AuthUser | null> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email,
    phone: data.user.phone ?? undefined,
    phoneVerified: !!data.user.phone_confirmed_at
  };
}

const packCardSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  prompt: z.string().max(8000).optional(),
  image: z.string().max(8000).optional().nullable(),
  group: z.string().max(80).optional().nullable(),
  tags: z.array(z.string().max(40)).max(12).optional()
});

const PACK_CARD_MAX = 500;
const PACK_FOLDER_PREVIEW_MAX = 5;

const publishSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  tag: z.string().max(40).optional(),
  priceCents: z.number().int().min(0).max(99999900).optional(),
  saleType: z.enum(['bulk', 'buyout']).optional(),
  commercialUseAllowed: z.boolean().optional(),
  countLabel: z.string().max(120).optional(),
  previewTree: z.array(z.unknown()).optional(),
  previewThumbs: z.array(z.object({ label: z.string().max(80), hue: z.number().optional() })).optional(),
  sourceWarehouseId: z.string().max(120).optional(),
  sourceWarehouseName: z.string().max(120).optional(),
  previewCardIds: z.array(z.string().max(120)).max(60).optional(),
  packUi: z.enum(['light', 'heavy']).optional(),
  cards: z.array(packCardSchema).min(1).max(PACK_CARD_MAX)
});

function validationErrorMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return '请填写有效的资产包信息';
  const path = issue.path.join('.');
  if (path === 'cards' && issue.code === 'too_big') {
    return `卡片数量不能超过 ${issue.maximum ?? PACK_CARD_MAX} 张，请减少勾选`;
  }
  if (path === 'cards' && issue.code === 'too_small') {
    return '请至少选择一张卡片';
  }
  if (path === 'title' && issue.code === 'too_small') {
    return '标题至少 2 个字';
  }
  if (path.startsWith('cards') && issue.code === 'too_big') {
    return '部分卡片字段过长（提示词或图片引用），请减少或联系支持';
  }
  return `请填写有效的资产包信息（${path}: ${issue.message}）`;
}

const patchSchema = publishSchema.partial().extend({
  status: z.enum(['published', 'archived']).optional()
});

/** 游客可浏览 */
export const assetPackagesPublicRoutes = new Hono<{ Bindings: Env }>();

assetPackagesPublicRoutes.get('/', rateLimit(120, 60_000), async c => {
  const admin = createAdminClient(c.env);
  const user = await optionalUser(c);
  const items = await listPublishedAssetPackages(admin, user?.id || null);
  return c.json({ ok: true, data: { items } });
});

assetPackagesPublicRoutes.get('/:id/covers', rateLimit(180, 60_000), async c => {
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const previewImages = await getPackagePreviewCovers(admin, id);
  return c.json({ ok: true, data: { id, previewImages } });
});

assetPackagesPublicRoutes.get('/:id', rateLimit(120, 60_000), async c => {
  const id = c.req.param('id');
  if (id === 'mine') throw new ApiError(404, 'NOT_FOUND', '资产包不存在');
  const admin = createAdminClient(c.env);
  const user = await optionalUser(c);
  const pkg = await getAssetPackageById(admin, id, user?.id || null);
  if (!pkg) throw new ApiError(404, 'NOT_FOUND', '资产包不存在');
  return c.json({ ok: true, data: pkg });
});

assetPackagesPublicRoutes.get('/:id/folders/:folder/images', rateLimit(180, 60_000), async c => {
  const id = c.req.param('id');
  const folder = decodeURIComponent(c.req.param('folder') || '');
  const admin = createAdminClient(c.env);
  const user = await optionalUser(c);
  const data = await getPackageFolderImages(admin, id, folder, user?.id || null);
  return c.json({ ok: true, data });
});

/** 需登录 */
export const assetPackagesRoutes = new Hono<{ Bindings: Env }>();

assetPackagesRoutes.get('/mine/owned', rateLimit(90, 60_000), async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const items = await listEntitlementsForUser(admin, user.id, 'owned');
  return c.json({ ok: true, data: { items } });
});

assetPackagesRoutes.get('/mine/published', rateLimit(90, 60_000), async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const items = await listEntitlementsForUser(admin, user.id, 'published');
  return c.json({ ok: true, data: { items } });
});

assetPackagesRoutes.post('/', rateLimit(30, 60_000), async c => {
  const user = c.get('user');
  const parsed = publishSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', validationErrorMessage(parsed.error));
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  const pkg = await createAssetPackage(admin, user.id, profile, parsed.data);
  return c.json({ ok: true, data: pkg });
});

assetPackagesRoutes.patch('/:id', rateLimit(40, 60_000), async c => {
  const user = c.get('user');
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的修改内容');
  const admin = createAdminClient(c.env);
  const pkg = await updateAssetPackage(admin, user.id, c.req.param('id'), parsed.data);
  return c.json({ ok: true, data: pkg });
});

assetPackagesRoutes.post('/:id/claim', rateLimit(60, 60_000), async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const result = await claimAssetPackage(admin, user.id, c.req.param('id'));
  return c.json({
    ok: true,
    data: {
      package: result.package,
      alreadyOwned: result.alreadyOwned,
      message: result.alreadyOwned ? '你已拥有该资产包' : '已加入你的资产包'
    }
  });
});

assetPackagesRoutes.get('/:id/content', rateLimit(90, 60_000), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const payload = await getPackageCardsPayload(admin, user.id, id);
  return c.json({ ok: true, data: payload });
});

assetPackagesRoutes.get('/:id/export', rateLimit(60, 60_000), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const payload = await getPackageCardsPayload(admin, user.id, id);
  const body = {
    type: 'prompt-hub-asset-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    package: {
      title: payload.title,
      commercialUseAllowed: payload.commercialUseAllowed
    },
    cards: payload.cards
  };
  const filename = `asset-pack-${String(payload.title || id).replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40)}.json`;
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
});

const importBodySchema = z.object({
  warehouseId: z.string().min(1).max(120),
  folders: z.array(z.string().min(1).max(80)).max(50).optional(),
  cardIds: z.array(z.string().min(1).max(120)).max(500).optional()
});

assetPackagesRoutes.post('/:id/import', rateLimit(30, 60_000), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = importBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请选择要导入的卡片库');
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  const result = await importAssetPackageToWarehouse(
    admin,
    user.id,
    profile,
    id,
    parsed.data.warehouseId,
    parsed.data.folders,
    parsed.data.cardIds
  );
  return c.json({ ok: true, data: result });
});
