import type { Context } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { isStorageRef, storagePathFromRef } from './image-archive';
import {
  apiOriginFromRequest,
  buildPrivateMediaCdnUrl,
  resolveStoragePath
} from './media-cdn';
import { downloadCardImage, uploadCardImage } from './r2-storage';

const BUCKET = 'card-images';
const MAX_REF_BYTES = 8 * 1024 * 1024;

export function isAcceptedRefImageInput(value: string): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (isStorageRef(s)) return true;
  return /^data:image\/[\w+.-]+;base64,/i.test(s);
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) throw new ApiError(400, 'VALIDATION_ERROR', '参考图格式无效');
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > MAX_REF_BYTES) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参考图过大，请换一张较小的图');
  }
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { bytes, mime, ext };
}

function contentTypeForExt(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function assertUserOwnsPath(userId: string, path: string): void {
  const clean = path.replace(/^\//, '');
  if (!clean.startsWith(`${userId}/`)) {
    throw new ApiError(403, 'FORBIDDEN', '无权使用该参考图');
  }
}

function isOwnMediaUrl(url: string, origin: string): boolean {
  if (/\/api\/v1\/media\/[ic]\//i.test(url)) return true;
  try {
    const u = new URL(url);
    if (u.origin === origin) return true;
    return /prompt-hub/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function downloadRefBlob(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  path: string
): Promise<Blob | null> {
  const clean = path.replace(/^\//, '');
  const fromR2 = await downloadCardImage(c.env, clean);
  if (fromR2 && fromR2.size > 512) return fromR2;
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(clean);
    if (!error && data && data.size > 512) return data;
  } catch {
    /* try upstream re-upload path below */
  }
  return null;
}

/** Apimart 拉取需稳定可达：从 R2/Storage 取原图后写入 upstream 并签新链 */
async function ensureUpstreamRefUrl(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  storagePath: string
): Promise<string> {
  const clean = storagePath.replace(/^\//, '');
  assertUserOwnsPath(userId, clean);
  const blob = await downloadRefBlob(c, admin, clean);
  if (!blob) {
    throw new ApiError(400, 'VALIDATION_ERROR', '参考图不存在或已失效，请重新上传');
  }
  const ext = /\.png$/i.test(clean) ? 'png' : /\.webp$/i.test(clean) ? 'webp' : 'jpg';
  const upstreamPath = `${userId}/imagegen/upstream/${crypto.randomUUID()}.${ext}`;
  await uploadCardImage(c.env, upstreamPath, blob, contentTypeForExt(ext));
  return buildPrivateMediaCdnUrl(c, upstreamPath);
}

async function uploadDataUrlRef(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  dataUrl: string
): Promise<string> {
  const { bytes, mime, ext } = parseDataUrl(dataUrl);
  const path = `${userId}/imagegen/${crypto.randomUUID()}.${ext}`;
  const blob = new Blob([bytes], { type: mime });
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true
  });
  if (error) {
    throw new ApiError(502, 'GENERATION_FAILED', `参考图上传失败：${error.message.slice(0, 120)}`);
  }
  await uploadCardImage(c.env, path, blob, mime);
  return ensureUpstreamRefUrl(c, admin, userId, path);
}

async function resolvePathToUpstreamUrl(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  path: string
): Promise<string> {
  return ensureUpstreamRefUrl(c, admin, userId, path);
}

/** 将客户端参考图（https / storage:// / data:）转为上游可拉取的 URL */
export async function resolveGenerationRefUrls(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  refs: string[]
): Promise<string[]> {
  const origin = apiOriginFromRequest(c);
  const out: string[] = [];
  for (const raw of refs) {
    const ref = String(raw || '').trim();
    if (!ref) continue;
    if (/^https?:\/\//i.test(ref)) {
      const path = resolveStoragePath(ref);
      if (path && isOwnMediaUrl(ref, origin)) {
        out.push(await resolvePathToUpstreamUrl(c, admin, userId, path));
        continue;
      }
      out.push(ref);
      continue;
    }
    if (isStorageRef(ref)) {
      const path = storagePathFromRef(ref);
      if (path) {
        out.push(await resolvePathToUpstreamUrl(c, admin, userId, path));
      }
      continue;
    }
    if (ref.startsWith('data:image/')) {
      out.push(await uploadDataUrlRef(c, admin, userId, ref));
    }
  }
  return out;
}
