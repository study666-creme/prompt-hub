import type { SupabaseClient } from '@supabase/supabase-js';
import { isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';
import { ApiError } from './errors';
import { encodeStoragePath, isAllowedCommunityMediaPath } from './media-cdn';
import { assertStorageDelta } from './storage-quota';
import type { Profile } from './supabase';

const BUCKET = 'card-images';
const MEDIA_CDN_ORIGIN = 'https://api.prompt-hub.cn';

/** 导入时无法精确得知复制后体积，按每张有图卡片估算 */
const IMPORT_IMAGE_BYTES_ESTIMATE = 2 * 1024 * 1024;

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
  warehouseId: string,
  folders?: string[] | null,
  cardIds?: string[] | null
): Promise<{ imported: number; cardIds: string[]; groups: string[] }> {
  const { cards, title } = await getPackageCardsPayload(admin, userId, packageId);
  const folderFilter =
    Array.isArray(folders) && folders.length
      ? new Set(folders.map((f) => String(f || '').trim()).filter(Boolean))
      : null;
  const cardIdFilter =
    Array.isArray(cardIds) && cardIds.length
      ? new Set(cardIds.map((id) => String(id || '').trim()).filter(Boolean))
      : null;
  let toImport = cards;
  if (cardIdFilter) {
    toImport = cards.filter((c) => cardIdFilter.has(String(c.id)));
  } else if (folderFilter) {
    toImport = cards.filter((c) => folderFilter.has(String(c.group || '').trim() || '未分类'));
  }
  if (!toImport.length) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      cardIdFilter ? '所选卡片无法导入' : '所选文件夹中没有可导入的卡片'
    );
  }
  const wid = String(warehouseId || 'default').slice(0, 64);

  const { data: row, error: pullErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (pullErr) throw pullErr;

  const payload = (row?.data || {}) as { cards?: Array<Record<string, unknown>>; schemaVersion?: number };
  const existing = Array.isArray(payload.cards) ? [...payload.cards] : [];
  const importBytesEst = toImport.filter((c) => c.image).length * IMPORT_IMAGE_BYTES_ESTIMATE;
  try {
    assertStorageDelta(profile, importBytesEst);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '云存储空间不足';
    throw new ApiError(402, 'STORAGE_QUOTA', msg);
  }

  const now = Date.now();
  const newIds: string[] = [];
  const importedCards: Array<Record<string, unknown>> = [];

  for (const src of toImport) {
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

  const groups = [
    ...new Set(
      importedCards
        .map((c) => (c.group != null ? String(c.group).trim() : ''))
        .filter(Boolean)
    )
  ];
  return { imported: importedCards.length, cardIds: newIds, groups };
}

const PACK_FOLDER_PREVIEW_MAX = 5;

async function signPackCardImage(
  _admin: SupabaseClient,
  imageRef: string | null | undefined
): Promise<string | null> {
  const path = storagePathFromRef(String(imageRef || ''));
  if (path && isAllowedCommunityMediaPath(path)) {
    return `${MEDIA_CDN_ORIGIN}/api/v1/media/c/${encodeStoragePath(path)}`;
  }
  if (imageRef && /^https?:\/\//i.test(String(imageRef))) return String(imageRef);
  return null;
}

export async function getPackageFolderImages(
  admin: SupabaseClient,
  packageId: string,
  folderName: string,
  userId: string | null
): Promise<{
  folder: string;
  fullAccess: boolean;
  items: Array<{ cardId: string; label: string; imageUrl: string | null }>;
}> {
  const { data, error } = await admin
    .from('asset_packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'NOT_FOUND', '资产包不存在');

  const row = data as { author_id: string; status: string; cards_payload: unknown; preview_card_ids: unknown };
  const cards = normalizePackCards(row.cards_payload);
  const folder = String(folderName || '').trim() || '未分类';
  const inFolder = cards.filter((c) => (String(c.group || '').trim() || '未分类') === folder);

  let fullAccess = false;
  if (userId) {
    if (String(row.author_id) === String(userId)) fullAccess = true;
    else {
      const { data: ent } = await admin
        .from('asset_package_entitlements')
        .select('package_id')
        .eq('user_id', userId)
        .eq('package_id', packageId)
        .maybeSingle();
      fullAccess = !!ent;
    }
  }
  if (row.status !== 'published' && !fullAccess) {
    throw new ApiError(404, 'NOT_FOUND', '资产包不存在');
  }

  const previewIds = new Set(
    (Array.isArray(row.preview_card_ids) ? row.preview_card_ids : []).map(String).filter(Boolean)
  );
  const picks = fullAccess
    ? inFolder
    : inFolder.filter((c) => previewIds.has(c.id)).slice(0, PACK_FOLDER_PREVIEW_MAX);

  const items: Array<{ cardId: string; label: string; imageUrl: string | null }> = [];
  for (const c of picks) {
    items.push({
      cardId: c.id,
      label: (c.title || c.prompt || '预览').slice(0, 40),
      imageUrl: await signPackCardImage(admin, c.image)
    });
  }

  return { folder, fullAccess, items };
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

  return Promise.all(
    list.map(async (c) => {
      let imageUrl: string | null = null;
      const path = storagePathFromRef(String(c.image || ''));
      if (path && isAllowedCommunityMediaPath(path)) {
        imageUrl = `${MEDIA_CDN_ORIGIN}/api/v1/media/c/${encodeStoragePath(path)}`;
      } else if (c.image && /^https?:\/\//i.test(c.image)) {
        imageUrl = c.image;
      }
      return {
        cardId: c.id,
        label: (c.title || c.prompt || '预览').slice(0, 40),
        imageUrl
      };
    })
  );
}

export { normalizePackCards };
