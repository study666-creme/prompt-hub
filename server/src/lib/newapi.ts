import { ApiError } from './errors';
import { extractAllImageUrls, extractTaskId } from './apimart';
import { imageRetailCreditsFromYuan } from './credit-math';
import {
  NEWAPI_IMAGE_MODEL_CATALOG,
  isPublicNewApiImageEntry,
  normalizeImageModelId,
  type ImageModelCatalogEntry,
  type ImageModelUiFamily
} from './image-models-catalog';
import { mapQualityForGptImage } from './pricing';
import {
  projectPublicCatalogParameters,
  projectPublicCatalogPricing,
  sanitizePublicModelDescription,
  sanitizePublicModelId,
  sanitizePublicModelLabel,
  sanitizePublicModelTags
} from './public-model-projection';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  fixedQualityLow?: boolean;
  size?: string;
  count?: number;
  refImageUrls?: string[];
  catalogParameters?: NewApiCatalogParameter[];
  mjParams?: Record<string, unknown>;
  /** Stable caller-side correlation key. It is persisted before the paid request starts. */
  clientRequestId?: string;
  /** Persists the API request id as soon as response headers/body expose it. */
  onRequestId?: (requestId: string) => Promise<void> | void;
};

export const NEWAPI_CHAT_IMAGE_REF_LIMIT = 4;
export const NEWAPI_BANANA_IMAGE_REF_LIMIT = 14;

const IMAGE_RESOLUTION_VALUES = new Set(['1k', '2k', '4k']);

export type NewApiPricingRule = {
  model: string;
  credits: number;
  creditsByResolution?: Partial<Record<'1k' | '2k' | '4k', number>>;
  description: string | null;
  tags: string;
  label: string;
  modality: 'image';
  parameters: NewApiCatalogParameter[];
};

export type NewApiModelModality = 'text' | 'image' | 'video' | 'audio';

export type NewApiCatalogPricingTier = {
  when: Record<string, string | number | boolean>;
  yuan: number;
  credits: number;
};

export type NewApiCatalogPricingGroup = {
  id: string;
  yuan?: number;
  credits?: number;
  tiers?: NewApiCatalogPricingTier[];
  inputMultiplier?: number;
  outputMultiplier?: number;
  completionRatio?: number;
  inputCreditsPerMillion?: number;
  outputCreditsPerMillion?: number;
};

export type NewApiCatalogPricing = {
  mode: 'fixed' | 'tiered' | 'token';
  unit: 'request' | 'second' | 'image' | 'token';
  yuan?: number;
  credits?: number;
  tiers?: NewApiCatalogPricingTier[];
  quantityParameter?: string | null;
  inputMultiplier?: number;
  outputMultiplier?: number;
  completionRatio?: number;
  inputCreditsPerMillion?: number;
  outputCreditsPerMillion?: number;
  groups?: NewApiCatalogPricingGroup[];
};

export type NewApiCatalogModel = {
  /** Stable public id used by Prompt Hub and canvas. */
  id: string;
  /** New API model id. Never include this field in a client response. */
  upstreamModel: string;
  label: string;
  description: string;
  modality: NewApiModelModality;
  operation: 'chat' | 'generate';
  order: number;
  endpoint: { method: 'POST'; path: string; contentType: 'application/json' };
  parameters: NewApiCatalogParameter[];
  pricing: NewApiCatalogPricing;
};

export type NewApiCatalogParameter = {
  name: string;
  path: string;
  label: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  fixed?: unknown;
  options?: unknown[];
  min?: number;
  max?: number;
  min_items?: number;
  max_items?: number;
  items?: Record<string, unknown>;
};

export type NewApiCatalogSnapshot = {
  available: boolean;
  stale: boolean;
  fetchedAt?: string;
  version: string;
  pricingVersion: string;
  models: NewApiCatalogModel[];
  rules: NewApiPricingRule[];
  imageCatalogEntries: ImageModelCatalogEntry[];
};

export type NewApiAdminRoute = {
  channelId: number;
  channelName: string;
  status: 'active' | 'disabled' | 'auto_disabled';
  enabled: boolean;
  groups: string[];
  actualModel: string;
  priority: number;
  weight: number;
  upstreamHost: string;
};

export type NewApiAdminRouteSnapshot = {
  available: boolean;
  fetchedAt: string;
  routes: Record<string, NewApiAdminRoute[]>;
  error: string | null;
};

export type NewApiResolvedCatalogModel = {
  model: NewApiCatalogModel;
  route: NewApiAdminRoute | null;
  requestedModelId: string;
};

export type NewApiTaskPollResult = {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
};

const PRICING_CACHE_MS = 5 * 60_000;
export const NEWAPI_PRICING_CATALOG_MAX_AGE_MS = 5 * 60_000;
// A catalog service can return a verified last-known-good snapshot marked
// stale while it retries its own dependencies. Keep that state brief so the
// image picker recovers promptly instead of hiding its live choices for the
// normal five-minute catalog cache window.
const STALE_CATALOG_RETRY_MS = 5_000;
const ADMIN_ROUTE_CACHE_MS = 30_000;

const FALLBACK_PUBLIC_PRESENTATION: Record<string, { id: string; label: string; description: string }> = {
  'gpt-5.5': { id: 'creative-5-5', label: '全能模型5.5', description: '通用创作与推理模型，最高 xhigh 思考。' },
  'gpt-5.6-sol': { id: 'creative-5-6', label: '全能模型5.6', description: '旗舰创作与推理模型，最高 ultra 思考。' },
  'gpt-image-2-1k': { id: 'image2-economy', label: '全能模型2 · 特价 1K', description: '特价 1K 生图模型，支持参考图。' },
  'gpt-image-2-chat': { id: 'image2-economy', label: '全能模型2 · 特价 1K', description: '特价文字生图，固定 1K。' },
  'gpt-image-2-free': { id: 'image2-free', label: '全能模型2 · 免费 1K', description: '免费生图模型，固定 1K。' },
  'gpt-image-2': { id: 'image2', label: '全能模型2 · 1K', description: '标准生图模型，固定 1K。' },
  'image2-4k-fast': { id: 'image2-4k-fast', label: '全能模型2 · 4K', description: '固定 4K 的生图模型，支持官方 Image 参数与参考图。' },
  'gpt-image-2-4k-fast': { id: 'image2-4k-fast', label: '全能模型2 · 4K', description: '固定 4K 的生图模型，支持官方 Image 参数与参考图。' },
  'gpt-image-2-4k-adobe': { id: 'image2-4k-fast', label: '全能模型2 · 4K', description: '固定 4K 的生图模型，支持官方 Image 参数与参考图。' },
  'gpt-image-2-ext': { id: 'image2-pro', label: '全能模型2 · 稳定 1K/2K/4K', description: '稳定生图模型，支持 1K/2K/4K。' },
  image2k4k: { id: 'image2-hd', label: '全能模型2 · 经济 2K/4K', description: '高分辨率经济模型，支持 2K/4K。' },
  'nano-banana-fast': { id: 'lingtu-fast', label: '香蕉 · Fast 1K', description: '快速生图模型，固定 1K。' },
  'nano-banana-2-lite': { id: 'lingtu-lite', label: '香蕉 · Lite 1K', description: '轻量生图模型，固定 1K。' },
  'nano-banana-2': { id: 'lingtu-2', label: '香蕉 · 2 1K/2K/4K', description: '通用生图模型，支持 1K/2K/4K。' },
  'nano-banana-pro': { id: 'lingtu-pro', label: '香蕉 · Pro 1K/2K/4K', description: '高质量通用生图模型，支持 1K/2K/4K。' },
  'nano-banana': { id: 'lingtu', label: '香蕉 · Standard 1K', description: '通用生图模型，固定 1K。' },
  'grok-imagine-video': { id: 'motion-video', label: 'Grok Video', description: '按秒计费的视频模型，支持文生、单图和多图生视频。' },
  'grok-imagine-video-1.5': { id: 'motion-video-1-5', label: 'Grok Video 1.5', description: '按秒计费的视频模型，支持单图生视频。' },
  'grok-imagine-video-1.5-fast': { id: 'motion-video-1-5-fast', label: 'Grok Video 1.5 Fast', description: '按次计费的视频模型，支持文生视频或单图生视频。' },
  'grok-video': { id: 'motion-video', label: 'Grok Video', description: '按秒计费的视频模型，支持文生、单图和多图生视频。' },
  'grok-video-1.5': { id: 'motion-video-1-5', label: 'Grok Video 1.5', description: '按秒计费的视频模型，支持单图生视频。' }
};

