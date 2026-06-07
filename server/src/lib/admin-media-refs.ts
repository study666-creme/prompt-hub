import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { CARD_IMAGES_BUCKET } from './admin-storage';
import { storagePathFromRef } from './image-archive';
import { encodeStoragePath } from './media-cdn';
import { deleteFromR2 } from './r2-storage';

const LIST_PAGE = 1000;
const MAX_BUCKET_SCAN = 15_000;

function normalizePath(p: string): string {
  return String(p || '').replace(/^\//, '').trim();
}

function gridSiblingPath(primary: string): string | null {
  const p = normalizePath(primary);
  if (!p || /_grid\./i.test(p)) return null;
  return p.replace(/\.(jpe?g|png|webp)$/i, '_grid.jpg');
}

function addReferencedPath(refs: Set<string>, raw: string | null | undefined) {
  const path = storagePathFromRef(String(raw || '')) || normalizePath(String(raw || ''));
  if (!path || !path.includes('/')) return;
  refs.add(path);
  const grid = gridSiblingPath(path);
  if (grid) refs.add(grid);
}

/** 收集仍被卡片库 / 社区帖引用的 Storage 路径 */
export async function collectReferencedStoragePaths(
  admin: SupabaseClient
): Promise<Set<string>> {
  const refs = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('user_data')
      .select('data')
      .range(offset, offset + 199);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const cards = (row as { data?: { cards?: { image?: string }[] } }).data?.cards;
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        addReferencedPath(refs, card?.image);
      }
    }
    offset += 200;
    if (data.length < 200) break;
  }

  let postOffset = 0;
  while (true) {
    const { data, error } = await admin
      .from('community_posts')
      .select('image')
      .range(postOffset, postOffset + 499);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      addReferencedPath(refs, (row as { image?: string }).image);
    }
    postOffset += 500;
    if (data.length < 500) break;
  }

  return refs;
}

export type BucketOrphanItem = {
  path: string;
  bytes: number;
  thumbUrl: string;
  thumbFallbackUrl: string;
};

export type BucketOrphanListResult = {
  items: BucketOrphanItem[];
  total: number;
  referencedCount: number;
  scannedCount: number;
  truncated: boolean;
};

export async function listBucketOrphanFiles(
  admin: SupabaseClient,
  apiOrigin: string,
  opts: { limit: number; offset: number }
): Promise<BucketOrphanListResult> {
  const referenced = await collectReferencedStoragePaths(admin);
  const orphans: { path: string; bytes: number }[] = [];
  let scanned = 0;
  let truncated = false;

  async function walk(prefix: string): Promise<void> {
    if (truncated) return;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(CARD_IMAGES_BUCKET).list(prefix, {
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (error) throw error;
      if (!data?.length) break;

      for (const item of data) {
        const childPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          scanned += 1;
          const path = normalizePath(childPath);
          if (!referenced.has(path)) {
            orphans.push({
              path,
              bytes: Number(item.metadata?.size) || 0
            });
          }
          if (scanned >= MAX_BUCKET_SCAN) {
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
  orphans.sort((a, b) => b.bytes - a.bytes);

  const limit = Math.min(100, Math.max(1, opts.limit));
  const offset = Math.max(0, opts.offset);
  const slice = orphans.slice(offset, offset + limit);
  const origin = apiOrigin.replace(/\/$/, '');

  const items: BucketOrphanItem[] = slice.map((o) => {
    const grid = gridSiblingPath(o.path);
    const thumbPath = grid || o.path;
    return {
      path: o.path,
      bytes: o.bytes,
      thumbUrl: `${origin}/api/v1/media/c/${encodeStoragePath(thumbPath)}`,
      thumbFallbackUrl: `${origin}/api/v1/media/c/${encodeStoragePath(o.path)}`
    };
  });

  return {
    items,
    total: orphans.length,
    referencedCount: referenced.size,
    scannedCount: scanned,
    truncated
  };
}

export async function deleteStoragePaths(
  admin: SupabaseClient,
  env: Env,
  paths: string[]
): Promise<{ removed: number; r2Removed: number }> {
  const clean = [...new Set(paths.map(normalizePath).filter(Boolean))];
  if (!clean.length) return { removed: 0, r2Removed: 0 };

  const { error } = await admin.storage.from(CARD_IMAGES_BUCKET).remove(clean);
  if (error) throw error;

  let r2Removed = 0;
  for (const p of clean) {
    if (await deleteFromR2(env, p)) r2Removed += 1;
  }
  return { removed: clean.length, r2Removed };
}

export function publicThumbUrls(
  apiOrigin: string,
  imageRef: string | null | undefined
): { thumbUrl: string | null; thumbFallbackUrl: string | null } {
  const base = storagePathFromRef(String(imageRef || ''));
  if (!base) return { thumbUrl: null, thumbFallbackUrl: null };
  const origin = apiOrigin.replace(/\/$/, '');
  const grid = gridSiblingPath(base);
  return {
    thumbUrl: `${origin}/api/v1/media/c/${encodeStoragePath(grid || base)}`,
    thumbFallbackUrl: `${origin}/api/v1/media/c/${encodeStoragePath(base)}`
  };
}
