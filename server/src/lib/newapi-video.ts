import { ApiError } from './errors';

export type NewApiVideoSubmitParams = {
  idempotencyKey?: string;
  upstreamModel: string;
  prompt: string;
  duration: number;
  ratio: string;
  resolution: string;
  size?: string;
  referenceImages?: string[];
  firstImage?: string;
  lastImage?: string;
  referenceVideos?: string[];
  referenceAudios?: string[];
};

export type NewApiVideoTask = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'unknown';
  progress: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  videoUrl: string | null;
  actualDurationSeconds?: number;
  billedDurationSeconds?: number;
};

const NEWAPI_VIDEO_REQUEST_TIMEOUT_MS = 45_000;

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

function taskErrorDetails(value: unknown): { code: string | null; message: string | null } {
  const payload = record(value);
  const nested = record(payload?.data);
  const nestedError = record(nested?.error);
  const rootError = record(payload?.error);
  const code = text(nestedError?.code)
    || text(rootError?.code)
    || text(nested?.error_code)
    || text(payload?.error_code);
  const message = text(nestedError?.message)
    || text(rootError?.message)
    || text(nested?.message)
    || text(payload?.message)
    || text(payload?.msg);
  return {
    code: code ? code.slice(0, 120) : null,
    message: message ? message.slice(0, 500) : null
  };
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

function findPositiveNumber(value: unknown, keys: readonly string[]): number | undefined {
  const keySet = new Set(keys.map(key => key.toLowerCase()));
  const seen = new Set<unknown>();
  const visit = (current: unknown): number | undefined => {
    if (!current || seen.has(current) || typeof current === 'string') return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item);
        if (found != null) return found;
      }
      return undefined;
    }
    const object = record(current);
    if (!object) return undefined;
    for (const [key, item] of Object.entries(object)) {
      if (!keySet.has(key.toLowerCase())) continue;
      const number = Number(item);
      if (Number.isFinite(number) && number > 0 && number <= 60) return number;
    }
    for (const item of Object.values(object)) {
      const found = visit(item);
      if (found != null) return found;
    }
    return undefined;
  };
  return visit(value);
}

function findStrings(value: unknown, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (current: unknown): void => {
    if (!current || seen.has(current) || typeof current === 'string') return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const object = record(current);
    if (!object) return;
    for (const [name, item] of Object.entries(object)) {
      if (name.toLowerCase() === key && typeof item === 'string' && item.trim()) out.push(item.trim());
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return out;
}

function isAudioUrl(value: string): boolean {
  return /\.(?:mp3|wav|aac|m4a|flac|oga|ogg)(?:$|[?#])/i.test(value)
    || /(?:^|[?&])(?:mime|type)=audio%2f/i.test(value);
}

function isVideoUrl(value: string): boolean {
  return /\.(?:mp4|webm|mov|m4v|mkv|avi|mpeg|mpg)(?:$|[?#])/i.test(value)
    || /(?:^|[?&])(?:mime|type)=video%2f/i.test(value);
}

function resultVideoUrl(payload: unknown): string | null {
  for (const key of ['video_url', 'download_url', 'content_url']) {
    const explicit = findString(payload, new Set([key]));
    if (explicit && !isAudioUrl(explicit)) return explicit;
  }
  const generic = findStrings(payload, 'url');
  return generic.find(isVideoUrl) || generic.find(url => !isAudioUrl(url)) || null;
}

function normalizeStatus(value: unknown, upstreamErrorCode: string | null): NewApiVideoTask['status'] {
  const status = text(value).toLowerCase().replace(/-/g, '_');
  const errorCode = text(upstreamErrorCode).toLowerCase().replace(/-/g, '_');
  if (['completed', 'succeeded', 'success', 'done'].includes(status)) return 'completed';
  if (
    ['unknown', 'result_uncertain', 'outcome_unknown'].includes(status)
    || ['unknown', 'result_uncertain', 'outcome_unknown'].includes(errorCode)
  ) return 'unknown';
  if (['failed', 'cancelled', 'canceled', 'expired', 'error'].includes(status)) return 'failed';
  if (['processing', 'running', 'in_progress', 'generating'].includes(status)) return 'processing';
  return 'queued';
}

function parseTask(payload: unknown, fallbackId = ''): NewApiVideoTask {
  const object = record(payload);
  const nested = record(object?.data) || object;
  const id = findString(payload, new Set(['task_id']))
    || findString(payload, new Set(['request_id']))
    || findString(payload, new Set(['id']))
    || fallbackId;
  const upstreamError = taskErrorDetails(payload);
  const status = normalizeStatus(
    nested?.status ?? nested?.state ?? object?.status ?? object?.state,
    upstreamError.code
  );
  const rawProgress = Number(nested?.progress ?? object?.progress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : null;
  const videoUrl = resultVideoUrl(payload);
  const failure = status === 'failed' || status === 'unknown'
    ? upstreamError.message || (status === 'failed' ? errorMessage(payload, 502) : null)
    : null;
  const duration = status === 'completed'
    ? {
        billedDurationSeconds: findPositiveNumber(payload, [
          'billed_duration_seconds',
          'billable_duration_seconds',
          'charged_duration_seconds',
          'billed_seconds'
        ]),
        actualDurationSeconds: findPositiveNumber(payload, [
          'actual_duration_seconds',
          'actual_duration',
          'duration_seconds',
          'video_duration'
        ])
      }
    : {};
  return { id, status, progress, errorCode: upstreamError.code, errorMessage: failure, videoUrl, ...duration };
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
    ...(params.size ? { size: params.size } : {}),
    ...(isSd ? { ratio: params.ratio } : { aspect_ratio: params.ratio }),
    ...(params.referenceImages?.length
      ? isSd
        ? { referenceImages: params.referenceImages }
        : params.referenceImages.length === 1
          ? { image: params.referenceImages[0] }
          : { images: params.referenceImages }
      : {}),
    ...(params.firstImage ? { first_image: params.firstImage } : {}),
    ...(params.lastImage ? { last_image: params.lastImage } : {}),
    ...(params.referenceVideos?.length ? { referenceVideos: params.referenceVideos } : {}),
    ...(params.referenceAudios?.length ? { referenceAudios: params.referenceAudios } : {}),
    async: true,
    n: 1
  };
  const response = await fetch(`${apiBase(baseUrl)}/v1/videos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NEWAPI_VIDEO_REQUEST_TIMEOUT_MS)
  });
  const payload = await jsonResponse(response);
  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  const task = parseTask(payload);
  if (!task.id) throw new ApiError(502, 'UPSTREAM_ERROR', '视频接口没有返回任务 ID');
  return task;
}

export async function fetchNewApiVideoTask(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<NewApiVideoTask> {
  const response = await fetch(`${apiBase(baseUrl)}/v1/videos/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(NEWAPI_VIDEO_REQUEST_TIMEOUT_MS)
  });
  const payload = await jsonResponse(response);
  const task = parseTask(payload, taskId);
  if (!response.ok) {
    if (task.status === 'unknown') return task;
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  return task;
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
    },
    signal: AbortSignal.timeout(NEWAPI_VIDEO_REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    const payload = await jsonResponse(response);
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
  }
  return response;
}