let catalogCache: { base: string; at: number; snapshot: NewApiCatalogSnapshot } | null = null;
let catalogInflight: { base: string; promise: Promise<NewApiCatalogSnapshot> } | null = null;
let adminRouteCache: { base: string; at: number; snapshot: NewApiAdminRouteSnapshot } | null = null;

const REVIEWED_NEWAPI_IMAGE_IDS = new Set(
  NEWAPI_IMAGE_MODEL_CATALOG
    .filter(isPublicNewApiImageEntry)
    .map(model => model.id)
);

function reviewedImagePricingCoverage(snapshot: NewApiCatalogSnapshot): Set<string> {
  const coverage = new Set<string>();
  for (const model of snapshot.imageCatalogEntries) {
    if (!REVIEWED_NEWAPI_IMAGE_IDS.has(model.id)) continue;
    coverage.add(`model:${model.id}`);
    for (const resolution of model.resolutions) {
      coverage.add(`resolution:${model.id}:${resolution}`);
    }
    for (const resolution of Object.keys(model.defaultCreditsByResolution || {})) {
      coverage.add(`tier:${model.id}:${resolution}`);
    }
  }
  return coverage;
}

function losesReviewedImagePricingCoverage(
  previous: NewApiCatalogSnapshot,
  candidate: NewApiCatalogSnapshot
): boolean {
  const previousCoverage = reviewedImagePricingCoverage(previous);
  if (!previousCoverage.size) return false;
  const candidateCoverage = reviewedImagePricingCoverage(candidate);
  return [...previousCoverage].some(key => !candidateCoverage.has(key));
}

function apiBase(envBase?: string): string {
  return (envBase || 'https://newapi.prompt-hubs.com').replace(/\/$/, '');
}

function catalogUrl(baseUrl?: string, force = false): string {
  const url = new URL(apiBase(baseUrl));
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.toLowerCase().endsWith('/api/model-catalog')) {
    const stripped = path.replace(/\/(?:v1|api\/v1|api)$/i, '');
    url.pathname = `${stripped}/api/model-catalog`.replace(/\/{2,}/g, '/');
  }
  url.search = '';
  if (force) url.searchParams.set('refresh', '1');
  url.hash = '';
  return url.toString();
}

function adminRouteCatalogUrl(baseUrl?: string, force = false): string {
  const url = new URL(apiBase(baseUrl));
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(?:v1|api\/v1|api)$/i, '');
  url.pathname = `${path}/api/model-catalog/admin/routes`.replace(/\/{2,}/g, '/');
  url.search = '';
  if (force) url.searchParams.set('refresh', '1');
  url.hash = '';
  return url.toString();
}

function numberValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function rounded(value: number): number {
  return Number(value.toFixed(8));
}

function normalizedPricingTiers(value: unknown, applyImageMarkup: boolean): NewApiCatalogPricingTier[] {
  return (Array.isArray(value) ? value : [])
    .map((entry): NewApiCatalogPricingTier | null => {
      if (!entry || typeof entry !== 'object') return null;
      const tier = entry as Record<string, unknown>;
      const yuan = numberValue(tier.yuan);
      const credits = applyImageMarkup
        ? imageRetailCreditsFromYuan(tier.yuan)
        : yuan == null
          ? null
          : rounded(yuan * 100);
      const when = tier.when && typeof tier.when === 'object'
        ? Object.fromEntries(
            Object.entries(tier.when as Record<string, unknown>)
              .filter(([, condition]) => ['string', 'number', 'boolean'].includes(typeof condition))
          ) as Record<string, string | number | boolean>
        : {};
      const legacyResolution = String(when.quality || '').trim().toLowerCase();
      if (!('resolution' in when) && IMAGE_RESOLUTION_VALUES.has(legacyResolution)) {
        delete when.quality;
        when.resolution = legacyResolution;
      }
      if (yuan == null || yuan < 0 || credits == null || !Object.keys(when).length) return null;
      return { when, yuan, credits };
    })
    .filter((tier): tier is NewApiCatalogPricingTier => tier != null);
}

function normalizedPricingGroups(
  value: unknown,
  mode: NewApiCatalogPricing['mode'],
  applyImageMarkup: boolean
): NewApiCatalogPricingGroup[] {
  return (Array.isArray(value) ? value : [])
    .map((entry): NewApiCatalogPricingGroup | null => {
      if (!entry || typeof entry !== 'object') return null;
      const group = entry as Record<string, unknown>;
      const id = stringValue(group.id);
      if (!id) return null;
      if (mode === 'token') {
        const inputMultiplier = numberValue(group.input_multiplier);
        const outputMultiplier = numberValue(group.output_multiplier);
        const completionRatio = numberValue(group.completion_ratio);
        const inputCreditsPerMillion = numberValue(group.input_credits_per_million);
        const outputCreditsPerMillion = numberValue(group.output_credits_per_million);
        if (inputMultiplier == null || outputMultiplier == null) return null;
        return {
          id,
          inputMultiplier,
          outputMultiplier,
          ...(completionRatio != null ? { completionRatio } : {}),
          ...(inputCreditsPerMillion != null ? { inputCreditsPerMillion } : {}),
          ...(outputCreditsPerMillion != null ? { outputCreditsPerMillion } : {})
        };
      }
      const yuan = numberValue(group.yuan);
      const credits = applyImageMarkup
        ? imageRetailCreditsFromYuan(group.yuan)
        : yuan == null
          ? null
          : rounded(yuan * 100);
      if (yuan == null || yuan < 0 || credits == null) return null;
      const tiers = normalizedPricingTiers(group.tiers, applyImageMarkup);
      return { id, yuan, credits, ...(tiers.length ? { tiers } : {}) };
    })
    .filter((group): group is NewApiCatalogPricingGroup => group != null);
}

function canonicalImageFamilyLabel(family: string, label: string): string {
  const base = family === 'gim2' ? '全能模型2' : family === 'banana' ? '香蕉' : '';
  if (!base) return label;
  const suffix = label
    .replace(/^(?:GPT\s*Image\s*2|Image\s*2|Image2|全能模型2|Nano\s*Banana|Banana|香蕉)\s*[·:：/\-]?\s*/i, '')
    .trim();
  return suffix ? `${base} · ${suffix}` : base;
}

function publicPresentation(item: Record<string, unknown>, upstreamModel: string, family: string) {
  const declared = item.public && typeof item.public === 'object'
    ? item.public as Record<string, unknown>
    : null;
  const canonical = FALLBACK_PUBLIC_PRESENTATION[upstreamModel.toLowerCase()];
  const declaredId = sanitizePublicModelId(declared?.id);
  const id = canonical?.id || declaredId;
  if (!id) return null;
  const fallbackLabel = canonical?.label || stringValue(declared?.label) || id;
  const label = sanitizePublicModelLabel(fallbackLabel, id);
  const fallbackDescription = canonical?.description || stringValue(declared?.description);
  return {
    id,
    label: canonicalImageFamilyLabel(family, label),
    description: sanitizePublicModelDescription(fallbackDescription)
  };
}

function publicEndpoint(modality: NewApiModelModality) {
  const path = modality === 'image'
    ? '/api/v1/generate'
    : modality === 'video'
      ? '/api/v1/video'
      : '/api/v1/chat';
  return { method: 'POST' as const, path, contentType: 'application/json' as const };
}

