import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { CARD_IMAGES_BUCKET } from './admin-storage';
import { encodeStoragePath, resolveStoragePath, sanitizeCardFileBase } from './media-cdn';
import { deleteFromR2, mediaStorageMode } from './r2-storage';

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
  const path = resolveStoragePath(raw) || normalizePath(String(raw || ''));
  if (!path || !path.includes('/')) return;
  refs.add(path);
  const grid = gridSiblingPath(path);
  if (grid) refs.add(grid);
}

function addCardPathCandidates(refs: Set<string>, userId: string, cardId: string) {
  const uid = String(userId || '').trim();
  const cid = String(cardId || '').trim();
  if (!uid || !cid) return;
  const base = sanitizeCardFileBase(cid);
  for (const ext of ['jpg', 'webp', 'png']) {
    addReferencedPath(refs, `${uid}/${base}.${ext}`);
    addReferencedPath(refs, `${uid}/${cid}.${ext}`);
    addReferencedPath(refs, `${uid}/generated/${base}.${ext}`);
    addReferencedPath(refs, `${uid}/generated/${cid}.${ext}`);
    addReferencedPath(refs, `${uid}/${base}_grid.jpg`);
    addReferencedPath(refs, `${uid}/${cid}_grid.jpg`);
    addReferencedPath(refs, `${uid}/generated/${base}_grid.jpg`);
    addReferencedPath(refs, `${uid}/generated/${cid}_grid.jpg`);
  }
}

/** 收集仍被卡片库 / 社区帖 / 生图任务引用的 Storage 路径 */
export async function collectReferencedStoragePaths(
  admin: SupabaseClient
): Promise<Set<string>> {
  const refs = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('user_data')
      .select('user_id, data')
      .range(offset, offset + 199);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const userId = String((row as { user_id?: string }).user_id || '').trim();
      const cards = (row as { data?: { cards?: { id?: string; image?: string; genJobId?: string }[] } })
        .data?.cards;
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        const cardId = card && typeof card === 'object' ? String(card.id || '').trim() : '';
        addReferencedPath(refs, card?.image);
        if (userId && cardId) addCardPathCandidates(refs, userId, cardId);
        const jobId = card && typeof card === 'object' ? String(card.genJobId || '').replace(/#\d+$/, '') : '';
        if (userId && jobId) {
          for (const ext of ['jpg', 'webp', 'png']) {
            addReferencedPath(refs, `${userId}/generated/${jobId}.${ext}`);
            addReferencedPath(refs, `${userId}/generated/${jobId}_grid.jpg`);
          }
        }
      }
    }
    offset += 200;
    if (data.length < 200) break;
  }

  let postOffset = 0;
  while (true) {
    const { data, error } = await admin
      .from('community_posts')
      .select('author_id, source_card_id, image')
      .range(postOffset, postOffset + 499);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const authorId = String((row as { author_id?: string }).author_id || '').trim();
      const sourceCardId = String((row as { source_card_id?: string }).source_card_id || '').trim();
      addReferencedPath(refs, (row as { image?: string }).image);
      if (authorId && sourceCardId) addCardPathCandidates(refs, authorId, sourceCardId);
    }
    postOffset += 500;
    if (data.length < 500) break;
  }

  let jobOffset = 0;
  while (true) {
    const { data, error } = await admin
      .from('generation_requests')
      .select('user_id, id, result_image_url')
      .not('result_image_url', 'is', null)
      .range(jobOffset, jobOffset + 499);
    if (error) {
      if (String(error.message || '').includes('generation_requests')) break;
      throw error;
    }
    if (!data?.length) break;
    for (const row of data) {
      const userId = String((row as { user_id?: string }).user_id || '').trim();
      const jobId = String((row as { id?: string }).id || '').trim();
      addReferencedPath(refs, (row as { result_image_url?: string }).result_image_url);
      if (userId && jobId) {
        for (const ext of ['jpg', 'webp', 'png']) {
          addReferencedPath(refs, `${userId}/generated/${jobId}.${ext}`);
          addReferencedPath(refs, `${userId}/generated/${jobId}_grid.jpg`);
        }
      }
    }
    jobOffset += 500;
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

  const mode = mediaStorageMode(env);
  let supabaseRemoved = 0;
  if (mode !== 'r2') {
    const { error } = await admin.storage.from(CARD_IMAGES_BUCKET).remove(clean);
    if (error) throw error;
    supabaseRemoved = clean.length;
  } else {
    const { error } = await admin.storage.from(CARD_IMAGES_BUCKET).remove(clean);
    if (!error) supabaseRemoved = clean.length;
  }

  let r2Removed = 0;
  for (const p of clean) {
    if (await deleteFromR2(env, p)) r2Removed += 1;
  }
  return { removed: Math.max(supabaseRemoved, r2Removed), r2Removed };
}

export function publicThumbUrls(
  apiOrigin: string,
  imageRef: string | null | undefined
): { thumbUrl: string | null; thumbFallbackUrl: string | null } {
  const base = resolveStoragePath(imageRef);
  if (!base) return { thumbUrl: null, thumbFallbackUrl: null };
  const origin = apiOrigin.replace(/\/$/, '');
  const grid = gridSiblingPath(base);
  return {
    thumbUrl: `${origin}/api/v1/media/c/${encodeStoragePath(grid || base)}`,
    thumbFallbackUrl: `${origin}/api/v1/media/c/${encodeStoragePath(base)}`
  };
}
