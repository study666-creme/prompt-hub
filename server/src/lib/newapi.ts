import { ApiError } from './errors';
import { extractAllImageUrls, extractTaskId } from './apimart';
import { imageRetailCreditsFromYuan } from './credit-math';
import {
  APIMART_IMAGE_MODEL_CATALOG,
  NEWAPI_IMAGE_MODEL_CATALOG,
  isPublicNewApiImageEntry,
  isRetainedPublicImageEntry,
  type ImageModelCatalogEntry,
  type ImageModelUiFamily
} from './image-models-catalog';
import { mapQualityForGptImage } from './pricing';
import { buildImageProtocolRequest, type ImageProtocolRequest } from './image-protocol';

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
  idempotencyKey?: string;
  mjParams?: Record<string, unknown>;
};

export const NEWAPI_CHAT_IMAGE_REF_LIMIT = 4;

export type NewApiPricingRule = {
  model: string;
  credits: number;
  creditsByResolution?: Partial<Record<'1k' | '2k' | '4k', number>>;
  pricingTiers?: NewApiCatalogPricingTier[];
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
const ADMIN_ROUTE_CACHE_MS = 30_000;
const NEWAPI_CATALOG_FETCH_TIMEOUT_MS = 15_000;
const PUBLIC_MIDJOURNEY_MODEL_IDS = new Set(['Midjourney v8.2 高速', 'mj-v82', 'mj-v81', 'mj-v7', 'mj-niji7']);
// The two live 8.2 entries are routed by New API to their configured API
// station channels. Older MJ ids remain on the legacy APIMart adapter.
const API_STATION_MIDJOURNEY_MODEL_IDS = new Set(['Midjourney v8.2 高速', 'mj-v82']);

const FALLBACK_PUBLIC_PRESENTATION: Record<string, { id: string; label: string; description: string }> = {
  'gpt-5.5': { id: 'creative-5-5', label: '全能模型5.5', description: '通用创作与推理模型，最高 xhigh 思考。' },
  'gpt-5.6-sol': { id: 'creative-5-6', label: '全能模型5.6', description: '旗舰创作与推理模型，最高 ultra 思考。' },
  'gpt-image-2-1k': { id: 'image2-economy', label: '全能模型2 · 特价 1K', description: '特价 1K 生图模型，支持参考图。' },
  'gpt-image-2-chat': { id: 'image2-economy', label: '全能模型2 · 特价 1K', description: '特价文字生图，固定 1K。' },
  'gpt-image-2': { id: 'image2', label: '全能模型2 · 1K', description: '标准生图模型，固定 1K。' },
  'gpt-image-2-4k-fast': { id: 'image2-4k-fast', label: '全能模型2 · 极速 4K', description: '固定 4K 的快速生图模型，支持多种画面比例。' },
  'gpt-image-2-ext': { id: 'image2-pro', label: '全能模型2 · 高质量 1K/2K/4K', description: '高质量生图模型，支持 1K/2K/4K。' },
  image2k4k: { id: 'image2-hd', label: '全能模型2 · 经济 2K/4K', description: '高分辨率经济模型，支持 2K/4K。' },
  'nano-banana-fast': { id: 'lingtu-fast', label: '香蕉 · Fast 1K', description: '快速生图模型，固定 1K。' },
  'nano-banana-2': { id: 'lingtu-2', label: '香蕉 · 2 1K/2K/4K', description: '通用生图模型，支持 1K/2K/4K。' },
  'nano-banana-pro': { id: 'lingtu-pro', label: '香蕉 · Pro 1K/2K/4K', description: '高质量通用生图模型，支持 1K/2K/4K。' },
  'nano-banana': { id: 'lingtu', label: '香蕉 · Standard 1K/2K/4K', description: '通用生图模型，支持 1K/2K/4K。' },
  'grok-imagine-video': { id: 'motion-video', label: 'Grok Video', description: '按秒计费的视频模型，支持文生、单图和多图生视频。' },
  'grok-imagine-video-1.5': { id: 'motion-video-1-5', label: 'Grok Video 1.5', description: '按秒计费的视频模型，支持单图生视频。' },
  'grok-video': { id: 'motion-video', label: 'Grok Video', description: '按秒计费的视频模型，支持文生、单图和多图生视频。' },
  'grok-video-1.5': { id: 'motion-video-1-5', label: 'Grok Video 1.5', description: '按秒计费的视频模型，支持单图生视频。' }
};

let catalogCache: { base: string; at: number; snapshot: NewApiCatalogSnapshot } | null = null;
let catalogInflight: { base: string; promise: Promise<NewApiCatalogSnapshot> } | null = null;
let adminRouteCache: { base: string; at: number; snapshot: NewApiAdminRouteSnapshot } | null = null;

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
  const canonical = FALLBACK_PUBLIC_PRESENTATION[upstreamModel];
  const fallback = canonical || {
    id: upstreamModel,
    label: stringValue(item.label) || upstreamModel,
    description: stringValue(item.description)
  };
  const label = canonical?.label || stringValue(declared?.label) || fallback.label;
  return {
    id: canonical?.id || stringValue(declared?.id) || fallback.id,
    label: canonical ? canonicalImageFamilyLabel(family, label) : label,
    description: stringValue(declared?.description) || fallback.description
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

function isMidjourneyCatalogItem(
  item: Record<string, unknown>,
  upstreamModel: string,
  modality: NewApiModelModality
): boolean {
  if (modality !== 'image' || !PUBLIC_MIDJOURNEY_MODEL_IDS.has(upstreamModel)) return false;
  const endpoint = item.endpoint && typeof item.endpoint === 'object'
    ? item.endpoint as Record<string, unknown>
    : null;
  return stringValue(endpoint?.path).replace(/\/$/, '') === '/v1/midjourney/generations';
}

function isApiStationMidjourneyModel(upstreamModel: string): boolean {
  return API_STATION_MIDJOURNEY_MODEL_IDS.has(String(upstreamModel || '').trim());
}

type CatalogImageFamily = ImageModelUiFamily | 'gim2-chat';

function inferredImageFamily(
  item: Record<string, unknown>,
  upstreamModel: string,
  modality: NewApiModelModality
): CatalogImageFamily | null {
  if (modality !== 'image') return null;
  const declared = stringValue(item.family).toLowerCase();
  if (declared === 'gim2' || declared === 'gim2-chat' || declared === 'banana') return declared;
  if (isMidjourneyCatalogItem(item, upstreamModel, modality)) return 'midjourney';

  const id = upstreamModel.toLowerCase();
  const tags = new Set(
    stringValue(item.tags)
      .toLowerCase()
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
  );
  if (id === 'gpt-image-2-chat') return 'gim2-chat';
  if (id.startsWith('nano-banana-') || id === 'nano-banana' || tags.has('banana')) return 'banana';
  if (
    id === 'image2k4k'
    || /^image2(?:-|$)/.test(id)
    || /^gpt-image-2(?:-|$)/.test(id)
    || tags.has('image2')
  ) return 'gim2';
  return null;
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
  return {
    mode,
    unit,
    yuan,
    credits,
    ...(tiers.length ? { tiers } : {}),
    ...(groups.length ? { groups } : {}),
    quantityParameter: stringValue(raw.quantity_parameter) || null
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

function resolutionOptions(
  parameters: NewApiCatalogParameter[],
  upstreamModel = ''
): ('1k' | '2k' | '4k')[] {
  const parameter = parameters.find((item) => item.name === 'resolution' || item.name === 'quality');
  const values = parameter?.options?.length
    ? parameter.options
    : parameter && 'fixed' in parameter
      ? [parameter.fixed]
      : [];
  const explicit = values
    .map((value) => stringValue(value).toLowerCase())
    .filter((value): value is '1k' | '2k' | '4k' => value === '1k' || value === '2k' || value === '4k');
  if (explicit.length) return [...new Set(explicit)];
  const inferred = String(upstreamModel).toLowerCase().match(/(?:^|[-_])(1k|2k|4k)(?:[-_]|$)/)?.[1];
  return inferred === '1k' || inferred === '2k' || inferred === '4k' ? [inferred] : [];
}

function parseCatalogPayload(payload: unknown): NewApiCatalogSnapshot | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.success === false || !Array.isArray(p.models)) return null;
  const models: NewApiCatalogModel[] = [];
  const rules: NewApiPricingRule[] = [];
  const imageCatalogEntries: ImageModelCatalogEntry[] = [];
  for (const raw of p.models) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const upstreamModel = stringValue(item.id);
    const modality = stringValue(item.modality) as NewApiModelModality;
    const familyValue = stringValue(item.family);
    if (!upstreamModel || item.selectable !== true || !['text', 'image', 'video', 'audio'].includes(modality)) continue;
    const pricing = normalizeCatalogPricing(item.pricing, modality === 'image');
    if (!pricing) continue;
    const parameters = (Array.isArray(item.parameters) ? item.parameters : [])
      .map(normalizeCatalogParameter)
      .filter((parameter): parameter is NewApiCatalogParameter => parameter != null);
    const isMidjourney = isMidjourneyCatalogItem(item, upstreamModel, modality);
    const imageFamily = inferredImageFamily(item, upstreamModel, modality);
    const output = item.output && typeof item.output === 'object'
      ? item.output as Record<string, unknown>
      : null;
    const outputCount = output?.count && typeof output.count === 'object'
      ? numberValue((output.count as Record<string, unknown>).fixed)
      : null;
    const presentation = publicPresentation(item, upstreamModel, imageFamily || familyValue);
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
      parameters: publicParameters,
      pricing
    });

    const isChatImage = imageFamily === 'gim2-chat' && upstreamModel === 'gpt-image-2-chat';
    if (
      modality !== 'image'
      || (pricing.unit !== 'image' && !isChatImage && !isMidjourney)
      || pricing.credits == null
      || pricing.credits < 0
    ) continue;
    const declaredResolutions = resolutionOptions(parameters, upstreamModel);
    const resolutions: ('1k' | '2k' | '4k')[] = isMidjourney
      ? (declaredResolutions.length ? declaredResolutions : ['1k'])
      : isChatImage
      ? ['1k']
      : resolutionOptions(parameters, upstreamModel);
    if (upstreamModel === 'gpt-image-2-ext' && !resolutions.includes('1k')) {
      resolutions.unshift('1k');
    }
    const creditsByResolution: Partial<Record<'1k' | '2k' | '4k', number>> = {};
    for (const tier of pricing.tiers || []) {
      const resolution = stringValue(tier.when.quality ?? tier.when.resolution).toLowerCase();
      const isResolutionOnly = Object.keys(tier.when).length === 1;
      if (isResolutionOnly && (resolution === '1k' || resolution === '2k' || resolution === '4k') && tier.credits >= 0) {
        creditsByResolution[resolution] = tier.credits;
      }
    }
    const integration = item.integrations && typeof item.integrations === 'object'
      ? (item.integrations as Record<string, unknown>).prompt_hub
      : null;
    const promptHub = integration && typeof integration === 'object'
      ? integration as Record<string, unknown>
      : {};
    const resolvedImageFamily = imageFamily || (modality === 'image' ? 'generic' : null);
    if (!resolvedImageFamily) continue;
    const family = (isChatImage ? 'gim2' : resolvedImageFamily) as ImageModelUiFamily;
    const publicId = presentation.id || stringValue(promptHub.id) || `newapi-${upstreamModel}`;
    const description = presentation.description || null;
    const label = presentation.label;
    if (!isMidjourney || isApiStationMidjourneyModel(upstreamModel)) {
      rules.push({
        model: upstreamModel,
        credits: pricing.credits,
        ...(Object.keys(creditsByResolution).length ? { creditsByResolution } : {}),
        ...(pricing.tiers?.length ? { pricingTiers: pricing.tiers } : {}),
        description,
        tags: stringValue(item.tags).toLowerCase(),
        label,
        modality: 'image',
        parameters
      });
    }
    imageCatalogEntries.push({
      id: publicId,
      provider: isMidjourney && !isApiStationMidjourneyModel(upstreamModel) ? 'apimart' : 'newapi',
      uiFamily: family,
      upstream: upstreamModel,
      label,
      group: upstreamModel === 'mj-v7' ? 'classic' : 'new',
      description: description || '',
      upstreamPoints: pricing.yuan ?? 0,
      ...(outputCount != null ? { outputCount } : {}),
      refundOnViolation: true,
      resolutions,
      defaultCredits: pricing.credits,
      pricingByResolution: !isMidjourney && Object.keys(creditsByResolution).length > 0,
      ...(!isMidjourney && Object.keys(creditsByResolution).length ? { defaultCreditsByResolution: creditsByResolution } : {}),
      ...(!isMidjourney ? { fixedQualityLow: booleanValue(promptHub.fixed_quality_low) } : {}),
      sortOrder: numberValue(item.order) ?? 100
    });
  }
  return {
    available: true,
    stale: booleanValue(p.stale),
    version: stringValue(p.version),
    pricingVersion: stringValue(p.pricing_version),
    models: models.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    rules,
    imageCatalogEntries
  };
}

