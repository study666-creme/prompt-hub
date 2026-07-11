import { ApiError } from './errors';
import { extractAllImageUrls, extractTaskId } from './apimart';
import {
  IMAGE_MODEL_CATALOG,
  type ImageModelCatalogEntry,
  type ImageModelUiFamily
} from './image-models-catalog';
import { mapQualityForGptImage } from './pricing';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  fixedQualityLow?: boolean;
  size?: string;
  refImageUrls?: string[];
};

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

export type NewApiTaskPollResult = {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
};

const PRICING_CACHE_MS = 5 * 60_000;
const CREDITS_PER_YUAN = 100;

const FALLBACK_PUBLIC_PRESENTATION: Record<string, { id: string; label: string; description: string }> = {
  'gpt-5.5': { id: 'creative-5-5', label: '创作 5.5', description: '通用创作与推理模型，最高 xhigh 思考。' },
  'gpt-5.6-sol': { id: 'creative-5-6', label: '创作 5.6', description: '旗舰创作与推理模型，最高 ultra 思考。' },
  'gpt-image-2': { id: 'image2', label: 'Image2', description: '标准生图模型，固定 1K。' },
  'gpt-image-2-ext': { id: 'image2-pro', label: 'Image2 Pro', description: '高质量生图模型，支持 2K/4K。' },
  image2k4k: { id: 'image2-hd', label: 'Image2 HD', description: '高分辨率经济模型，支持 2K/4K。' },
  'nano-banana-fast': { id: 'lingtu-fast', label: '灵图 极速', description: '快速生图模型，固定 1K。' },
  'nano-banana-2': { id: 'lingtu-2', label: '灵图 2', description: '通用生图模型，支持 1K/2K/4K。' },
  'nano-banana-pro': { id: 'lingtu-pro', label: '灵图 Pro', description: '高质量通用生图模型，支持 1K/2K/4K。' },
  'nano-banana': { id: 'lingtu', label: '灵图', description: '通用生图模型，支持 1K/2K/4K。' },
  'grok-video': { id: 'motion-video', label: '动态影像', description: '按秒计费的视频模型，支持文生、单图和多图生视频。' },
  'grok-video-1.5': { id: 'motion-video-1-5', label: '动态影像 1.5', description: '按秒计费的视频模型，支持单图生视频。' }
};

let catalogCache: { base: string; at: number; snapshot: NewApiCatalogSnapshot } | null = null;
let catalogInflight: { base: string; promise: Promise<NewApiCatalogSnapshot> } | null = null;

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

function creditsFromYuan(value: unknown): number | null {
  const yuan = numberValue(value);
  return yuan == null || yuan < 0 ? null : rounded(yuan * CREDITS_PER_YUAN);
}