function normalizeCatalogPricing(value: unknown, applyImageMarkup = false): NewApiCatalogPricing | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const mode = stringValue(raw.mode) as NewApiCatalogPricing['mode'];
  const unit = stringValue(raw.unit) as NewApiCatalogPricing['unit'];
  if (!['fixed', 'tiered', 'token'].includes(mode) || !['request', 'second', 'image', 'token'].includes(unit)) {
    return null;
  }
  if (mode === 'token') {
    const inputMultiplier = numberValue(raw.input_multiplier);
    const outputMultiplier = numberValue(raw.output_multiplier);
    const completionRatio = numberValue(raw.completion_ratio);
    const inputCreditsPerMillion = numberValue(raw.input_credits_per_million);
    const outputCreditsPerMillion = numberValue(raw.output_credits_per_million);
    if (inputMultiplier == null || inputMultiplier < 0 || outputMultiplier == null || outputMultiplier < 0) return null;
    if (inputCreditsPerMillion == null || inputCreditsPerMillion < 0 || outputCreditsPerMillion == null || outputCreditsPerMillion < 0) return null;
    const groups = normalizedPricingGroups(raw.groups, mode, applyImageMarkup);
    return {
      mode,
      unit,
      inputMultiplier,
      outputMultiplier,
      inputCreditsPerMillion,
      outputCreditsPerMillion,
      ...(completionRatio != null && completionRatio >= 0 ? { completionRatio } : {}),
      ...(groups.length ? { groups } : {})
    };
  }
  const yuan = numberValue(raw.yuan);
  const credits = applyImageMarkup
    ? imageRetailCreditsFromYuan(raw.yuan)
    : (() => {
        const yuanValue = numberValue(raw.yuan);
        return yuanValue == null ? null : rounded(yuanValue * 100);
      })();
  if (yuan == null || yuan < 0 || credits == null) return null;
  const tiers = normalizedPricingTiers(raw.tiers, applyImageMarkup);
  const groups = normalizedPricingGroups(raw.groups, mode, applyImageMarkup);
  const rawQuantityParameter = stringValue(raw.quantity_parameter) || null;
  const quantityParameter = rawQuantityParameter === 'quality'
    && tiers.some(tier => 'resolution' in tier.when && !('quality' in tier.when))
    ? 'resolution'
    : rawQuantityParameter;
  return {
    mode,
    unit,
    yuan,
    credits,
    ...(tiers.length ? { tiers } : {}),
    ...(groups.length ? { groups } : {}),
    quantityParameter
  };
}

function normalizeCatalogParameter(value: unknown): NewApiCatalogParameter | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name);
  const path = stringValue(raw.path);
  const type = stringValue(raw.type) as NewApiCatalogParameter['type'];
  if (!name || !path || !['string', 'integer', 'number', 'boolean', 'array', 'object'].includes(type)) {
    return null;
  }
  const parameter: NewApiCatalogParameter = {
    name,
    path,
    label: stringValue(raw.label) || name,
    type,
    required: booleanValue(raw.required)
  };
  if ('default' in raw) parameter.default = raw.default;
  if ('fixed' in raw) parameter.fixed = raw.fixed;
  if (Array.isArray(raw.options)) parameter.options = [...raw.options];
  for (const key of ['min', 'max', 'min_items', 'max_items'] as const) {
    const value = numberValue(raw[key]);
    if (value != null) parameter[key] = value;
  }
  if (raw.items && typeof raw.items === 'object') parameter.items = raw.items as Record<string, unknown>;
  return parameter;
}

function declaredParameterValues(parameter: NewApiCatalogParameter): unknown[] {
  if (parameter.options?.length) return parameter.options;
  if (Object.prototype.hasOwnProperty.call(parameter, 'fixed')) return [parameter.fixed];
  if (Object.prototype.hasOwnProperty.call(parameter, 'default')) return [parameter.default];
  return [];
}

function isLegacyResolutionQualityParameter(parameter: NewApiCatalogParameter): boolean {
  const name = parameter.name.toLowerCase();
  const path = parameter.path.toLowerCase();
  if (name !== 'quality' && path !== 'quality') return false;
  const values = declaredParameterValues(parameter)
    .map(value => String(value).trim().toLowerCase())
    .filter(Boolean);
  return values.length > 0 && values.every(value => IMAGE_RESOLUTION_VALUES.has(value));
}

function normalizeLegacyResolutionParameters(
  parameters: NewApiCatalogParameter[]
): NewApiCatalogParameter[] {
  const normalized: NewApiCatalogParameter[] = [];
  for (const parameter of parameters) {
    const next = isLegacyResolutionQualityParameter(parameter)
      ? { ...parameter, name: 'resolution', path: 'resolution', label: '分辨率' }
      : parameter;
    if (next.name === 'resolution' && normalized.some(item => item.name === 'resolution')) continue;
    normalized.push(next);
  }
  return normalized;
}

function isBananaUpstreamModel(upstreamModel: string): boolean {
  return /^(?:nano[-_]?banana|banana|lingtu)(?:[-_]|$)/i.test(upstreamModel.trim());
}

function ensureBananaReferenceCapability(
  parameters: NewApiCatalogParameter[],
  upstreamModel: string,
  family?: PublicImageFamily | null
): NewApiCatalogParameter[] {
  if (family !== 'banana' && !isBananaUpstreamModel(upstreamModel)) return parameters;
  const imagesIndex = parameters.findIndex(parameter => (
    parameter.name.toLowerCase() === 'images' || parameter.path.toLowerCase() === 'images'
  ));
  if (imagesIndex >= 0) {
    return parameters.map((parameter, index) => index === imagesIndex
      ? { ...parameter, max_items: NEWAPI_BANANA_IMAGE_REF_LIMIT }
      : parameter);
  }
  return [
    ...parameters,
    {
      name: 'images',
      path: 'images',
      label: '参考图',
      type: 'array',
      required: false,
      max_items: NEWAPI_BANANA_IMAGE_REF_LIMIT,
      items: { type: 'string', format: 'uri-or-data-image' }
    }
  ];
}

function isImage2ExtModel(upstreamModel: string): boolean {
  return upstreamModel.trim().toLowerCase() === 'gpt-image-2-ext';
}

function isImage2K4KModel(upstreamModel: string): boolean {
  return upstreamModel.trim().toLowerCase() === 'image2k4k';
}

function isImage2Fixed4KModel(upstreamModel: string): boolean {
  return new Set([
    'image2-4k-fast',
    'gpt-image-2-4k-fast',
    'gpt-image-2-4k-adobe'
  ]).has(upstreamModel.trim().toLowerCase());
}

function qualityParameterIndex(parameters: NewApiCatalogParameter[]): number {
  return parameters.findIndex(parameter => (
    parameter.name.toLowerCase() === 'quality' || parameter.path.toLowerCase() === 'quality'
  ));
}

function withFixedImageQuality(
  parameters: NewApiCatalogParameter[],
  quality: 'low' | 'standard'
): NewApiCatalogParameter[] {
  const index = qualityParameterIndex(parameters);
  const fixed: NewApiCatalogParameter = {
    name: 'quality',
    path: 'quality',
    label: '质量',
    type: 'string',
    required: false,
    fixed: quality
  };
  return index < 0
    ? [...parameters, fixed]
    : parameters.map((parameter, parameterIndex) => parameterIndex === index ? fixed : parameter);
}

function normalizeImageQualityContract(
  parameters: NewApiCatalogParameter[],
  upstreamModel: string,
  family?: PublicImageFamily | null
): NewApiCatalogParameter[] {
  if (isImage2ExtModel(upstreamModel)) {
    return parameters.filter((_, index) => index !== qualityParameterIndex(parameters));
  }
  if (isImage2K4KModel(upstreamModel)) return withFixedImageQuality(parameters, 'low');
  if (isImage2Fixed4KModel(upstreamModel)) return withFixedImageQuality(parameters, 'standard');
  if (family === 'banana' || isBananaUpstreamModel(upstreamModel)) {
    const index = qualityParameterIndex(parameters);
    const selectable: NewApiCatalogParameter = {
      name: 'quality',
      path: 'quality',
      label: '质量',
      type: 'string',
      required: false,
      default: 'medium',
      options: ['low', 'medium', 'high']
    };
    return index < 0
      ? [...parameters, selectable]
      : parameters.map((parameter, parameterIndex) => parameterIndex === index ? selectable : parameter);
  }
  return parameters;
}

function normalizeImageCatalogParameters(
  parameters: NewApiCatalogParameter[],
  upstreamModel: string,
  family?: PublicImageFamily | null
): NewApiCatalogParameter[] {
  return normalizeImageQualityContract(
    ensureBananaReferenceCapability(
      family === 'midjourney' ? parameters : normalizeLegacyResolutionParameters(parameters),
      upstreamModel,
      family
    ),
    upstreamModel,
    family
  );
}