export async function fetchNewApiModelCatalog(
  baseUrl?: string,
  opts?: { force?: boolean; requireFresh?: boolean }
): Promise<NewApiCatalogSnapshot> {
  const base = apiBase(baseUrl);
  const now = Date.now();
  if (!opts?.force && catalogCache && catalogCache.base === base && now - catalogCache.at < PRICING_CACHE_MS) {
    return catalogCache.snapshot;
  }
  if (!opts?.force && catalogInflight?.base === base) return catalogInflight.promise;

  const promise = fetch(catalogUrl(base, opts?.force === true), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(NEWAPI_CATALOG_FETCH_TIMEOUT_MS)
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`model catalog ${res.status}`);
        const snapshot = parseCatalogPayload(await res.json());
        if (!snapshot) throw new Error('invalid model catalog payload');
        catalogCache = { base, at: Date.now(), snapshot };
        return snapshot;
      })
      .catch((e) => {
        console.warn('[newapi] model catalog fetch failed', e);
        if (opts?.requireFresh) throw e;
        if (catalogCache?.base === base) return { ...catalogCache.snapshot, stale: true };
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
      signal: AbortSignal.timeout(NEWAPI_CATALOG_FETCH_TIMEOUT_MS)
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
    return {
      available: false,
      fetchedAt: '',
      routes: {},
      error: String((error as Error).message || error).slice(0, 160)
    };
  }
}

