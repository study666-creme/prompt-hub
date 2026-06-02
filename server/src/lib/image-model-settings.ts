import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IMAGE_MODEL_CATALOG,
  catalogById,
  getCatalogEntry,
  normalizeImageModelId,
  providerLabel,
  type ImageModelCatalogEntry
} from './image-models-catalog';
import { overlayGrsaiUpstreamStatus } from './grsai-upstream-status';
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
  /** 100 = 原价；80 = 该模型 8 折 */
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
  /** 全站生图折扣：100=无，90=九折 */
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
  discountPercent: number;
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
      discountPercent:
        patch.discountPercent != null ? clampPercent(patch.discountPercent, 100) : undefined,
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
  const status = resolveModelStatus(override);
  const displayLabel = sanitizeDisplayName(override.displayName) || catalog.label;
  const enabled = status === 'active';
  const visible = status !== 'offline';
  const statusNotice =
    status === 'maintenance' ? '该模型维护中，请稍后再试或换用其他模型' : null;
  const pricingByResolution = catalog.pricingByResolution === true;
  let creditsByResolution: Partial<Record<ImageResolutionKey, number>> | null = null;
  if (pricingByResolution) {
    creditsByResolution = {};
    for (const res of catalog.resolutions) {
      const def = catalog.defaultCreditsByResolution?.[res] ?? catalog.defaultCredits;
      creditsByResolution[res] = clampCredits(override.creditsByResolution?.[res], def);
    }
  }
  const creditsPerCall = pricingByResolution
    ? creditsByResolution!['1k'] ?? catalog.defaultCredits
    : clampCredits(override.creditsPerCall, catalog.defaultCredits);
  const discountPercent = clampPercent(override.discountPercent, 100);
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
  const globalMult = clampPercent(settings.globalDiscountPercent, 100) / 100;
  const modelMult = discountPercent / 100;
  let effectiveCreditsByResolution: Partial<Record<ImageResolutionKey, number>> | null = null;
  if (pricingByResolution && creditsByResolution) {
    effectiveCreditsByResolution = {};
    for (const res of catalog.resolutions) {
      const raw = creditsByResolution[res] ?? catalog.defaultCredits;
      effectiveCreditsByResolution[res] = fixedPrice
        ? raw
        : roundCredits(raw * modelMult * globalMult);
    }
  }
  const listBase = pricingByResolution
    ? effectiveCreditsByResolution!['1k'] ?? catalog.defaultCredits
    : creditsPerCall;
  const effectiveBaseCredits = fixedPrice
    ? listBase
    : pricingByResolution
      ? listBase
      : roundCredits(creditsPerCall * modelMult * globalMult);
  return overlayGrsaiUpstreamStatus(
    {
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
      discountPercent,
      effectiveBaseCredits,
      fixedPrice,
      memberDiscountCapPercent,
      refundOnViolation,
      violationNotice: refundOnViolation
        ? null
        : '该模型触发内容审核（违规）时不返还积分，请谨慎选择'
    },
    settings
  );
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
  memberActive: boolean
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
      settings.globalDiscountPercent
    );
  }
  return computeFromResolved(
    model,
    tier,
    memberActive,
    resolution,
    settings.globalDiscountPercent
  );
}

function resolveModelBaseCredits(model: ResolvedImageModel, resolution: string): number {
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '1k') as ImageResolutionKey;
  if (model.pricingByResolution && model.effectiveCreditsByResolution?.[res] != null) {
    return model.effectiveCreditsByResolution[res]!;
  }
  return model.effectiveBaseCredits;
}

/** 管理后台「售价积分」原价（未乘模型/全场折扣） */
function resolveModelListPriceCredits(model: ResolvedImageModel, resolution: string): number {
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '1k') as ImageResolutionKey;
  if (model.pricingByResolution && model.creditsByResolution?.[res] != null) {
    return model.creditsByResolution[res]!;
  }
  return model.creditsPerCall;
}

function formatModelDiscountLabel(
  discountPercent: number,
  fixedPrice: boolean
): string | null {
  if (fixedPrice || discountPercent >= 100) return null;
  return `${discountPercent}折`;
}

function computePromoCredits(
  listPrice: number,
  model: ResolvedImageModel,
  globalDiscountPercent: number
): number {
  if (model.fixedPrice) return listPrice;
  const globalMult = clampPercent(globalDiscountPercent, 100) / 100;
  const modelMult = model.discountPercent / 100;
  return roundCredits(listPrice * modelMult * globalMult);
}

function computeMemberCreditsFromList(
  listPrice: number,
  model: ResolvedImageModel,
  tier: Profile['membership_tier'],
  memberActive: boolean
): { price: number; mult: number; label: string | null } {
  if (!memberActive || !tier || model.fixedPrice) {
    return { price: listPrice, mult: 1, label: null };
  }
  let mult = membershipGenMultiplier(tier);
  if (model.memberDiscountCapPercent != null && mult < 1) {
    const floor = model.memberDiscountCapPercent / 100;
    mult = Math.max(mult, floor);
  }
  if (mult >= 1) {
    return { price: listPrice, mult: 1, label: null };
  }
  return {
    price: applyMemberCreditDiscount(listPrice, mult),
    mult,
    label: membershipGenDiscountLabel(tier)
  };
}

function computeFromResolved(
  model: ResolvedImageModel,
  tier: Profile['membership_tier'],
  memberActive: boolean,
  resolution = '1k',
  globalDiscountPercent = 100
) {
  const listPrice = resolveModelListPriceCredits(model, resolution);
  const promoPrice = computePromoCredits(listPrice, model, globalDiscountPercent);
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
      modelDiscountLabel = formatModelDiscountLabel(model.discountPercent, false);
    }
  } else if (promoPrice <= member.price) {
    final = promoPrice;
    if (promoPrice < listPrice - 0.04) {
      appliedDiscount = 'model';
      modelDiscountLabel = formatModelDiscountLabel(model.discountPercent, false);
      if (!modelDiscountLabel && promoPrice < listPrice - 0.04) {
        modelDiscountLabel = '活动价';
      }
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
    modelDiscountPercent: model.discountPercent,
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
    return {
      id: catalog.id,
      provider: catalog.provider,
      providerLabel: providerLabel(catalog.provider),
      upstream: catalog.upstream,
      label: catalog.label,
      displayName: resolved.displayLabel,
      displayLabel: resolved.displayLabel,
      status: resolved.status,
      statusNotice: resolved.statusNotice,
      group: catalog.group,
      description: catalog.description,
      upstreamPoints: catalog.upstreamPoints,
      refundOnViolation: resolved.refundOnViolation,
      resolutions: catalog.resolutions,
      enabled: resolved.enabled,
      visible: resolved.visible,
      creditsPerCall: resolved.creditsPerCall,
      creditsByResolution: resolved.creditsByResolution,
      effectiveCreditsByResolution: resolved.effectiveCreditsByResolution,
      pricingByResolution: resolved.pricingByResolution,
      discountPercent: resolved.discountPercent,
      effectiveBaseCredits: resolved.effectiveBaseCredits,
      fixedPrice: resolved.fixedPrice,
      memberDiscountCapPercent: resolved.memberDiscountCapPercent,
      sortOrder: override.sortOrder ?? catalog.sortOrder
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'zh-CN'));
}

export { normalizeImageModelId, catalogById, getCatalogEntry };
