import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IMAGE_MODEL_CATALOG,
  catalogById,
  getCatalogEntry,
  normalizeImageModelId,
  providerLabel,
  type ImageModelCatalogEntry,
  type MjSpeedKey
} from './image-models-catalog';
import {
  buildUpstreamCostLines,
  formatUpstreamCostCell,
  normalizeMjSpeed
} from './apimart-upstream-cost';
import {
  buildGrsaiUpstreamCostLines,
  formatGrsaiUpstreamCostCell
} from './grsai-upstream-cost';
import type { Profile } from './supabase';
import { applyMemberCreditDiscount, clampCreditsValue, roundCredits } from './credit-math';
import { membershipGenDiscountLabel, membershipGenMultiplier } from './supabase';

export const IMAGE_MODEL_SETTINGS_KEY = 'image_model_pricing';

/** active=可生图；maintenance=前台可见但不可选；offline=下架隐藏 */
export type ImageModelStatus = 'active' | 'maintenance' | 'offline';

export type ImageResolutionKey = '1k' | '2k' | '4k';

export type ImageModelOverride = {
  /** 仅前台展示名，不改上游 model id */
  displayName?: string;
  status?: ImageModelStatus;
  /** @deprecated 用 status=offline；保留兼容旧数据 */
  enabled?: boolean;
  creditsPerCall?: number;
  /** Apimart GPT Image 2：按分辨率定价 */
  creditsByResolution?: Partial<Record<ImageResolutionKey, number>>;
  /** MJ Imagine：按 relax / fast / turbo 定价 */
  creditsBySpeed?: Partial<Record<MjSpeedKey, number>>;
  /** 单档售价的活动价；不填则无活动价 */
  promoPrice?: number;
  /** 多分辨率模型的活动价（按 1k/2k/4k） */
  promoByResolution?: Partial<Record<ImageResolutionKey, number>>;
  /** MJ 按 speed 的活动价 */
  promoBySpeed?: Partial<Record<MjSpeedKey, number>>;
  /** @deprecated 已改为 promoPrice / promoByResolution；旧数据忽略 */
  discountPercent?: number;
  sortOrder?: number;
  /** 固定积分/次：不吃全站与模型折扣%，会员也不享生图折扣 */
  fixedPrice?: boolean;
  /**
   * 会员最低付费比例（%），限制会员折扣力度。100=会员与生图同价；90=会员至多九折。
   * 与 fixedPrice 同时开启时，以 fixedPrice 为准。
   */
  memberDiscountCapPercent?: number;
  /** 违规时是否返还积分；默认跟随模型目录，可在后台覆盖 */
  refundOnViolation?: boolean;
};

export type ImageModelPricingSettings = {
  /** @deprecated 已改为各模型单独折扣价；保留字段兼容旧数据 */
  globalDiscountPercent: number;
  models: Record<string, ImageModelOverride>;
};

export type ResolvedImageModel = ImageModelCatalogEntry & {
  displayLabel: string;
  status: ImageModelStatus;
  statusNotice: string | null;
  /** 是否允许提交生图 */
  enabled: boolean;
  /** 是否出现在前台模型列表（含维护中） */
  visible: boolean;
  creditsPerCall: number;
  creditsByResolution: Partial<Record<ImageResolutionKey, number>> | null;
  effectiveCreditsByResolution: Partial<Record<ImageResolutionKey, number>> | null;
  pricingByResolution: boolean;
  creditsBySpeed: Partial<Record<MjSpeedKey, number>> | null;
  effectiveCreditsBySpeed: Partial<Record<MjSpeedKey, number>> | null;
  pricingBySpeed: boolean;
  promoPrice: number | null;
  promoByResolution: Partial<Record<ImageResolutionKey, number>> | null;
  promoBySpeed: Partial<Record<MjSpeedKey, number>> | null;
  effectiveBaseCredits: number;
  fixedPrice: boolean;
  memberDiscountCapPercent: number | null;
  refundOnViolation: boolean;
  violationNotice: string | null;
};

