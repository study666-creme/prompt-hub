import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'card-images';
const STORAGE_PREFIX = `storage://${BUCKET}/`;

export function toStorageRef(path: string): string {
  return STORAGE_PREFIX + path.replace(/^\//, '');
}

export function storagePathFromRef(ref: string): string | null {
  if (!ref || typeof ref !== 'string') return null;
  if (!ref.startsWith(STORAGE_PREFIX)) return null;
  return ref.slice(STORAGE_PREFIX.length).split('?')[0] || null;
}

/** 将上游临时 URL 拉取并写入用户私有桶，返回 storage:// 引用 */
export async function archiveRemoteImage(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  remoteUrl: string
): Promise<string> {
  const res = await fetch(remoteUrl, {
    headers: { Accept: 'image/*' }
  });
  if (!res.ok) {
    throw new Error(`fetch_image_failed_${res.status}`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('empty_image');

  const path = `${userId}/generated/${jobId}.jpg`;
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: contentType.split(';')[0] || 'image/jpeg',
    upsert: true,
    cacheControl: '3600'
  });
  if (error) throw error;
  return toStorageRef(path);
}