function resolutionOptions(
  parameters: NewApiCatalogParameter[],
  upstreamModel = ''
): ('1k' | '2k' | '4k')[] {
  const parameter = parameters.find((item) => item.name === 'resolution' || item.path === 'resolution');
  const values = parameter ? declaredParameterValues(parameter) : [];
  const explicit = values
    .map((value) => stringValue(value).toLowerCase())
    .filter((value): value is '1k' | '2k' | '4k' => value === '1k' || value === '2k' || value === '4k');
  if (explicit.length) return [...new Set(explicit)];
  const inferred = String(upstreamModel).toLowerCase().match(/(?:^|[-_])(1k|2k|4k)(?:[-_]|$)/)?.[1];
  return inferred === '1k' || inferred === '2k' || inferred === '4k' ? [inferred] : [];
}

type PublicImageFamily = Extract<ImageModelUiFamily, 'gim2' | 'banana' | 'midjourney' | 'jimeng'>;

function publicTagTokens(value: unknown): Set<string> {
  const tags = Array.isArray(value) ? value : stringValue(value).split(',');
  return new Set(tags.map(tag => stringValue(tag).toLowerCase()).filter(Boolean));
}

function inferPublicImageFamily(
  item: Record<string, unknown>,
  upstreamModel: string,
  parameters: NewApiCatalogParameter[]
): PublicImageFamily | null {
  const legacyFamily = stringValue(item.family).toLowerCase();
  if (legacyFamily === 'gim2' || legacyFamily === 'banana' || legacyFamily === 'midjourney') return legacyFamily;
  if (legacyFamily === 'gim2-chat' && upstreamModel === 'gpt-image-2-chat') return 'gim2';

  const declared = item.public && typeof item.public === 'object'
    ? item.public as Record<string, unknown>
    : null;
  const modelParameter = parameters.find(parameter => parameter.name === 'model' || parameter.path === 'model');
  const identities = [
    upstreamModel,
    stringValue(declared?.id),
    stringValue(modelParameter?.fixed)
  ].map(value => value.toLowerCase()).filter(Boolean);
  const tags = publicTagTokens(item.tags);
  const labels = [
    stringValue(item.label),
    stringValue(declared?.label)
  ].filter(Boolean);

  if (
    tags.has('image2')
    || tags.has('gim2')
    || identities.some(value => /^(?:gpt[-_]?image[-_]?2|image2)(?:[-_]|$)/i.test(value))
    || labels.some(value => /(?:\b(?:gpt\s*image\s*2|image\s*2)\b|全能模型2)/i.test(value))
  ) {
    return 'gim2';
  }
  if (
    tags.has('banana')
    || tags.has('nano-banana')
    || identities.some(value => /^(?:nano[-_]?banana|banana|lingtu)(?:[-_]|$)/i.test(value))
    || labels.some(value => /(?:\b(?:nano\s*banana|banana)\b|香蕉)/i.test(value))
  ) {
    return 'banana';
  }
  if (
    tags.has('midjourney')
    || identities.some(value => /^mj(?:[-_]|$)/i.test(value))
    || labels.some(value => /midjourney/i.test(value))
  ) {
    return 'midjourney';
  }
  if (
    tags.has('jimeng')
    || tags.has('seedream')
    || identities.some(value => /(?:seedream|jimeng)/i.test(value))
    || labels.some(value => /seedream/i.test(value))
  ) {
    return 'jimeng';
  }
  // sensenova 等通用生图型号：归入 jimeng，与 seedream 同属"其他模型"公开分组，
  // 不伪装成全能模型2。
  if (identities.some(value => /sensenova/i.test(value))) {
    return 'jimeng';
  }
  return null;
}

function fixedQualityLowFromPublicParameters(parameters: NewApiCatalogParameter[]): boolean {
  return parameters.some(parameter => {
    if (parameter.name.toLowerCase() !== 'quality' && parameter.path.toLowerCase() !== 'quality') return false;
    if (stringValue(parameter.fixed).toLowerCase() === 'low') return true;
    const options = (parameter.options || []).map(option => stringValue(option).toLowerCase()).filter(Boolean);
    return options.length === 1 && options[0] === 'low';
  });
}

function ensureImage2Ext1kResolution(
  parameters: NewApiCatalogParameter[],
  upstreamModel: string
): NewApiCatalogParameter[] {
  if (upstreamModel.toLowerCase() !== 'gpt-image-2-ext') return parameters;
  return parameters.map(parameter => {
    const isResolutionParameter = parameter.name.toLowerCase() === 'quality'
      || parameter.name.toLowerCase() === 'resolution'
      || parameter.path.toLowerCase() === 'quality'
      || parameter.path.toLowerCase() === 'resolution';
    if (!isResolutionParameter || !Array.isArray(parameter.options)) return parameter;
    const options = parameter.options.map(value => String(value).toLowerCase());
    if (!options.includes('2k') && !options.includes('4k')) return parameter;
    if (options.includes('1k')) return parameter;
    return { ...parameter, options: ['1k', ...parameter.options] };
  });
}

function catalogModelsWithKnownCapabilities(payload: Record<string, unknown>): unknown[] {
  const models = Array.isArray(payload.models) ? [...payload.models] : [];
  const hasFreeImage = models.some(raw => (
    raw && typeof raw === 'object' && stringValue((raw as Record<string, unknown>).id) === 'gpt-image-2-free'
  ));
  const freeImageAdvertised = (Array.isArray(payload.unclassified_models) ? payload.unclassified_models : [])
    .some(raw => raw && typeof raw === 'object'
      && stringValue((raw as Record<string, unknown>).id) === 'gpt-image-2-free');
  if (!hasFreeImage && freeImageAdvertised) {
    models.push({
      id: 'gpt-image-2-free',
      label: 'GPT Image 2 Free',
      description: '免费生图模型，固定 1K。',
      modality: 'image',
      family: 'gim2',
      operation: 'generate',
      order: 19,
      selectable: true,
      tags: 'image,openai,image2,free,1k,ratios',
      public: FALLBACK_PUBLIC_PRESENTATION['gpt-image-2-free'],
      integrations: { prompt_hub: { id: 'image2-free', fixed_quality_low: false } },
      parameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'gpt-image-2-free' },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, fixed: '1k' },
        { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, default: 'auto', options: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'] },
        { name: 'n', path: 'n', label: '生成张数', type: 'integer', required: false, fixed: 1 }
      ],
      pricing: { mode: 'fixed', unit: 'image', yuan: 0, credits: 0 }
    });
  }
  return models;
}

