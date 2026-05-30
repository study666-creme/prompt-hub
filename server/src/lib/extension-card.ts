import type { SupabaseClient } from '@supabase/supabase-js';
import { isMembershipActive, type Profile } from './supabase';

const BUCKET = 'card-images';
const FREE_CARD_LIMIT = 100;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROMPT_LEN = 20000;

export type QuickCardInput = {
  prompt: string;
  title?: string;
  imageBase64?: string | null;
  sourceUrl?: string | null;
};

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

type UserDataPayload = {
  cards?: Array<Record<string, unknown>>;
  customGroups?: unknown[];
  globalFields?: unknown[];
  settings?: Record<string, unknown>;
  schemaVersion?: number;
  [key: string]: unknown;
};

export async function appendQuickCard(
  admin: SupabaseClient,
  userId: string,
  profile: Profile,
  input: QuickCardInput
): Promise<{ cardId: string; cardCount: number }> {
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

  const card = {
    id: cardId,
    title,
    prompt: prompt || title,
    image,
    group: null,
    tags: input.sourceUrl ? ['#浏览器插件'] : [],
    customFields: input.sourceUrl ? { extSourceUrl: String(input.sourceUrl).slice(0, 500) } : {},
    createdAt: now,
    updatedAt: now,
    publishedToCommunity: false
  };

  cards.unshift(card);
  const nextPayload: UserDataPayload = {
    ...payload,
    cards,
    schemaVersion: payload.schemaVersion || 2
  };

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

  return { cardId, cardCount: cards.length };
}
