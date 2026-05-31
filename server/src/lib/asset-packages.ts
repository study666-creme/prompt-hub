import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDisplayName } from './display-name';
import { ApiError } from './errors';
import {
  normalizePackCards,
  signPreviewImagesForPackage,
  type PackCard
} from './asset-package-import';

export type AssetPackageRow = {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  description: string;
  tag: string;
  price_cents: number;
  sale_type: 'bulk' | 'buyout';
  commercial_use_allowed: boolean;
  count_label: string;
  license_text: string;
  preview_tree: unknown;
  preview_thumbs: unknown;
  source_warehouse_id?: string | null;
  source_warehouse_name?: string | null;
  preview_card_ids?: unknown;
  cards_payload?: unknown;
  status: string;
  created_at: string;
  updated_at: string;
};

export function buildLicenseText(commercialUseAllowed: boolean, saleType: 'bulk' | 'buyout'): string {
  if (saleType === 'buyout') {
    return commercialUseAllowed
      ? '买断后购买者获得独占使用权，可将包内图片、提示词及文档用于个人与商业项目。'
      : '买断后购买者获得独占使用权，仅限个人与非商用创作，禁止商业使用与二次售卖。';
  }
  return commercialUseAllowed
    ? '购买者可将包内图片、提示词及附属文档用于个人与商业项目。'
    : '购买者仅可将包内内容用于个人学习与非商用创作，禁止商业使用与二次售卖。';
}

export function formatPriceLabel(priceCents: number): string {
  if (!priceCents) return '免费';
  const yuan = priceCents / 100;
  return yuan % 1 === 0 ? `¥${yuan.toFixed(0)}` : `¥${yuan.toFixed(2)}`;
}

function normalizePreviewTree(raw: unknown): Array<{ name: string; children?: unknown[] }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((node) => {
      if (!node || typeof node !== 'object') return null;
      const n = node as { name?: string; children?: unknown[] };
      const name = String(n.name || '').trim();
      if (!name) return null;
      const children = Array.isArray(n.children)
        ? n.children.map((c) => (typeof c === 'string' ? c : String((c as { name?: string })?.name || ''))).filter(Boolean)
        : undefined;
      return children?.length ? { name, children } : { name };
    })
    .filter(Boolean) as Array<{ name: string; children?: unknown[] }>;
}

function normalizePreviewThumbs(raw: unknown): Array<{ label: string; hue: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t, i) => {
      if (!t || typeof t !== 'object') return null;
      const o = t as { label?: string; hue?: number };
      const label = String(o.label || `预览 ${i + 1}`).trim();
      const hue = Number.isFinite(Number(o.hue)) ? Number(o.hue) : (i * 67) % 360;
      return { label, hue };
    })
    .filter(Boolean) as Array<{ label: string; hue: number }>;
}