function parseCatalogPayload(payload: unknown): NewApiCatalogSnapshot | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.success === false || !Array.isArray(p.models)) return null;
  const models: NewApiCatalogModel[] = [];
  const rules: NewApiPricingRule[] = [];
  const imageCatalogEntries: ImageModelCatalogEntry[] = [];
  for (const raw of catalogModelsWithKnownCapabilities(p)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const upstreamModel = stringValue(item.id);
    const modality = stringValue(item.modality) as NewApiModelModality;
    if (!upstreamModel || item.selectable !== true || !['text', 'image', 'video', 'audio'].includes(modality)) continue;
    const pricing = normalizeCatalogPricing(item.pricing, modality === 'image');
    if (!pricing) continue;
    const rawParameters = (Array.isArray(item.parameters) ? item.parameters : [])
      .map(normalizeCatalogParameter)
      .filter((parameter): parameter is NewApiCatalogParameter => parameter != null);
    const imageFamily = modality === 'image'
      ? inferPublicImageFamily(item, upstreamModel, rawParameters)
      : null;
    const parameters = ensureImage2Ext1kResolution(
      modality === 'image'
        ? normalizeImageCatalogParameters(rawParameters, upstreamModel, imageFamily)
        : rawParameters,
      upstreamModel
    );
    const presentation = publicPresentation(item, upstreamModel, imageFamily || stringValue(item.family));
    if (!presentation) continue;
    const publicParameters = parameters.map(parameter =>
      parameter.name === 'model'
        ? { ...parameter, fixed: presentation.id }
        : { ...parameter }
    );
    models.push({
      id: presentation.id,
      upstreamModel,
      label: presentation.label,
      description: presentation.description,
      modality,
      operation: stringValue(item.operation) === 'chat' ? 'chat' : 'generate',
      order: numberValue(item.order) ?? 100,
      endpoint: publicEndpoint(modality),
      parameters: projectPublicCatalogParameters(publicParameters, presentation.id),
      pricing
    });

    const isChatImage = modality === 'image'
      && upstreamModel === 'gpt-image-2-chat'
      && (stringValue(item.operation) === 'chat' || pricing.unit === 'request');
    const isMidjourneyImage = modality === 'image'
      && imageFamily === 'midjourney'
      && pricing.unit === 'request';
    if (
      modality !== 'image'
      || !imageFamily
      || (pricing.unit !== 'image' && !isChatImage && !isMidjourneyImage)
      || pricing.credits == null
      || pricing.credits < 0
    ) continue;
    const resolutions: ('1k' | '2k' | '4k')[] = isChatImage || isMidjourneyImage
      ? ['1k']
      : resolutionOptions(parameters, upstreamModel);
    if (upstreamModel === 'gpt-image-2-ext' && !resolutions.includes('1k')) {
      resolutions.unshift('1k');
    }
    if (!resolutions.length) continue;
    const creditsByResolution: Partial<Record<'1k' | '2k' | '4k', number>> = {};
    for (const tier of pricing.tiers || []) {
      const resolution = stringValue(tier.when.resolution ?? tier.when.quality).toLowerCase();
      if ((resolution === '1k' || resolution === '2k' || resolution === '4k') && tier.credits >= 0) {
        creditsByResolution[resolution] = tier.credits;
      }
    }
    const integration = item.integrations && typeof item.integrations === 'object'
      ? (item.integrations as Record<string, unknown>).prompt_hub
      : null;
    const promptHub = integration && typeof integration === 'object'
      ? integration as Record<string, unknown>
      : {};
    const family = imageFamily;
    const publicId = presentation.id || stringValue(promptHub.id) || `newapi-${upstreamModel}`;
    const description = presentation.description || null;
    const label = presentation.label;
    rules.push({
      model: upstreamModel,
      credits: pricing.credits,
      ...(Object.keys(creditsByResolution).length ? { creditsByResolution } : {}),
      description,
      tags: sanitizePublicModelTags(item.tags),
      label,
      modality: 'image',
      parameters
    });
    imageCatalogEntries.push({
      id: publicId,
      provider: 'newapi',
      uiFamily: family,
      upstream: upstreamModel,
      label,
      group: 'new',
      description: description || '',
      upstreamPoints: pricing.yuan ?? 0,
      refundOnViolation: true,
      resolutions,
      defaultCredits: pricing.credits,
      pricingByResolution: Object.keys(creditsByResolution).length > 0,
      ...(Object.keys(creditsByResolution).length ? { defaultCreditsByResolution: creditsByResolution } : {}),
      fixedQualityLow: booleanValue(promptHub.fixed_quality_low)
        || fixedQualityLowFromPublicParameters(parameters),
      sortOrder: numberValue(item.order) ?? 100
    });
  }
  return {
    available: true,
    stale: booleanValue(p.stale),
    fetchedAt: stringValue(p.fetched_at),
    version: stringValue(p.version),
    pricingVersion: stringValue(p.pricing_version),
    models: models.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    rules,
    imageCatalogEntries
  };
}

export async function fetchNewApiModelCatalog(
  baseUrl?: string,
  opts?: { force?: boolean; requireFresh?: boolean; maxAgeMs?: number }
): Promise<NewApiCatalogSnapshot> {
  const base = apiBase(baseUrl);
  const now = Date.now();
  const requestedMaxAgeMs = Number.isFinite(opts?.maxAgeMs)
    ? Math.max(0, Number(opts?.maxAgeMs))
    : null;
  if (!opts?.force && catalogCache && catalogCache.base === base) {
    const cacheMs = catalogCache.snapshot.stale
      ? STALE_CATALOG_RETRY_MS
      : PRICING_CACHE_MS;
    const cachedAge = now - catalogCache.at;
    const sourceAge = newApiCatalogAgeMs(catalogCache.snapshot, now);
    const withinRequestedAge = requestedMaxAgeMs == null
      || Math.max(cachedAge, sourceAge) <= requestedMaxAgeMs;
    if (cachedAge < cacheMs && withinRequestedAge) return catalogCache.snapshot;
  }
  // A force refresh is still a fresh network request. Share it with callers
  // arriving while that request is in flight instead of stampeding the
  // catalog service with parallel refresh=1 requests.
  if (catalogInflight?.base === base) return catalogInflight.promise;

  const promise = fetch(catalogUrl(base, opts?.force === true), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`model catalog ${res.status}`);
        const snapshot = parseCatalogPayload(await res.json());
        if (!snapshot) throw new Error('invalid model catalog payload');
        if (!snapshot.fetchedAt && !snapshot.stale) {
          snapshot.fetchedAt = new Date().toISOString();
        }
        if (catalogCache?.base === base && losesReviewedImagePricingCoverage(catalogCache.snapshot, snapshot)) {
          throw new Error('model catalog image pricing coverage regressed');
        }
        catalogCache = { base, at: Date.now(), snapshot };
        return snapshot;
      })
      .catch((e) => {
        console.warn('[newapi] model catalog fetch failed', e);
        const cachedAge = catalogCache?.base === base ? Date.now() - catalogCache.at : Infinity;
        const fallbackMaxAgeMs = requestedMaxAgeMs
          ?? (opts?.requireFresh ? PRICING_CACHE_MS : null);
        const sourceAge = catalogCache?.base === base
          ? newApiCatalogAgeMs(catalogCache.snapshot)
          : Infinity;
        if (
          catalogCache?.base === base
          && (fallbackMaxAgeMs == null || Math.max(cachedAge, sourceAge) <= fallbackMaxAgeMs)
        ) {
          return { ...catalogCache.snapshot, stale: true };
        }
        if (opts?.requireFresh || requestedMaxAgeMs != null) throw e;
        return {
          available: false,
          stale: true,
          version: '',
          pricingVersion: '',
          models: [],
          rules: [],
          imageCatalogEntries: []
        };
      })
      .finally(() => {
        if (catalogInflight?.promise === promise) catalogInflight = null;
      });
  catalogInflight = { base, promise };
  return promise;
}

export function newApiCatalogAgeMs(
  snapshot: Pick<NewApiCatalogSnapshot, 'fetchedAt'>,
  now = Date.now()
): number {
  const fetchedAt = Date.parse(String(snapshot.fetchedAt || ''));
  if (!Number.isFinite(fetchedAt)) return Infinity;
  return Math.max(0, now - fetchedAt);
}

export async function fetchTrustedNewApiPricingCatalog(
  baseUrl?: string,
  maxAgeMs = NEWAPI_PRICING_CATALOG_MAX_AGE_MS
): Promise<NewApiCatalogSnapshot> {
  const trustedMaxAgeMs = Math.max(0, Number(maxAgeMs) || 0);
  const snapshot = await fetchNewApiModelCatalog(baseUrl, {
    requireFresh: true,
    maxAgeMs: trustedMaxAgeMs
  });
  if (!snapshot.available || !snapshot.rules.length || !snapshot.imageCatalogEntries.length) {
    throw new Error('image pricing catalog is incomplete');
  }
  if (newApiCatalogAgeMs(snapshot) > trustedMaxAgeMs) {
    throw new Error('image pricing catalog is too old');
  }
  return snapshot;
}

