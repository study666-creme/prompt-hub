import type { Context } from 'hono';
import type { Env } from '../env';
import { ApiError } from './errors';
import { storagePathFromRef } from './image-archive';
import { createAdminClient } from './supabase';

export const CARD_IMAGES_BUCKET = 'card-images';
const CDN_CACHE_SEC = 60 * 60 * 24 * 30;
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7;

/** 社区公开浏览：用户目录下任意层级图片 */
export function isAllowedCommunityMediaPath(path: string): boolean {
  const key = path.replace(/^\//, '');
  if (!key || key.includes('..')) return false;
  return /^[^/]+\/.+\.(jpe?g|png|webp)$/i.test(key);
}

export function encodeStoragePath(path: string): string {
  const clean = path.replace(/^\//, '');
  const bytes = new TextEncoder().encode(clean);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeStoragePath(encoded: string): string | null {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const path = new TextDecoder().decode(bytes).replace(/^\//, '');
    if (!path || path.includes('..')) return null;
    return path;
  } catch {
    return null;
  }
}

function mediaSignSecret(env: Env): string {
  return (
    env.ADMIN_API_SECRET?.trim() ||
    env.SUPABASE_JWT_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ''
  );
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createMediaAccessToken(
  env: Env,
  path: string,
  ttlSec = TOKEN_TTL_SEC
): Promise<{ exp: number; sig: string }> {
  const secret = mediaSignSecret(env);
  if (!secret) throw new Error('MEDIA_SIGN_SECRET missing');
  const clean = path.replace(/^\//, '');
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = (await hmacHex(secret, `${clean}|${exp}`)).slice(0, 32);
  return { exp, sig };
}

export async function verifyMediaAccessToken(
  env: Env,
  path: string,
  exp: number,
  sig: string
): Promise<boolean> {
  const secret = mediaSignSecret(env);
  if (!secret || !sig || !exp) return false;
  if (exp * 1000 < Date.now()) return false;
  const clean = path.replace(/^\//, '');
  const expected = (await hmacHex(secret, `${clean}|${exp}`)).slice(0, 32);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function apiOriginFromRequest(c: Context): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return 'https://api.prompt-hub.cn';
  }
}

export async function buildPublicMediaCdnUrl(
  c: Context,
  path: string
): Promise<string> {
  const clean = path.replace(/^\//, '');
  if (!isAllowedCommunityMediaPath(clean)) {
    throw new ApiError(403, 'FORBIDDEN', '不允许公开代理该路径');
  }
  const origin = apiOriginFromRequest(c);
  return `${origin}/api/v1/media/c/${encodeStoragePath(clean)}`;
}

export async function buildPrivateMediaCdnUrl(
  c: Context,
  path: string
): Promise<string> {
  const clean = path.replace(/^\//, '');
  const { exp, sig } = await createMediaAccessToken(c.env as Env, clean);
  const origin = apiOriginFromRequest(c);
  return `${origin}/api/v1/media/i/${encodeStoragePath(clean)}?e=${exp}&s=${sig}`;
}

export function sanitizeCardFileBase(cardId: string): string {
  return String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function communityImagePathCandidates(
  ref: string,
  authorId?: string,
  cardId?: string,
  opts?: { preferGrid?: boolean }
): string[] {
  const preferGrid = opts?.preferGrid !== false;
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && isAllowedCommunityMediaPath(key) && !out.includes(key)) out.push(key);
  };
  const fromRef = storagePathFromRef(ref);
  if (fromRef) {
    if (preferGrid) {
      const grid = gridPathFromPrimary(fromRef.replace(/^\//, ''));
      if (grid) add(grid);
    }
    add(fromRef);
  }
  const aid = (authorId || '').trim();
  const cid = (cardId || '').trim();
  if (aid && cid) {
    const base = sanitizeCardFileBase(cid);
    if (preferGrid) {
      add(`${aid}/${base}_grid.jpg`);
      add(`${aid}/${cid}_grid.jpg`);
    }
    add(`${aid}/${base}.jpg`);
    add(`${aid}/${cid}.jpg`);
    add(`${aid}/${base}.webp`);
    add(`${aid}/${base}.png`);
    if (preferGrid) {
      add(`${aid}/generated/${base}_grid.jpg`);
      add(`${aid}/generated/${cid}_grid.jpg`);
    }
    add(`${aid}/generated/${base}.jpg`);
    add(`${aid}/generated/${cid}.jpg`);
  }
  return out;
}

function gridPathFromPrimary(path: string): string | null {
  const clean = path.replace(/^\//, '');
  if (!clean || /_grid\.(jpe?g|webp|png)$/i.test(clean)) return null;
  const m = clean.match(/^(.+\/)([^/]+)\.(jpe?g|webp|png)$/i);
  if (!m) return null;
  return `${m[1]}${m[2]}_grid.jpg`;
}

function contentTypeForPath(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

/** 用 list 精确匹配文件名（不下载文件体） */
export async function storageObjectExistsLight(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  bucket = CARD_IMAGES_BUCKET
): Promise<boolean> {
  const clean = path.replace(/^\//, '');
  if (!clean) return false;
  const slash = clean.lastIndexOf('/');
  const dir = slash >= 0 ? clean.slice(0, slash) : '';
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  let offset = 0;
  const page = 200;
  for (let guard = 0; guard < 40; guard++) {
    const { data, error } = await admin.storage.from(bucket).list(dir, { limit: page, offset });
    if (error) return false;
    if (!data?.length) return false;
    if (data.some(item => item.name === name && item.id)) return true;
    if (data.length < page) return false;
    offset += page;
  }
  return false;
}

export async function findFirstExistingStoragePath(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[],
  bucket = CARD_IMAGES_BUCKET
): Promise<string | null> {
  for (const path of paths) {
    const clean = path.replace(/^\//, '');
    if (!clean) continue;
    if (await storageObjectExistsLight(admin, clean, bucket)) return clean;
  }
  return null;
}

export async function serveCachedStorageImage(
  c: Context<{ Bindings: Env }>,
  path: string
): Promise<Response> {
  const clean = path.replace(/^\//, '');
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = '';
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const admin = createAdminClient(c.env);
  const { data, error } = await admin.storage.from(CARD_IMAGES_BUCKET).download(clean);
  if (error || !data) {
    throw new ApiError(404, 'NOT_FOUND', '图片不存在');
  }

  const response = new Response(data, {
    headers: {
      'Content-Type': contentTypeForPath(clean),
      'Cache-Control': `public, max-age=${CDN_CACHE_SEC}, s-maxage=${CDN_CACHE_SEC}, immutable`,
      'CDN-Cache-Control': `max-age=${CDN_CACHE_SEC}`,
      'Vary': 'Accept',
      'Access-Control-Allow-Origin': '*',
      ...(c.req.query('dl') === '1'
        ? {
            'Content-Disposition': `attachment; filename="prompt-hub-${Date.now()}.png"`
          }
        : {})
    }
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export { TOKEN_TTL_SEC as MEDIA_CDN_TOKEN_TTL_SEC };