export async function fetchNewApiPricingRules(baseUrl?: string, opts?: { force?: boolean; requireFresh?: boolean }): Promise<NewApiPricingRule[]> {
  return (await fetchNewApiModelCatalog(baseUrl, opts)).rules;
}

function isPublicCatalogModel(snapshot: NewApiCatalogSnapshot, model: NewApiCatalogModel): boolean {
  if (model.modality !== 'image') return true;
  return snapshot.imageCatalogEntries.some(entry => entry.upstream === model.upstreamModel);
}

export function publicNewApiCatalogModels(snapshot: NewApiCatalogSnapshot) {
  return snapshot.models
    .filter(model => isPublicCatalogModel(snapshot, model))
    .map(({ upstreamModel: _upstreamModel, ...model }) => ({
      ...model,
      pricing: publicCatalogPricing(model.pricing)
    }));
}

const SCOPED_MODEL_PATTERN = /^_sf-([A-Za-z0-9_-]+)::(.+)$/;

function publicCatalogPricing(pricing: NewApiCatalogPricing): NewApiCatalogPricing {
  const { groups: _groups, ...publicPricing } = pricing;
  return publicPricing;
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
  if (!group) return publicCatalogPricing(pricing);
  if (pricing.mode === 'token') {
    const inputRatio = pricing.inputMultiplier && group.inputMultiplier != null
      ? group.inputMultiplier / pricing.inputMultiplier
      : 1;
    const outputRatio = pricing.outputMultiplier && group.outputMultiplier != null
      ? group.outputMultiplier / pricing.outputMultiplier
      : 1;
    return {
      ...publicCatalogPricing(pricing),
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
    ...publicCatalogPricing(pricing),
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
  const unique = new Map<number, NewApiAdminRoute>();
  for (const route of routeSnapshot.routes[upstreamModel] || []) {
    if (route.enabled && route.channelId > 0 && !unique.has(route.channelId)) unique.set(route.channelId, route);
  }
  return [...unique.values()];
}

function routeLabel(index: number) {
  return `线路 ${index + 1}`;
}

export async function publicNewApiRoutedCatalogModels(
  snapshot: NewApiCatalogSnapshot,
  routeSnapshot: NewApiAdminRouteSnapshot
) {
  const models = snapshot.models.filter(model => isPublicCatalogModel(snapshot, model));
  const result: Array<Omit<NewApiCatalogModel, 'upstreamModel'>> = [];
  for (const model of models) {
    const { upstreamModel: _upstreamModel, ...publicModel } = model;
    const routes = model.modality === 'image' ? [] : activeModelRoutes(routeSnapshot, model.upstreamModel);
    if (model.modality === 'video' && routeSnapshot.available && routes.length === 0) {
      continue;
    }
    if (routes.length <= 1) {
      result.push({ ...publicModel, pricing: publicCatalogPricing(model.pricing) });
      continue;
    }
    for (const [index, route] of routes.entries()) {
      const id = `_sf-${await scopedRouteToken(model.upstreamModel, route.channelId)}::${model.id}`;
      result.push({
        ...publicModel,
        id,
        label: `${model.label} · ${routeLabel(index)}`,
        order: model.order + index / 100,
        parameters: model.parameters.map(parameter => parameter.name === 'model' ? { ...parameter, fixed: id } : parameter),
        pricing: pricingForRoute(model.pricing, route)
      });
    }
  }
  return result.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
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
    if (!model) return null;
    if (model.modality !== 'video' || !routeSnapshot.available) {
      return { model, route: null, requestedModelId: model.id };
    }
    const routes = activeModelRoutes(routeSnapshot, model.upstreamModel);
    if (routes.length !== 1) return null;
    return {
      model: { ...model, pricing: pricingForRoute(model.pricing, routes[0]) },
      route: routes[0],
      requestedModelId: model.id
    };
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
  const tier = [...(model.pricing.tiers || [])]
    .sort((a, b) => Object.keys(b.when).length - Object.keys(a.when).length)
    .find(candidate =>
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
  const snapshotEntries = snapshot.available
    ? snapshot.imageCatalogEntries.filter(isRetainedPublicImageEntry)
    : NEWAPI_IMAGE_MODEL_CATALOG.filter(isPublicNewApiImageEntry);
  const merged = new Map<string, ImageModelCatalogEntry>();
  for (const entry of [
    ...snapshotEntries,
    ...APIMART_IMAGE_MODEL_CATALOG.filter(isRetainedPublicImageEntry)
  ]) {
    if (!merged.has(entry.id)) merged.set(entry.id, entry);
  }
  return [...merged.values()];
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
  resolution?: string | null,
  quality?: string | null
): number | null {
  const candidates = pricingCandidates(upstreamModel, resolution).map((m) => m.toLowerCase());
  const exact = candidates
    .map(candidate => rules.find(rule => rule.model.toLowerCase() === candidate))
    .find((rule): rule is NewApiPricingRule => !!rule);
  const res = normalizedResolution(resolution);
  const normalizedQuality = String(quality || '').toLowerCase();
  if (upstreamModel.toLowerCase() === 'image2-a' && normalizedQuality === 'high') {
    const baseTier = [...(exact?.pricingTiers || [])]
      .sort((a, b) => Object.keys(b.when).length - Object.keys(a.when).length)
      .find(candidate => {
        const whenQuality = candidate.when.quality;
        const whenResolution = candidate.when.resolution;
        return whenQuality == null
          && (whenResolution == null || String(whenResolution).toLowerCase() === res);
      });
    const baseCredits = baseTier?.credits
      ?? (res ? exact?.creditsByResolution?.[res] : null)
      ?? exact?.credits;
    if (baseCredits != null) return Math.round((baseCredits + 2) * 100) / 100;
  }
  const tier = [...(exact?.pricingTiers || [])]
    .sort((a, b) => Object.keys(b.when).length - Object.keys(a.when).length)
    .find(candidate =>
      Object.entries(candidate.when).every(([key, expected]) => {
        const actual = key === 'resolution' ? res : key === 'quality' ? quality : undefined;
        return actual != null && String(actual).toLowerCase() === String(expected).toLowerCase();
      })
    );
  if (tier) return tier.credits;
  if (exact && res && exact.creditsByResolution?.[res] != null) {
    return exact.creditsByResolution[res] ?? null;
  }
  return exact?.credits ?? null;
}

function pickErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== 'object') return 'request failed';
  const p = payload as Record<string, unknown>;
  const err = p.error && typeof p.error === 'object' ? p.error as Record<string, unknown> : null;
  return stringValue(err?.message) || stringValue(p.message) || stringValue(p.error) || 'request failed';
}

function pickErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  const err = p.error && typeof p.error === 'object' ? p.error as Record<string, unknown> : null;
  const code = stringValue(err?.code) || stringValue(p.code);
  return /^[a-z0-9_.:-]{2,80}$/i.test(code) ? code : '';
}

