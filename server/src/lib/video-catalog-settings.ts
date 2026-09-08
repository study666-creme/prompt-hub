import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 后台视频目录覆盖（site_settings.video_catalog_overrides）。
 * 运营可在后台直接纠正卡藏目录的计价配置：unit（second/request）、每秒/每次价、
 * 按档位价、上下架。Worker 计费与公开目录在卡藏数据之后应用覆盖，覆盖优先；
 * 卡藏修正后清掉覆盖即恢复目录真实值。
 */

export type VideoCatalogOverride = {
  /** 卡藏模型 id（catalog id 或 upstreamModel） */
  id: string;
  /** 覆盖计价单位：second=单价×时长，request=按次平摊 */
  unit?: 'second' | 'request';
  /** 覆盖默认积分（每秒价或每次价；无 tier 覆盖时使用） */
  credits?: number | null;
  /** 覆盖按档位价：目录 tier 的 name（如 768/1080p/2K）→ 积分 */
  creditsByTier?: Record<string, number> | null;
  /** false=后台直接隐藏该模型 */
  enabled?: boolean;
  note?: string;
  updatedAt?: string;
};

export type VideoCatalogOverrides = {
  models: Record<string, VideoCatalogOverride>;
};

/** 卡藏 pricing tier 形态：{name, when, credits} */
export type CatalogPricingLike = {
  mode?: unknown;
  unit?: unknown;
  credits?: unknown;
  tiers?: unknown;
  quantityParameter?: unknown;
  [key: string]: unknown;
};

const KEY = 'video_catalog_overrides';
const CACHE_MS = 30_000;
let cached: VideoCatalogOverrides | null = null;
let cachedAt = 0;

export function emptyVideoOverrides(): VideoCatalogOverrides {
  return { models: {} };
}

function normalize(value: unknown): VideoCatalogOverrides {
  const raw = value && typeof value === 'object' ? (value as { models?: unknown }) : {};
  const models: Record<string, VideoCatalogOverride> = {};
  const entries = raw.models && typeof raw.models === 'object' ? Object.entries(raw.models) : [];
  for (const [id, v] of entries) {
    const o = v && typeof v === 'object' ? (v as VideoCatalogOverride) : null;
    if (!o) continue;
    const override: VideoCatalogOverride = { id: String(o.id || id) };
    if (o.unit === 'second' || o.unit === 'request') override.unit = o.unit;
    if (o.credits != null && Number.isFinite(Number(o.credits))) override.credits = Number(o.credits);
    if (o.creditsByTier && typeof o.creditsByTier === 'object') {
      const tiers: Record<string, number> = {};
      for (const [name, credits] of Object.entries(o.creditsByTier ?? {})) {
        const n = Number(credits);
        if (Number.isFinite(n) && n > 0) tiers[name] = n;
      }
      if (Object.keys(tiers).length) override.creditsByTier = tiers;
    }
    if (typeof o.enabled === 'boolean') override.enabled = o.enabled;
    if (o.note) override.note = String(o.note).slice(0, 300);
    if (o.updatedAt) override.updatedAt = String(o.updatedAt);
    models[id] = override;
  }
  return { models };
}

export async function loadVideoCatalogOverrides(
  admin: SupabaseClient
): Promise<VideoCatalogOverrides> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;
  try {
    const { data, error } = await admin
      .from('site_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();
    if (error) {
      console.warn('[video-overrides] load error:', error.message);
      return cached ?? emptyVideoOverrides();
    }
    cached = normalize(data?.value);
    cachedAt = now;
    return cached;
  } catch (e) {
    console.warn('[video-overrides] load threw:', e instanceof Error ? e.message : String(e));
    return cached ?? emptyVideoOverrides();
  }
}

export function invalidateVideoOverridesCache() {
  cached = null;
  cachedAt = 0;
}

/**
 * 应用覆盖到 pricing：返回覆盖后的 pricing（新对象）与 enabled。
 * enabled=false 表示后台已下架该模型。tiers 覆盖按 tier.name 匹配卡藏 tier
 * （保住 when 条件），只替换 credits；卡藏没有同名 tier 时追加。
 */
export function applyVideoOverride(
  overrides: VideoCatalogOverrides,
  model: { id: string; upstreamModel: string },
  pricing: CatalogPricingLike
): { pricing: CatalogPricingLike; enabled: boolean } {
  const o = overrides.models[model.id] ?? overrides.models[model.upstreamModel];
  if (!o) return { pricing, enabled: true };
  if (o.enabled === false) return { pricing, enabled: false };
  const next: CatalogPricingLike = { ...pricing };
  if (o.unit === 'second' || o.unit === 'request') {
    next.unit = o.unit;
    if (o.unit === 'second') next.quantityParameter = 'duration';
    else delete next.quantityParameter;
  }
  if (o.creditsByTier && Object.keys(o.creditsByTier).length) {
    const source = Array.isArray(pricing.tiers)
      ? (pricing.tiers as Array<Record<string, unknown>>)
      : [];
    // tier 匹配键：name，退而求其次 when.resolution（卡藏投影可能丢 name）。
    // 只替换已有 tier 的 credits，不追加——防止同档位出现两行重复价。
    const tierKey = (t: Record<string, unknown>) => {
      const name = String(t?.name ?? '').trim();
      if (name) return name;
      const when = t?.when as Record<string, unknown> | undefined;
      return String(when?.resolution ?? '').trim();
    };
    const merged = source.map((t: Record<string, unknown>) => {
      const hit = (o.creditsByTier ?? {})[tierKey(t)];
      return hit != null ? { ...t, credits: hit } : t;
    });
    const covered = new Set(merged.map(tierKey).filter(Boolean));
    // 目录完全没有的档位才追加（带 when，便于计费匹配）
    for (const [name, credits] of Object.entries(o.creditsByTier)) {
      if (!covered.has(name)) merged.push({ name, when: { resolution: name }, credits });
    }
    next.tiers = merged;
  } else if (o.credits != null) {
    next.credits = o.credits;
    next.tiers = [];
  }
  return { pricing: next, enabled: true };
}
