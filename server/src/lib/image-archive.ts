import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { mookoImageFetchCandidates } from './mooko';
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
      if (!isParseableDataImageUrl(raw)) {
        console.warn('[archive] skip invalid data url', archiveKey);
        continue;
      }
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

const B64_SAMPLE = 256;
const B64_FULL_REGEX_LIMIT = 2048;

function isBase64CharCode(c: number): boolean {
  return (
    (c >= 48 && c <= 57)
    || (c >= 65 && c <= 90)
    || (c >= 97 && c <= 122)
    || c === 43
    || c === 47
    || c === 61
  );
}

function sampleBase64LooksValid(b64: string): boolean {
  if (b64.length < 80 || b64.length % 4 !== 0) return false;
  if (b64.length <= B64_FULL_REGEX_LIMIT) {
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return false;
  } else {
    const head = b64.slice(0, B64_SAMPLE);
    const tail = b64.slice(-B64_SAMPLE);
    if (!/^[A-Za-z0-9+/=]+$/.test(head) || !/^[A-Za-z0-9+/=]+$/.test(tail)) return false;
    const mid = b64.slice(Math.floor(b64.length / 2), Math.floor(b64.length / 2) + 64);
    for (let i = 0; i < mid.length; i += 1) {
      if (!isBase64CharCode(mid.charCodeAt(i))) return false;
    }
  }
  try {
    atob(b64.slice(0, Math.min(B64_SAMPLE, b64.length)));
    if (b64.length > B64_SAMPLE * 2) atob(b64.slice(-B64_SAMPLE));
    return true;
  } catch {
    return false;
  }
}

/** 木瓜 2K 同步体可达数 MB；勿对整段 base64 做 regex/atob 校验 */
export function isParseableDataImageUrl(dataUrl: string | null | undefined): boolean {
  if (!isDataImageUrl(dataUrl)) return false;
  const s = String(dataUrl);
  const comma = s.indexOf(',');
  if (comma < 0) return false;
  const header = s.slice(0, comma);
  if (!/^data:image\/[a-z0-9+.-]+;base64$/i.test(header)) return false;
  return sampleBase64LooksValid(s.slice(comma + 1).trim());
}

/** 归档前轻量判断：避免对大段 base64 做全量 regex */
export function isLikelyDataImageUrl(dataUrl: string | null | undefined): boolean {
  if (!isDataImageUrl(dataUrl)) return false;
  const s = String(dataUrl);
  const comma = s.indexOf(',');
  if (comma < 0) return false;
  const header = s.slice(0, comma);
  if (!/^data:image\/[a-z0-9+.-]+;base64$/i.test(header)) return false;
  const b64 = s.slice(comma + 1).trim();
  return b64.length >= 80 && b64.length % 4 === 0;
}

function bytesFromAtobBinary(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** 分块 atob，避免 2K 大图单次解码触发 Worker CPU 上限 */
function base64ToBytes(b64: string): ArrayBuffer | null {
  try {
    const quantum = 4;
    const chunkChars = quantum * 24 * 1024;
    if (b64.length <= chunkChars) {
      const single = bytesFromAtobBinary(atob(b64));
      return single.buffer.slice(single.byteOffset, single.byteOffset + single.byteLength);
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    let off = 0;
    while (off < b64.length) {
      let end = Math.min(off + chunkChars, b64.length);
      if (end < b64.length) end -= (end - off) % quantum;
      const slice = b64.slice(off, end);
      if (!slice) break;
      const bytes = bytesFromAtobBinary(atob(slice));
      parts.push(bytes);
      total += bytes.length;
      off = end;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      out.set(part, pos);
      pos += part.length;
    }
    return out.buffer.slice(0);
  } catch {
    return null;
  }
}

function parseDataImageUrl(dataUrl: string): { mime: string; bytes: ArrayBuffer } | null {
  if (!isParseableDataImageUrl(dataUrl)) return null;
  const s = String(dataUrl);
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const mime = s.slice(5, comma).split(';')[0] || 'image/jpeg';
  const bytes = base64ToBytes(s.slice(comma + 1).trim());
  if (!bytes || bytes.byteLength < 64) return null;
  return { mime, bytes };
}

export function extensionFromImageMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'jpg';
}

export function generationStorageAssetId(jobId: string): string {
  return String(jobId || '').replace(/#/g, '-');
}

export function generatedArchivePath(userId: string, jobId: string, mime: string): string {
  const key = generationStorageAssetId(jobId);
  return `${userId}/generated/${key}.${extensionFromImageMime(mime)}`;
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
        const candidates = mookoImageFetchCandidates(remoteUrl);
        let res: Response | null = null;
        let lastStatus = 0;
        for (const fetchUrl of candidates) {
          res = await fetch(fetchUrl, {
            headers: { Accept: 'image/*' }
          });
          lastStatus = res.status;
          if (res.ok) break;
        }
        if (!res || !res.ok) {
          throw new Error(`fetch_image_failed_${lastStatus || 0}`);
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
