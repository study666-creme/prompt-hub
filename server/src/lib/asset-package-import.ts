import type { SupabaseClient } from '@supabase/supabase-js';
import { isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';
import { ApiError } from './errors';
import type { Profile } from './supabase';
import { isMembershipActive } from './supabase';

const BUCKET = 'card-images';
const FREE_CARD_LIMIT = 100;

export type PackCard = {
  id: string;
  title?: string;
  prompt?: string;
  image?: string | null;
  group?: string | null;
  tags?: string[];
};

function generateCardId(): string {
  return `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePackCards(raw: unknown): PackCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const o = c as PackCard;
      const id = String(o.id || '').trim();
      if (!id) return null;
      return {
        id,
        title: String(o.title || '').slice(0, 200),
        prompt: String(o.prompt || '').slice(0, 8000),
        image: o.image != null ? String(o.image) : null,
        group: o.group != null ? String(o.group).slice(0, 80) : null,
        tags: Array.isArray(o.tags) ? o.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : []
      };
    })
    .filter(Boolean) as PackCard[];
}

async function copyStorageImage(
  admin: SupabaseClient,
  srcRef: string | null | undefined,
  destUserId: string,
  destCardId: string
): Promise<string | null> {
  const srcPath = storagePathFromRef(String(srcRef || ''));
  if (!srcPath) return typeof srcRef === 'string' && /^https?:\/\//i.test(srcRef) ? srcRef : null;
  const ext = srcPath.includes('.png') ? 'png' : srcPath.includes('.webp') ? 'webp' : 'jpg';
  const destPath = `${destUserId}/${destCardId}.${ext}`;

  const { error: copyErr } = await admin.storage.from(BUCKET).copy(srcPath, destPath);
  if (!copyErr) return toStorageRef(destPath);

  const { data: sign } = await admin.storage.from(BUCKET).createSignedUrl(srcPath, 120);
  if (!sign?.signedUrl) return null;
  const res = await fetch(sign.signedUrl);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) return null;
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const { error: upErr } = await admin.storage.from(BUCKET).upload(destPath, buf, {
    upsert: true,
    contentType
  });
  if (upErr) return null;
  return toStorageRef(destPath);
}

export async function assertPackageEntitlement(
  admin: SupabaseClient,
  userId: string,
  packageId: string
): Promise<void> {
  const { data, error } = await admin
    .from('asset_package_entitlements')
    .select('package_id')
    .eq('user_id', userId)
    .eq('package_id', packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(403, 'FORBIDDEN', '请先领取或购买该资产包');
}

export async function getPackageCardsPayload(
  admin: SupabaseClient,
  userId: string,
  packageId: string
): Promise<{ title: string; commercialUseAllowed: boolean; cards: PackCard[] }> {
  await assertPackageEntitlement(admin, userId, packageId);
  const { data, error } = await admin.from('asset_packages').select('*').eq('id', packageId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'NOT_FOUND', '资产包不存在');
  const cards = normalizePackCards(data.cards_payload);
  if (!cards.length) throw new ApiError(404, 'EMPTY_PACKAGE', '该资产包暂无卡片内容');
  return {
    title: String(data.title || '资产包'),
    commercialUseAllowed: !!data.commercial_use_allowed,
    cards
  };
}

export async function importAssetPackageToWarehouse(
  admin: SupabaseClient,
  userId: string,
  profile: Profile,
  packageId: string,
  warehouseId: string
): Promise<{ imported: number; cardIds: string[] }> {
  const { cards, title } = await getPackageCardsPayload(admin, userId, packageId);
  const wid = String(warehouseId || 'default').slice(0, 64);

  const { data: row, error: pullErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (pullErr) throw pullErr;

  const payload = (row?.data || {}) as { cards?: Array<Record<string, unknown>>; schemaVersion?: number };
  const existing = Array.isArray(payload.cards) ? [...payload.cards] : [];
  if (!isMembershipActive(profile) && existing.length + cards.length > FREE_CARD_LIMIT) {
    throw new ApiError(402, 'CARD_LIMIT', `导入后将超过普通用户 ${FREE_CARD_LIMIT} 张上限，请开通会员或删除旧卡`);
  }

  const now = Date.now();
  const newIds: string[] = [];
  const importedCards: Array<Record<string, unknown>> = [];

  for (const src of cards) {
    const newId = generateCardId();
    let image: string | null = src.image || null;
    if (image && isStorageRef(image)) {
      image = await copyStorageImage(admin, image, userId, newId);
    }
    importedCards.push({
      id: newId,
      title: src.title || src.prompt?.slice(0, 48) || '未命名',
      prompt: src.prompt || src.title || '',
      image,
      group: src.group || null,
      tags: src.tags || [],
      customFields: { assetPackageId: packageId, assetPackageTitle: title },
      warehouseId: wid,
      createdAt: now,
      updatedAt: now,
      publishedToCommunity: false,
      communityPostId: null
    });
    newIds.push(newId);
  }

  const nextPayload = {
    ...payload,
    cards: [...importedCards, ...existing],
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
  if (upsertErr) throw upsertErr;

  return { imported: importedCards.length, cardIds: newIds };
}

export async function signPreviewImagesForPackage(
  admin: SupabaseClient,
  previewCardIds: string[],
  cardsPayload: unknown
): Promise<Array<{ cardId: string; label: string; imageUrl: string | null }>> {
  const cards = normalizePackCards(cardsPayload);
  const idSet = new Set(previewCardIds.map(String));
  const picks = cards.filter((c) => idSet.has(c.id)).slice(0, 4);
  const fallback = cards.slice(0, 4);
  const list = picks.length ? picks : fallback;

  const out: Array<{ cardId: string; label: string; imageUrl: string | null }> = [];
  for (const c of list) {
    let imageUrl: string | null = null;
    const path = storagePathFromRef(String(c.image || ''));
    if (path) {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
      imageUrl = data?.signedUrl || null;
    } else if (c.image && /^https?:\/\//i.test(c.image)) {
      imageUrl = c.image;
    }
    out.push({
      cardId: c.id,
      label: (c.title || c.prompt || '预览').slice(0, 40),
      imageUrl
    });
  }
  return out;
}

export { normalizePackCards };
