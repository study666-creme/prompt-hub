import { ApiError } from './errors';
import {
  buildApimartOfficialBudgetRequestBody,
  isApimartOfficialBudgetUpstream
} from './apimart-official-budget';
import { mapQualityForGptImage, mapResolutionForSeedream } from './pricing';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

function isJimengLikeUpstream(upstream: string): boolean {
  return /nano-banana|jimeng|seedream|seedance|doubao-seedream/i.test(upstream);
}

export type TaskPollResult = {
  status: string;
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

export function extractTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.data) && p.data[0] && typeof p.data[0] === 'object') {
    const row = p.data[0] as Record<string, unknown>;
    if (typeof row.task_id === 'string') return row.task_id;
  }
  if (p.data && typeof p.data === 'object') {
    const d = p.data as Record<string, unknown>;
    if (typeof d.task_id === 'string') return d.task_id;
    if (typeof d.id === 'string') return d.id;
  }
  return null;
}

function pickUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = pickUrl(item);
      if (u) return u;
    }
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return (
      pickUrl(o.url) ||
      pickUrl(o.image_url) ||
      pickUrl(o.imageUrl) ||
      pickUrl(o.uri) ||
      pickUrl(o.href) ||
      pickUrl(o.output_url)
    );
  }
  return null;
}

function pushHttpUrl(value: unknown, seen: Set<string>, out: string[]): void {
  if (typeof value !== 'string') return;
  const s = value.trim();
  if (!/^https?:\/\//i.test(s) || seen.has(s)) return;
  seen.add(s);
  out.push(s);
}

/** 递归收集全部图片 URL（Apimart 常见：result.images[].url[] 内有多张） */
function collectImageUrls(value: unknown, seen: Set<string>, out: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    pushHttpUrl(value, seen, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, seen, out);
    return;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.images)) {
      for (const img of o.images) {
        if (img && typeof img === 'object') {
          collectImageUrls((img as Record<string, unknown>).url, seen, out);
        }
      }
    }
    for (const key of ['url', 'image_url', 'imageUrl', 'output_url', 'uri', 'href', 'output', 'outputs', 'image']) {
      if (key in o) collectImageUrls(o[key], seen, out);
    }
  }
}

/** 收集任务结果中全部图片 URL（上游偶发 n>1 或 images/url 数组） */
export function extractAllImageUrls(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const data = p.data;
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const seen = new Set<string>();
  const out: string[] = [];

  if (d.result) collectImageUrls(d.result, seen, out);
  for (const key of ['output_url', 'image_url', 'imageUrl', 'url', 'output', 'outputs', 'images', 'image']) {
    if (key in d) collectImageUrls(d[key], seen, out);
  }
  return out;
}

function extractImageUrl(payload: unknown): string | null {
  const all = extractAllImageUrls(payload);
  return all[0] || null;
}

export function isApimartContentViolationMessage(msg: string | null | undefined): boolean {
  const s = String(msg || '').toLowerCase();
  return /prohibited words or images|prohibited|flagged as containing|content.?policy|moderation|violation|违规|敏感|blocked|safety/i.test(
    s
  );
}

function buildRequestBody(params: SubmitParams): Record<string, unknown> {
  const upstream = params.upstreamModel.trim().toLowerCase();
  const size = params.size || '1:1';
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;

  if (isJimengLikeUpstream(upstream)) {
    return {
      model: upstream,
      prompt: params.prompt,
      size,
      resolution: mapResolutionForSeedream(params.resolution),
      n: 1,
      ...(refs ? { image_urls: refs } : {})
    };
  }

  if (isApimartOfficialBudgetUpstream(upstream)) {
    return buildApimartOfficialBudgetRequestBody({
      prompt: params.prompt,
      resolution: params.resolution,
      size: params.size,
      refImageUrls: params.refImageUrls
    });
  }

  return {
    model: upstream,
    prompt: params.prompt,
    size,
    resolution: params.resolution,
    quality: mapQualityForGptImage(params.quality),
    n: 1,
    ...(refs ? { image_urls: refs } : {})
  };
}

export async function submitApimartImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<string> {
  const res = await fetch(`${apiBase(baseUrl)}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildRequestBody(params))
  });

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      err?.error?.message || `上游生图失败 (${res.status})`
    );
  }

  const taskId = extractTaskId(json);
  if (!taskId) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '上游未返回 task_id');
  }
  return taskId;
}

export async function fetchApimartTaskOnce(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<TaskPollResult> {
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

  const data =
    json && typeof json === 'object' && 'data' in json
      ? (json as { data: Record<string, unknown> }).data
      : null;
  if (!data) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }

  const status = String(data.status || '');
  const imageUrls = extractAllImageUrls(json);

  if (status === 'completed' || (status !== 'failed' && imageUrls.length > 0)) {
    if (!imageUrls.length) {
      return {
        status: 'failed',
        imageUrl: null,
        imageUrls: [],
        errorMessage: 'upstream_no_image'
      };
    }
    return {
      status: 'completed',
      imageUrl: imageUrls[0],
      imageUrls,
      errorMessage: null
    };
  }
  if (status === 'failed') {
    if (imageUrls.length) {
      return {
        status: 'completed',
        imageUrl: imageUrls[0],
        imageUrls,
        errorMessage: null
      };
    }
    const rawErr = String(data.error_message || data.error || 'upstream_failed');
    return {
      status,
      imageUrl: null,
      imageUrls: [],
      errorMessage: isApimartContentViolationMessage(rawErr)
        ? 'upstream_content_violation'
        : rawErr
    };
  }

  return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}

export async function pollApimartTask(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  maxWaitMs?: number
): Promise<TaskPollResult> {
  const deadline = Date.now() + (maxWaitMs ?? 180000);
  const intervalMs = 4000;

  while (Date.now() < deadline) {
    const result = await fetchApimartTaskOnce(apiKey, baseUrl, taskId);
    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return { status: 'timeout', imageUrl: null, imageUrls: [], errorMessage: 'upstream_timeout' };
}

/** 标记失败/超时前多次确认，避免上游已成功却退款 */
export async function confirmApimartTaskOutcome(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<TaskPollResult> {
  const attempts = Math.max(1, opts?.attempts ?? 6);
  const intervalMs = Math.max(2000, opts?.intervalMs ?? 10000);
  let last: TaskPollResult = {
    status: 'pending',
    imageUrl: null,
    imageUrls: [],
    errorMessage: null
  };
  for (let i = 0; i < attempts; i += 1) {
    last = await fetchApimartTaskOnce(apiKey, baseUrl, taskId);
    if (last.status === 'completed' && last.imageUrl) return last;
    if (last.status === 'failed' && !last.imageUrls.length) {
      if (i < attempts - 1) await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    if (last.status === 'pending') {
      if (i < attempts - 1) await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    return last;
  }
  return last;
}
