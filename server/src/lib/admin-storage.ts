import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { hasR2, mediaStorageMode, r2Bucket, scanAllR2Objects } from './r2-storage';

export const CARD_IMAGES_BUCKET = 'card-images';
const LIST_PAGE = 1000;
const MAX_SCAN_FILES = 20_000;
const MAX_DELETE_BATCHES = 50;

export type BucketUsageByUser = {
  userId: string;
  bytes: number;
  fileCount: number;
};

export type BucketUsageResult = {
  bytes: number;
  fileCount: number;
  truncated: boolean;
  source: 'r2' | 'memfire';
  byUser: BucketUsageByUser[];
};

function summarizeByUser(
  files: Array<{ path: string; size: number }>,
  source: BucketUsageResult['source'],
  truncated: boolean
): BucketUsageResult {
  let bytes = 0;
  const byUserMap = new Map<string, { bytes: number; fileCount: number }>();
  for (const file of files) {
    bytes += file.size;
    const userId = file.path.split('/')[0];
    if (!userId) continue;
    const row = byUserMap.get(userId) || { bytes: 0, fileCount: 0 };
    row.bytes += file.size;
    row.fileCount += 1;
    byUserMap.set(userId, row);
  }
  const byUser = [...byUserMap.entries()]
    .map(([userId, value]) => ({ userId, bytes: value.bytes, fileCount: value.fileCount }))
    .sort((a, b) => b.bytes - a.bytes);
  return { bytes, fileCount: files.length, truncated, source, byUser };
}

async function scanMemfireBucketUsage(
  admin: SupabaseClient,
  bucket: string,
  maxFiles: number
): Promise<BucketUsageResult> {
  const files: Array<{ path: string; size: number }> = [];
  let truncated = false;

  async function walk(prefix: string): Promise<void> {
    if (truncated) return;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (error) throw error;
      if (!data?.length) break;

      for (const item of data) {
        const childPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          files.push({ path: childPath, size: Number(item.metadata?.size) || 0 });
          if (files.length >= maxFiles) {
            truncated = true;
            return;
          }
        } else {
          await walk(childPath);
          if (truncated) return;
        }
      }
      if (data.length < LIST_PAGE) break;
      offset += LIST_PAGE;
    }
  }

  await walk('');
  return summarizeByUser(files, 'memfire', truncated);
}

/** 扫描当前主存储；r2-first/r2 使用 R2，supabase 模式使用 MemFire Storage。 */
export async function scanBucketUsage(
  admin: SupabaseClient,
  env: Env,
  bucket = CARD_IMAGES_BUCKET,
  maxFiles = MAX_SCAN_FILES
): Promise<BucketUsageResult> {
  if (mediaStorageMode(env) !== 'supabase' && hasR2(env)) {
    const scan = await scanAllR2Objects(env, maxFiles);
    return summarizeByUser(
      scan.objects.map((object) => ({ path: object.key, size: object.size })),
      'r2',
      scan.truncated
    );
  }
  return scanMemfireBucketUsage(admin, bucket, maxFiles);
}

async function deleteMemfireUserFiles(
  admin: SupabaseClient,
  userId: string,
  bucket: string
): Promise<number> {
  let removed = 0;
  const prefix = userId.replace(/\/$/, '');

  async function walk(path: string): Promise<void> {
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(path, { limit: LIST_PAGE });
      if (error) throw error;
      if (!data?.length) break;

      const filePaths: string[] = [];
      for (const item of data) {
        const childPath = path ? `${path}/${item.name}` : item.name;
        if (item.id) filePaths.push(childPath);
        else await walk(childPath);
      }
      if (filePaths.length) {
        const { error: removeError } = await admin.storage.from(bucket).remove(filePaths);
        if (removeError) throw removeError;
        removed += filePaths.length;
      }
      if (data.length < LIST_PAGE) break;
    }
  }

  await walk(prefix);
  return removed;
}

async function deleteR2UserFiles(env: Env, userId: string): Promise<number> {
  const bucket = r2Bucket(env);
  if (!bucket) return 0;
  const prefix = `${userId.replace(/\/$/, '')}/`;
  let removed = 0;
  for (let batch = 0; batch < MAX_DELETE_BATCHES; batch += 1) {
    const listed = await bucket.list({ prefix, limit: LIST_PAGE });
    const keys = (listed.objects || []).map((object) => object.key).filter(Boolean);
    if (!keys.length) break;
    await bucket.delete(keys);
    removed += keys.length;
    if (!listed.truncated) break;
  }
  return removed;
}

export type DeleteUserStorageResult = {
  totalRemoved: number;
  r2Removed: number;
  memfireRemoved: number;
};

/** 账号删除时清理双写的两份对象，避免 R2 留下不可归属文件。 */
export async function deleteUserStorageFiles(
  admin: SupabaseClient,
  env: Env,
  userId: string,
  bucket = CARD_IMAGES_BUCKET
): Promise<DeleteUserStorageResult> {
  const [r2, memfire] = await Promise.allSettled([
    deleteR2UserFiles(env, userId),
    deleteMemfireUserFiles(admin, userId, bucket)
  ]);
  const r2Removed = r2.status === 'fulfilled' ? r2.value : 0;
  const memfireRemoved = memfire.status === 'fulfilled' ? memfire.value : 0;
  return {
    totalRemoved: r2Removed + memfireRemoved,
    r2Removed,
    memfireRemoved
  };
}
