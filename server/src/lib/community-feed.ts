import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { publicThumbUrls, deleteStoragePaths } from './admin-media-refs';
import {
  inferOwnerIdFromImageRef,
  isStorageRef,
  storagePathFromRef,
  toStorageRef
} from './image-archive';
import {
  communityImagePathCandidates,
  findFirstExistingStoragePath,
  resolveStoragePath,
  sanitizeCardFileBase,
  storageObjectExistsLight
} from './media-cdn';

const BUCKET = 'card-images';

export const MIN_COMMUNITY_PROMPT_LEN = 15;

type CardLibraryIndex = {
  ids: Set<string>;
  fileBases: Set<string>;
  postIds: Set<string>;
};

function fileBaseFromStoragePath(path: string): string | null {
  const name = path.split('/').pop() || '';
  const m = name.match(/^(.+?)(?:_grid)?\.(jpe?g|png|webp)$/i);
  return m ? m[1] : null;
}

function cardLibraryIndexFromUserData(data: unknown): CardLibraryIndex {
  const ids = new Set<string>();
  const fileBases = new Set<string>();
  const postIds = new Set<string>();
  if (!data || typeof data !== 'object') return { ids, fileBases, postIds };
  const cards = (data as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) return { ids, fileBases, postIds };
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    const card = c as {
      id?: string;
      image?: string;
      genJobId?: string;
      communityPostId?: string;
    };
    const id = String(card.id || '').trim();
    if (id) {
      ids.add(id);
      fileBases.add(sanitizeCardFileBase(id));
    }
    const linkedPost = String(card.communityPostId || '').trim();
    if (linkedPost) postIds.add(linkedPost);
    const path = resolveStoragePath(card.image);
    if (path) {
      const base = fileBaseFromStoragePath(path);
      if (base) fileBases.add(base);
    }
    const jobId = String(card.genJobId || '').replace(/#\d+$/, '').trim();
    if (jobId) fileBases.add(jobId);
  }
  return { ids, fileBases, postIds };
}

/** @deprecated 用 cardLibraryIndexFromUserData */
function cardIdsFromUserData(data: unknown): Set<string> {
  return cardLibraryIndexFromUserData(data).ids;
}

function isCardInAuthorLibrary(
  row: {
    id?: string;
    author_id: string;
    source_card_id: string | null;
    image?: string | null;
  },
  indexesByAuthor: Map<string, CardLibraryIndex>
): boolean {
  const cid = String(row.source_card_id || '').trim();
  const pid = String(row.id || '').trim();
  if (!cid && !pid) return false;
  const aid = String(row.author_id || '').trim();
  if (!isAuthorUuid(aid)) return true;

  const idx = indexesByAuthor.get(aid);
  if (idx) {
    if (pid && idx.postIds.has(pid)) return true;
    if (cid && idx.ids.has(cid)) return true;
    const base = sanitizeCardFileBase(cid);
    if (cid && (idx.fileBases.has(base) || idx.fileBases.has(cid))) return true;
  }

  const postPath = resolveStoragePath(row.image);
  if (postPath) {
    const postBase = fileBaseFromStoragePath(postPath);
    const base = sanitizeCardFileBase(cid);
    if (postBase && (postBase === base || postBase === cid)) return true;
    if (idx && postBase && idx.fileBases.has(postBase)) return true;
    if (postPath.includes(`/${base}.`) || postPath.includes(`/${cid}.`)) return true;
    if (postPath.includes(`/generated/${base}.`) || postPath.includes(`/generated/${cid}.`)) return true;
  }

  return false;
}

async function storageObjectExists(
  admin: SupabaseClient,
  path: string,
  env?: Env
): Promise<boolean> {
  return storageObjectExistsLight(admin, path, BUCKET, env);
}

/** 同步到全站前：在桶里找到真实存在的路径（与 uploadCardImage 命名一致） */
export async function resolvePublicImageRef(
  admin: SupabaseClient,
  userId: string,
  post: CommunityPostPayload,
  env?: Env
): Promise<string | null> {
  const candidates: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && !candidates.includes(key)) candidates.push(key);
  };
  if (post.image) {
    const fromRef = storagePathFromRef(post.image);
    if (fromRef) add(fromRef);
  }
  if (post.sourceCardId) {
    const base = sanitizeCardFileBase(post.sourceCardId);
    add(`${userId}/${base}.jpg`);
    add(`${userId}/${post.sourceCardId}.jpg`);
    add(`${userId}/${base}.webp`);
    add(`${userId}/${base}.png`);
  }
  for (const path of candidates) {
    if (await storageObjectExists(admin, path, env)) {
      return toStorageRef(path);
    }
  }
  if (post.image && typeof post.image === 'string' && post.image.trim()) {
    return isStorageRef(post.image) ? toStorageRef(storagePathFromRef(post.image) || '') : post.image.trim();
  }
  return null;
}

