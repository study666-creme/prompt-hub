import type { Context } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';
import { buildPrivateMediaCdnUrl } from './media-cdn';

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

async function storageRefToCdnUrl(
  c: Context<{ Bindings: Env }>,
  userId: string,
  ref: string
): Promise<string | null> {
  const path = storagePathFromRef(ref);
  if (!path || !path.replace(/^\//, '').startsWith(`${userId}/`)) return null;
  return buildPrivateMediaCdnUrl(c, path.replace(/^\//, ''));
}

async function uploadDataUrlRef(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  dataUrl: string
): Promise<string> {
  const { bytes, mime, ext } = parseDataUrl(dataUrl);
  const path = `${userId}/imagegen/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true
  });
  if (error) {
    throw new ApiError(502, 'GENERATION_FAILED', `参考图上传失败：${error.message.slice(0, 120)}`);
  }
  return buildPrivateMediaCdnUrl(c, path);
}

/** 将客户端参考图（https / storage:// / data:）转为上游可拉取的 URL */
export async function resolveGenerationRefUrls(
  c: Context<{ Bindings: Env }>,
  admin: SupabaseClient,
  userId: string,
  refs: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const raw of refs) {
    const ref = String(raw || '').trim();
    if (!ref) continue;
    if (/^https?:\/\//i.test(ref)) {
      out.push(ref);
      continue;
    }
    if (isStorageRef(ref)) {
      const url = await storageRefToCdnUrl(c, userId, ref);
      if (url) out.push(url);
      continue;
    }
    if (ref.startsWith('data:image/')) {
      out.push(await uploadDataUrlRef(c, admin, userId, ref));
    }
  }
  return out;
}