function newApiHttpErrorMessage(payload: unknown, status: number): string {
  const code = pickErrorCode(payload);
  const reason = pickErrorMessage(payload, status);
  return `HTTP ${status}${code ? ` [${code}]` : ''}: ${reason}`;
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

type NewApiImageResponsePayload = {
  payloads: unknown[];
  rawText: string;
};

function parseNewApiImageSse(rawText: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = line.match(/^data:\s?(.*)$/i);
    if (!match) continue;
    const data = match[1].trim();
    if (!data || data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore keepalive or non-JSON event data. A missing final image is
      // handled below as an invalid upstream response.
    }
  }
  return payloads;
}

async function readNewApiImageResponse(res: Response): Promise<NewApiImageResponsePayload> {
  const rawText = await res.text();
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return { payloads: parseNewApiImageSse(rawText), rawText };
  }
  try {
    return { payloads: [JSON.parse(rawText)], rawText };
  } catch {
    return { payloads: [], rawText };
  }
}

function newApiImageStreamError(payloads: unknown[]): unknown | null {
  return payloads.find(payload => {
    if (!payload || typeof payload !== 'object') return false;
    const root = payload as Record<string, unknown>;
    const type = stringValue(root.type).toLowerCase();
    return type === 'error' || type === 'upstream_error' || root.error != null;
  }) || null;
}