export type CommunityPostPayload = {
  id: string;
  sourceCardId?: string | null;
  authorId?: string;
  authorName?: string;
  title?: string;
  prompt: string;
  image?: string | null;
  likes?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type CommunityPostDto = {
  id: string;
  sourceCardId: string | null;
  authorId: string;
  authorName: string;
  title: string;
  prompt: string;
  image: string | null;
  likes: number;
  createdAt: number;
  updatedAt: number;
};

type CommunityRow = {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  prompt: string;
  image: string | null;
  likes: number;
  source_card_id: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
};

function effectiveAuthorForRow(row: CommunityRow): { authorId: string; authorName: string } {
  const ownerFromImage = inferOwnerIdFromImageRef(row.image);
  if (ownerFromImage && ownerFromImage !== row.author_id) {
    return { authorId: ownerFromImage, authorName: row.author_name || '用户' };
  }
  return { authorId: row.author_id, authorName: row.author_name || '用户' };
}

export function mapRowToDto(row: CommunityRow): CommunityPostDto {
  const author = effectiveAuthorForRow(row);
  return {
    id: row.id,
    sourceCardId: row.source_card_id,
    authorId: author.authorId,
    authorName: author.authorName,
    title: row.title || '',
    prompt: row.prompt || '',
    image: row.image,
    likes: row.likes ?? 0,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime()
  };
}

/** 同一 source_card_id / 同图同文案只保留最新一条（修复历史重复发布） */
export function dedupeCommunityFeedPosts(posts: CommunityPostDto[]): CommunityPostDto[] {
  const byCard = new Map<string, CommunityPostDto>();
  const byPrompt = new Map<string, CommunityPostDto>();
  for (const p of posts) {
    if (!p?.id) continue;
    if (p.sourceCardId) {
      const key = String(p.sourceCardId);
      const prev = byCard.get(key);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) byCard.set(key, p);
      continue;
    }
    const owner = inferOwnerIdFromImageRef(p.image) || p.authorId || '';
    const prompt = String(p.prompt || '').trim().slice(0, 160).toLowerCase();
    if (!prompt) continue;
    const key = `${owner}:${prompt}`;
    const prev = byPrompt.get(key);
    const ts = p.updatedAt || p.createdAt || 0;
    const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
    if (!prev || ts >= prevTs) byPrompt.set(key, p);
  }
  return [...byCard.values(), ...byPrompt.values()].sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

export function validatePostPayload(post: CommunityPostPayload): string | null {
  if (!post.id || String(post.id).length > 128) return '帖子 ID 无效';
  const prompt = String(post.prompt || '').trim();
  if (prompt.length < MIN_COMMUNITY_PROMPT_LEN) {
    return `提示词至少 ${MIN_COMMUNITY_PROMPT_LEN} 字`;
  }
  const image = String(post.image || '').trim();
  if (!image) return '发布到社区需要配图';
  if (image.startsWith('data:image/')) return null;
  if (isStorageRef(image)) return null;
  if (/^https?:\/\//i.test(image)) return null;
  return '发布到社区需要配图';
}

const AUTHOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAuthorUuid(id: string): boolean {
  return AUTHOR_UUID_RE.test(String(id || '').trim());
}

/** 下架无效作者（888 / guest / 非 UUID）及 Storage 中已无文件的帖 */
export async function unpublishGhostCommunityPosts(
  admin: SupabaseClient,
  env?: Env
): Promise<number> {
  const { data, error } = await admin
    .from('community_posts')
    .select('id, author_id, author_name, image, source_card_id')
    .eq('published', true);
  if (error) throw error;
  const now = new Date().toISOString();
  let removed = 0;
  for (const row of (data || []) as {
    id: string;
    author_id: string;
    author_name: string;
    image: string | null;
    source_card_id: string | null;
  }[]) {
    const aid = String(row.author_id || '').trim();
    const name = String(row.author_name || '').trim();
    const ghostAuthor =
      !isAuthorUuid(aid) || aid === '888' || name === '888' || /^local_/i.test(aid);
    let missingFile = false;
    const img = String(row.image || '').trim();
    if (!img) {
      missingFile = true;
    } else {
      const candidates = communityImagePathCandidates(
        img,
        aid,
        String(row.source_card_id || '').trim() || undefined
      );
      const found = await findFirstExistingStoragePath(admin, candidates, BUCKET, env);
      missingFile = !found;
    }
    if (!ghostAuthor && !missingFile) continue;
    const { error: upErr } = await admin
      .from('community_posts')
      .update({ published: false, updated_at: now })
      .eq('id', row.id);
    if (!upErr) removed += 1;
  }
  return removed;
}

/** 将 author_id 纠正为图片路径中的真实 UUID（修复旧版换号未清卡导致的 888 等串号） */
export async function repairMisattributedCommunityAuthors(
  admin: SupabaseClient
): Promise<number> {
  const { data, error } = await admin
    .from('community_posts')
    .select('id, author_id, image')
    .eq('published', true);
  if (error) throw error;
  let fixed = 0;
  for (const row of (data || []) as { id: string; author_id: string; image: string | null }[]) {
    const owner = inferOwnerIdFromImageRef(row.image);
    if (!owner || owner === row.author_id) continue;
    const { data: prof } = await admin
      .from('profiles')
      .select('display_name, user_id')
      .eq('user_id', owner)
      .maybeSingle();
    const authorName =
      String((prof as { display_name?: string | null } | null)?.display_name || '').trim() ||
      '用户';
    const { error: upErr } = await admin
      .from('community_posts')
      .update({
        author_id: owner,
        author_name: authorName.slice(0, 80),
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);
    if (!upErr) fixed += 1;
  }
  return fixed;
}

/** 同 source_card_id 的重复帖：保留最新，其余下架 */
export async function unpublishDuplicateCommunityPosts(
  admin: SupabaseClient
): Promise<number> {
  const { data, error } = await admin
    .from('community_posts')
    .select('id, source_card_id, updated_at, created_at')
    .eq('published', true)
    .not('source_card_id', 'is', null);
  if (error) throw error;
  const byCard = new Map<string, { id: string; ts: number }[]>();
  for (const row of (data || []) as {
    id: string;
    source_card_id: string;
    updated_at: string;
    created_at: string;
  }[]) {
    const cid = String(row.source_card_id || '').trim();
    if (!cid) continue;
    const ts = new Date(row.updated_at || row.created_at).getTime();
    const list = byCard.get(cid) || [];
    list.push({ id: row.id, ts });
    byCard.set(cid, list);
  }
  let removed = 0;
  const now = new Date().toISOString();
  for (const list of byCard.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.ts - a.ts);
    for (const dup of list.slice(1)) {
      const { error: upErr } = await admin
        .from('community_posts')
        .update({ published: false, updated_at: now })
        .eq('id', dup.id);
      if (!upErr) removed += 1;
    }
  }
  return removed;
}

export async function listPublicCommunityFeed(
  admin: SupabaseClient,
  limit: number,
  offset: number,
  opts?: { repairAuthors?: boolean; runMaintenance?: boolean }
): Promise<CommunityPostDto[]> {
  if (offset === 0 && opts?.runMaintenance) {
    try {
      if (opts.repairAuthors !== false) {
        await repairMisattributedCommunityAuthors(admin);
      }
      await unpublishOrphanSourceCardPosts(admin);
      await unpublishGhostCommunityPosts(admin);
      await unpublishDuplicateCommunityPosts(admin);
    } catch (e) {
      console.warn('[community-feed] repair skipped', e);
    }
  }
  const safeLimit = Math.min(100, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  // 去重后条数会缩水：按 offset+limit 多拉一段，且不再硬 cap 200 导致 offset≥200 永远为空
  const windowEnd = Math.min(3000, safeOffset + safeLimit + Math.max(120, safeLimit * 4));
  const { data, error } = await admin
    .from('community_posts')
    .select(
      'id, author_id, author_name, title, prompt, image, likes, source_card_id, published, created_at, updated_at'
    )
    .eq('published', true)
    .order('updated_at', { ascending: false })
    .range(0, windowEnd - 1);

  if (error) throw error;
  const deduped = dedupeCommunityFeedPosts((data as CommunityRow[]).map(mapRowToDto));
  return deduped
    .filter((p) => String(p.image || '').trim())
    .slice(safeOffset, safeOffset + safeLimit);
}

export async function upsertCommunityPost(
  admin: SupabaseClient,
  userId: string,
  post: CommunityPostPayload,
  env?: Env
): Promise<CommunityPostDto> {
  const err = validatePostPayload(post);
  if (err) throw new Error(err);

  const now = new Date().toISOString();
  const created =
    post.createdAt && post.createdAt > 0
      ? new Date(post.createdAt).toISOString()
      : now;

  const resolvedImage = await resolvePublicImageRef(admin, userId, post, env);
  const ownerFromImage = inferOwnerIdFromImageRef(resolvedImage);
  if (ownerFromImage && ownerFromImage !== userId) {
    throw new Error('图片不属于当前账号，无法以当前账号发布到社区');
  }
  const authorId = ownerFromImage || userId;

  const incomingLikes = Math.max(0, Math.floor(Number(post.likes) || 0));
  const { data: existingRow } = await admin
    .from('community_posts')
    .select('likes')
    .eq('id', String(post.id))
    .maybeSingle();
  const likes = existingRow
    ? Math.max(Number(existingRow.likes) || 0, incomingLikes)
    : incomingLikes;

  const row = {
    id: String(post.id),
    author_id: authorId,
    author_name: String(post.authorName || '用户').slice(0, 80),
    title: String(post.title || '').slice(0, 200),
    prompt: String(post.prompt).trim(),
    image: resolvedImage,
    likes,
    source_card_id: post.sourceCardId ? String(post.sourceCardId) : null,
    published: true,
    created_at: created,
    updated_at: now
  };

  const { data, error } = await admin
    .from('community_posts')
    .upsert(row, { onConflict: 'id' })
    .select(
      'id, author_id, author_name, title, prompt, image, likes, source_card_id, published, created_at, updated_at'
    )
    .single();

  if (error) throw error;
  return mapRowToDto(data as CommunityRow);
}

export async function unpublishCommunityPost(
  admin: SupabaseClient,
  userId: string,
  postId: string
): Promise<void> {
  const { data: row, error: selErr } = await admin
    .from('community_posts')
    .select('id, author_id, image')
    .eq('id', postId)
    .maybeSingle();
  if (selErr || !row) throw new Error('帖子不存在');
  const owner = inferOwnerIdFromImageRef(row.image);
  const can =
    String(row.author_id) === String(userId)
    || (owner && owner === String(userId));
  if (!can) throw new Error('无权下架该帖子');

  const { error } = await admin
    .from('community_posts')
    .update({ published: false, updated_at: new Date().toISOString() })
    .eq('id', postId);

  if (error) throw error;
}

export async function syncAuthorCommunityPosts(
  admin: SupabaseClient,
  userId: string,
  authorName: string,
  posts: CommunityPostPayload[],
  env?: Env
): Promise<{ synced: number; unpublished: number }> {
  const keepIds = new Set<string>();
  const keepCardIds = new Set<string>();
  for (const p of posts.slice(0, 80)) {
    if (p.id) keepIds.add(String(p.id));
    if (p.sourceCardId) keepCardIds.add(String(p.sourceCardId));
  }

  let unpublished = 0;
  const { data: existing, error: listErr } = await admin
    .from('community_posts')
    .select('id, source_card_id, image, author_id')
    .eq('published', true);
  if (listErr) throw listErr;

  const now = new Date().toISOString();
  for (const row of (existing || []) as CommunityRow[]) {
    const owner = inferOwnerIdFromImageRef(row.image) || String(row.author_id || '');
    if (owner !== userId && String(row.author_id) !== userId) continue;
    const id = String(row.id);
    const cardId = row.source_card_id ? String(row.source_card_id) : '';
    if (keepIds.has(id)) continue;
    if (cardId && keepCardIds.has(cardId)) continue;
    const { error } = await admin
      .from('community_posts')
      .update({ published: false, updated_at: now })
      .eq('id', id);
    if (!error) unpublished += 1;
  }

  let synced = 0;
  for (const p of posts.slice(0, 80)) {
    const err = validatePostPayload(p);
    if (err) continue;
    const owner = inferOwnerIdFromImageRef(p.image);
    if (owner && owner !== userId) continue;
    try {
      await upsertCommunityPost(admin, userId, { ...p, authorName }, env);
      synced += 1;
    } catch {
      /* 跳过无权发布的串号帖 */
    }
  }
  return { synced, unpublished };
}

export async function likeCommunityPost(
  admin: SupabaseClient,
  userId: string,
  postId: string
): Promise<{ likes: number; alreadyLiked: boolean }> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('缺少帖子 ID');

  const { data: postRow, error: postErr } = await admin
    .from('community_posts')
    .select('id, author_id, likes, published')
    .eq('id', id)
    .maybeSingle();
  if (postErr) throw postErr;
  if (!postRow || !postRow.published) throw new Error('帖子不存在');

  if (String(postRow.author_id) === String(userId)) {
    throw new Error('不能给自己的作品点赞');
  }

  const { error: likeInsertErr } = await admin
    .from('community_post_likes')
    .insert({ post_id: id, user_id: userId });

  if (likeInsertErr) {
    if (likeInsertErr.code === '23505') {
      return {
        likes: Math.max(0, Number(postRow.likes) || 0),
        alreadyLiked: true
      };
    }
    throw likeInsertErr;
  }

  const nextLikes = Math.max(0, (Number(postRow.likes) || 0) + 1);
  const { data: updated, error: updErr } = await admin
    .from('community_posts')
    .update({ likes: nextLikes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('likes')
    .single();
  if (updErr) throw updErr;

  return {
    likes: Math.max(0, Number(updated?.likes) || nextLikes),
    alreadyLiked: false
  };
}

/** 作者卡片库已删但社区仍在线的帖：下架（解决「删卡后社区又出现」） */
export async function unpublishOrphanSourceCardPosts(
  admin: SupabaseClient
): Promise<number> {
  const { data, error } = await admin
    .from('community_posts')
    .select('id, author_id, source_card_id')
    .eq('published', true)
    .not('source_card_id', 'is', null);
  if (error) throw error;

  const byAuthor = new Map<string, { id: string; source_card_id: string }[]>();
  for (const row of (data || []) as {
    id: string;
    author_id: string;
    source_card_id: string;
  }[]) {
    const aid = String(row.author_id || '').trim();
    const cid = String(row.source_card_id || '').trim();
    if (!aid || !cid || !isAuthorUuid(aid)) continue;
    const list = byAuthor.get(aid) || [];
    list.push({ id: row.id, source_card_id: cid });
    byAuthor.set(aid, list);
  }

  let removed = 0;
  const now = new Date().toISOString();
  for (const [authorId, posts] of byAuthor) {
    const { data: ud } = await admin
      .from('user_data')
      .select('data')
      .eq('user_id', authorId)
      .maybeSingle();
    const lib = cardLibraryIndexFromUserData(ud?.data);
    for (const p of posts) {
      if (isCardInAuthorLibrary(
        {
          id: p.id,
          author_id: authorId,
          source_card_id: p.source_card_id,
          image: null
        },
        new Map([[authorId, lib]])
      )) continue;
      const { error: upErr } = await admin
        .from('community_posts')
        .update({ published: false, updated_at: now })
        .eq('id', p.id);
      if (!upErr) removed += 1;
    }
  }
  return removed;
}

export async function adminUnpublishCommunityPost(
  admin: SupabaseClient,
  postId: string
): Promise<void> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('缺少帖子 ID');
  const { error } = await admin
    .from('community_posts')
    .update({ published: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function getCommunityAdminStats(admin: SupabaseClient) {
  const [publishedRes, unpublishedRes, withImageRes, orphanCount] = await Promise.all([
    admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('published', true),
    admin.from('community_posts').select('id', { count: 'exact', head: true }).eq('published', false),
    admin
      .from('community_posts')
      .select('id', { count: 'exact', head: true })
      .eq('published', true)
      .not('image', 'is', null)
      .neq('image', ''),
    countOrphanPublishedPosts(admin)
  ]);
  if (publishedRes.error) throw publishedRes.error;
  if (unpublishedRes.error) throw unpublishedRes.error;
  if (withImageRes.error) throw withImageRes.error;
  return {
    publishedCount: publishedRes.count ?? 0,
    unpublishedCount: unpublishedRes.count ?? 0,
    publishedWithImage: withImageRes.count ?? 0,
    orphanPublished: orphanCount
  };
}

async function countOrphanPublishedPosts(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('community_posts')
    .select('id, author_id, source_card_id, image')
    .eq('published', true)
    .limit(3000);
  if (error) throw error;

  const authorIds = [
    ...new Set(
      ((data || []) as { author_id: string }[])
        .map((r) => String(r.author_id || '').trim())
        .filter((id) => isAuthorUuid(id))
    )
  ];
  const libraryByAuthor = await loadCardLibraryByAuthor(admin, authorIds);

  let count = 0;
  for (const row of (data || []) as {
    id: string;
    author_id: string;
    source_card_id: string | null;
    image?: string | null;
  }[]) {
    if (isLibraryMissingPost(row, libraryByAuthor)) count += 1;
  }
  return count;
}

function postMatchesAdminQuery(
  row: {
    author_name: string;
    prompt: string;
    id: string;
    source_card_id: string | null;
  },
  q: string
): boolean {
  const safe = String(q || '').trim();
  if (!safe) return true;
  const lower = safe.toLowerCase();
  if (safe.includes('@')) {
    return String(row.author_name || '').toLowerCase().includes(lower);
  }
  if (/^cp_/i.test(safe) || /^card_/i.test(safe)) {
    return row.id === safe || String(row.source_card_id || '') === safe;
  }
  const prompt = String(row.prompt || '').toLowerCase();
  const name = String(row.author_name || '').toLowerCase();
  return prompt.includes(lower) || name.includes(lower);
}

type UserDataPayload = {
  cards?: { id?: string }[];
  schemaVersion?: number;
  [key: string]: unknown;
};

export async function restoreCommunityPostToUserLibrary(
  admin: SupabaseClient,
  postId: string
): Promise<{ cardId: string; userId: string; alreadyExists: boolean }> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('缺少帖子 ID');

  const { data: post, error: postErr } = await admin
    .from('community_posts')
    .select(
      'id, author_id, author_name, title, prompt, image, source_card_id, published, created_at'
    )
    .eq('id', id)
    .maybeSingle();
  if (postErr) throw postErr;
  if (!post) throw new Error('帖子不存在');

  const userId = String(post.author_id || '').trim();
  if (!isAuthorUuid(userId)) throw new Error('无效作者，无法恢复');

  const sourceCardId = String(post.source_card_id || '').trim();
  const cardId =
    sourceCardId || `card_restored_${String(post.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const { data: ud, error: udErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (udErr) throw udErr;

  const payload = ((ud?.data || {}) as UserDataPayload) || {};
  const cards = Array.isArray(payload.cards) ? [...payload.cards] : [];
  if (cards.some((c) => String(c?.id || '') === cardId)) {
    return { cardId, userId, alreadyExists: true };
  }

  const now = Date.now();
  const createdMs = post.created_at ? new Date(post.created_at).getTime() : now;
  const card = {
    id: cardId,
    title: String(post.title || '').trim().slice(0, 200),
    prompt: String(post.prompt || '').trim(),
    image: post.image || null,
    group: null,
    tags: ['#社区恢复'],
    customFields: { restoredFromCommunity: post.id },
    createdAt: createdMs,
    updatedAt: now,
    publishedToCommunity: !!post.published,
    communityPostId: post.id
  };

  cards.unshift(card);
  const { error: upsertErr } = await admin.from('user_data').upsert(
    {
      user_id: userId,
      data: { ...payload, cards, schemaVersion: payload.schemaVersion || 2 },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (upsertErr) throw upsertErr;

  return { cardId, userId, alreadyExists: false };
}

export async function restoreOrphanCommunityPosts(
  admin: SupabaseClient,
  opts?: { limit?: number; authorId?: string }
): Promise<{ restored: number; skipped: number; failed: number }> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  const { data, error } = await admin
    .from('community_posts')
    .select('id, author_id, source_card_id, image')
    .eq('published', true)
    .not('source_card_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const byAuthor = new Map<string, string[]>();
  for (const row of (data || []) as {
    id: string;
    author_id: string;
    source_card_id: string;
    image?: string | null;
  }[]) {
    const aid = String(row.author_id || '').trim();
    const cid = String(row.source_card_id || '').trim();
    if (!aid || !cid || !isAuthorUuid(aid)) continue;
    if (opts?.authorId && aid !== opts.authorId) continue;
    const list = byAuthor.get(aid) || [];
    list.push(row.id);
    byAuthor.set(aid, list);
  }

  const orphanIds: string[] = [];
  for (const [authorId, ids] of byAuthor) {
    const { data: ud } = await admin
      .from('user_data')
      .select('data')
      .eq('user_id', authorId)
      .maybeSingle();
    const lib = cardLibraryIndexFromUserData(ud?.data);
    const postRows = (data || []).filter(
      (r) => String((r as { author_id: string }).author_id) === authorId
    ) as { id: string; source_card_id: string; image?: string | null }[];
    const libMap = new Map([[authorId, lib]]);
    for (const p of postRows) {
      if (!isCardInAuthorLibrary(
        {
          id: p.id,
          author_id: authorId,
          source_card_id: p.source_card_id,
          image: p.image
        },
        libMap
      )) orphanIds.push(p.id);
    }
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  for (const pid of orphanIds.slice(0, limit)) {
    try {
      const r = await restoreCommunityPostToUserLibrary(admin, pid);
      if (r.alreadyExists) skipped += 1;
      else restored += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, skipped, failed };
}

export type CommunityAdminListItem = {
  id: string;
  authorId: string;
  authorName: string;
  sourceCardId: string | null;
  image: string | null;
  thumbUrl: string | null;
  thumbFallbackUrl: string | null;
  promptPreview: string;
  likes: number;
  published: boolean;
  cardInLibrary: boolean | null;
  createdAt: string;
};

function mapAdminPostRow(
  row: {
    id: string;
    author_id: string;
    author_name: string;
    source_card_id: string | null;
    image: string | null;
    prompt: string;
    likes: number;
    published: boolean;
    created_at: string;
  },
  cardInLibrary: boolean | null,
  apiOrigin: string
): CommunityAdminListItem {
  const thumbs = publicThumbUrls(apiOrigin, row.image);
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name || '用户',
    sourceCardId: row.source_card_id ? String(row.source_card_id) : null,
    image: row.image,
    thumbUrl: thumbs.thumbUrl,
    thumbFallbackUrl: thumbs.thumbFallbackUrl,
    promptPreview: String(row.prompt || '').trim().slice(0, 120),
    likes: row.likes ?? 0,
    published: !!row.published,
    cardInLibrary,
    createdAt: row.created_at
  };
}

function isLibraryMissingPost(
  row: {
    id?: string;
    author_id: string;
    source_card_id: string | null;
    image?: string | null;
  },
  libraryByAuthor: Map<string, CardLibraryIndex>
): boolean {
  const cid = String(row.source_card_id || '').trim();
  if (!cid) return true;
  if (!isAuthorUuid(String(row.author_id || '').trim())) return false;
  return !isCardInAuthorLibrary(row, libraryByAuthor);
}

async function loadCardLibraryByAuthor(admin: SupabaseClient, authorIds: string[]) {
  const libraryByAuthor = new Map<string, CardLibraryIndex>();
  if (!authorIds.length) return libraryByAuthor;
  for (let i = 0; i < authorIds.length; i += 100) {
    const chunk = authorIds.slice(i, i + 100);
    const { data: udRows } = await admin
      .from('user_data')
      .select('user_id, data')
      .in('user_id', chunk);
    for (const row of udRows || []) {
      libraryByAuthor.set(
        String((row as { user_id: string }).user_id),
        cardLibraryIndexFromUserData((row as { data: unknown }).data)
      );
    }
  }
  return libraryByAuthor;
}

export async function listCommunityPostsForAdmin(
  admin: SupabaseClient,
  opts: {
    limit: number;
    offset: number;
    publishedOnly?: boolean;
    q?: string;
    orphanOnly?: boolean;
    view?: 'published' | 'unpublished' | 'library-missing';
    apiOrigin?: string;
  }
): Promise<{ items: CommunityAdminListItem[]; total: number; view: string }> {
  const limit = Math.min(100, Math.max(1, opts.limit));
  const offset = Math.max(0, opts.offset);
  const q = String(opts.q || '').trim();
  const apiOrigin = String(opts.apiOrigin || '').trim();
  const view =
    opts.view
    || (opts.orphanOnly ? 'library-missing' : opts.publishedOnly === false ? 'unpublished' : 'published');

  async function loadCardIdsByAuthor(authorIds: string[]) {
    return loadCardLibraryByAuthor(admin, authorIds);
  }

  if (view === 'library-missing') {
    const { data, error } = await admin
      .from('community_posts')
      .select(
        'id, author_id, author_name, source_card_id, image, prompt, likes, published, created_at'
      )
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(3000);
    if (error) throw error;

    const authorIds = [
      ...new Set(
        ((data || []) as { author_id: string }[])
          .map((r) => String(r.author_id || '').trim())
          .filter((id) => isAuthorUuid(id))
      )
    ];
    const libraryByAuthor = await loadCardIdsByAuthor(authorIds);

    const orphans = ((data || []) as {
      id: string;
      author_id: string;
      author_name: string;
      source_card_id: string | null;
      image: string | null;
      prompt: string;
      likes: number;
      published: boolean;
      created_at: string;
    }[]).filter((row) => {
      if (!postMatchesAdminQuery(row, q)) return false;
      return isLibraryMissingPost(row, libraryByAuthor);
    });

    const slice = orphans.slice(offset, offset + limit);
    return {
      view,
      total: orphans.length,
      items: slice.map((row) => mapAdminPostRow(row, false, apiOrigin))
    };
  }

  let query = admin
    .from('community_posts')
    .select(
      'id, author_id, author_name, source_card_id, image, prompt, likes, published, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (view === 'unpublished') {
    query = query.eq('published', false);
  } else {
    query = query.eq('published', true);
  }

  if (q) {
    const safe = q.replace(/[%_,]/g, ' ').slice(0, 80);
    if (safe.includes('@')) {
      query = query.ilike('author_name', `%${safe}%`);
    } else if (/^cp_/i.test(safe) || /^card_/i.test(safe)) {
      query = query.or(`id.eq.${safe},source_card_id.eq.${safe}`);
    } else {
      query = query.or(`author_name.ilike.%${safe}%,prompt.ilike.%${safe}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const authorIds = [
    ...new Set(
      ((data || []) as { author_id: string }[])
        .map((r) => String(r.author_id || '').trim())
        .filter((id) => isAuthorUuid(id))
    )
  ];
  const libraryByAuthor = await loadCardIdsByAuthor(authorIds);

  const items = ((data || []) as {
    id: string;
    author_id: string;
    author_name: string;
    source_card_id: string | null;
    image: string | null;
    prompt: string;
    likes: number;
    published: boolean;
    created_at: string;
  }[]).map((row) => {
    const sourceCardId = row.source_card_id ? String(row.source_card_id) : null;
    let cardInLibrary: boolean | null = null;
    if (!sourceCardId) cardInLibrary = false;
    else if (isAuthorUuid(row.author_id)) {
      cardInLibrary = isCardInAuthorLibrary(row, libraryByAuthor);
    }
    return mapAdminPostRow(row, cardInLibrary, apiOrigin);
  });

  return { items, total: count ?? items.length, view };
}

export async function adminDeleteCommunityPost(
  admin: SupabaseClient,
  env: Env,
  postId: string,
  opts?: { deleteStorage?: boolean }
): Promise<{ id: string; storageRemoved: number }> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('缺少帖子 ID');

  const { data: post, error } = await admin
    .from('community_posts')
    .select('id, image, source_card_id, author_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!post) throw new Error('帖子不存在');

  const paths: string[] = [];
  const base = storagePathFromRef(String(post.image || ''));
  if (base) {
    paths.push(base);
    const grid = base.replace(/\.(jpe?g|png|webp)$/i, '_grid.jpg');
    if (grid !== base) paths.push(grid);
  }

  await admin.from('community_posts').delete().eq('id', id);

  let storageRemoved = 0;
  if (opts?.deleteStorage && paths.length) {
    const r = await deleteStoragePaths(admin, env, paths);
    storageRemoved = r.removed;
  }

  return { id, storageRemoved };
}

export type CommunityBatchResult = {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  errors: { id: string; message: string }[];
};

function normalizeBatchIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 50);
}

export async function batchRestoreCommunityPosts(
  admin: SupabaseClient,
  ids: unknown
): Promise<CommunityBatchResult> {
  const list = normalizeBatchIds(ids);
  const result: CommunityBatchResult = {
    total: list.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  for (const id of list) {
    try {
      const r = await restoreCommunityPostToUserLibrary(admin, id);
      if (r.alreadyExists) result.skipped += 1;
      else result.succeeded += 1;
    } catch (e) {
      result.failed += 1;
      result.errors.push({
        id,
        message: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return result;
}

export async function batchUnpublishCommunityPosts(
  admin: SupabaseClient,
  ids: unknown
): Promise<CommunityBatchResult> {
  const list = normalizeBatchIds(ids);
  const result: CommunityBatchResult = {
    total: list.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  for (const id of list) {
    try {
      await adminUnpublishCommunityPost(admin, id);
      result.succeeded += 1;
    } catch (e) {
      result.failed += 1;
      result.errors.push({
        id,
        message: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return result;
}

export async function batchDeleteCommunityPosts(
  admin: SupabaseClient,
  env: Env,
  ids: unknown,
  opts?: { deleteStorage?: boolean }
): Promise<CommunityBatchResult & { storageRemoved: number }> {
  const list = normalizeBatchIds(ids);
  const result: CommunityBatchResult & { storageRemoved: number } = {
    total: list.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    storageRemoved: 0
  };
  for (const id of list) {
    try {
      const r = await adminDeleteCommunityPost(admin, env, id, opts);
      result.succeeded += 1;
      result.storageRemoved += r.storageRemoved || 0;
    } catch (e) {
      result.failed += 1;
      result.errors.push({
        id,
        message: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return result;
}
