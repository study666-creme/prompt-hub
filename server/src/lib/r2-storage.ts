import type { R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { createAdminClient } from './supabase';

const CARD_IMAGES_BUCKET = 'card-images';

export type MediaStorageMode = 'supabase' | 'r2-first' | 'r2';

export function mediaStorageMode(env: Env): MediaStorageMode {
  const raw = String(env.MEDIA_STORAGE_MODE || 'supabase').trim().toLowerCase();
  if (raw === 'r2' || raw === 'r2-only') return 'r2';
  if (raw === 'r2-first' || raw === 'r2_first') return 'r2-first';
  return 'supabase';
}

export function r2Bucket(env: Env): R2Bucket | null {
  return env.CARD_IMAGES_R2 ?? null;
}

export function hasR2(env: Env): boolean {
  return !!r2Bucket(env);
}

function cleanPath(path: string): string {
  return path.replace(/^\//, '');
}

export async function downloadFromR2(env: Env, path: string): Promise<Blob | null> {
  const bucket = r2Bucket(env);
  if (!bucket) return null;
  const key = cleanPath(path);
  if (!key) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const bytes = obj.size || 0;
    if (bytes < 512) return null;
    return await obj.blob();
  } catch {
    return null;
  }
}

export async function uploadToR2(
  env: Env,
  path: string,
  body: Blob | ArrayBuffer | ReadableStream,
  contentType: string
): Promise<boolean> {
  const bucket = r2Bucket(env);
  if (!bucket) return false;
  const key = cleanPath(path);
  if (!key) return false;
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType }
    });
    return true;
  } catch {
    return false;
  }
}

export async function existsInR2(env: Env, path: string): Promise<boolean> {
  const size = await r2ObjectSize(env, path);
  return size > 0;
}

/** HEAD 读 R2 对象大小（比 download 轻，用于 repair 扫描） */
export async function r2ObjectSize(env: Env, path: string): Promise<number> {
  const bucket = r2Bucket(env);
  if (!bucket) return 0;
  const key = cleanPath(path);
  if (!key) return 0;
  try {
    const head = await bucket.head(key);
    return Number(head?.size) || 0;
  } catch {
    return 0;
  }
}

export async function deleteFromR2(env: Env, path: string): Promise<boolean> {
  const bucket = r2Bucket(env);
  if (!bucket) return false;
  const key = cleanPath(path);
  if (!key) return false;
  try {
    await bucket.delete(key);
    return true;
  } catch {
    return false;
  }
}

export type R2ListedObject = { key: string; size: number };

/** 分页列出 R2 桶内对象（Workers binding） */
export async function listR2ObjectsPage(
  env: Env,
  opts: { prefix?: string; cursor?: string; limit?: number }
): Promise<{ objects: R2ListedObject[]; cursor?: string; truncated: boolean }> {
  const bucket = r2Bucket(env);
  if (!bucket) return { objects: [], truncated: false };
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 1000));
  try {
    const listed = await bucket.list({
      prefix: opts.prefix ? cleanPath(opts.prefix) : undefined,
      cursor: opts.cursor || undefined,
      limit
    });
    const objects = (listed.objects || [])
      .map((o) => ({ key: cleanPath(o.key), size: Number(o.size) || 0 }))
      .filter((o) => o.key && o.size >= 512);
    return {
      objects,
      cursor: listed.truncated ? listed.cursor : undefined,
      truncated: !!listed.truncated
    };
  } catch {
    return { objects: [], truncated: false };
  }
}

/** 全桶扫描（带上限，避免 Worker 超时） */
export async function scanAllR2Objects(
  env: Env,
  maxObjects = 15_000
): Promise<{ objects: R2ListedObject[]; truncated: boolean }> {
  const out: R2ListedObject[] = [];
  let cursor: string | undefined;
  let truncated = false;
  while (out.length < maxObjects) {
    const page = await listR2ObjectsPage(env, {
      cursor,
      limit: Math.min(1000, maxObjects - out.length)
    });
    out.push(...page.objects);
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
    if (out.length >= maxObjects) {
      truncated = true;
      break;
    }
  }
  return { objects: out, truncated };
}

async function downloadFromSupabase(env: Env, path: string): Promise<Blob | null> {
  const admin = createAdminClient(env);
  const key = cleanPath(path);
  const { data, error } = await admin.storage.from(CARD_IMAGES_BUCKET).download(key);
  if (error || !data) return null;
  if ((data.size || 0) < 512) return null;
  return data;
}

/** 按 MEDIA_STORAGE_MODE 下载对象 */
export async function downloadCardImage(env: Env, path: string): Promise<Blob | null> {
  const mode = mediaStorageMode(env);
  const key = cleanPath(path);
  if (!key) return null;

  if (mode === 'r2' || mode === 'r2-first') {
    const fromR2 = await downloadFromR2(env, key);
    if (fromR2) return fromR2;
    if (mode === 'r2') return null;
  }

  return downloadFromSupabase(env, key);
}

/** 上传：有 R2 时双写 R2 + Supabase（r2-only 时只写 R2） */
export async function uploadCardImage(
  env: Env,
  path: string,
  body: Blob | ArrayBuffer,
  contentType: string
): Promise<void> {
  const mode = mediaStorageMode(env);
  const key = cleanPath(path);
  if (!key) return;

  if (hasR2(env) && mode !== 'supabase') {
    const ok = await uploadToR2(env, key, body, contentType);
    if (!ok) {
      throw new Error('R2 图片上传失败，请检查桶绑定 prompt-hub-card-images');
    }
    if (mode === 'r2') return;
  }

  if (mode !== 'r2') {
    const admin = createAdminClient(env);
    const { error } = await admin.storage.from(CARD_IMAGES_BUCKET).upload(key, body, {
      contentType,
      upsert: true
    });
    if (error) throw error;
  }
}

/** list 轻量存在检查：R2 head 或 Supabase list */
export async function cardImageExists(
  env: Env,
  path: string,
  admin = createAdminClient(env)
): Promise<boolean> {
  const mode = mediaStorageMode(env);
  const key = cleanPath(path);
  if (!key) return false;

  if ((mode === 'r2' || mode === 'r2-first') && hasR2(env)) {
    if (await existsInR2(env, key)) return true;
    if (mode === 'r2') return false;
  }

  try {
    const { data, error } = await admin.storage.from(CARD_IMAGES_BUCKET).download(key);
    if (!error && data && (data.size || 0) > 0) return true;
  } catch {
    /* fall through */
  }

  const slash = key.lastIndexOf('/');
  const dir = slash >= 0 ? key.slice(0, slash) : '';
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  const { data, error } = await admin.storage.from(CARD_IMAGES_BUCKET).list(dir, { limit: 200 });
  if (error || !data?.length) return false;
  return data.some((item) => item.name === name);
}
