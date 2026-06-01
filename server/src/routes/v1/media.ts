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
  serveCachedStorageImage,
  verifyMediaAccessToken
} from '../../lib/media-cdn';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const BUCKET = 'card-images';

function assertOwnPath(userId: string, path: string): void {
  const norm = path.replace(/^\//, '');
  if (!norm.startsWith(`${userId}/`)) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问该图片');
  }
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
  const paths = communityImagePathCandidates(ref, authorId, cardId);
  if (!paths.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的图片引用');
  }
  const admin = createAdminClient(c.env);
  const found = await findFirstExistingStoragePath(admin, paths, BUCKET);
  if (found) {
    const url = await buildPublicMediaCdnUrl(c, found);
    return c.json({
      ok: true,
      data: { url, expiresIn: MEDIA_CDN_TOKEN_TTL_SEC, cdn: true }
    });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Object not found');
}

/** 将 storage:// 转为 CDN 代理 URL */
mediaRoutes.get('/sign', async c => {
  const user = c.get('user');
  const ref = (c.req.query('ref') || '').trim();
  const path = storagePathFromRef(ref);
  if (!path) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的图片引用');
  }
  assertOwnPath(user.id, path);

  const url = await buildPrivateMediaCdnUrl(c, path);
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
      urls[key] = await buildPrivateMediaCdnUrl(c, key);
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

const ALLOWED_FETCH_HOSTS = ['apimart.ai', 'api.apimart.ai', 'filesystem.site', 'supabase.co', 'api.prompt-hub.cn', 'prompt-hub.cn'];

function isAllowedRemoteUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_FETCH_HOSTS.some(
      h => u.hostname === h || u.hostname.endsWith('.' + h)
    );
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