function preferredNewApiImagePayloads(payloads: unknown[]): unknown[] {
  const completed = payloads.filter(payload => {
    if (!payload || typeof payload !== 'object') return false;
    return stringValue((payload as Record<string, unknown>).type).toLowerCase().includes('completed');
  });
  return completed.length ? completed : [...payloads].reverse();
}

function legacyRequestBody(params: SubmitParams): Record<string, unknown> {
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  const model = params.upstreamModel.trim();
  const resolutionTierModel = model === 'gpt-image-2-ext' || model === 'image2k4k';
  return {
    model,
    prompt: params.prompt,
    n: Math.max(1, Math.floor(params.count || 1)),
    size: params.size || '1:1',
    resolution: params.resolution,
    quality: resolutionTierModel
      ? params.resolution
      : params.fixedQualityLow
        ? 'low'
        : mapQualityForGptImage(params.quality),
    ...(model.toLowerCase() === 'gpt-image-2-1k' ? { response_format: 'b64_json' } : {}),
    ...(refs?.length ? { images: refs.slice(0, 14) } : {})
  };
}

function imageProtocolForSubmit(params: SubmitParams): ImageProtocolRequest {
  const model = params.upstreamModel.trim();
  const resolutionTierModel = model === 'gpt-image-2-ext' || model === 'image2k4k';
  return buildImageProtocolRequest({
    model,
    prompt: params.prompt,
    resolution: params.resolution,
    aspectRatio: params.size || '1:1',
    quality: resolutionTierModel
      ? params.resolution
      : params.fixedQualityLow
        ? 'low'
        : mapQualityForGptImage(params.quality),
    count: Math.max(1, Math.floor(params.count || 1)),
    mediaInputs: (params.refImageUrls || []).filter(Boolean).map((url) => ({ kind: 'image' as const, role: 'reference' as const, url }))
  });
}