export type ImageModelSettingsLoadResult = {
  settings: ImageModelPricingSettings;
  /** 是否已有 image_model_pricing 这一行配置 */
  persisted: boolean;
  /** site_settings 表是否可读 */
  tableReady: boolean;
  tableError: string | null;
};

function isMissingTableError(msg: string): boolean {
  return /does not exist|relation.*site_settings|Could not find the table|PGRST205|schema cache/i.test(
    msg
  );
}

export async function probeSiteSettingsTable(
  admin: SupabaseClient
): Promise<{ tableReady: boolean; tableError: string | null }> {
  try {
    const { error } = await admin.from('site_settings').select('key').limit(1);
    if (!error) return { tableReady: true, tableError: null };
    if (isMissingTableError(error.message)) {
      return { tableReady: false, tableError: error.message };
    }
    return { tableReady: true, tableError: error.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tableReady: !isMissingTableError(msg), tableError: msg };
  }
}

const DEFAULT_SETTINGS: ImageModelPricingSettings = {
  globalDiscountPercent: 100,
  models: {}
};

let cachedSettings: ImageModelPricingSettings | null = null;
let cachedMeta: {
  persisted: boolean;
  tableReady: boolean;
  tableError: string | null;
} | null = null;
let cachedAt = 0;
const CACHE_MS = 15_000;

function clampPercent(n: unknown, fallback = 100): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(1, Math.round(v)));
}

function clampCredits(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return roundCredits(fallback);
  return clampCreditsValue(v);
}

