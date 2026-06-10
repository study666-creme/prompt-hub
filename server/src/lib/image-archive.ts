import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { cardImageExists, hasR2, mediaStorageMode, uploadCardImage, uploadToR2 } from './r2-storage';
import { storageObjectExistsLight } from './media-cdn';

const BUCKET = 'card-images';
const STORAGE_PREFIX = `storage://${BUCKET}/`;

export function toStorageRef(path: string): string {
  return STORAGE_PREFIX + path.replace(/^\//, '');
}

export function isStorageRef(ref: string): boolean {
  return typeof ref === 'string' && ref.startsWith(STORAGE_PREFIX);
}

export function isDataImageUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^data:image\//i.test(url);
}

/** 木瓜等同步返回的 data URL 不得写入 meta；先归档为 storage:// */
export async function archiveGenerationResultUrls(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  urls: string[],
  env?: Env
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const raw = urls[i]?.trim();
    if (!raw) continue;
    if (isStorageRef(raw)) {
      out.push(raw);
      continue;
    }
    const archiveKey = i === 0 ? jobId : `${jobId}-extra-${i}`;
    if (isDataImageUrl(raw)) {
      out.push(await archiveRemoteImage(admin, userId, archiveKey, raw, { env, maxAttempts: 3 }));
      continue;
    }
    if (/^https?:\/\//i.test(raw)) {
      try {
        out.push(await archiveRemoteImage(admin, userId, archiveKey, raw, { env, maxAttempts: 2 }));
      } catch (e) {
        console.warn('[archive] keep upstream http for pending', archiveKey, e);
        out.push(raw);
      }
    }
  }
  return out;
}

/** 从 storage 路径首段解析 Supabase 用户 UUID（图片真实归属） */
export function inferOwnerIdFromImageRef(image: string | null | undefined): string | null {
  const path = storagePathFromRef(image || '');
  if (!path) return null;
  const head = path.replace(/^\//, '').split('/')[0] || '';
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(head)
  ) {
    return head;
  }
  return null;
}

export function storagePathFromRef(ref: string): string | null {
  if (!ref || typeof ref !== 'string') return null;
  if (ref.startsWith(STORAGE_PREFIX)) {
    return ref.slice(STORAGE_PREFIX.length).split('?')[0] || null;
  }
  const markers = [
    `/storage/v1/object/public/${BUCKET}/`,
    `/storage/v1/object/sign/${BUCKET}/`,
    `/storage/v1/object/authenticated/${BUCKET}/`
  ];
  for (const marker of markers) {
    const i = ref.indexOf(marker);
    if (i !== -1) return ref.slice(i + marker.length).split('?')[0] || null;
  }
  return null;
}

function parseDataImageUrl(dataUrl: string): { mime: string; bytes: ArrayBuffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: m[1] || 'image/png', bytes: bytes.buffer };
}

export function extensionFromImageMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'jpg';
}

export function generatedArchivePath(userId: string, jobId: string, mime: string): string {
  return `${userId}/generated/${jobId}.${extensionFromImageMime(mime)}`;
}

async function verifyStoredObject(
  admin: SupabaseClient,
  path: string,
  env?: Env
): Promise<boolean> {
  if (env) return cardImageExists(env, path, admin);
  return storageObjectExistsLight(admin, path, BUCKET);
}

/** 将上游临时 URL 或 data URL 拉取并写入用户私有桶，返回 storage:// 引用（含校验与重试） */
export async function archiveRemoteImage(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  remoteUrl: string,
  opts?: { maxAttempts?: number; env?: Env }
): Promise<string> {
  const env = opts?.env;
  if (isStorageRef(remoteUrl)) {
    const path = storagePathFromRef(remoteUrl);
    if (path && (await verifyStoredObject(admin, path, env))) return remoteUrl;
  }

  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let buf: ArrayBuffer;
      let mime = 'image/jpeg';
      if (/^data:image\//i.test(remoteUrl)) {
        const parsed = parseDataImageUrl(remoteUrl);
        if (!parsed) throw new Error('invalid_data_url');
        buf = parsed.bytes;
        mime = parsed.mime;
      } else {
        const res = await fetch(remoteUrl, {
          headers: { Accept: 'image/*' }
        });
        if (!res.ok) {
          throw new Error(`fetch_image_failed_${res.status}`);
        }
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        mime = contentType.split(';')[0] || 'image/jpeg';
        const path = generatedArchivePath(userId, jobId, mime);

        if (env && hasR2(env) && res.body) {
          const mode = mediaStorageMode(env);
          const streamed = await uploadToR2(env, path, res.body, mime);
          if (!streamed) throw new Error('r2_stream_upload_failed');
          if (mode === 'r2' || mode === 'r2-first') {
            if (await verifyStoredObject(admin, path, env)) {
              return toStorageRef(path);
            }
            throw new Error('archive_verify_failed');
          }
        }

        buf = await res.arrayBuffer();
      }
      if (!buf.byteLength) throw new Error('empty_image');

      const path = generatedArchivePath(userId, jobId, mime);

      if (env) {
        await uploadCardImage(env, path, buf, mime);
      } else {
        const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
          contentType: mime,
          upsert: true,
          cacheControl: '3600'
        });
        if (error) throw error;
      }

      if (await verifyStoredObject(admin, path, env)) {
        return toStorageRef(path);
      }
      throw new Error('archive_verify_failed');
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 400 * attempt));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('archive_failed');
}
