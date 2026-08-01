const PRIVATE_TEXT_PATTERN = /(?:\b(?:apimart|grsai|thinkai|ithink|mooko|new\s*api)\b|卡藏\s*api|上游|供应商|供货商|渠道|通道|线路|路由|采购|进货|成本|毛利|利润|倍率|加价|结算价|内部价|实时价|优先级|权重|故障转移|failover|upstream|provider|reseller|channel|route|priority|weight|margin|markup|multiplier|base\s*url)/i;
const PRIVATE_PARAMETER_PATTERN = /(?:upstream|provider|reseller|channel|route|group|priority|weight|margin|markup|multiplier|cost|base_?url|api_?key)/i;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const URL_OR_DOMAIN_PATTERN = /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|cn|dev|app|cloud)(?:\/\S*)?/gi;

const PUBLIC_TAGS = new Set([
  'text', 'image', 'video', 'audio', 'chat', 'generate', 'free', 'fast', 'lite',
  'pro', 'standard', 'quality', 'reasoning', 'vision', 'reference', 'multi-image',
  'ratios', '1k', '2k', '4k'
]);

const PUBLIC_PARAMETER_LABELS: Record<string, string> = {
  model: '模型',
  prompt: '提示词',
  quality: '质量',
  resolution: '分辨率',
  size: '画面比例',
  aspect_ratio: '画面比例',
  image: '参考图',
  images: '参考图',
  n: '生成张数',
  count: '生成张数',
  duration: '时长',
  seconds: '时长',
  speed: '速度'
};

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(URL_OR_DOMAIN_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsPrivatePublicMetadata(value: unknown): boolean {
  const text = String(value ?? '');
  URL_OR_DOMAIN_PATTERN.lastIndex = 0;
  return PRIVATE_TEXT_PATTERN.test(text) || URL_OR_DOMAIN_PATTERN.test(text);
}

export function sanitizePublicModelText(
  value: unknown,
  opts?: { fallback?: string; maxLength?: number }
): string {
  const fallback = cleanText(opts?.fallback || '');
  const maxLength = Math.max(1, Math.min(500, opts?.maxLength ?? 240));
  const raw = cleanText(value);
  if (!raw) return fallback.slice(0, maxLength);

  const retained = raw
    .split(/[|｜;；\n]+/)
    .map(part => part.trim())
    .filter(part => part && !PRIVATE_TEXT_PATTERN.test(part));
  const safe = retained.join('；').replace(/\s*[·•]\s*$/g, '').trim();
  return (safe || fallback).slice(0, maxLength);
}

export function sanitizePublicModelLabel(value: unknown, fallback = '模型'): string {
  return sanitizePublicModelText(value, { fallback, maxLength: 80 });
}

export function sanitizePublicModelDescription(value: unknown): string {
  return sanitizePublicModelText(value, { fallback: '', maxLength: 240 });
}

export function sanitizePublicModelId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  if (!PUBLIC_ID_PATTERN.test(id)) return null;
  if (id.startsWith('_sf-') || PRIVATE_TEXT_PATTERN.test(id)) return null;
  return id;
}

export function sanitizePublicModelTags(value: unknown): string {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(raw
    .map(tag => String(tag).trim().toLowerCase())
    .filter(tag => PUBLIC_TAGS.has(tag)))]
    .join(',');
}

function safePrimitive(value: unknown): unknown | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const text = cleanText(value).slice(0, 160);
    return text && !containsPrivatePublicMetadata(text) ? text : undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 64).map(safePrimitive).filter(item => item !== undefined);
  }
  return undefined;
}

export type PublicCatalogParameter = {
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
  aggregateConstraint?: {
    fields: string[];
    maxTotalItems: number;
  };
};

