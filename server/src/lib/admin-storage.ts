import type { SupabaseClient } from '@supabase/supabase-js';

export const CARD_IMAGES_BUCKET = 'card-images';
const LIST_PAGE = 1000;
const MAX_SCAN_FILES = 20_000;

export type BucketUsageResult = {
  bytes: number;
  fileCount: number;
  truncated: boolean;
};

export async function scanBucketUsage(
  admin: SupabaseClient,
  bucket = CARD_IMAGES_BUCKET,
  maxFiles = MAX_SCAN_FILES
): Promise<BucketUsageResult> {
  let bytes = 0;
  let fileCount = 0;
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
          fileCount += 1;
          bytes += Number(item.metadata?.size) || 0;
          if (fileCount >= maxFiles) {
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
  return { bytes, fileCount, truncated };
}

export async function deleteUserStorageFiles(
  admin: SupabaseClient,
  userId: string,
  bucket = CARD_IMAGES_BUCKET
): Promise<number> {
  let removed = 0;
  const prefix = `${userId.replace(/\/$/, '')}`;

  async function walk(path: string): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(path, {
        limit: LIST_PAGE,
        offset
      });
      if (error) throw error;
      if (!data?.length) break;

      const filePaths: string[] = [];
      for (const item of data) {
        const childPath = path ? `${path}/${item.name}` : item.name;
        if (item.id) filePaths.push(childPath);
        else await walk(childPath);
      }

      if (filePaths.length) {
        const { error: rmErr } = await admin.storage.from(bucket).remove(filePaths);
        if (rmErr) throw rmErr;
        removed += filePaths.length;
      }

      if (data.length < LIST_PAGE) break;
      offset += LIST_PAGE;
    }
  }

  await walk(prefix);
  return removed;
}
