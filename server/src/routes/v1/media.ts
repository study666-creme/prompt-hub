import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { storagePathFromRef } from '../../lib/image-archive';
import {
  buildPublicMediaCdnUrl,
  buildPrivateMediaCdnUrl,
  communityImagePathCandidates,
  decodeStoragePath,
  findFirstExistingStoragePath,
  isAllowedCommunityMediaPath,
  MEDIA_CDN_TOKEN_TTL_SEC,
  resolveCommunityGridPath,
  materializeCommunityGridIfMissing,
  serveCachedStorageImage,
  verifyMediaAccessToken,
  gridPathFromPrimary
} from '../../lib/media-cdn';
import { createAdminClient } from '../../lib/supabase';
import { uploadCardImage } from '../../lib/r2-storage';
import { rateLimit } from '../../middleware/rate-limit';

const BUCKET = 'card-images';

function assertOwnPath(userId: string, path: string): void {
  const norm = path.replace(/^\//, '');
  if (!norm.startsWith(`${userId}/`)) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问该图片');
  }
}

/** 列表签名默认走 _grid；仅 variant=full 时签原图 */
function signingPathForVariant(path: string, variant: string): string {
  const clean = path.replace(/^\//, '');
  if (variant === 'full') return clean;
  if (/_grid\.(jpe?g|webp|png)$/i.test(clean)) return clean;
  const grid = gridPathFromPrimary(clean);
  return grid ? grid.replace(/^\//, '') : clean;
}

export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.use('*', rateLimit(480, 60_000));

/** Cloudflare 边缘缓存的公开社区图（同一张图只从 Supabase 拉一次） */
export async function publicCachedMediaHandler(c: Context<{ Bindings: Env }>) {
  const enc = c.req.param('enc') || '';
  const path = decodeStoragePath(enc);
  if (!path || !isAllowedCommunityMediaPath(path)) {
    throw new ApiError(404, 'NOT_FOUND', '无效路径');
  }
  return serveCachedStorageImage(c, path);
}

/** 带短时 token 的私有图（img 可直接用，重复访问走 CF 缓存） */
export async function privateCachedMediaHandler(c: Context<{ Bindings: Env }>) {
  const enc = c.req.param('enc') || '';
  const path = decodeStoragePath(enc);
  if (!path) throw new ApiError(404, 'NOT_FOUND', '无效路径');
  const exp = Number(c.req.query('e') || 0);
  const sig = String(c.req.query('s') || '');
  const ok = await verifyMediaAccessToken(c.env, path, exp, sig);
  if (!ok) throw new ApiError(401, 'UNAUTHORIZED', '图片链接无效或已过期');
  return serveCachedStorageImage(c, path);
}

/** 游客/未登录：返回 CDN 代理 URL（不再返回 supabase.co 直链） */
export async function communityMediaSignHandler(c: Context<{ Bindings: Env }>) {
  const ref = (c.req.query('ref') || '').trim();
  const authorId = (c.req.query('authorId') || '').trim();
  const cardId = (c.req.query('cardId') || '').trim();
  const variantQ = (c.req.query('variant') || 'grid').trim().toLowerCase();
  const admin = createAdminClient(c.env);
  if (variantQ === 'full') {
    const paths = communityImagePathCandidates(ref, authorId, cardId, { gridOnly: false, preferGrid: false });
    const found = await findFirstExistingStoragePath(admin, paths, BUCKET, c.env);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Object not found');
    const url = await buildPublicMediaCdnUrl(c, found);
    return c.json({ ok: true, data: { url, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true } });
  }
  const gridPath = await resolveCommunityGridPath(admin, ref, authorId, cardId, BUCKET, c.env);
  if (!gridPath) {
    throw new ApiError(404, 'NOT_FOUND', 'Object not found');
  }
  await materializeCommunityGridIfMissing(c, admin, gridPath, ref, authorId, cardId);
  const url = await buildPublicMediaCdnUrl(c, gridPath);
  return c.json({
    ok: true,
    data: { url, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true }
  });
}

const communitySignBatchBodySchema = z.object({
  items: z
    .array(
      z.object({
        ref: z.string().max(500),
        authorId: z.string().max(80).optional().nullable(),
        cardId: z.string().max(128).optional().nullable()
      })
    )
    .max(40)
});

/** 社区 Feed 批量签名：一次请求签多张公开图，减少首屏 RTT */
export async function communityMediaSignBatchHandler(c: Context<{ Bindings: Env }>) {
  const parsed = communitySignBatchBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '批量社区签名参数无效');
  }

  const admin = createAdminClient(c.env);
  const urls: Record<string, string> = {};
  const refMap: Record<string, string> = {};
  const seen = new Set<string>();

  const items = parsed.data.items.filter(item => {
    const ref = String(item.ref || '').trim();
    if (!ref) return false;
    const key = `${ref}|${item.authorId || ''}|${item.cardId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let idx = 0;
  const concurrency = 6;
  async function worker() {
    while (idx < items.length) {
      const item = items[idx];
      idx += 1;
      const ref = String(item.ref || '').trim();
      const gridPath = await resolveCommunityGridPath(
        admin,
        ref,
        item.authorId || undefined,
        item.cardId || undefined,
        BUCKET,
        c.env
      );
      if (!gridPath) continue;
      c.executionCtx.waitUntil(
        materializeCommunityGridIfMissing(
          c,
          admin,
          gridPath,
          ref,
          item.authorId || undefined,
          item.cardId || undefined
        ).catch(() => {})
      );
      if (urls[gridPath]) {
        refMap[ref] = urls[gridPath];
        continue;
      }
      const url = await buildPublicMediaCdnUrl(c, gridPath);
      urls[gridPath] = url;
      refMap[ref] = url;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()));

  return c.json({
    ok: true,
    data: { urls, refMap, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true }
  });
}

/** 与 Supabase card-images 桶上限一致（50MB）；4K 原图经 Worker 写入 R2 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** 卡片图上传 → R2（MEDIA_STORAGE_MODE=r2 时不写 Supabase/阿里云 Storage） */
mediaRoutes.post('/upload', async c => {
  const user = c.get('user');
  const pathParam = String(c.req.query('path') || '').trim().replace(/^\//, '');
  if (!pathParam) {
    throw new ApiError(400, 'VALIDATION_ERROR', '缺少 path 参数');
  }
  assertOwnPath(user.id, pathParam);

  const body = await c.req.arrayBuffer();
  if (!body.byteLength || body.byteLength < 512) {
    throw new ApiError(400, 'VALIDATION_ERROR', '图片数据无效或过小');
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(400, 'VALIDATION_ERROR', '图片过大（最大 50MB）');
  }

  const contentType = (c.req.header('content-type') || 'image/jpeg').split(';')[0].trim();
  try {
    await uploadCardImage(c.env, pathParam, body, contentType || 'image/jpeg');
  } catch (e) {
    throw new ApiError(500, 'UPLOAD_FAILED', String((e as Error).message || e).slice(0, 180));
  }

  return c.json({
    ok: true,
    data: { ref: `storage://${BUCKET}/${pathParam}` }
  });
});