export function projectPublicCatalogParameters<T extends PublicCatalogParameter>(
  parameters: readonly T[],
  publicModelId?: string
): PublicCatalogParameter[] {
  const safeModelId = sanitizePublicModelId(publicModelId);
  return parameters.flatMap(parameter => {
    const name = String(parameter.name || '').trim();
    const path = String(parameter.path || '').trim();
    if (!name || !path || PRIVATE_PARAMETER_PATTERN.test(name) || PRIVATE_PARAMETER_PATTERN.test(path)) return [];
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || !/^[A-Za-z0-9_.-]{1,120}$/.test(path)) return [];

    const out: PublicCatalogParameter = {
      name,
      path,
      label: sanitizePublicModelLabel(parameter.label, PUBLIC_PARAMETER_LABELS[name.toLowerCase()] || name),
      type: parameter.type,
      required: parameter.required === true
    };
    const defaultValue = safePrimitive(parameter.default);
    const fixedValue = name === 'model' && safeModelId ? safeModelId : safePrimitive(parameter.fixed);
    const options = safePrimitive(parameter.options);
    if (defaultValue !== undefined) out.default = defaultValue;
    if (fixedValue !== undefined) out.fixed = fixedValue;
    if (Array.isArray(options) && options.length) out.options = options;
    for (const key of ['min', 'max', 'min_items', 'max_items'] as const) {
      const number = Number(parameter[key]);
      if (Number.isFinite(number)) out[key] = number;
    }
    if (parameter.items && typeof parameter.items === 'object') {
      const itemType = safePrimitive(parameter.items.type);
      const itemFormat = safePrimitive(parameter.items.format);
      const items: Record<string, unknown> = {};
      if (typeof itemType === 'string') items.type = itemType;
      if (typeof itemFormat === 'string') items.format = itemFormat;
      if (Object.keys(items).length) out.items = items;
    }
    if (parameter.aggregateConstraint) {
      const fields = parameter.aggregateConstraint.fields
        .map(value => String(value || '').trim())
        .filter(value => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(value));
      const maxTotalItems = Number(parameter.aggregateConstraint.maxTotalItems);
      if (fields.length && Number.isInteger(maxTotalItems) && maxTotalItems >= 0) {
        out.aggregateConstraint = { fields: [...new Set(fields)], maxTotalItems };
      }
    }
    return [out];
  });
}

const PUBLIC_TIER_KEYS = new Set([
  'resolution', 'quality', 'duration', 'seconds', 'n', 'count', 'size',
  'speed', 'aspect_ratio', 'aspectRatio'
]);

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export type PublicCatalogPricing = {
  mode: 'fixed' | 'tiered' | 'token';
  unit: 'request' | 'second' | 'image' | 'token';
  credits?: number;
  tiers?: Array<{ when: Record<string, string | number | boolean>; credits: number }>;
  quantityParameter?: string | null;
  inputCreditsPerMillion?: number;
  outputCreditsPerMillion?: number;
};

export function projectPublicCatalogPricing(pricing: Record<string, unknown>): PublicCatalogPricing {
  const mode = ['fixed', 'tiered', 'token'].includes(String(pricing.mode))
    ? String(pricing.mode) as PublicCatalogPricing['mode']
    : 'fixed';
  const unit = ['request', 'second', 'image', 'token'].includes(String(pricing.unit))
    ? String(pricing.unit) as PublicCatalogPricing['unit']
    : 'request';
  const out: PublicCatalogPricing = { mode, unit };
  const credits = finiteNonNegative(pricing.credits);
  if (credits != null) out.credits = credits;
  const tiers = Array.isArray(pricing.tiers)
    ? pricing.tiers.flatMap(raw => {
        if (!raw || typeof raw !== 'object') return [];
        const tier = raw as Record<string, unknown>;
        const tierCredits = finiteNonNegative(tier.credits);
        if (tierCredits == null) return [];
        const sourceWhen = tier.when && typeof tier.when === 'object'
          ? tier.when as Record<string, unknown>
          : {};
        const when: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(sourceWhen)) {
          if (!PUBLIC_TIER_KEYS.has(key)) continue;
          const safe = safePrimitive(value);
          if (typeof safe === 'string' || typeof safe === 'number' || typeof safe === 'boolean') when[key] = safe;
        }
        return [{ when, credits: tierCredits }];
      })
    : [];
  if (tiers.length) out.tiers = tiers;
  const quantityParameter = String(pricing.quantityParameter || '').trim();
  if (PUBLIC_TIER_KEYS.has(quantityParameter)) out.quantityParameter = quantityParameter;
  for (const key of ['inputCreditsPerMillion', 'outputCreditsPerMillion'] as const) {
    const value = finiteNonNegative(pricing[key]);
    if (value != null) out[key] = value;
  }
  return out;
}

export function projectFinalCreditCost(value: unknown): { final: number } | null {
  if (!value || typeof value !== 'object') return null;
  const final = finiteNonNegative((value as Record<string, unknown>).final);
  return final == null ? null : { final };
}
