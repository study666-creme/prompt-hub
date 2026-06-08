import { ApiError } from './errors';

const MOOKO_IMG_ORIGIN = 'https://gimg.mooko.ai';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

export type MookoSubmitResult = {
  taskId: string;
  imageUrl: string | null;
  imageUrls: string[];
};

export type MookoPollResult = {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
  isViolation?: boolean;
};

export type MookoApiRequest = {
  path: string;
  body: Record<string, unknown>;
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.mooko.ai').replace(/\/$/, '');
}

function normalizeMookoImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;
  if (/^data:image\//i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${MOOKO_IMG_ORIGIN}${url}`;
  return null;
}

function mookoDataUrlFromBase64(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const b64 = raw.trim();
  if (b64.length < 40) return null;
  if (/^data:image\//i.test(b64)) return b64;
  return `data:image/png;base64,${b64}`;
}

/** gpt-image-2（1K）文档合法 size */
function mapGptImage2Size(sizeLabel?: string): string {
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  const map: Record<string, string> = {
    auto: 'auto',
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1792x1024',
    '3:4': '1024x1792',
    '3:2': '1792x1024',
    '2:3': '1024x1792'
  };
  return map[ratio] || '1024x1024';
}

/** gpt-image-2-pro（2K/4K）文档合法 size */
function mapGptImage2ProSize(sizeLabel?: string, resolution?: string): string {
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  const is4k = String(resolution || '2k').toLowerCase() === '4k';
  const map2k: Record<string, string> = {
    auto: '1024x1024',
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1024x1536',
    '4:3': '2048x1152',
    '3:4': '1024x1536',
    '3:2': '2048x1152',
    '2:3': '1024x1536'
  };
  const map4k: Record<string, string> = {
    auto: '1024x1024',
    '1:1': '2048x2048',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3840x2160',
    '3:4': '2160x3840',
    '3:2': '3840x2160',
    '2:3': '2160x3840'
  };
  const table = is4k ? map4k : map2k;
  return table[ratio] || table['1:1'];
}

function mapMookoQuality(quality: string): string {
  const q = String(quality || 'standard').toLowerCase();
  if (q === 'high' || q === 'ultra') return 'high';
  if (q === 'standard') return 'medium';
  return 'auto';
}

/** 按木瓜 Apifox 文档组装请求（generations / edits） */
export function buildMookoApiRequest(params: SubmitParams): MookoApiRequest {
  const upstream = params.upstreamModel.trim().toLowerCase() || 'gpt-image-2';
  const refs = params.refImageUrls?.filter(Boolean).slice(0, 8) || [];
  const isPro = upstream === 'gpt-image-2-pro';

  if (isPro && refs.length) {
    return {
      path: '/v1/images/edits',
      body: {
        model: 'gpt-image-2-pro',
        prompt: params.prompt,
        n: 1,
        size: mapGptImage2ProSize(params.size, params.resolution),
        quality: mapMookoQuality(params.quality),
        response_format: 'url',
        moderation: 'auto',
        output_format: params.resolution === '4k' ? 'jpeg' : 'png',
        image: refs
      }
    };
  }

  if (isPro) {
    return {
      path: '/v1/images/generations',
      body: {
        model: 'gpt-image-2-pro',
        prompt: params.prompt,
        n: 1,
        size: mapGptImage2ProSize(params.size, params.resolution),
        quality: mapMookoQuality(params.quality),
        response_format: 'url',
        moderation: 'auto',
        output_format: params.resolution === '4k' ? 'jpeg' : 'png'
      }
    };
  }

  const body: Record<string, unknown> = {
    model: 'gpt-image-2',
    prompt: params.prompt,
    n: 1,
    size: mapGptImage2Size(params.size)
  };
  if (refs.length) body.reference_images = refs;
  return { path: '/v1/images/generations', body };
}

function extractTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  for (const key of ['task_id', 'request_id', 'id']) {
    const val = p[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  const data = p.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    const row = data[0] as Record<string, unknown>;
    for (const key of ['task_id', 'request_id', 'id']) {
      const val = row[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['task_id', 'request_id', 'id']) {
      const val = d[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
  }
  return null;
}

function collectImageUrls(payload: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const url = normalizeMookoImageUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const pushRow = (row: Record<string, unknown>) => {
    push(row.url);
    push(row.image_url);
    push(row.imageUrl);
    push(row.output_url);
    push(row.result_url);
    push(row.file_url);
    push(row.cdn_url);
    push(row.image);
    const dataUrl = mookoDataUrlFromBase64(row.b64_json);
    if (dataUrl) push(dataUrl);
  };
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  push(p.url);
  push(p.image_url);
  const data = p.data;
  if (Array.isArray(p.images)) {
    for (const img of p.images) {
      if (typeof img === 'string') push(img);
      else if (img && typeof img === 'object') pushRow(img as Record<string, unknown>);
    }
  }
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === 'object') pushRow(row as Record<string, unknown>);
    }
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    pushRow(d);
    if (d.result && typeof d.result === 'object') {
      const result = d.result as Record<string, unknown>;
      if (Array.isArray(result.images)) {
        for (const img of result.images) {
          if (img && typeof img === 'object') {
            const row = img as Record<string, unknown>;
            if (Array.isArray(row.url)) {
              for (const u of row.url) push(u);
            } else {
              pushRow(row);
            }
          }
        }
      }
    }
  }
  return out;
}

/** 递归扫描 JSON，兜底抠漏网的图片 URL / data URL */
function collectImageUrlsDeep(payload: unknown, text?: string): string[] {
  const out = collectImageUrls(payload);
  const seen = new Set(out);
  const push = (raw: unknown) => {
    const url = normalizeMookoImageUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const walk = (node: unknown, depth = 0) => {
    if (depth > 10 || node == null) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node) || /^data:image\//i.test(node)) push(node);
      const dataUrl = mookoDataUrlFromBase64(node);
      if (dataUrl) push(dataUrl);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const val of Object.values(node as Record<string, unknown>)) walk(val, depth + 1);
    }
  };
  walk(payload);
  if (text) {
    for (const u of scrapeImageUrlsFromRawText(text)) push(u);
  }
  return out;
}