function sanitizeCreditsBySpeed(
  raw: unknown,
  catalog: ImageModelCatalogEntry
): Partial<Record<MjSpeedKey, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const speeds: MjSpeedKey[] = ['relax', 'fast', 'turbo'];
  const out: Partial<Record<MjSpeedKey, number>> = {};
  for (const speed of speeds) {
    if (src[speed] == null) continue;
    const def = catalog.defaultCreditsBySpeed?.[speed] ?? catalog.defaultCredits;
    out[speed] = clampCredits(src[speed], def);
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeCreditsByResolution(
  raw: unknown,
  catalog: ImageModelCatalogEntry
): Partial<Record<ImageResolutionKey, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<ImageResolutionKey, number>> = {};
  for (const res of catalog.resolutions) {
    if (src[res] == null) continue;
    const def = catalog.defaultCreditsByResolution?.[res] ?? catalog.defaultCredits;
    out[res] = clampCredits(src[res], def);
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeOptionalPromoCredits(n: unknown): number | undefined {
  if (n == null || n === '') return undefined;
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return clampCreditsValue(v);
}

function sanitizePromoByResolution(
  raw: unknown,
  catalog: ImageModelCatalogEntry
): Partial<Record<ImageResolutionKey, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<ImageResolutionKey, number>> = {};
  for (const res of catalog.resolutions) {
    const v = sanitizeOptionalPromoCredits(src[res]);
    if (v != null) out[res] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizePromoBySpeed(
  raw: unknown
): Partial<Record<MjSpeedKey, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<MjSpeedKey, number>> = {};
  for (const speed of ['relax', 'fast', 'turbo'] as MjSpeedKey[]) {
    const v = sanitizeOptionalPromoCredits(src[speed]);
    if (v != null) out[speed] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 多分辨率且非 MJ speed 定价时，允许按分辨率单独设售价 */
export function modelUsesPerResolutionPricing(catalog: ImageModelCatalogEntry): boolean {
  return catalog.pricingBySpeed !== true
    && (catalog.pricingByResolution === true || catalog.resolutions.length > 1);
}

function sanitizeDisplayName(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  return s.slice(0, 48);
}

export function resolveModelStatus(override: ImageModelOverride): ImageModelStatus {
  if (
    override.status === 'active' ||
    override.status === 'maintenance' ||
    override.status === 'offline'
  ) {
    return override.status;
  }
  if (override.enabled === false) return 'offline';
  return 'active';
}

export function mergeImageModelSettings(
  raw: Partial<ImageModelPricingSettings> | null | undefined
): ImageModelPricingSettings {
  const models: Record<string, ImageModelOverride> = {};
  const src = raw?.models && typeof raw.models === 'object' ? raw.models : {};
  for (const [id, patch] of Object.entries(src)) {
    if (!patch || typeof patch !== 'object') continue;
    const status =
      patch.status === 'active' ||
      patch.status === 'maintenance' ||
      patch.status === 'offline'
        ? patch.status
        : undefined;
    models[id] = {
      displayName: sanitizeDisplayName(patch.displayName),
      status,
      enabled: patch.enabled === false ? false : patch.enabled === true ? true : undefined,
      creditsPerCall:
        patch.creditsPerCall != null ? clampCredits(patch.creditsPerCall, 10) : undefined,
      creditsByResolution: (() => {
        const catalog = getCatalogEntry(id);
        if (!catalog || !patch.creditsByResolution) return undefined;
        return sanitizeCreditsByResolution(patch.creditsByResolution, catalog);
      })(),
      creditsBySpeed: (() => {
        const catalog = getCatalogEntry(id);
        if (!catalog || !patch.creditsBySpeed) return undefined;
        return sanitizeCreditsBySpeed(patch.creditsBySpeed, catalog);
      })(),
      promoPrice: sanitizeOptionalPromoCredits(patch.promoPrice),
      promoByResolution: (() => {
        const catalog = getCatalogEntry(id);
        if (!catalog || !patch.promoByResolution) return undefined;
        return sanitizePromoByResolution(patch.promoByResolution, catalog);
      })(),
      promoBySpeed: patch.promoBySpeed ? sanitizePromoBySpeed(patch.promoBySpeed) : undefined,
      sortOrder:
        patch.sortOrder != null && Number.isFinite(Number(patch.sortOrder))
          ? Math.round(Number(patch.sortOrder))
          : undefined,
      fixedPrice: patch.fixedPrice === true ? true : patch.fixedPrice === false ? false : undefined,
      memberDiscountCapPercent:
        patch.memberDiscountCapPercent != null
          ? clampPercent(patch.memberDiscountCapPercent, 100)
          : undefined,
      refundOnViolation:
        patch.refundOnViolation === true
          ? true
          : patch.refundOnViolation === false
            ? false
            : undefined
    };
  }
  return {
    globalDiscountPercent: clampPercent(raw?.globalDiscountPercent, 100),
    models
  };
}

export async function loadImageModelSettingsWithMeta(
  admin: SupabaseClient
): Promise<ImageModelSettingsLoadResult> {
  const now = Date.now();
  if (cachedSettings && cachedMeta && now - cachedAt < CACHE_MS) {
    return {
      settings: cachedSettings,
      persisted: cachedMeta.persisted,
      tableReady: cachedMeta.tableReady,
      tableError: cachedMeta.tableError
    };
  }

  const probe = await probeSiteSettingsTable(admin);
  let row: { value?: unknown } | null = null;
  let tableError = probe.tableError;

  if (probe.tableReady) {
    try {
      const { data, error } = await admin
        .from('site_settings')
        .select('value')
        .eq('key', IMAGE_MODEL_SETTINGS_KEY)
        .maybeSingle();
      if (error) {
        tableError = error.message;
        console.warn('[image-model-settings] load error:', error.message);
      } else {
        row = data;
      }
    } catch (err) {
      tableError = err instanceof Error ? err.message : String(err);
      console.warn('[image-model-settings] load exception:', err);
    }
  }

  const persisted = row != null;
  const merged = mergeImageModelSettings(
    (row?.value && typeof row.value === 'object'
      ? (row.value as Partial<ImageModelPricingSettings>)
      : null) || DEFAULT_SETTINGS
  );
  cachedSettings = merged;
  cachedMeta = { persisted, tableReady: probe.tableReady, tableError };
  cachedAt = now;
  return {
    settings: merged,
    persisted,
    tableReady: probe.tableReady,
    tableError
  };
}

export async function loadImageModelSettings(
  admin: SupabaseClient
): Promise<ImageModelPricingSettings> {
  const { settings } = await loadImageModelSettingsWithMeta(admin);
  return settings;
}

export function invalidateImageModelSettingsCache(): void {
  cachedSettings = null;
  cachedMeta = null;
  cachedAt = 0;
}

export async function saveImageModelSettings(
  admin: SupabaseClient,
  settings: ImageModelPricingSettings
): Promise<ImageModelPricingSettings> {
  const merged = mergeImageModelSettings(settings);
  const { error } = await admin.from('site_settings').upsert(
    {
      key: IMAGE_MODEL_SETTINGS_KEY,
      value: merged
    },
    { onConflict: 'key' }
  );
  if (error) {
    const msg = error.message || String(error);
    if (isMissingTableError(msg)) {
      throw new Error(
        'SITE_SETTINGS_TABLE_MISSING: 请先在 Supabase SQL 编辑器执行 migrations/20260602160000_site_settings_image_models.sql 与 20260602200000_site_settings_grants.sql'
      );
    }
    if (/permission denied|42501|RLS/i.test(msg)) {
      throw new Error(
        'SITE_SETTINGS_PERMISSION: 请执行 migrations/20260602200000_site_settings_grants.sql 授予 service_role 权限'
      );
    }
    throw error;
  }
  invalidateImageModelSettingsCache();

  const { data: verify, error: verifyErr } = await admin
    .from('site_settings')
    .select('value')
    .eq('key', IMAGE_MODEL_SETTINGS_KEY)
    .maybeSingle();
  if (verifyErr) {
    console.warn('[image-model-settings] save verify read error:', verifyErr.message);
  } else if (!verify) {
    console.warn('[image-model-settings] save verify: row not visible yet (upsert ok)');
  }
  return merged;
}

export function resolveImageModelConfig(
  modelId: string,
  settings: ImageModelPricingSettings
): ResolvedImageModel | null {
  const catalog = getCatalogEntry(modelId);
  if (!catalog) return null;
  const override = settings.models[catalog.id] || {};
  let status = resolveModelStatus(override);
  const displayLabel = sanitizeDisplayName(override.displayName) || catalog.label;
  const enabled = status === 'active';
  const visible = status !== 'offline';
  const statusNotice =
    status === 'maintenance'
      ? '该模型维护中，请稍后再试或换用其他模型'
      : null;
  const pricingByResolution = modelUsesPerResolutionPricing(catalog);
  const pricingBySpeed = catalog.pricingBySpeed === true;
  let creditsByResolution: Partial<Record<ImageResolutionKey, number>> | null = null;
  if (pricingByResolution) {
    creditsByResolution = {};
    for (const res of catalog.resolutions) {
      const def = catalog.defaultCreditsByResolution?.[res] ?? catalog.defaultCredits;
      creditsByResolution[res] = clampCredits(override.creditsByResolution?.[res], def);
    }
  }
  let creditsBySpeed: Partial<Record<MjSpeedKey, number>> | null = null;
  if (pricingBySpeed) {
    creditsBySpeed = {};
    const hasSpeedOverride =
      override.creditsBySpeed && Object.keys(override.creditsBySpeed).length > 0;
    const legacyFlat =
      !hasSpeedOverride && override.creditsPerCall != null ? override.creditsPerCall : null;
    for (const speed of ['relax', 'fast', 'turbo'] as MjSpeedKey[]) {
      const def = catalog.defaultCreditsBySpeed?.[speed] ?? catalog.defaultCredits;
      if (override.creditsBySpeed?.[speed] != null) {
        creditsBySpeed[speed] = clampCredits(override.creditsBySpeed[speed], def);
      } else if (legacyFlat != null) {
        creditsBySpeed[speed] = clampCredits(legacyFlat, def);
      } else {
        creditsBySpeed[speed] = clampCredits(undefined, def);
      }
    }
  }
  const creditsPerCall = pricingBySpeed
    ? creditsBySpeed!.relax ?? catalog.defaultCredits
    : pricingByResolution
      ? creditsByResolution![catalog.resolutions[0] as ImageResolutionKey] ?? catalog.defaultCredits
      : clampCredits(override.creditsPerCall, catalog.defaultCredits);
  const fixedPrice = override.fixedPrice === true;
  const memberDiscountCapPercent =
    override.memberDiscountCapPercent != null
      ? clampPercent(override.memberDiscountCapPercent, 100)
      : null;
  const refundOnViolation =
    override.refundOnViolation === false
      ? false
      : override.refundOnViolation === true
        ? true
        : catalog.refundOnViolation;
  let promoByResolution: Partial<Record<ImageResolutionKey, number>> | null = null;
  if (pricingByResolution && override.promoByResolution) {
    promoByResolution = {};
    for (const res of catalog.resolutions) {
      const v = sanitizeOptionalPromoCredits(override.promoByResolution[res]);
      if (v != null) promoByResolution[res] = v;
    }
    if (!Object.keys(promoByResolution).length) promoByResolution = null;
  }
  let promoBySpeed: Partial<Record<MjSpeedKey, number>> | null = null;
  if (pricingBySpeed && override.promoBySpeed) {
    promoBySpeed = {};
    for (const speed of ['relax', 'fast', 'turbo'] as MjSpeedKey[]) {
      const v = sanitizeOptionalPromoCredits(override.promoBySpeed[speed]);
      if (v != null) promoBySpeed[speed] = v;
    }
    if (!Object.keys(promoBySpeed).length) promoBySpeed = null;
  }
  const promoPrice = !pricingByResolution && !pricingBySpeed
    ? sanitizeOptionalPromoCredits(override.promoPrice) ?? null
    : null;
  const effectiveCreditsByResolution = creditsByResolution
    ? { ...creditsByResolution }
    : null;
  const effectiveCreditsBySpeed = creditsBySpeed ? { ...creditsBySpeed } : null;
  const listBase = pricingBySpeed
    ? creditsBySpeed!.relax ?? catalog.defaultCredits
    : pricingByResolution
      ? creditsByResolution![catalog.resolutions[0] as ImageResolutionKey] ?? catalog.defaultCredits
      : creditsPerCall;
  const effectiveBaseCredits = listBase;
  return {
      ...catalog,
      displayLabel,
      status,
      statusNotice,
      enabled,
      visible,
      creditsPerCall,
      creditsByResolution,
      effectiveCreditsByResolution,
      pricingByResolution,
      creditsBySpeed,
      effectiveCreditsBySpeed,
      pricingBySpeed,
      promoPrice,
      promoByResolution,
      promoBySpeed,
      effectiveBaseCredits,
      fixedPrice,
      memberDiscountCapPercent,
      refundOnViolation,
      violationNotice: refundOnViolation
        ? null
        : '该模型触发内容审核（违规）时不返还积分，请谨慎选择'
  };
}

export function listResolvedImageModels(
  settings: ImageModelPricingSettings,
  opts?: { enabledOnly?: boolean; publicList?: boolean }
): ResolvedImageModel[] {
  const out: ResolvedImageModel[] = [];
  for (const catalog of IMAGE_MODEL_CATALOG) {
    const resolved = resolveImageModelConfig(catalog.id, settings)!;
    if (opts?.enabledOnly && !resolved.enabled) continue;
    if (opts?.publicList && !resolved.visible) continue;
    out.push(resolved);
  }
  out.sort((a, b) => {
    const ao = settings.models[a.id]?.sortOrder ?? a.sortOrder;
    const bo = settings.models[b.id]?.sortOrder ?? b.sortOrder;
    return ao - bo || a.label.localeCompare(b.label, 'zh-CN');
  });
  return out;
}

export function computeImageGenerationCost(
  settings: ImageModelPricingSettings,
  modelId: string,
  resolution: string,
  tier: Profile['membership_tier'],
  memberActive: boolean,
  opts?: { mjSpeed?: string | null }
): {
  base: number;
  final: number;
  listPrice: number;
  promoPrice: number;
  modelDiscountPercent: number;
  modelDiscountLabel: string | null;
  discountLabel: string | null;
  appliedDiscount: 'model' | 'member' | 'fixed' | 'none';
  modelLabel: string;
  modelId: string;
  refundOnViolation: boolean;
  violationNotice: string | null;
} {
  const id = normalizeImageModelId(modelId);
  const model = resolveImageModelConfig(id, settings);
  if (!model) {
    const fallback = resolveImageModelConfig('gpt-image-2', settings)!;
    return computeFromResolved(
      fallback,
      tier,
      memberActive,
      resolution,
      opts?.mjSpeed
    );
  }
  return computeFromResolved(
    model,
    tier,
    memberActive,
    resolution,
    opts?.mjSpeed
  );
}

function resolveModelBaseCredits(
  model: ResolvedImageModel,
  resolution: string,
  mjSpeed?: string | null
): number {
  if (model.pricingBySpeed) {
    const speed = normalizeMjSpeed(mjSpeed);
    if (model.creditsBySpeed?.[speed] != null) {
      return model.creditsBySpeed[speed]!;
    }
    return model.creditsPerCall;
  }
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '1k') as ImageResolutionKey;
  if (model.pricingByResolution && model.creditsByResolution?.[res] != null) {
    return model.creditsByResolution[res]!;
  }
  return model.creditsPerCall;
}

/** 管理后台「售价积分」原价（未乘模型/全场折扣） */
function resolveModelListPriceCredits(
  model: ResolvedImageModel,
  resolution: string,
  mjSpeed?: string | null
): number {
  if (model.pricingBySpeed) {
    const speed = normalizeMjSpeed(mjSpeed);
    if (model.creditsBySpeed?.[speed] != null) return model.creditsBySpeed[speed]!;
    return model.creditsPerCall;
  }
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '1k') as ImageResolutionKey;
  if (model.pricingByResolution && model.creditsByResolution?.[res] != null) {
    return model.creditsByResolution[res]!;
  }
  return model.creditsPerCall;
}

function resolvePromoPriceCredits(
  model: ResolvedImageModel,
  listPrice: number,
  resolution: string,
  mjSpeed?: string | null
): number {
  if (model.fixedPrice) return listPrice;
  if (model.pricingBySpeed) {
    const speed = normalizeMjSpeed(mjSpeed);
    const promo = model.promoBySpeed?.[speed];
    if (promo != null) return promo;
    return listPrice;
  }
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '1k') as ImageResolutionKey;
  if (model.pricingByResolution) {
    const promo = model.promoByResolution?.[res];
    if (promo != null) return promo;
    return listPrice;
  }
  if (model.promoPrice != null) return model.promoPrice;
  return listPrice;
}

function formatPromoDiscountLabel(
  listPrice: number,
  promoPrice: number,
  fixedPrice: boolean
): string | null {
  if (fixedPrice || promoPrice >= listPrice - 0.04) return null;
  return '活动价';
}

function computeMemberCreditsFromList(
  listPrice: number,
  model: ResolvedImageModel,
  _tier: Profile['membership_tier'],
  _memberActive: boolean
): { price: number; mult: number; label: string | null } {
  void model;
  return { price: listPrice, mult: 1, label: null };
}

function computeFromResolved(
  model: ResolvedImageModel,
  tier: Profile['membership_tier'],
  memberActive: boolean,
  resolution = '1k',
  mjSpeed?: string | null
) {
  const listPrice = resolveModelListPriceCredits(model, resolution, mjSpeed);
  const promoPrice = resolvePromoPriceCredits(model, listPrice, resolution, mjSpeed);
  const member = computeMemberCreditsFromList(listPrice, model, tier, memberActive);

  let final = listPrice;
  let appliedDiscount: 'model' | 'member' | 'fixed' | 'none' = 'none';
  let modelDiscountLabel: string | null = null;
  let discountLabel: string | null = null;

  if (model.fixedPrice) {
    final = listPrice;
    appliedDiscount = 'fixed';
    discountLabel = '固定价';
  } else if (member.mult >= 1) {
    final = promoPrice;
    if (promoPrice < listPrice - 0.04) {
      appliedDiscount = 'model';
      modelDiscountLabel = formatPromoDiscountLabel(listPrice, promoPrice, false);
    }
  } else if (promoPrice <= member.price) {
    final = promoPrice;
    if (promoPrice < listPrice - 0.04) {
      appliedDiscount = 'model';
      modelDiscountLabel = formatPromoDiscountLabel(listPrice, promoPrice, false);
    }
  } else {
    final = member.price;
    appliedDiscount = 'member';
    discountLabel = member.label;
    if (
      model.memberDiscountCapPercent != null &&
      tier &&
      membershipGenMultiplier(tier) < member.mult
    ) {
      discountLabel = `会员≥${model.memberDiscountCapPercent}%`;
    }
  }

  return {
    base: listPrice,
    final,
    listPrice,
    promoPrice,
    modelDiscountPercent: promoPrice < listPrice - 0.04
      ? Math.round((promoPrice / listPrice) * 100)
      : 100,
    modelDiscountLabel,
    discountLabel,
    appliedDiscount,
    modelLabel: model.displayLabel,
    modelId: model.id,
    refundOnViolation: model.refundOnViolation,
    violationNotice: model.violationNotice
  };
}

export function adminModelRows(settings: ImageModelPricingSettings) {
  return IMAGE_MODEL_CATALOG.map((catalog) => {
    const resolved = resolveImageModelConfig(catalog.id, settings)!;
    const override = settings.models[catalog.id] || {};
    const costLines = buildUpstreamCostLines(catalog);
    return {
      id: catalog.id,
      provider: catalog.provider,
      providerLabel: providerLabel(catalog.provider),
      uiFamily: catalog.uiFamily,
      upstream: catalog.upstream,
      label: catalog.label,
      displayName: resolved.displayLabel,
      displayLabel: resolved.displayLabel,
      status: resolved.status,
      statusNotice: resolved.statusNotice,
      group: catalog.group,
      description: catalog.description,
      upstreamPoints: catalog.upstreamPoints,
      upstreamCostText:
        catalog.provider === 'grsai'
          ? formatGrsaiUpstreamCostCell(buildGrsaiUpstreamCostLines(catalog))
          : formatUpstreamCostCell(catalog.provider, costLines),
      upstreamCostLines: costLines,
      refundOnViolation: resolved.refundOnViolation,
      resolutions: catalog.resolutions,
      enabled: resolved.enabled,
      visible: resolved.visible,
      creditsPerCall: resolved.creditsPerCall,
      creditsByResolution: resolved.creditsByResolution,
      effectiveCreditsByResolution: resolved.effectiveCreditsByResolution,
      pricingByResolution: resolved.pricingByResolution,
      creditsBySpeed: resolved.creditsBySpeed,
      effectiveCreditsBySpeed: resolved.effectiveCreditsBySpeed,
      pricingBySpeed: resolved.pricingBySpeed,
      promoPrice: resolved.promoPrice,
      promoByResolution: resolved.promoByResolution,
      promoBySpeed: resolved.promoBySpeed,
      effectiveBaseCredits: resolved.effectiveBaseCredits,
      fixedPrice: resolved.fixedPrice,
      memberDiscountCapPercent: resolved.memberDiscountCapPercent,
      sortOrder: override.sortOrder ?? catalog.sortOrder
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'zh-CN'));
}

export { normalizeImageModelId, catalogById, getCatalogEntry };
