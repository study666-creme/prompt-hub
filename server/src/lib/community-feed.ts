import type { SupabaseClient } from '@supabase/supabase-js';
import {
  inferOwnerIdFromImageRef,
  isStorageRef,
  storagePathFromRef,
  toStorageRef
} from './image-archive';
import { communityImagePathCandidates, findFirstExistingStoragePath, storageObjectExistsLight } from './media-cdn';

const BUCKET = 'card-images';

export const MIN_COMMUNITY_PROMPT_LEN = 15;

function sanitizeCardFileBase(cardId: string): string {
  return String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function storageObjectExists(
  admin: SupabaseClient,
  path: string
): Promise<boolean> {
  return storageObjectExistsLight(admin, path, BUCKET);
}

/** 同步到全站前：在桶里找到真实存在的路径（与 uploadCardImage 命名一致） */
export async function resolvePublicImageRef(
  admin: SupabaseClient,
  userId: string,
  post: CommunityPostPayload
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
    if (await storageObjectExists(admin, path)) {
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
  admin: SupabaseClient
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
      const found = await findFirstExistingStoragePath(admin, candidates, BUCKET);
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
      await unpublishGhostCommunityPosts(admin);
      await unpublishDuplicateCommunityPosts(admin);
    } catch (e) {
      console.warn('[community-feed] repair skipped', e);
    }
  }
  const fetchLimit = Math.min(200, Math.max(limit + offset, limit * 2));
  const { data, error } = await admin
    .from('community_posts')
    .select(
      'id, author_id, author_name, title, prompt, image, likes, source_card_id, published, created_at, updated_at'
    )
    .eq('published', true)
    .order('created_at', { ascending: false })
    .range(0, fetchLimit - 1);

  if (error) throw error;
  const deduped = dedupeCommunityFeedPosts((data as CommunityRow[]).map(mapRowToDto));
  return deduped
    .filter((p) => String(p.image || '').trim())
    .slice(offset, offset + limit);
}

export async function upsertCommunityPost(
  admin: SupabaseClient,
  userId: string,
  post: CommunityPostPayload
): Promise<CommunityPostDto> {
  const err = validatePostPayload(post);
  if (err) throw new Error(err);

  const now = new Date().toISOString();
  const created =
    post.createdAt && post.createdAt > 0
      ? new Date(post.createdAt).toISOString()
      : now;

  const resolvedImage = await resolvePublicImageRef(admin, userId, post);
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
  posts: CommunityPostPayload[]
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
      await upsertCommunityPost(admin, userId, { ...p, authorName });
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
