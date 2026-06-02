import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_COMMUNITY_PROMPT_LEN, upsertCommunityPost } from './community-feed';
import { isMembershipActive, type Profile } from './supabase';

const BUCKET = 'card-images';
const FREE_CARD_LIMIT = 100;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROMPT_LEN = 20000;
const COMMUNITY_COLLECT_TAG = '社区收藏';

function isCommunityCollectTagName(raw: string): boolean {
  return String(raw || '').replace(/^#+/, '').trim() === COMMUNITY_COLLECT_TAG;
}

export type QuickCardInput = {
  prompt: string;
  title?: string;
  imageBase64?: string | null;
  sourceUrl?: string | null;
  tags?: string[];
  publishToCommunity?: boolean;
};

export type QuickCardResult = {
  cardId: string;
  cardCount: number;
  publishedToCommunity: boolean;
  communityPostId: string | null;
  publishNote?: string | null;
};

type UserDataPayload = {
  cards?: Array<Record<string, unknown>>;
  customGroups?: unknown[];
  globalFields?: unknown[];
  settings?: Record<string, unknown>;
  schemaVersion?: number;
  [key: string]: unknown;
};

function isCommunityPromptEligible(prompt: string): boolean {
  return String(prompt || '').trim().length >= MIN_COMMUNITY_PROMPT_LEN;
}

export function readDefaultPublishCommunity(payload: UserDataPayload): boolean {
  const settings = payload.settings;
  if (!settings || typeof settings !== 'object') return true;
  return (settings as { defaultPublishCommunity?: boolean }).defaultPublishCommunity !== false;
}

export function readShowTrimBlackBorderTool(payload: UserDataPayload): boolean {
  const settings = payload.settings;
  if (!settings || typeof settings !== 'object') return false;
  return (settings as { showTrimBlackBorderTool?: boolean }).showTrimBlackBorderTool === true;
}

function normalizeTag(raw: string): string {
  const t = String(raw || '').trim().replace(/^#+/, '');
  if (!t) return '';
  return `#${t.slice(0, 40)}`;
}

function normalizeTags(list?: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list || []) {
    const t = normalizeTag(raw);
    if (t && !isCommunityCollectTagName(t)) out.add(t);
  }
  return [...out];
}

export function collectUserTags(payload: UserDataPayload): string[] {
  const set = new Set<string>();
  for (const c of payload.cards || []) {
    const tags = (c as { tags?: string[] }).tags;
    if (!Array.isArray(tags)) continue;
    for (const raw of tags) {
      const t = normalizeTag(String(raw));
      if (t && !isCommunityCollectTagName(t)) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function listUserTags(
  admin: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data: row, error } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return collectUserTags((row?.data || {}) as UserDataPayload);
}

function generateCardId(): string {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function cardStoragePath(userId: string, cardId: string): string {
  const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${userId}/${base}.jpg`;
}

function decodeBase64Image(raw: string): Uint8Array {
  const m = raw.match(/^data:image\/[\w+.-]+;base64,(.+)$/i);
  const body = m ? m[1] : raw;
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length) throw new Error('图片数据无效');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片过大（最大 5MB）');
  return bytes;
}

async function uploadCardImage(
  admin: SupabaseClient,
  userId: string,
  cardId: string,
  imageBase64: string
): Promise<string> {
  const path = cardStoragePath(userId, cardId);
  const bytes = decodeBase64Image(imageBase64);
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true
  });
  if (error) throw error;
  return `storage://${BUCKET}/${path}`;
}

export async function appendQuickCard(
  admin: SupabaseClient,
  userId: string,
  profile: Profile,
  input: QuickCardInput
): Promise<QuickCardResult> {
  const prompt = String(input.prompt || '').trim();
  if (!prompt && !input.imageBase64) {
    throw new Error('请填写提示词或添加图片');
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    throw new Error('提示词过长');
  }

  const { data: row, error: pullErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (pullErr) throw pullErr;

  const payload = (row?.data || {}) as UserDataPayload;
  const cards = Array.isArray(payload.cards) ? [...payload.cards] : [];

  if (!isMembershipActive(profile) && cards.length >= FREE_CARD_LIMIT) {
    throw new Error(`普通用户最多 ${FREE_CARD_LIMIT} 张卡片，请开通会员或删除旧卡`);
  }

  const now = Date.now();
  const cardId = generateCardId();
  let image: string | null = null;
  if (input.imageBase64) {
    image = await uploadCardImage(admin, userId, cardId, input.imageBase64);
  }

  const title =
    String(input.title || '').trim().slice(0, 200)
    || (prompt ? prompt.slice(0, 48) : '网页摘录');

  let tags = normalizeTags(input.tags);
  if (!tags.length && input.sourceUrl) tags = ['#浏览器插件'];

  const wantPublish = input.publishToCommunity === true;
  let publishedToCommunity = false;
  let communityPostId: string | null = null;
  let publishNote: string | null = null;

  if (wantPublish) {
    if (!isCommunityPromptEligible(prompt)) {
      publishNote = `公开到社区需要提示词至少 ${MIN_COMMUNITY_PROMPT_LEN} 字，已仅保存到仓库`;
    } else if (!image) {
      publishNote = '公开到社区需要配图，已仅保存到仓库';
    } else {
      publishedToCommunity = true;
      communityPostId = `cp_${cardId}`;
    }
  }

  const card = {
    id: cardId,
    title,
    prompt: prompt || title,
    image,
    group: null,
    tags,
    customFields: input.sourceUrl ? { extSourceUrl: String(input.sourceUrl).slice(0, 500) } : {},
    createdAt: now,
    updatedAt: now,
    publishedToCommunity,
    communityPostId
  };

  cards.unshift(card);
  const nextPayload: UserDataPayload = {
    ...payload,
    cards,
    schemaVersion: payload.schemaVersion || 2
  };

  const upsertUserData = async () => {
    const { error: upsertErr } = await admin.from('user_data').upsert(
      {
        user_id: userId,
        data: nextPayload,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (upsertErr) {
      const msg = String(upsertErr.message || upsertErr);
      if (/permission denied.*user_data/i.test(msg)) {
        throw new Error(
          'DB_PERMISSION: 请在 Supabase 执行 supabase/migrations/20260530100000_user_data_service_role.sql'
        );
      }
      throw upsertErr;
    }
  };

  await upsertUserData();

  if (publishedToCommunity && communityPostId && image) {
    try {
      await upsertCommunityPost(admin, userId, {
        id: communityPostId,
        sourceCardId: cardId,
        authorName: String(profile.display_name || '用户').slice(0, 80),
        title,
        prompt: prompt || title,
        image,
        likes: 0,
        createdAt: now,
        updatedAt: now
      });
    } catch (e) {
      card.publishedToCommunity = false;
      card.communityPostId = null;
      publishedToCommunity = false;
      communityPostId = null;
      publishNote = `已保存到仓库；公开失败：${String((e as Error).message || e).slice(0, 80)}`;
      nextPayload.cards = cards;
      await upsertUserData();
    }
  }

  return {
    cardId,
    cardCount: cards.length,
    publishedToCommunity,
    communityPostId,
    publishNote
  };
}
