import { ApiError } from './errors';

export type NewApiVideoSubmitParams = {
  upstreamModel: string;
  prompt: string;
  duration: number;
  ratio: string;
  resolution: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
};

export type NewApiVideoTask = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number | null;
  errorMessage: string | null;
  videoUrl: string | null;
};

function apiBase(value?: string): string {
  return (value || 'https://newapi.prompt-hubs.com').replace(/\/+$/, '');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(value: unknown, status: number): string {
  const payload = record(value);
  const error = record(payload?.error);
  return text(error?.message) || text(payload?.message) || text(payload?.msg) || text(payload?.error) || `视频接口失败 (${status})`;
}

function findString(value: unknown, keys: Set<string>): string {
  const seen = new Set<unknown>();
  const visit = (current: unknown): string => {
    if (!current || seen.has(current)) return '';
    if (typeof current === 'string') return '';
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item);
        if (found) return found;
      }
      return '';
    }
    const object = record(current);
    if (!object) return '';
    for (const [key, item] of Object.entries(object)) {
      if (keys.has(key.toLowerCase()) && typeof item === 'string' && item.trim()) return item.trim();
    }
    for (const item of Object.values(object)) {
      const found = visit(item);
      if (found) return found;
    }
    return '';
  };
  return visit(value);
}

function normalizeStatus(value: unknown): NewApiVideoTask['status'] {
  const status = text(value).toLowerCase();
  if (['completed', 'succeeded', 'success', 'done'].includes(status)) return 'completed';
  if (['failed', 'cancelled', 'canceled', 'expired', 'error'].includes(status)) return 'failed';
  if (['processing', 'running', 'in_progress', 'generating'].includes(status)) return 'processing';
  return 'queued';
}

function parseTask(payload: unknown, fallbackId = ''): NewApiVideoTask {
  const object = record(payload);
  const nested = record(object?.data) || object;
  const id = findString(payload, new Set(['id', 'task_id', 'request_id'])) || fallbackId;
  const status = normalizeStatus(nested?.status ?? nested?.state ?? object?.status ?? object?.state);
  const rawProgress = Number(nested?.progress ?? object?.progress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : null;
  const videoUrl = findString(payload, new Set(['video_url', 'url', 'download_url', 'content_url'])) || null;
  const failure = status === 'failed' ? errorMessage(payload, 502) : null;
  return { id, status, progress, errorMessage: failure, videoUrl };
}

async function jsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function submitNewApiVideo(
  apiKey: string,
  baseUrl: string | undefined,
  params: NewApiVideoSubmitParams
): Promise<NewApiVideoTask> {
  const isSd = params.upstreamModel.toLowerCase().startsWith('sd');
  const body: Record<string, unknown> = {
    model: params.upstreamModel,
    prompt: params.prompt,
    duration: params.duration,
    resolution: params.resolution,
    ...(isSd ? { ratio: params.ratio } : { aspect_ratio: params.ratio }),
    ...(params.referenceImages?.length
      ? isSd
        ? { referenceImages: params.referenceImages }
        : params.referenceImages.length === 1
          ? { image: params.referenceImages[0] }
          : { images: params.referenceImages }
      : {}),
    ...(params.referenceVideos?.length ? { referenceVideos: params.referenceVideos } : {}),
    ...(params.referenceAudios?.length ? { referenceAudios: params.referenceAudios } : {}),
    async: true,
    n: 1
  };
  const response = await fetch(`${apiBase(baseUrl)}/v1/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await jsonResponse(response);
  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  const task = parseTask(payload);
  if (!task.id && !task.videoUrl) throw new ApiError(502, 'UPSTREAM_ERROR', '视频接口没有返回任务 ID');
  return task;
}

export async function fetchNewApiVideoTask(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<NewApiVideoTask> {
  const response = await fetch(`${apiBase(baseUrl)}/v1/videos/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const payload = await jsonResponse(response);
  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  return parseTask(payload, taskId);
}

export async function fetchNewApiVideoContent(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  range?: string
): Promise<Response> {
  const response = await fetch(`${apiBase(baseUrl)}/v1/videos/${encodeURIComponent(taskId)}/content`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(range ? { Range: range } : {})
    }
  });
  if (!response.ok) {
    const payload = await jsonResponse(response);
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  return response;
}