/** 将 storage:// 转为 CDN 代理 URL */
mediaRoutes.get('/sign', async c => {
  const user = c.get('user');
  const ref = (c.req.query('ref') || '').trim();
  const path = storagePathFromRef(ref);
  if (!path) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的图片引用');
  }
  assertOwnPath(user.id, path);

  const variant = (c.req.query('variant') || 'grid').trim().toLowerCase();
  const signPath = signingPathForVariant(path, variant);
  const url = await buildPrivateMediaCdnUrl(c, signPath);
  return c.json({
    ok: true,
    data: { url, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true }
  });
});

const signBatchBodySchema = z.object({
  refs: z.array(z.string().max(500)).max(48)
});

mediaRoutes.post('/sign-batch', async c => {
  const user = c.get('user');
  const parsed = signBatchBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '批量签名参数无效');
  }
  const pathSet = new Set<string>();
  for (const ref of parsed.data.refs) {
    const path = storagePathFromRef(ref);
    if (!path) continue;
    try {
      assertOwnPath(user.id, path);
    } catch {
      continue;
    }
    pathSet.add(path.replace(/^\//, ''));
  }
  const paths = [...pathSet];
  const urls: Record<string, string> = {};
  await Promise.all(
    paths.map(async key => {
      const signPath = signingPathForVariant(key, 'grid');
      urls[key] = await buildPrivateMediaCdnUrl(c, signPath);
    })
  );
  return c.json({
    ok: true,
    data: { urls, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true }
  });
});

mediaRoutes.get('/generation/:jobId/url', async c => {
  const user = c.get('user');
  const jobId = c.req.param('jobId');
  const admin = createAdminClient(c.env);

  const { data: job, error } = await admin
    .from('generation_requests')
    .select('result_image_url, status, user_id')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !job || job.user_id !== user.id) {
    throw new ApiError(404, 'NOT_FOUND', '任务不存在');
  }
  if (job.status !== 'completed' || !job.result_image_url) {
    throw new ApiError(400, 'NOT_READY', '图片尚未生成完成');
  }

  const raw = job.result_image_url;
  const path = storagePathFromRef(raw);
  if (path) {
    assertOwnPath(user.id, path);
    const url = await buildPrivateMediaCdnUrl(c, path);
    return c.json({ ok: true, data: { url, cdn: true } });
  }

  if (typeof raw === 'string' && raw.startsWith('https://')) {
    return c.json({ ok: true, data: { url: raw } });
  }

  throw new ApiError(400, 'INVALID_IMAGE', '无法解析图片地址');
});

const ALLOWED_FETCH_HOSTS = [
  'apimart.ai',
  'api.apimart.ai',
  'filesystem.site',
  'supabase.co',
  'memfiredb.com',
  'baseaf.memfiredb.com',
  'api.prompt-hub.cn',
  'prompt-hub.cn',
  'api.prompt-hubs.com',
  'prompt-hubs.com',
  'grsai.com',
  'api.grsai.com',
  'aitohumanize.com',
  'oaiusercontent.com',
  'openai.com',
  'blob.core.windows.net'
];

function isAllowedRemoteUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (ALLOWED_FETCH_HOSTS.some(
      h => u.hostname === h || u.hostname.endsWith('.' + h)
    )) {
      return true;
    }
    // Grs / 第三方生图 CDN 子域较多，仅放行常见图片后缀路径
    if (/\.(aitohumanize|grsai|filesystem\.site|oaiusercontent)\./i.test(u.hostname)) {
      return true;
    }
    return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

mediaRoutes.get('/fetch', async c => {
  const url = (c.req.query('url') || '').trim();
  if (!url || !isAllowedRemoteUrl(url)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '不允许的图片地址');
  }

  const res = await fetch(url, { headers: { Accept: 'image/*' } });
  if (!res.ok) {
    throw new ApiError(502, 'UPSTREAM_ERROR', `拉取图片失败 (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const body = await res.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
});