function isApiStationMidjourneyRequest(model: string): boolean {
  return API_STATION_MIDJOURNEY_MODEL_IDS.has(String(model || '').trim());
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
  const parameters = params.catalogParameters?.filter(parameter => parameter?.name && parameter.path) || [];
  if (!parameters.length) return legacyRequestBody(params);
  const protocol = imageProtocolForSubmit(params);
  const body: Record<string, unknown> = {};
  const byName = new Map(parameters.map(parameter => [parameter.name, parameter]));
  const set = (name: string, requested: unknown, fallback?: unknown) => {
    const parameter = byName.get(name);
    if (!parameter) return;
    setRequestPath(body, parameter.path, declaredValue(parameter, requested, fallback));
  };

  set('model', params.upstreamModel);
  set('prompt', protocol.prompt);
  set('size', protocol.aspect_ratio);
  set('resolution', protocol.resolution);

  const qualityParameter = byName.get('quality');
  if (qualityParameter) {
    const resolutionQuality = (qualityParameter.options || [])
      .map(value => String(value).toLowerCase())
      .some(value => value === '1k' || value === '2k' || value === '4k');
    const quality = resolutionQuality ? protocol.resolution : protocol.quality;
    set('quality', quality);
  }

  const nParameter = byName.get('n');
  if (nParameter) {
    const raw = Number(declaredValue(nParameter, protocol.count, 1));
    const bounded = Math.min(nParameter.max ?? 1, Math.max(nParameter.min ?? 1, Number.isFinite(raw) ? raw : 1));
    setRequestPath(body, nParameter.path, Math.max(1, Math.floor(bounded)));
  }

  const refs = (protocol.media_inputs || []).filter((item) => item.role === 'reference').map((item) => item.url);
  const imagesParameter = byName.get('images');
  if (refs.length && imagesParameter) {
    const max = Math.max(1, imagesParameter.max_items ?? refs.length);
    setRequestPath(body, imagesParameter.path, refs.slice(0, max));
  } else if (refs.length) {
    set('image', refs[0]);
  }
  if (isApiStationMidjourneyRequest(params.upstreamModel)) {
    // One API-station task returns the four-image MJ gallery. Keep the
    // provider submission count fixed at one and pass only documented MJ
    // controls through the OpenAI-compatible endpoint.
    if (typeof params.mjParams?.raw === 'boolean') set('raw', params.mjParams.raw);
    set('n', 1);
  }
  if (params.upstreamModel.toLowerCase() === 'gpt-image-2-1k') {
    body.response_format = 'b64_json';
  }
  return body;
}

