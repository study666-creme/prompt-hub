import type { Context } from 'hono';
import type { Env } from '../env';
import { ApiError } from './errors';
import { storagePathFromRef } from './image-archive';
import { createAdminClient } from './supabase';
import { deleteFromR2, downloadCardImage, uploadCardImage, cardImageExists } from './r2-storage';

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

/** storage://、Supabase URL、CDN 签名链、裸路径 → 桶内 key */
export function resolveStoragePath(ref: string | null | undefined): string | null {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const fromRef = storagePathFromRef(raw);
  if (fromRef) return fromRef.replace(/^\//, '');
  const cdnMarkers = ['/api/v1/media/c/', '/api/v1/media/i/'];
  for (const marker of cdnMarkers) {
    const i = raw.indexOf(marker);
    if (i !== -1) {
      const encoded = raw.slice(i + marker.length).split('?')[0];
      const decoded = decodeStoragePath(encoded);
      if (decoded) return decoded;
    }
  }
  const bare = raw.replace(/^\//, '');
  if (/^[^/]+\/.+\.(jpe?g|png|webp)$/i.test(bare) && !/^https?:/i.test(raw)) return bare;
  return null;
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

/** 本地 development：列表/仓库图走线上 CDN（本地 R2 桶为空） */
export function mediaCdnOrigin(c: Context): string {
  const env = c.env as Env;
  if (env.ENVIRONMENT === 'development') {
    const upstream = String(env.LOCAL_MEDIA_UPSTREAM || 'https://api.prompt-hubs.com')
      .trim()
      .replace(/\/$/, '');
    if (upstream) return upstream;
  }
  return apiOriginFromRequest(c);
}

export async function buildPublicMediaCdnUrl(
  c: Context,
  path: string
): Promise<string> {
  const clean = path.replace(/^\//, '');
  if (!isAllowedCommunityMediaPath(clean)) {
    throw new ApiError(403, 'FORBIDDEN', '不允许公开代理该路径');
  }
  const origin = mediaCdnOrigin(c);
  return `${origin}/api/v1/media/c/${encodeStoragePath(clean)}`;
}

export async function buildPrivateMediaCdnUrl(
  c: Context,
  path: string
): Promise<string> {
  const clean = path.replace(/^\//, '');
  const env = c.env as Env;
  if (env.ENVIRONMENT === 'development' && isAllowedCommunityMediaPath(clean)) {
    const origin = mediaCdnOrigin(c);
    return `${origin}/api/v1/media/c/${encodeStoragePath(clean)}`;
  }
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
  opts?: { preferGrid?: boolean; gridOnly?: boolean }
): string[] {
  const preferGrid = opts?.preferGrid !== false;
  const gridOnly = opts?.gridOnly === true;
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && isAllowedCommunityMediaPath(key) && !out.includes(key)) out.push(key);
  };
  const fromRef = storagePathFromRef(ref);
  if (fromRef) {
    const clean = fromRef.replace(/^\//, '');
    if (preferGrid) {
      const grid = gridPathFromPrimary(clean);
      if (grid) add(grid);
      if (/_grid\.(jpe?g|webp|png)$/i.test(clean)) {
        add(clean.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg'));
        add(clean.replace(/_grid\.(jpe?g|webp|png)$/i, '.webp'));
        add(clean.replace(/_grid\.(jpe?g|webp|png)$/i, '.png'));
      }
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
  if (gridOnly) {
    return out.filter((p) => /_grid\.(jpe?g|webp|png)$/i.test(p));
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

export { gridPathFromPrimary };

/** 列表签名默认走 _grid；仅 variant=full 时签原图 */
export function signingPathForVariant(path: string, variant: string): string {
  const clean = path.replace(/^\//, '');
  if (variant === 'full') return clean;
  if (/_grid\.(jpe?g|webp|png)$/i.test(clean)) return clean;
  const grid = gridPathFromPrimary(clean);
  return grid ? grid.replace(/^\//, '') : clean;
}

function primaryPathFromGridPath(gridPath: string): string | null {
  const candidates = primaryCandidatesFromGridPath(gridPath);
  return candidates[0] || null;
}

function primaryCandidatesFromGridPath(gridPath: string): string[] {
  const clean = gridPath.replace(/^\//, '');
  if (!/_grid\.(jpe?g|webp|png)$/i.test(clean)) return [];
  const stem = clean.replace(/_grid\.(jpe?g|webp|png)$/i, '');
  return [`${stem}.jpg`, `${stem}.jpeg`, `${stem}.webp`, `${stem}.png`];
}

/** full 路径 404 时尝试同 stem 的其它扩展名 / generated 目录 */
function fullPathServeCandidates(clean: string): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && !out.includes(key)) out.push(key);
  };
  add(clean);
  const m = clean.match(/^(.+\/)([^/]+)\.(jpe?g|webp|png)$/i);
  if (!m) return out;
  const dir = m[1];
  const stem = m[2];
  for (const ext of ['jpg', 'jpeg', 'webp', 'png']) add(`${dir}${stem}.${ext}`);
  if (!dir.includes('/generated/')) {
    add(`${dir}generated/${stem}.jpg`);
    add(`${dir}generated/${stem}.webp`);
    add(`${dir}generated/${stem}.png`);
  }
  return out;
}

const GRID_SERVE_MAX_SIDE = 640;
const GRID_SERVE_JPEG_QUALITY = 0.78;
const GRID_MIN_BYTES = 2048;
/** 列表 grid 单张上限（约 220KB）；超过视为误存原图，CDN 现场重缩 */
const GRID_SERVE_MAX_BYTES = 220 * 1024;

function sniffImageMime(head: Uint8Array): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

async function blobHasValidImageMagic(blob: Blob): Promise<string | null> {
  if (!blob || (blob.size || 0) < 512) return null;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return sniffImageMime(head);
}

async function isAcceptableGridBlob(blob: Blob | null | undefined): Promise<boolean> {
  const n = blob?.size || 0;
  if (n < GRID_MIN_BYTES || n > GRID_SERVE_MAX_BYTES) return false;
  return !!(await blobHasValidImageMagic(blob!));
}

async function downloadGridBlob(
  env: Env,
  gridClean: string
): Promise<Blob | null> {
  return downloadCardImage(env, gridClean);
}

async function rebuildGridAtPath(
  env: Env,
  admin: ReturnType<typeof createAdminClient>,
  gridClean: string,
  primaryPath: string
): Promise<Blob | null> {
  const gridBlob = await buildGridBlobFromPrimary(env, admin, primaryPath);
  if (!(await isAcceptableGridBlob(gridBlob))) return null;
  await uploadCardImage(env, gridClean, gridBlob!, 'image/jpeg');
  return gridBlob;
}

/** 确保 primary 对应 _grid 已写入 R2；返回 grid 路径（不含 leading /） */
export async function materializeGridForPrimaryPath(
  env: Env,
  admin: ReturnType<typeof createAdminClient>,
  primaryPath: string
): Promise<string | null> {
  const primaryClean = primaryPath.replace(/^\//, '');
  const gridPath = gridPathFromPrimary(primaryClean);
  if (!gridPath) return null;
  const gridClean = gridPath.replace(/^\//, '');
  const existing = await downloadGridBlob(env, gridClean);
  if (await isAcceptableGridBlob(existing)) return gridClean;
  if (existing) {
    await deleteFromR2(env, gridClean).catch(() => {});
  }
  const rebuilt = await rebuildGridAtPath(env, admin, gridClean, primaryClean);
  if (!rebuilt) return null;
  return gridClean;
}

/** Supabase Storage 变换：Worker 内无 Canvas 时用此 API 生成 grid */
async function fetchSupabaseGridBytes(env: Env, primaryPath: string): Promise<Blob | null> {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) return null;
  const objectPath = primaryPath.replace(/^\//, '');
  const segments = objectPath.split('/').map((s) => encodeURIComponent(s)).join('/');
  const url =
    `${base}/storage/v1/render/image/authenticated/${CARD_IMAGES_BUCKET}/${segments}` +
    `?width=${GRID_SERVE_MAX_SIDE}&quality=78&resize=contain`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, apikey: key }
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) return null;
    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return new Blob([buf], { type: ct || 'image/jpeg' });
  } catch {
    return null;
  }
}

async function buildGridBlobFromPrimary(
  env: Env,
  admin: ReturnType<typeof createAdminClient>,
  primaryPath: string
): Promise<Blob | null> {
  const primaryClean = primaryPath.replace(/^\//, '');
  const primaryBlob = await downloadCardImage(env, primaryClean);
  if (primaryBlob) {
    const resized = await resizeImageToGridJpeg(primaryBlob);
    if (resized && resized.size >= GRID_MIN_BYTES) return resized;
  }
  const transformed = await fetchSupabaseGridBytes(env, primaryClean);
  if (transformed && transformed.size >= GRID_MIN_BYTES) return transformed;
  return null;
}

export async function materializeCommunityGridIfMissing(
  c: Context<{ Bindings: Env }>,
  admin: ReturnType<typeof createAdminClient>,
  gridPath: string,
  ref: string,
  authorId?: string,
  cardId?: string
): Promise<void> {
  const gridClean = gridPath.replace(/^\//, '');
  const existing = await downloadGridBlob(c.env, gridClean);
  if (await isAcceptableGridBlob(existing)) return;
  if (existing) {
    c.executionCtx.waitUntil(deleteFromR2(c.env, gridClean).catch(() => {}));
  }

  let primaryCandidates = [...primaryCandidatesFromGridPath(gridClean)];
  if (!primaryCandidates.length) {
    primaryCandidates = communityImagePathCandidates(ref, authorId, cardId, {
      preferGrid: false,
      gridOnly: false
    }).filter((p) => !/_grid\.(jpe?g|webp|png)$/i.test(p));
  }
  const primary = await findFirstExistingStoragePath(admin, primaryCandidates, CARD_IMAGES_BUCKET, c.env);
  if (!primary) return;

  await rebuildGridAtPath(c.env, admin, gridClean, primary);
}

async function resizeImageToGridJpeg(source: Blob): Promise<Blob | null> {
  try {
    const g = globalThis as typeof globalThis & {
      createImageBitmap?: (image: Blob) => Promise<{ width: number; height: number; close: () => void }>;
      OffscreenCanvas?: new (w: number, h: number) => {
        getContext: (type: '2d') => { drawImage: (...args: unknown[]) => void } | null;
        convertToBlob: (opts?: { type?: string; quality?: number }) => Promise<Blob>;
      };
    };
    if (!g.createImageBitmap || !g.OffscreenCanvas) return null;
    const bitmap = await g.createImageBitmap(source);
    let w = bitmap.width;
    let h = bitmap.height;
    if (!w || !h) {
      bitmap.close();
      return null;
    }
    const maxSide = GRID_SERVE_MAX_SIDE;
    if (w > maxSide || h > maxSide) {
      const scale = maxSide / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    const canvas = new g.OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: GRID_SERVE_JPEG_QUALITY });
  } catch {
    return null;
  }
}

/** 社区列表：已有 grid 用 grid；否则原图存在则返回应对的 grid 路径（CDN 按需生成） */
export async function resolveCommunityGridPath(
  admin: ReturnType<typeof createAdminClient>,
  ref: string,
  authorId?: string,
  cardId?: string,
  bucket = CARD_IMAGES_BUCKET,
  env?: Env
): Promise<string | null> {
  const gridPaths = communityImagePathCandidates(ref, authorId, cardId, { gridOnly: true });
  const existing = await findFirstExistingStoragePath(admin, gridPaths, bucket, env);
  if (existing) return existing;

  let primaryPaths = communityImagePathCandidates(ref, authorId, cardId, {
    preferGrid: false,
    gridOnly: false
  }).filter(p => !/_grid\.(jpe?g|webp|png)$/i.test(p));

  const fromRef = storagePathFromRef(ref)?.replace(/^\//, '') || '';
  if (fromRef && /_grid\.(jpe?g|webp|png)$/i.test(fromRef)) {
    for (const p of primaryCandidatesFromGridPath(fromRef)) {
      if (!primaryPaths.includes(p)) primaryPaths.push(p);
    }
  } else if (fromRef && !primaryPaths.includes(fromRef)) {
    primaryPaths.unshift(fromRef);
  }

  const primary = await findFirstExistingStoragePath(admin, primaryPaths, bucket, env);
  if (!primary) return null;
  return gridPathFromPrimary(primary);
}

function contentTypeForPath(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

/** 用 list 精确匹配文件名（不下载文件体）；传 env 时走 R2 / r2-first */
export async function storageObjectExistsLight(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  bucket = CARD_IMAGES_BUCKET,
  env?: Env
): Promise<boolean> {
  const clean = path.replace(/^\//, '');
  if (!clean) return false;
  if (env) return cardImageExists(env, clean, admin);
  const slash = clean.lastIndexOf('/');
  const dir = slash >= 0 ? clean.slice(0, slash) : '';
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  let offset = 0;
  const page = 200;
  for (let guard = 0; guard < 40; guard++) {
    const { data, error } = await admin.storage.from(bucket).list(dir, { limit: page, offset });
    if (error) return false;
    if (!data?.length) return false;
    if (data.some(item => item.name === name)) return true;
    if (data.length < page) return false;
    offset += page;
  }
  return false;
}

export async function findFirstExistingStoragePath(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[],
  bucket = CARD_IMAGES_BUCKET,
  env?: Env
): Promise<string | null> {
  for (const path of paths) {
    const clean = path.replace(/^\//, '');
    if (!clean) continue;
    if (env) {
      if (await cardImageExists(env, clean, admin)) return clean;
      continue;
    }
    try {
      const { data, error } = await admin.storage.from(bucket).download(clean);
      if (!error && data && (data.size || 0) > 0) return clean;
    } catch {
      /* try list fallback */
    }
    if (await storageObjectExistsLight(admin, clean, bucket)) return clean;
  }
  // 本地 development + MEDIA_STORAGE_MODE=r2：本地 R2 桶为空，交给线上 CDN 试拉
  if (env?.ENVIRONMENT === 'development') {
    const guess = paths
      .map(p => p.replace(/^\//, ''))
      .find(p => p && isAllowedCommunityMediaPath(p));
    if (guess) return guess;
  }
  return null;
}

export async function serveCachedStorageImage(
  c: Context<{ Bindings: Env }>,
  path: string
): Promise<Response> {
  const clean = path.replace(/^\//, '');
  const isGrid = /_grid\.(jpe?g|webp|png)$/i.test(clean);
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = '';
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    if (!isGrid) return cached;
    if (cached.headers.get('X-PH-Grid-Ok') === '1') {
      const len = Number(cached.headers.get('content-length') || 0);
      if (len >= GRID_MIN_BYTES && len <= GRID_SERVE_MAX_BYTES) return cached;
    }
    c.executionCtx.waitUntil(cache.delete(cacheKey));
  }

  const admin = createAdminClient(c.env);
  let body: Blob | null = null;
  let contentType = contentTypeForPath(clean);

  const stored = isGrid ? await downloadGridBlob(c.env, clean) : null;
  if (stored && (await isAcceptableGridBlob(stored))) {
    body = stored;
    const sniffed = await blobHasValidImageMagic(stored);
    if (sniffed) contentType = sniffed;
  } else if (stored && isGrid) {
    c.executionCtx.waitUntil(deleteFromR2(c.env, clean).catch(() => {}));
  } else if (!isGrid) {
    for (const candidate of fullPathServeCandidates(clean)) {
      const blob = await downloadCardImage(c.env, candidate);
      if (blob) {
        const bytes = blob.size || 0;
        if (bytes >= 512) {
          body = blob;
          contentType = contentTypeForPath(candidate);
          break;
        }
      }
    }
  }

  if (!body && isGrid) {
    for (const primary of primaryCandidatesFromGridPath(clean)) {
      const gridBlob = await buildGridBlobFromPrimary(c.env, admin, primary);
      if (await isAcceptableGridBlob(gridBlob)) {
        body = gridBlob;
        contentType = 'image/jpeg';
        c.executionCtx.waitUntil(
          uploadCardImage(c.env, clean, gridBlob!, 'image/jpeg').catch(() => {})
        );
        break;
      }
    }
  }

  if (!body) {
    throw new ApiError(404, 'NOT_FOUND', '图片不存在');
  }

  const response = new Response(body, {
    headers: {
      'Content-Type': contentType,
      ...(isGrid ? { 'X-PH-Grid-Ok': '1' } : {}),
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