/** 兜底：从原始 JSON 文本里抠 gimg.mooko.ai / 常见图片 URL */
function scrapeImageUrlsFromRawText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s"'<>\\]+/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[),.;}\]]+$/, '');
    const url = normalizeMookoImageUrl(raw);
    if (!url || seen.has(url)) continue;
    if (
      /gimg\.mooko\.ai/i.test(url)
      || /mooko\.ai/i.test(url)
      || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)
    ) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

function extractUpstreamError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const p = payload as Record<string, unknown>;
  const err = p.error;
  if (err && typeof err === 'object') {
    const msg = String((err as Record<string, unknown>).message || '').trim();
    if (msg) return msg;
  }
  return String(p.message || p.msg || fallback).slice(0, 400);
}

function parsePollPayload(json: unknown): MookoPollResult {
  const data =
    json && typeof json === 'object' && 'data' in json
      ? (json as { data: Record<string, unknown> }).data
      : json && typeof json === 'object'
        ? (json as Record<string, unknown>)
        : null;
  if (!data) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  const status = String(data.status || '').toLowerCase();
  const imageUrls = collectImageUrlsDeep(json);
  const errMsg = String(data.error || data.error_message || data.message || '').trim() || null;
  const isViolation = /violation|违规|moderation|policy|审核/i.test(String(errMsg || ''));

  if (status === 'failed' || status === 'error' || status === 'cancelled') {
    return {
      status: 'failed',
      imageUrl: null,
      imageUrls: [],
      errorMessage: errMsg || 'upstream_failed',
      isViolation
    };
  }
  if (status === 'completed' || status === 'success' || status === 'succeeded' || imageUrls.length > 0) {
    return {
      status: 'completed',
      imageUrl: imageUrls[0] || null,
      imageUrls,
      errorMessage: null
    };
  }
  return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}

export function isMookoPlaceholderTaskId(taskId: string | null | undefined): boolean {
  return typeof taskId === 'string' && /^mooko-[0-9a-f-]{36}$/i.test(taskId.trim());
}

export function parseMookoImagePayload(payload: unknown): { taskId: string | null; imageUrls: string[] } {
  return {
    taskId: extractTaskId(payload),
    imageUrls: collectImageUrls(payload)
  };
}

export async function submitMookoImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<MookoSubmitResult> {
  const token = String(apiKey || '').trim();
  if (!token) {
    throw new ApiError(502, 'UPSTREAM_FAILED', '木瓜AI 未配置有效令牌（MOOKO_API_KEY）');
  }

  const { path, body } = buildMookoApiRequest(params);
  const url = `${apiBase(baseUrl)}${path}`;
  const doFetch = async () =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

  let res = await doFetch();
  if (!res.ok && (res.status === 502 || res.status === 503 || res.status === 504)) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await doFetch();
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = extractUpstreamError(json, text || `HTTP ${res.status}`);
    throw new ApiError(502, 'UPSTREAM_FAILED', msg.slice(0, 480));
  }

  let imageUrls = collectImageUrlsDeep(json, text);
  const taskId = extractTaskId(json);
  if (!imageUrls.length && taskId) {
    const polled = await fetchMookoTaskOnce(apiKey, baseUrl, taskId);
    if (polled.imageUrls.length) imageUrls = polled.imageUrls;
    else if (polled.imageUrl) imageUrls = [polled.imageUrl];
  }
  if (!taskId && !imageUrls.length) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '木瓜AI 未返回 task_id 或图片');
  }
  return {
    taskId: taskId || `mooko-${crypto.randomUUID()}`,
    imageUrl: imageUrls[0] || null,
    imageUrls
  };
}

export async function fetchMookoTaskOnce(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<MookoPollResult> {
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
  return parsePollPayload(json);
}

export async function confirmMookoTaskOutcome(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<MookoPollResult> {
  const attempts = Math.max(1, opts?.attempts ?? 6);
  const intervalMs = Math.max(800, opts?.intervalMs ?? 3000);
  let last: MookoPollResult = { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    last = await fetchMookoTaskOnce(apiKey, baseUrl, taskId);
    if (last.status === 'completed' || last.status === 'failed') return last;
  }
  return last;
}