function publicPresentation(item: Record<string, unknown>, upstreamModel: string) {
  const declared = item.public && typeof item.public === 'object'
    ? item.public as Record<string, unknown>
    : null;
  const fallback = FALLBACK_PUBLIC_PRESENTATION[upstreamModel] || {
    id: upstreamModel,
    label: stringValue(item.label) || upstreamModel,
    description: stringValue(item.description)
  };
  return {
    id: stringValue(declared?.id) || fallback.id,
    label: stringValue(declared?.label) || fallback.label,
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

function normalizeCatalogPricing(value: unknown): NewApiCatalogPricing | null {
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
    return {
      mode,
      unit,
      inputMultiplier,
      outputMultiplier,
      inputCreditsPerMillion,
      outputCreditsPerMillion,
      ...(completionRatio != null && completionRatio >= 0 ? { completionRatio } : {})
    };
  }
  const yuan = numberValue(raw.yuan);
  const credits = creditsFromYuan(raw.yuan);
  if (yuan == null || yuan < 0 || credits == null) return null;
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map((value): NewApiCatalogPricingTier | null => {
      if (!value || typeof value !== 'object') return null;
      const tier = value as Record<string, unknown>;
      const tierYuan = numberValue(tier.yuan);
      const tierCredits = creditsFromYuan(tier.yuan);
      const when = tier.when && typeof tier.when === 'object'
        ? Object.fromEntries(
            Object.entries(tier.when as Record<string, unknown>)
              .filter(([, condition]) => ['string', 'number', 'boolean'].includes(typeof condition))
          ) as Record<string, string | number | boolean>
        : {};
      if (tierYuan == null || tierYuan < 0 || tierCredits == null || !Object.keys(when).length) return null;
      return { when, yuan: tierYuan, credits: tierCredits };
    })
    .filter((tier): tier is NewApiCatalogPricingTier => tier != null);
  return {
    mode,
    unit,
    yuan,
    credits,
    ...(tiers.length ? { tiers } : {}),
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

function resolutionOptions(parameters: NewApiCatalogParameter[]): ('1k' | '2k' | '4k')[] {
  const parameter = parameters.find((item) => item.name === 'resolution' || item.name === 'quality');
  const values = parameter?.options?.length
    ? parameter.options
    : parameter && 'fixed' in parameter
      ? [parameter.fixed]
      : [];
  return values
    .map((value) => stringValue(value).toLowerCase())
    .filter((value): value is '1k' | '2k' | '4k' => value === '1k' || value === '2k' || value === '4k');
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
    if (!upstreamModel || item.selectable !== true || !['text', 'image', 'video', 'audio'].includes(modality)) continue;
    const pricing = normalizeCatalogPricing(item.pricing);
    if (!pricing) continue;
    const parameters = (Array.isArray(item.parameters) ? item.parameters : [])
      .map(normalizeCatalogParameter)
      .filter((parameter): parameter is NewApiCatalogParameter => parameter != null);
    const presentation = publicPresentation(item, upstreamModel);
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

    if (modality !== 'image' || pricing.unit !== 'image' || pricing.credits == null || pricing.credits <= 0) continue;
    const resolutions = resolutionOptions(parameters);
    if (!resolutions.length) continue;
    const creditsByResolution: Partial<Record<'1k' | '2k' | '4k', number>> = {};
    for (const tier of pricing.tiers || []) {
      const resolution = stringValue(tier.when.quality ?? tier.when.resolution).toLowerCase();
      if ((resolution === '1k' || resolution === '2k' || resolution === '4k') && tier.credits > 0) {
        creditsByResolution[resolution] = tier.credits;
      }
    }
    const integration = item.integrations && typeof item.integrations === 'object'
      ? (item.integrations as Record<string, unknown>).prompt_hub
      : null;
    const promptHub = integration && typeof integration === 'object'
      ? integration as Record<string, unknown>
      : {};
    const familyValue = stringValue(item.family);
    if (!['gim2', 'banana', 'jimeng', 'midjourney', 'wan', 'flux'].includes(familyValue)) continue;
    const family = familyValue as ImageModelUiFamily;
    const publicId = presentation.id || stringValue(promptHub.id) || `newapi-${upstreamModel}`;
    const description = presentation.description || null;
    const label = presentation.label;
    rules.push({
      model: upstreamModel,
      credits: pricing.credits,
      ...(Object.keys(creditsByResolution).length ? { creditsByResolution } : {}),
      description,
      tags: stringValue(item.tags).toLowerCase(),
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
      fixedQualityLow: booleanValue(promptHub.fixed_quality_low),
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
      signal: AbortSignal.timeout(5000)
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

export async function fetchNewApiPricingRules(baseUrl?: string, opts?: { force?: boolean; requireFresh?: boolean }): Promise<NewApiPricingRule[]> {
  return (await fetchNewApiModelCatalog(baseUrl, opts)).rules;
}

export function publicNewApiCatalogModels(snapshot: NewApiCatalogSnapshot) {
  return snapshot.models.map(({ upstreamModel: _upstreamModel, ...model }) => model);
}

export function resolveNewApiCatalogModel(
  snapshot: NewApiCatalogSnapshot,
  modelId: string,
  modality?: NewApiModelModality
): NewApiCatalogModel | null {
  const value = String(modelId || '').trim().toLowerCase();
  if (!value) return null;
  return snapshot.models.find(model =>
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
  if (!snapshot.available) return IMAGE_MODEL_CATALOG;
  return [
    ...IMAGE_MODEL_CATALOG.filter((entry) => entry.provider !== 'newapi'),
    ...snapshot.imageCatalogEntries
  ];
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
    `${withoutRes}-${res}`,
    model,
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
  const exact = rules.find((r) => candidates.includes(r.model.toLowerCase()));
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

function requestBody(params: SubmitParams): Record<string, unknown> {
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  const model = params.upstreamModel.trim();
  const resolutionTierModel = model === 'gpt-image-2-ext' || model === 'image2k4k';
  return {
    model,
    prompt: params.prompt,
    n: 1,
    size: params.size || '1:1',
    resolution: params.resolution,
    quality: resolutionTierModel
      ? params.resolution
      : params.fixedQualityLow
        ? 'low'
        : mapQualityForGptImage(params.quality),
    ...(refs?.length ? { images: refs.slice(0, 14) } : {})
  };
}

export async function submitNewApiImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<{ taskId: string; imageUrl?: string | null }> {
  const res = await fetch(`${apiBase(baseUrl)}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody(params))
  });

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      pickErrorMessage(json, res.status)
    );
  }

  const imageUrls = extractAllNewApiImageUrls(json);
  const taskId = extractTaskId(json);
  if (taskId) return { taskId, imageUrl: imageUrls[0] || null };
  if (imageUrls.length) return { taskId: `newapi-${crypto.randomUUID()}`, imageUrl: imageUrls[0] };
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