export async function fetchNewApiAdminRoutes(
  baseUrl?: string,
  secret?: string,
  opts?: { force?: boolean }
): Promise<NewApiAdminRouteSnapshot> {
  const base = apiBase(baseUrl);
  const credential = String(secret || '').trim();
  if (!credential) {
    return { available: false, fetchedAt: '', routes: {}, error: '渠道目录密钥未配置' };
  }
  if (!opts?.force && adminRouteCache && adminRouteCache.base === base && Date.now() - adminRouteCache.at < ADMIN_ROUTE_CACHE_MS) {
    return adminRouteCache.snapshot;
  }

  try {
    const response = await fetch(adminRouteCatalogUrl(base, opts?.force === true), {
      headers: {
        Accept: 'application/json',
        'X-Catalog-Admin-Secret': credential
      },
      signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.success !== true || !payload.routes || typeof payload.routes !== 'object') {
      throw new Error(`route catalog ${response.status}`);
    }

    const routes: Record<string, NewApiAdminRoute[]> = {};
    for (const [model, value] of Object.entries(payload.routes as Record<string, unknown>)) {
      if (!model.trim() || !Array.isArray(value)) continue;
      const items = value
        .map((raw): NewApiAdminRoute | null => {
          if (!raw || typeof raw !== 'object') return null;
          const row = raw as Record<string, unknown>;
          const statusValue = stringValue(row.status);
          const status: NewApiAdminRoute['status'] = statusValue === 'active'
            ? 'active'
            : statusValue === 'auto_disabled'
              ? 'auto_disabled'
              : 'disabled';
          const channelName = stringValue(row.channel_name);
          const actualModel = stringValue(row.actual_model);
          if (!channelName || !actualModel) return null;
          return {
            channelId: numberValue(row.channel_id) ?? 0,
            channelName,
            status,
            enabled: row.enabled === true && status === 'active',
            groups: Array.isArray(row.groups) ? row.groups.map(stringValue).filter(Boolean) : [],
            actualModel,
            priority: numberValue(row.priority) ?? 0,
            weight: numberValue(row.weight) ?? 0,
            upstreamHost: stringValue(row.upstream_host)
          };
        })
        .filter((route): route is NewApiAdminRoute => route != null);
      if (items.length) routes[model] = items;
    }

    const snapshot: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: stringValue(payload.fetched_at),
      routes,
      error: null
    };
    adminRouteCache = { base, at: Date.now(), snapshot };
    return snapshot;
  } catch (error) {
    const message = String((error as Error).message || error).slice(0, 160);
    if (adminRouteCache?.base === base) {
      return {
        ...adminRouteCache.snapshot,
        error: message
      };
    }
    return {
      available: false,
      fetchedAt: '',
      routes: {},
      error: message
    };
  }
}

export async function fetchNewApiPricingRules(baseUrl?: string, opts?: { force?: boolean; requireFresh?: boolean }): Promise<NewApiPricingRule[]> {
  return (await fetchNewApiModelCatalog(baseUrl, opts)).rules;
}

const PUBLIC_DEEPSEEK_TEXT_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro'
]);

function isRetainedPublicTextModel(model: NewApiCatalogModel): boolean {
  if (model.modality !== 'text') return true;
  const identities = [model.id, model.upstreamModel].map(value => value.trim().toLowerCase());
  if (identities.some(value => /(?:^|[\/_-])glm[-_.]?5[-_.]?1(?:$|[\/_-])/.test(value))) {
    return false;
  }
  if (identities.some(value => value.includes('deepseek'))) {
    return PUBLIC_DEEPSEEK_TEXT_MODELS.has(model.id.trim().toLowerCase());
  }
  return true;
}

function isPublicCatalogModel(snapshot: NewApiCatalogSnapshot, model: NewApiCatalogModel): boolean {
  if (!isRetainedPublicTextModel(model)) return false;
  if (model.modality !== 'image') return true;
  return snapshot.imageCatalogEntries.some(entry => (
    entry.upstream === model.upstreamModel && isPublicNewApiImageEntry(entry)
  ));
}

export function publicNewApiCatalogModels(snapshot: NewApiCatalogSnapshot) {
  return snapshot.models
    .filter(model => (
      isPublicCatalogModel(snapshot, model)
      && (model.modality !== 'image' || !snapshot.stale)
    ))
    .map(model => projectPublicCatalogModel(model))
    .filter((model): model is NonNullable<typeof model> => model != null);
}

const SCOPED_MODEL_PATTERN = /^_sf-([A-Za-z0-9_-]+)::(.+)$/;

function publicCatalogPricing(pricing: NewApiCatalogPricing) {
  return projectPublicCatalogPricing(pricing as unknown as Record<string, unknown>);
}

function projectPublicCatalogModel(model: NewApiCatalogModel) {
  const id = sanitizePublicModelId(model.id);
  if (!id) return null;
  const label = sanitizePublicModelLabel(model.label, id);
  const { upstreamModel: _upstreamModel, ...publicModel } = model;
  return {
    ...publicModel,
    id,
    label,
    description: sanitizePublicModelDescription(model.description),
    parameters: projectPublicCatalogParameters(model.parameters, id),
    pricing: publicCatalogPricing(model.pricing)
  };
}

function pricingGroupScore(group: NewApiCatalogPricingGroup): number {
  if (group.credits != null) return group.credits;
  const input = group.inputCreditsPerMillion ?? group.inputMultiplier ?? Number.POSITIVE_INFINITY;
  const output = group.outputCreditsPerMillion ?? group.outputMultiplier ?? Number.POSITIVE_INFINITY;
  return input + output;
}

function pricingForRoute(pricing: NewApiCatalogPricing, route: NewApiAdminRoute): NewApiCatalogPricing {
  const routeGroups = new Set(route.groups);
  const group = (pricing.groups || [])
    .filter(candidate => routeGroups.has(candidate.id))
    .sort((left, right) => pricingGroupScore(left) - pricingGroupScore(right) || left.id.localeCompare(right.id))[0];
  if (!group) return pricing;
  if (pricing.mode === 'token') {
    const inputRatio = pricing.inputMultiplier && group.inputMultiplier != null
      ? group.inputMultiplier / pricing.inputMultiplier
      : 1;
    const outputRatio = pricing.outputMultiplier && group.outputMultiplier != null
      ? group.outputMultiplier / pricing.outputMultiplier
      : 1;
    return {
      ...pricing,
      inputMultiplier: group.inputMultiplier ?? pricing.inputMultiplier,
      outputMultiplier: group.outputMultiplier ?? pricing.outputMultiplier,
      completionRatio: group.completionRatio ?? pricing.completionRatio,
      inputCreditsPerMillion: group.inputCreditsPerMillion
        ?? (pricing.inputCreditsPerMillion == null ? undefined : rounded(pricing.inputCreditsPerMillion * inputRatio)),
      outputCreditsPerMillion: group.outputCreditsPerMillion
        ?? (pricing.outputCreditsPerMillion == null ? undefined : rounded(pricing.outputCreditsPerMillion * outputRatio))
    };
  }
  return {
    ...pricing,
    yuan: group.yuan ?? pricing.yuan,
    credits: group.credits ?? pricing.credits,
    tiers: group.tiers?.length ? group.tiers : pricing.tiers
  };
}

