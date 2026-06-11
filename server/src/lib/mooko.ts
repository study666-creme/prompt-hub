import { ApiError } from './errors';
import { isLikelyDataImageUrl, isParseableDataImageUrl } from './image-archive';
import { mapMookoProSize } from './image-size-options';

const MOOKO_IMG_ORIGIN = 'https://gimg.mooko.ai';
/** 木瓜官网 gpt-img 在 gimg 失败时用香港 OSS 同路径拉取 */
export const MOOKO_OSS_ORIGIN = 'https://mooko-hk.oss-cn-hongkong.aliyuncs.com';

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
  // Apifox：data[].url 可能是纯 base64 或 data URL
  const dataUrl = mookoDataUrlFromBase64(url);
  if (dataUrl) return dataUrl;
  return null;
}

/** Worker 拉图：gimg 403/超时则试 OSS 同路径（对齐 gpt-img.mooko.ai） */
export function mookoImageFetchCandidates(url: string): string[] {
  const primary = normalizeMookoImageUrl(url);
  if (!primary || !/^https?:\/\//i.test(primary)) return primary ? [primary] : [];
  const out = [primary];
  try {
    const u = new URL(primary);
    if (/gimg\.mooko\.ai/i.test(u.hostname) || /(^|\.)mooko\.ai$/i.test(u.hostname)) {
      const oss = `${MOOKO_OSS_ORIGIN}${u.pathname}${u.search}`;
      if (oss !== primary) out.push(oss);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function mookoDataUrlFromBase64(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length < 40) return null;
  if (/^data:image\//i.test(s)) return s;
  return `data:image/jpeg;base64,${s}`;
}

function mapMookoQuality(quality: string): string {
  const q = String(quality || 'standard').toLowerCase();
  if (q === 'high' || q === 'ultra') return 'high';
  if (q === 'standard') return 'medium';
  return 'auto';
}

function normalizeMookoResolution(resolution?: string): '2k' | '4k' {
  return String(resolution || '2k').toLowerCase() === '4k' ? '4k' : '2k';
}

/** 木瓜仅走 Images API + gpt-image-2-pro（2K/4K），与 gpt-img.mooko.ai 一致 */
export function buildMookoApiRequest(params: SubmitParams): MookoApiRequest {
  const refs = params.refImageUrls?.filter(Boolean).slice(0, 8) || [];
  const resolution = normalizeMookoResolution(params.resolution);
  const pixelSize = mapMookoProSize(resolution, params.size);
  const sharedBody = {
    model: 'gpt-image-2-pro',
    prompt: params.prompt,
    n: 1,
    size: pixelSize,
    quality: mapMookoQuality(params.quality),
    response_format: 'url',
    moderation: 'low',
    output_format: 'jpeg',
    output_compression: 85
  };

  if (refs.length) {
    return {
      path: '/v1/images/edits',
      body: {
        ...sharedBody,
        /** 木瓜 JSON 体要求 images[].image_url，勿用 OpenAI 旧字段 image[] */
        images: refs.map((url) => ({ image_url: url }))
      }
    };
  }

  return {
    path: '/v1/images/generations',
    body: sharedBody
  };
}

/** 不 JSON.parse 整段响应，直接从文本抠 data URL（木瓜 2K 体可达数 MB） */
export function extractMookoDataImageFromText(text: string): string | null {
  if (!text) return null;
  const needle = 'data:image/';
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf(needle, searchFrom);
    if (start < 0) break;
    const semi = text.indexOf(';base64,', start);
    if (semi < 0) {
      searchFrom = start + 1;
      continue;
    }
    const b64Start = semi + ';base64,'.length;
    let i = b64Start;
    while (i < text.length) {
      if (!/[A-Za-z0-9+/=]/.test(text[i])) break;
      i += 1;
    }
    const b64Len = i - b64Start;
    if (b64Len >= 80 && b64Len % 4 === 0) return text.slice(start, i);
    searchFrom = start + 1;
  }
  for (const marker of ['"b64_json":"', '"b64_json": "']) {
    const idx = text.indexOf(marker);
    if (idx < 0) continue;
    const b64Start = idx + marker.length;
    let i = b64Start;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === '\\') break;
      if (!/[A-Za-z0-9+/=]/.test(c)) break;
      i += 1;
    }
    const b64 = text.slice(b64Start, i);
    if (b64.length >= 80 && b64.length % 4 === 0) {
      return `data:image/jpeg;base64,${b64}`;
    }
  }
  return null;
}

export function extractRequestIdFromText(text: string): string | null {
  if (!text) return null;
  for (const key of ['request_id', 'task_id']) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`);
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

async function readMookoResponseBody(res: Response): Promise<{ text: string; requestId: string | null }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return { text, requestId: extractRequestIdFromText(text) };
  }
  const decoder = new TextDecoder();
  let text = '';
  let requestId: string | null = null;
  /** 木瓜同步体常为 data URL base64；/v1/tasks 不可用，须读完整响应再归档 */
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!requestId) requestId = extractRequestIdFromText(text);
    }
  } finally {
    try {
      text += decoder.decode();
    } catch {
      /* ignore */
    }
  }
  if (!requestId) requestId = extractRequestIdFromText(text);
  return { text, requestId };
}

function extractTaskId(payload: unknown, textFallback?: string): string | null {
  const fromText = textFallback ? extractRequestIdFromText(textFallback) : null;
  if (fromText) return fromText;
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
    push(row.thumbnail_url);
    push(row.thumbnailUrl);
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
  push(p.thumbnail_url);
  push(p.thumbnailUrl);
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
  const imageUrlsEarly = collectImageUrlsDeep(json);
  if (json && typeof json === 'object') {
    const root = json as Record<string, unknown>;
    const flatStatus = String(root.status || '').toLowerCase();
    if (flatStatus === 'success' || flatStatus === 'failed' || flatStatus === 'error') {
      const urls = imageUrlsEarly.length ? imageUrlsEarly : collectImageUrlsDeep(root);
      const errMsg = String(root.error_msg || root.error || root.message || '').trim() || null;
      if (flatStatus === 'failed' || flatStatus === 'error') {
        return {
          status: 'failed',
          imageUrl: null,
          imageUrls: [],
          errorMessage: errMsg || 'upstream_failed',
          isViolation: /violation|违规|moderation|policy|审核/i.test(String(errMsg || ''))
        };
      }
      if (urls.length) {
        return {
          status: 'completed',
          imageUrl: urls[0] || null,
          imageUrls: urls,
          errorMessage: null
        };
      }
    }
  }
  const data =
    json && typeof json === 'object' && 'data' in json
      ? (json as { data: Record<string, unknown> }).data
      : json && typeof json === 'object'
        ? (json as Record<string, unknown>)
        : null;
  if (!data) {
    if (imageUrlsEarly.length) {
      return {
        status: 'completed',
        imageUrl: imageUrlsEarly[0] || null,
        imageUrls: imageUrlsEarly,
        errorMessage: null
      };
    }
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }
  const status = String(data.status || '').toLowerCase();
  const imageUrls = imageUrlsEarly.length ? imageUrlsEarly : collectImageUrlsDeep(json);
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
  params: SubmitParams,
  hooks?: { onRequestId?: (taskId: string) => Promise<void> }
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

  const { text, requestId: earlyRequestId } = await readMookoResponseBody(res);
  if (earlyRequestId && hooks?.onRequestId) {
    try {
      await hooks.onRequestId(earlyRequestId);
    } catch (e) {
      console.warn('[mooko] early request_id patch failed', earlyRequestId, e);
    }
  }

  const largeBody = text.length > 180_000;
  let json: unknown = null;
  if (!largeBody) {
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const msg = extractUpstreamError(json, text || `HTTP ${res.status}`);
    throw new ApiError(502, 'UPSTREAM_FAILED', msg.slice(0, 480));
  }

  let imageUrls: string[] = [];
  if (largeBody) {
    const dataUrl = extractMookoDataImageFromText(text);
    if (dataUrl) imageUrls.push(dataUrl);
    imageUrls.push(...scrapeImageUrlsFromRawText(text));
  } else {
    imageUrls = json
      ? collectImageUrlsDeep(json, text)
      : scrapeImageUrlsFromRawText(text);
    if (!imageUrls.length) {
      const dataUrl = extractMookoDataImageFromText(text);
      if (dataUrl) imageUrls.push(dataUrl);
    }
  }
  imageUrls = imageUrls.filter(
    (u) =>
      /^https?:\/\//i.test(u)
      || isLikelyDataImageUrl(u)
  );
  const taskId = extractTaskId(json, text) || earlyRequestId;
  const hasHttp = imageUrls.some((u) => /^https?:\/\//i.test(u));
  const hasData = imageUrls.some((u) => isParseableDataImageUrl(u));
  /** 木瓜无可用 /v1/tasks；仅有 request_id 且无图时才短试一次（多数情况同步体已含 base64） */
  const needsPoll =
    taskId
    && !isMookoPlaceholderTaskId(taskId)
    && !hasHttp
    && !hasData;
  if (needsPoll) {
    const polled = await confirmMookoTaskOutcome(apiKey, baseUrl, taskId, {
      attempts: 3,
      intervalMs: 2000
    });
    if (polled.imageUrls.length) {
      imageUrls = polled.imageUrls.filter(
        (u) => /^https?:\/\//i.test(u) || isParseableDataImageUrl(u)
      );
    } else if (
      polled.imageUrl
      && (/^https?:\/\//i.test(polled.imageUrl) || isParseableDataImageUrl(polled.imageUrl))
    ) {
      imageUrls = [polled.imageUrl];
    }
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
