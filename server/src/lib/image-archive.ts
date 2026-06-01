import type { SupabaseClient } from '@supabase/supabase-js';
import { storageObjectExistsLight } from './media-cdn';

const BUCKET = 'card-images';
const STORAGE_PREFIX = `storage://${BUCKET}/`;

export function toStorageRef(path: string): string {
  return STORAGE_PREFIX + path.replace(/^\//, '');
}

export function isStorageRef(ref: string): boolean {
  return typeof ref === 'string' && ref.startsWith(STORAGE_PREFIX);
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

async function verifyStoredObject(
  admin: SupabaseClient,
  path: string
): Promise<boolean> {
  if (!(await storageObjectExistsLight(admin, path, BUCKET))) return false;
  return true;
}

/** 将上游临时 URL 拉取并写入用户私有桶，返回 storage:// 引用（含校验与重试） */
export async function archiveRemoteImage(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  remoteUrl: string,
  opts?: { maxAttempts?: number }
): Promise<string> {
  if (isStorageRef(remoteUrl)) {
    const path = storagePathFromRef(remoteUrl);
    if (path && (await verifyStoredObject(admin, path))) return remoteUrl;
  }

  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
  const path = `${userId}/generated/${jobId}.jpg`;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(remoteUrl, {
        headers: { Accept: 'image/*' }
      });
      if (!res.ok) {
        throw new Error(`fetch_image_failed_${res.status}`);
      }
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) throw new Error('empty_image');

      const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
        contentType: contentType.split(';')[0] || 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });
      if (error) throw error;

      if (await verifyStoredObject(admin, path)) {
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