function extractChatImageUrls(payload: unknown): string[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : null;
  const message = firstChoice
    ? firstChoice.message
    : null;
  const content = message && typeof message === 'object'
    ? (message as Record<string, unknown>).content
    : null;
  const urls = [
    message,
    firstChoice,
    root.data,
    root.output,
    root.response
  ].flatMap(extractAllNewApiImageUrls);
  if (typeof content === 'string') {
    const markdown = [...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)/gi)]
      .map(match => match[1]);
    const plainLinks = [...content.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
      .map(match => match[0]);
    return [...new Set([...urls, ...markdown, ...plainLinks])];
  }
  return [...new Set(urls)];
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
  const isMidjourney = isApiStationMidjourneyRequest(params.upstreamModel);
  const endpoint = isChatImage
    ? '/v1/chat/completions'
    : isMidjourney
      ? '/v1/midjourney/generations'
      : '/v1/images/generations';
  const body = isChatImage
    ? {
        model: params.upstreamModel,
        messages: buildChatImageMessages(params.prompt, params.refImageUrls),
        stream: false
      }
    : buildNewApiImageRequestBody(params);
  const idempotencyKey = stringValue(params.idempotencyKey).slice(0, 128);
  let res: Response | null = null;
  res = await fetch(`${apiBase(baseUrl)}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(!isChatImage ? { Prefer: 'respond-async' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });

  const response = await readNewApiImageResponse(res);
  const json = response.payloads[0] || {};

  if (!res?.ok) {
    const status = res?.status || 502;
    const errorPayload = response.payloads[0]
      || (response.rawText.trim() ? { message: response.rawText.trim().slice(0, 400) } : {});
    throw new ApiError(
      status >= 500 ? 502 : status,
      'UPSTREAM_ERROR',
      newApiHttpErrorMessage(errorPayload, status)
    );
  }

  const streamError = newApiImageStreamError(response.payloads);
  if (streamError) {
    throw new ApiError(502, 'UPSTREAM_ERROR', newApiHttpErrorMessage(streamError, 502));
  }

  const preferredPayloads = preferredNewApiImagePayloads(response.payloads);
  const imageUrls = [...new Set(preferredPayloads.flatMap(payload =>
    isChatImage ? extractChatImageUrls(payload) : extractAllNewApiImageUrls(payload)
  ))];
  const taskPayload = preferredPayloads.find(payload => extractTaskId(payload)) || json;
  const root = taskPayload && typeof taskPayload === 'object' ? taskPayload as Record<string, unknown> : {};
  const taskId = extractTaskId(taskPayload) || stringValue(root.task_id || root.id) || null;
  const requestId =
    stringValue(root.request_id || root.requestId)
    || stringValue(res.headers.get('x-request-id'))
    || stringValue(res.headers.get('x-oneapi-request-id'))
    || null;
  if (taskId) {
    return {
      taskId,
      imageUrl: imageUrls[0] || null,
      imageUrls,
      requestId
    };
  }
  if (imageUrls.length) {
    return { taskId: `newapi-${crypto.randomUUID()}`, imageUrl: imageUrls[0], imageUrls, requestId };
  }
  throw new ApiError(502, 'UPSTREAM_ERROR', 'New API 未返回 task_id 或图片');
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
      : { status: 'failed', imageUrl: null, imageUrls: [], errorMessage: 'upstream_no_image' };
  }
  if (['failed', 'failure', 'error', 'timeout', 'cancelled', 'canceled'].includes(status)) {
    const errorPayload = data.error_message || data.error || root.error || root;
    const raw = typeof errorPayload === 'string'
      ? errorPayload
      : (() => {
          const code = pickErrorCode(data) || pickErrorCode(root);
          const reason = pickErrorMessage(data, res.status) || pickErrorMessage(root, res.status);
          return `${code ? `[${code}] ` : ''}${reason || 'upstream_failed'}`;
        })();
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