export function mapAssetPackage(row: AssetPackageRow, opts: { owned?: boolean; isAuthor?: boolean } = {}) {
  const priceCents = Number(row.price_cents) || 0;
  const saleType = row.sale_type === 'buyout' ? 'buyout' : 'bulk';
  const cards = normalizePackCards(row.cards_payload);
  const previewIds = Array.isArray(row.preview_card_ids)
    ? row.preview_card_ids.map(String).filter(Boolean)
    : [];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tag: row.tag,
    priceCents,
    priceLabel: formatPriceLabel(priceCents),
    saleType,
    commercialUseAllowed: !!row.commercial_use_allowed,
    countLabel: row.count_label || (cards.length ? `${cards.length} 张卡片` : ''),
    license: row.license_text || buildLicenseText(!!row.commercial_use_allowed, saleType),
    previewTree: normalizePreviewTree(row.preview_tree),
    previewThumbs: normalizePreviewThumbs(row.preview_thumbs),
    previewCardIds: previewIds,
    cardCount: cards.length,
    sourceWarehouseId: row.source_warehouse_id || null,
    sourceWarehouseName: row.source_warehouse_name || null,
    previewImages: [] as Array<{ cardId: string; label: string; imageUrl: string | null }>,
    authorId: row.author_id,
    authorName: row.author_name,
    status: row.status,
    owned: !!opts.owned,
    isAuthor: !!opts.isAuthor,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function enrichPackagePreview(
  admin: SupabaseClient,
  row: AssetPackageRow,
  pkg: ReturnType<typeof mapAssetPackage>
) {
  const previewIds = Array.isArray(row.preview_card_ids)
    ? row.preview_card_ids.map(String).filter(Boolean)
    : [];
  pkg.previewImages = await signPreviewImagesForPackage(admin, previewIds, row.cards_payload);
  return pkg;
}

function buildPreviewTreeFromCards(cards: PackCard[], previewIds: string[]) {
  const previewSet = new Set(previewIds);
  const groups = new Map<string, string[]>();
  for (const c of cards) {
    const g = c.group || '未分类';
    const name = (c.title || c.prompt || '未命名').slice(0, 28);
    const label = `${name}${previewSet.has(c.id) ? ' · 可预览' : ' · 领取后可见'}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(label);
  }
  if (!groups.size) {
    return [{ name: '包内卡片', children: ['领取后可见'] }];
  }
  return Array.from(groups.entries()).map(([name, children]) => ({ name, children }));
}

export function newPackageId(): string {
  return `pkg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listPublishedAssetPackages(
  admin: SupabaseClient,
  userId?: string | null
) {
  const { data, error } = await admin
    .from('asset_packages')
    .select('*')
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation.*asset_packages|does not exist/i.test(error.message || '')) {
      throw new ApiError(
        503,
        'DB_MIGRATION_REQUIRED',
        '资产包表未创建，请在 Supabase 运行 supabase/migrations/20260530120000_asset_packages.sql'
      );
    }
    throw error;
  }

  let owned = new Set<string>();
  if (userId) {
    const { data: ents } = await admin
      .from('asset_package_entitlements')
      .select('package_id')
      .eq('user_id', userId);
    owned = new Set((ents || []).map((e) => String(e.package_id)));
  }

  return Promise.all(
    (data as AssetPackageRow[] | null || []).map(async (row) => {
      const pkg = mapAssetPackage(row, {
        owned: owned.has(row.id),
        isAuthor: userId ? String(row.author_id) === String(userId) : false
      });
      return enrichPackagePreview(admin, row, pkg);
    })
  );
}

export async function getAssetPackageById(admin: SupabaseClient, id: string, userId?: string | null) {
  const { data, error } = await admin.from('asset_packages').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as AssetPackageRow;
  if (row.status !== 'published' && (!userId || String(row.author_id) !== String(userId))) {
    return null;
  }
  let owned = false;
  if (userId) {
    const { data: ent } = await admin
      .from('asset_package_entitlements')
      .select('package_id')
      .eq('user_id', userId)
      .eq('package_id', id)
      .maybeSingle();
    owned = !!ent;
  }
  const pkg = mapAssetPackage(row, { owned, isAuthor: userId ? String(row.author_id) === String(userId) : false });
  return enrichPackagePreview(admin, row, pkg);
}

export async function listEntitlementsForUser(
  admin: SupabaseClient,
  userId: string,
  sourceFilter?: 'owned' | 'published'
) {
  if (sourceFilter === 'published') {
    const { data, error } = await admin
      .from('asset_packages')
      .select('*')
      .eq('author_id', userId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return Promise.all(
      (data as AssetPackageRow[] | null || []).map(async (row) => {
        const pkg = mapAssetPackage(row, { owned: true, isAuthor: true });
        return enrichPackagePreview(admin, row, pkg);
      })
    );
  }

  const { data: ents, error: entErr } = await admin
    .from('asset_package_entitlements')
    .select('package_id, source, acquired_at')
    .eq('user_id', userId)
    .order('acquired_at', { ascending: false });
  if (entErr) throw entErr;
  const ids = (ents || []).map((e) => String(e.package_id)).filter(Boolean);
  if (!ids.length) return [];

  const { data, error } = await admin.from('asset_packages').select('*').in('id', ids);
  if (error) throw error;
  const byId = new Map((data as AssetPackageRow[] | null || []).map((r) => [r.id, r]));
  return Promise.all(
    ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(async (row) => {
        const pkg = mapAssetPackage(row as AssetPackageRow, { owned: true });
        return enrichPackagePreview(admin, row as AssetPackageRow, pkg);
      })
  );
}

export async function createAssetPackage(
  admin: SupabaseClient,
  userId: string,
  profile: { display_name?: string | null; user_id: string },
  input: {
    title: string;
    description?: string;
    tag?: string;
    priceCents?: number;
    saleType?: 'bulk' | 'buyout';
    commercialUseAllowed?: boolean;
    countLabel?: string;
    previewTree?: unknown;
    previewThumbs?: unknown;
    sourceWarehouseId?: string;
    sourceWarehouseName?: string;
    previewCardIds?: string[];
    cards?: PackCard[];
  }
) {
  const authorName = resolveDisplayName(profile);
  const saleType = input.saleType === 'buyout' ? 'buyout' : 'bulk';
  const commercialUseAllowed = input.commercialUseAllowed !== false;
  const priceCents = Math.max(0, Math.floor(Number(input.priceCents) || 0));
  const cards = normalizePackCards(input.cards);
  if (!cards.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请至少选择一张卡片加入资产包');
  }
  const previewCardIds = (input.previewCardIds?.length ? input.previewCardIds : cards.slice(0, 4).map((c) => c.id))
    .map(String)
    .filter((id) => cards.some((c) => c.id === id))
    .slice(0, 8);
  const countLabel =
    String(input.countLabel || '').trim() || `${cards.length} 张卡片${cards.some((c) => c.prompt) ? ' + 提示词' : ''}`;
  const previewTree = input.previewTree
    ? normalizePreviewTree(input.previewTree)
    : buildPreviewTreeFromCards(cards, previewCardIds);
  const id = newPackageId();
  const row = {
    id,
    author_id: userId,
    author_name: authorName.slice(0, 80),
    title: input.title.slice(0, 120),
    description: String(input.description || '').slice(0, 2000),
    tag: String(input.tag || (priceCents ? '套装' : '免费')).slice(0, 40),
    price_cents: priceCents,
    sale_type: saleType,
    commercial_use_allowed: commercialUseAllowed,
    count_label: countLabel.slice(0, 120),
    license_text: buildLicenseText(commercialUseAllowed, saleType),
    preview_tree: previewTree,
    preview_thumbs: normalizePreviewThumbs(input.previewThumbs),
    source_warehouse_id: input.sourceWarehouseId ? String(input.sourceWarehouseId).slice(0, 64) : null,
    source_warehouse_name: input.sourceWarehouseName ? String(input.sourceWarehouseName).slice(0, 80) : null,
    preview_card_ids: previewCardIds,
    cards_payload: cards,
    status: 'published',
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin.from('asset_packages').insert(row).select('*').single();
  if (error) throw error;

  await admin.from('asset_package_entitlements').upsert(
    {
      user_id: userId,
      package_id: id,
      source: 'author',
      acquired_at: new Date().toISOString()
    },
    { onConflict: 'user_id,package_id' }
  );

  return enrichPackagePreview(
    admin,
    data as AssetPackageRow,
    mapAssetPackage(data as AssetPackageRow, { owned: true, isAuthor: true })
  );
}

export async function updateAssetPackage(
  admin: SupabaseClient,
  userId: string,
  packageId: string,
  patch: {
    title?: string;
    description?: string;
    tag?: string;
    priceCents?: number;
    saleType?: 'bulk' | 'buyout';
    commercialUseAllowed?: boolean;
    countLabel?: string;
    previewTree?: unknown;
    previewThumbs?: unknown;
    status?: 'published' | 'archived';
  }
) {
  const { data: existing, error: loadErr } = await admin
    .from('asset_packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!existing) throw new ApiError(404, 'NOT_FOUND', '资产包不存在');
  if (String((existing as AssetPackageRow).author_id) !== String(userId)) {
    throw new ApiError(403, 'FORBIDDEN', '只能编辑自己发布的资产包');
  }

  const cur = existing as AssetPackageRow;
  const saleType = patch.saleType === 'buyout' ? 'buyout' : patch.saleType === 'bulk' ? 'bulk' : cur.sale_type;
  const commercialUseAllowed =
    patch.commercialUseAllowed === undefined ? !!cur.commercial_use_allowed : patch.commercialUseAllowed !== false;
  const priceCents =
    patch.priceCents === undefined ? Number(cur.price_cents) || 0 : Math.max(0, Math.floor(Number(patch.priceCents) || 0));

  const next = {
    title: patch.title != null ? String(patch.title).slice(0, 120) : cur.title,
    description: patch.description != null ? String(patch.description).slice(0, 2000) : cur.description,
    tag: patch.tag != null ? String(patch.tag).slice(0, 40) : cur.tag,
    price_cents: priceCents,
    sale_type: saleType,
    commercial_use_allowed: commercialUseAllowed,
    count_label: patch.countLabel != null ? String(patch.countLabel).slice(0, 120) : cur.count_label,
    license_text: buildLicenseText(commercialUseAllowed, saleType),
    preview_tree:
      patch.previewTree !== undefined ? normalizePreviewTree(patch.previewTree) : cur.preview_tree,
    preview_thumbs:
      patch.previewThumbs !== undefined ? normalizePreviewThumbs(patch.previewThumbs) : cur.preview_thumbs,
    status: patch.status === 'archived' ? 'archived' : patch.status === 'published' ? 'published' : cur.status,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from('asset_packages')
    .update(next)
    .eq('id', packageId)
    .select('*')
    .single();
  if (error) throw error;
  return mapAssetPackage(data as AssetPackageRow, { owned: true, isAuthor: true });
}

export async function claimAssetPackage(admin: SupabaseClient, userId: string, packageId: string) {
  const pkg = await getAssetPackageById(admin, packageId, userId);
  if (!pkg) throw new ApiError(404, 'NOT_FOUND', '资产包不存在或已下架');

  const { data: existing } = await admin
    .from('asset_package_entitlements')
    .select('package_id')
    .eq('user_id', userId)
    .eq('package_id', packageId)
    .maybeSingle();
  if (existing) {
    return { package: pkg, alreadyOwned: true };
  }

  if (pkg.priceCents > 0) {
    throw new ApiError(402, 'PAYMENT_REQUIRED', '付费资产包即将开放，当前仅支持免费领取');
  }

  const { error } = await admin.from('asset_package_entitlements').insert({
    user_id: userId,
    package_id: packageId,
    source: 'claim',
    acquired_at: new Date().toISOString()
  });
  if (error) throw error;

  return { package: { ...pkg, owned: true }, alreadyOwned: false };
}