async function scopedRouteToken(upstreamModel: string, channelId: number): Promise<string> {
  const bytes = new TextEncoder().encode(`canvas-route-v1:${upstreamModel}:${channelId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const byte of digest.slice(0, 15)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function activeModelRoutes(routeSnapshot: NewApiAdminRouteSnapshot, upstreamModel: string) {
  const requestedModel = String(upstreamModel || '').trim();
  if (!requestedModel) return [];
  const target = normalizeImageModelId(requestedModel);
  const unique = new Map<number, NewApiAdminRoute>();
  for (const [routeModel, routes] of Object.entries(routeSnapshot.routes)) {
    if (normalizeImageModelId(routeModel) !== target) continue;
    for (const route of routes) {
      if (route.enabled && route.channelId > 0 && !unique.has(route.channelId)) unique.set(route.channelId, route);
    }
  }
  return [...unique.values()];
}

export function newApiHasActiveRoute(routeSnapshot: NewApiAdminRouteSnapshot, upstreamModel: string): boolean {
  return activeModelRoutes(routeSnapshot, upstreamModel).length > 0;
}

function routeLabel(index: number) {
  return `线路 ${index + 1}`;
}

export async function publicNewApiRoutedCatalogModels(
  snapshot: NewApiCatalogSnapshot,
  routeSnapshot: NewApiAdminRouteSnapshot
) {
  const models = snapshot.models.filter(model => isPublicCatalogModel(snapshot, model));
  const result: NonNullable<ReturnType<typeof projectPublicCatalogModel>>[] = [];
  for (const model of models) {
    if (
      (model.modality === 'image' || model.modality === 'video')
      && !newApiHasActiveRoute(routeSnapshot, model.upstreamModel)
    ) {
      continue;
    }
    const publicModel = projectPublicCatalogModel(model);
    if (publicModel) result.push(publicModel);
  }
  return result.sort((left, right) => Number(left.order) - Number(right.order) || String(left.label).localeCompare(String(right.label)));
}

export async function resolveNewApiRoutedCatalogModel(
  snapshot: NewApiCatalogSnapshot,
  routeSnapshot: NewApiAdminRouteSnapshot,
  modelId: string,
  modality?: NewApiModelModality
): Promise<NewApiResolvedCatalogModel | null> {
  const requestedModelId = String(modelId || '').trim();
  const scoped = requestedModelId.match(SCOPED_MODEL_PATTERN);
  if (!scoped) {
    const model = resolveNewApiCatalogModel(snapshot, requestedModelId, modality);
    return model ? { model, route: null, requestedModelId: model.id } : null;
  }
  const model = resolveNewApiCatalogModel(snapshot, scoped[2], modality);
  if (!model) return null;
  const routes = activeModelRoutes(routeSnapshot, model.upstreamModel);
  for (const [index, route] of routes.entries()) {
    if (await scopedRouteToken(model.upstreamModel, route.channelId) !== scoped[1]) continue;
    return {
      model: {
        ...model,
        id: requestedModelId,
        label: `${model.label} · ${routeLabel(index)}`,
        pricing: pricingForRoute(model.pricing, route)
      },
      route,
      requestedModelId
    };
  }
  return null;
}

export function newApiKeyForRoute(apiKey: string, route: Pick<NewApiAdminRoute, 'channelId'> | null | undefined) {
  return route?.channelId ? `${apiKey}-${route.channelId}` : apiKey;
}

export function resolveNewApiCatalogModel(
  snapshot: NewApiCatalogSnapshot,
  modelId: string,
  modality?: NewApiModelModality
): NewApiCatalogModel | null {
  const value = String(modelId || '').trim().toLowerCase();
  if (!value) return null;
  return snapshot.models.find(model =>
    isPublicCatalogModel(snapshot, model)
    &&
    (!modality || model.modality === modality)
    && (model.id.toLowerCase() === value || model.upstreamModel.toLowerCase() === value)
  ) || null;
}

export function newApiFixedCreditsForRequest(
  model: NewApiCatalogModel,
  params: Record<string, unknown>
): number | null {
  if (model.pricing.mode === 'token' || model.pricing.credits == null) return null;
  const tier = model.pricing.tiers?.find(candidate =>
    Object.entries(candidate.when).every(([key, expected]) =>
      String(params[key] ?? '').toLowerCase() === String(expected).toLowerCase()
    )
  );
  const unitCredits = tier?.credits ?? model.pricing.credits;
  const quantityKey = model.pricing.quantityParameter
    || (model.pricing.unit === 'second' ? 'duration' : model.pricing.unit === 'image' ? 'n' : '');
  const quantity = quantityKey ? Math.max(1, Number(params[quantityKey]) || 1) : 1;
  return rounded(unitCredits * quantity);
}

export function newApiTextCreditsForUsage(
  model: NewApiCatalogModel,
  inputTokens: number,
  outputTokens: number
): number | null {
  if (model.modality !== 'text') return null;
  if (model.pricing.mode !== 'token') {
    return newApiFixedCreditsForRequest(model, {});
  }
  const inputRate = model.pricing.inputCreditsPerMillion;
  const outputRate = model.pricing.outputCreditsPerMillion;
  if (inputRate == null || outputRate == null) return null;
  const credits = (Math.max(0, inputTokens) * inputRate + Math.max(0, outputTokens) * outputRate) / 1_000_000;
  return rounded(credits);
}

export function imageCatalogForNewApiSnapshot(snapshot: NewApiCatalogSnapshot): ImageModelCatalogEntry[] {
  const newApiEntries = snapshot.available
    ? snapshot.imageCatalogEntries.filter(isPublicNewApiImageEntry)
    : NEWAPI_IMAGE_MODEL_CATALOG.filter(isPublicNewApiImageEntry);
  return newApiEntries;
}

function normalizedResolution(resolution?: string | null): '1k' | '2k' | '4k' | null {
  const r = String(resolution || '').trim().toLowerCase();
  return r === '1k' || r === '2k' || r === '4k' ? r : null;
}

function pricingCandidates(upstreamModel: string, resolution?: string | null): string[] {
  const model = upstreamModel.trim();
  if (!model) return [];
  const res = normalizedResolution(resolution);
  if (!res) return [model];
  const withoutRes = model.replace(/-(?:1k|2k|4k)$/i, '');
  const candidates = [
    model,
    `${withoutRes}-${res}`,
    withoutRes
  ];
  return [...new Set(candidates)];
}

export function newApiCreditsForModel(
  rules: NewApiPricingRule[],
  upstreamModel: string,
  resolution?: string | null
): number | null {
  const candidates = pricingCandidates(upstreamModel, resolution).map((m) => m.toLowerCase());
  const exact = candidates
    .map(candidate => rules.find(rule => rule.model.toLowerCase() === candidate))
    .find((rule): rule is NewApiPricingRule => !!rule);
  const res = normalizedResolution(resolution);
  if (exact && res && exact.creditsByResolution?.[res] != null) {
    return exact.creditsByResolution[res] ?? null;
  }
  return exact?.credits ?? null;
}

function pickErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== 'object') return `New API error (${status})`;
  const p = payload as Record<string, unknown>;
  const err = p.error && typeof p.error === 'object' ? p.error as Record<string, unknown> : null;
  return stringValue(err?.message) || stringValue(p.message) || stringValue(p.error) || `New API error (${status})`;
}

function collectDataImageUrls(payload: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function walk(value: unknown): void {
    if (typeof value === 'string') {
      const s = value.trim();
      if (/^data:image\//i.test(s) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.b64_json === 'string') {
        const mime = stringValue(o.mime_type) || 'image/png';
        walk(`data:${mime};base64,${o.b64_json}`);
      }
      Object.values(o).forEach(walk);
    }
  }
  walk(payload);
  return out;
}

function collectHttpImageUrls(payload: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function walk(value: unknown): void {
    if (typeof value === 'string') {
      const s = value.trim();
      if (/^https?:\/\//i.test(s) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  }
  walk(payload);
  return out;
}

function extractAllNewApiImageUrls(payload: unknown): string[] {
  const urls = extractAllImageUrls(payload);
  const httpUrls = collectHttpImageUrls(payload);
  const dataUrls = collectDataImageUrls(payload);
  const seen = new Set(urls);
  return [
    ...urls,
    ...httpUrls.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    }),
    ...dataUrls.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    })
  ];
}

function legacyRequestBody(params: SubmitParams): Record<string, unknown> {
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  const model = params.upstreamModel.trim();
  const quality = isImage2ExtModel(model)
    ? undefined
    : isImage2K4KModel(model)
      ? 'low'
      : isImage2Fixed4KModel(model)
        ? 'standard'
        : params.fixedQualityLow
          ? 'low'
          : mapQualityForGptImage(params.quality);
  return {
    model,
    prompt: params.prompt,
    n: Math.max(1, Math.floor(params.count || 1)),
    size: params.size || '1:1',
    resolution: params.resolution,
    ...(quality ? { quality } : {}),
    ...(refs?.length ? { images: refs.slice(0, NEWAPI_BANANA_IMAGE_REF_LIMIT) } : {})
  };
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function declaredValue(
  parameter: NewApiCatalogParameter,
  requested: unknown,
  fallback?: unknown
): unknown {
  if (hasOwn(parameter, 'fixed')) return parameter.fixed;
  const candidate = requested ?? (hasOwn(parameter, 'default') ? parameter.default : fallback);
  if (!parameter.options?.length || candidate == null) return candidate;
  const matched = parameter.options.find(option =>
    String(option).toLowerCase() === String(candidate).toLowerCase()
  );
  if (matched != null) return matched;
  const declaredFallback = hasOwn(parameter, 'default') ? parameter.default : parameter.options[0];
  return declaredFallback;
}

function setRequestPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (value == null || value === '') return;
  const keys = path.split('.').map(key => key.trim()).filter(Boolean);
  if (!keys.length || keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) return;
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

export function buildNewApiImageRequestBody(params: SubmitParams): Record<string, unknown> {
  const declaredParameters = params.catalogParameters
    ?.filter(parameter => parameter?.name && parameter.path) || [];
  if (!declaredParameters.length) return legacyRequestBody(params);
  const parameters = normalizeImageCatalogParameters(
    declaredParameters,
    params.upstreamModel
  );
  const body: Record<string, unknown> = {};
  const byName = new Map(parameters.map(parameter => [parameter.name, parameter]));
  const set = (name: string, requested: unknown, fallback?: unknown) => {
    const parameter = byName.get(name);
    if (!parameter) return;
    setRequestPath(body, parameter.path, declaredValue(parameter, requested, fallback));
  };

  set('model', params.upstreamModel);
  set('prompt', params.prompt);
  set('size', params.size);
  set('resolution', params.resolution);

  const qualityParameter = byName.get('quality');
  if (qualityParameter) {
    const quality = params.fixedQualityLow
      ? 'low'
      : mapQualityForGptImage(params.quality);
    set('quality', quality);
  }

  const countParameter = byName.get('n') ?? byName.get('count');
  if (countParameter) {
    const raw = Number(declaredValue(countParameter, params.count, 1));
    const bounded = Math.min(
      countParameter.max ?? 1,
      Math.max(countParameter.min ?? 1, Number.isFinite(raw) ? raw : 1)
    );
    setRequestPath(body, countParameter.path, Math.max(1, Math.floor(bounded)));
  }

  const refs = (params.refImageUrls || []).filter(Boolean);
  const imagesParameter = byName.get('images');
  if (refs.length && imagesParameter) {
    const max = Math.max(1, imagesParameter.max_items ?? refs.length);
    setRequestPath(body, imagesParameter.path, refs.slice(0, max));
  } else if (refs.length) {
    set('image', refs[0]);
  }
  return body;
}

function buildNewApiMidjourneyRequestBody(params: SubmitParams): Record<string, unknown> {
  const parameters = params.catalogParameters
    ?.filter(parameter => parameter?.name && parameter.path) || [];
  const byName = new Map(parameters.map(parameter => [parameter.name, parameter]));
  const body: Record<string, unknown> = {};
  const mj = params.mjParams || {};
  const requestedValue = (name: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(mj, name)) return mj[name];
    if (name === 'negative_prompt') return mj.negativePrompt;
    return undefined;
  };
  const set = (name: string, requested: unknown, fallback?: unknown) => {
    const parameter = byName.get(name);
    if (!parameter) return;
    setRequestPath(body, parameter.path, declaredValue(parameter, requested, fallback));
  };

  set('model', params.upstreamModel);
  set('prompt', params.prompt);
  set('size', params.size);
  set('quality', requestedValue('quality'), params.resolution);
  for (const parameter of parameters) {
    if (['model', 'prompt', 'size', 'quality', 'image_urls'].includes(parameter.name)) continue;
    set(parameter.name, requestedValue(parameter.name));
  }
  const refs = (params.refImageUrls || []).filter(Boolean);
  const images = byName.get('image_urls');
  if (images && refs.length) {
    const max = Math.max(1, images.max_items ?? refs.length);
    setRequestPath(body, images.path, refs.slice(0, max));
  }
  // The API station exposes only the regular-price Midjourney tier.
  if (byName.has('speed')) set('speed', 'relax');
  else body.speed = 'relax';
  return body;
}

function extractChatImageUrls(payload: unknown): string[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message
    : null;
  const content = message && typeof message === 'object'
    ? (message as Record<string, unknown>).content
    : null;
  const urls = extractAllNewApiImageUrls({ data: { output: content } });
  if (typeof content === 'string') {
    const markdown = [...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)/gi)]
      .map(match => match[1]);
    return [...new Set([...urls, ...markdown])];
  }
  return urls;
}

function buildChatImageMessages(prompt: string, refImageUrls?: string[]): Array<Record<string, unknown>> {
  const refs = (refImageUrls || []).filter(Boolean).slice(0, NEWAPI_CHAT_IMAGE_REF_LIMIT);
  if (!refs.length) return [{ role: 'user', content: prompt }];
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...refs.map(url => ({
        type: 'image_url',
        image_url: { url }
      }))
    ]
  }];
}

export async function submitNewApiImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<{ taskId: string; imageUrl?: string | null; imageUrls?: string[]; requestId?: string | null }> {
  const isChatImage = params.upstreamModel === 'gpt-image-2-chat';
  const isMidjourneyImage = /^mj-/i.test(params.upstreamModel);
  const endpoint = isChatImage
    ? '/v1/chat/completions'
    : isMidjourneyImage
      ? '/v1/midjourney/generations'
      : '/v1/images/generations';
  const body = isChatImage
    ? {
        model: params.upstreamModel,
        messages: buildChatImageMessages(params.prompt, params.refImageUrls),
        stream: false
      }
    : isMidjourneyImage
      ? buildNewApiMidjourneyRequestBody(params)
      : buildNewApiImageRequestBody(params);
  let res: Response;
  try {
    res = await fetch(`${apiBase(baseUrl)}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(params.clientRequestId
          ? {
              'Idempotency-Key': params.clientRequestId,
              'X-Client-Request-Id': params.clientRequestId
            }
          : {})
      },
      body: JSON.stringify(body)
    });
  } catch {
    // A transport failure does not prove the paid request failed. Never retry it here.
    throw new ApiError(502, 'UPSTREAM_OUTCOME_UNKNOWN', 'upstream_outcome_unknown');
  }

  const headerRequestId =
    stringValue(res.headers.get('x-request-id'))
    || stringValue(res.headers.get('x-oneapi-request-id'))
    || null;
  if (headerRequestId && params.onRequestId) {
    try {
      await params.onRequestId(headerRequestId);
    } catch (error) {
      console.warn('[newapi-image] request id persistence failed', error);
    }
  }

  let json: unknown = {};
  let parsed = false;
  try {
    json = await res.json();
    parsed = true;
  } catch {
    json = {};
  }

  if (!res.ok) {
    const status = res.status || 502;
    throw new ApiError(
      status >= 500 ? 502 : status,
      'UPSTREAM_ERROR',
      pickErrorMessage(json, status)
    );
  }
  if (!parsed) {
    throw new ApiError(502, 'UPSTREAM_OUTCOME_UNKNOWN', 'upstream_response_unreadable');
  }

  const imageUrls = isChatImage ? extractChatImageUrls(json) : extractAllNewApiImageUrls(json);
  const taskId = extractTaskId(json);
  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const requestId =
    stringValue(root.request_id || root.requestId)
    || headerRequestId
    || null;
  if (requestId && requestId !== headerRequestId && params.onRequestId) {
    try {
      await params.onRequestId(requestId);
    } catch (error) {
      console.warn('[newapi-image] response request id persistence failed', error);
    }
  }
  if (taskId) return { taskId, imageUrl: imageUrls[0] || null, imageUrls, requestId };
  if (imageUrls.length) {
    return { taskId: `newapi-${crypto.randomUUID()}`, imageUrl: imageUrls[0], imageUrls, requestId };
  }
  throw new ApiError(502, 'UPSTREAM_OUTCOME_UNKNOWN', 'upstream_response_missing_result');
}

