import { ApiError } from './errors';
import { extractAllImageUrls, extractTaskId } from './apimart';
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
  description: string | null;
  tags: string;
};

export type NewApiTaskPollResult = {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
};

const PRICING_CACHE_MS = 5 * 60_000;
const PRICE_CREDITS_PER_YUAN = 100;

let pricingCache: { base: string; at: number; rules: NewApiPricingRule[] } | null = null;
let pricingInflight: Promise<NewApiPricingRule[]> | null = null;

function apiBase(envBase?: string): string {
  return (envBase || 'https://newapi.prompt-hubs.com').replace(/\/$/, '');
}

function pricingUrl(baseUrl?: string): string {
  const url = new URL(apiBase(baseUrl));
  const path = url.pathname.replace(/\/+$/, '');
  if (path.toLowerCase().endsWith('/api/pricing')) return url.toString();
  const stripped = path.replace(/\/(?:v1|api\/v1|api)$/i, '');
  url.pathname = `${stripped}/api/pricing`.replace(/\/{2,}/g, '/');
  url.search = '';
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

function yuanPriceToCredits(price: number): number {
  return Math.ceil(price * PRICE_CREDITS_PER_YUAN - 1e-9);
}

function primaryGroupRatio(payload: Record<string, unknown>): number {
  const groups = Array.isArray(payload.auto_groups) ? payload.auto_groups : [];
  const group = stringValue(groups[0]);
  const ratios = payload.group_ratio && typeof payload.group_ratio === 'object'
    ? payload.group_ratio as Record<string, unknown>
    : null;
  if (!group || !ratios) return 1;
  const ratio = numberValue(ratios[group]);
  return ratio && ratio > 0 ? ratio : 1;
}

function parsePricingPayload(payload: unknown): NewApiPricingRule[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const data = Array.isArray(p.data) ? p.data : [];
  const ratio = primaryGroupRatio(p);
  const out: NewApiPricingRule[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const model = stringValue(item.model_name);
    const tags = stringValue(item.tags).toLowerCase();
    const quotaType = numberValue(item.quota_type);
    const price = numberValue(item.model_price);
    if (!model || quotaType !== 1 || price == null || price < 0) continue;
    if (!tags.includes('image') && !/gpt-image|nano-banana|imagen|flux|midjourney/i.test(model)) continue;
    out.push({
      model,
      credits: yuanPriceToCredits(price * ratio),
      description: stringValue(item.description) || null,
      tags
    });
  }
  return out;
}

export async function fetchNewApiPricingRules(baseUrl?: string, opts?: { force?: boolean }): Promise<NewApiPricingRule[]> {
  const base = apiBase(baseUrl);
  const now = Date.now();
  if (!opts?.force && pricingCache && pricingCache.base === base && now - pricingCache.at < PRICING_CACHE_MS) {
    return pricingCache.rules;
  }
  if (pricingInflight) return pricingInflight;

  pricingInflight = fetch(pricingUrl(base), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`pricing ${res.status}`);
      const payload = await res.json();
      const rules = parsePricingPayload(payload);
      pricingCache = { base, at: Date.now(), rules };
      return rules;
    })
    .catch((e) => {
      console.warn('[newapi] pricing fetch failed', e);
      return pricingCache?.base === base ? pricingCache.rules : [];
    })
    .finally(() => {
      pricingInflight = null;
    });
  return pricingInflight;
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
  return {
    model: params.upstreamModel.trim(),
    prompt: params.prompt,
    n: 1,
    size: params.size || '1:1',
    resolution: params.resolution,
    quality: params.fixedQualityLow ? 'low' : mapQualityForGptImage(params.quality),
    ...(refs?.length ? { image_urls: refs.slice(0, 14) } : {})
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