function isContentViolationMessage(msg: string | null | undefined): boolean {
  return /violation|moderation|policy|prohibited|flagged|blocked|safety|敏感|违规/i.test(String(msg || ''));
}

export async function fetchNewApiTaskOnce(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<NewApiTaskPollResult> {
  if (taskId.startsWith('newapi-')) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  const res = await fetch(`${apiBase(baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }

  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const status = stringValue(data.status || root.status).toLowerCase();
  const imageUrls = extractAllNewApiImageUrls(json);

  if (['completed', 'succeeded', 'success', 'done'].includes(status) || (status !== 'failed' && imageUrls.length)) {
    return imageUrls.length
      ? { status: 'completed', imageUrl: imageUrls[0], imageUrls, errorMessage: null }
      // A task may become terminal before the provider exposes its output.
      // Keep it pending so the caller can confirm the result instead of
      // refunding a successful paid request as `upstream_no_image`.
      : { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  if (['failed', 'failure', 'error', 'timeout', 'cancelled', 'canceled'].includes(status)) {
    const raw = stringValue(data.error_message || data.error || root.error || 'upstream_failed');
    return {
      status: 'failed',
      imageUrl: null,
      imageUrls: [],
      errorMessage: isContentViolationMessage(raw) ? 'upstream_content_violation' : raw
    };
  }
  return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}

export async function confirmNewApiTaskOutcome(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<NewApiTaskPollResult> {
  const attempts = Math.max(1, opts?.attempts ?? 8);
  const intervalMs = Math.max(500, opts?.intervalMs ?? 2000);
  for (let i = 0; i < attempts; i += 1) {
    const r = await fetchNewApiTaskOnce(apiKey, baseUrl, taskId);
    if (r.status === 'completed' || r.status === 'failed') return r;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}
