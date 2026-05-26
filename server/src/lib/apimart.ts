import { ApiError } from './errors';
import {
  IMAGE_MODELS,
  mapQualityForGptImage,
  mapResolutionForSeedream,
  type ImageModelId
} from './pricing';

type SubmitParams = {
  modelId: ImageModelId;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

type TaskPollResult = {
  status: string;
  imageUrl: string | null;
  errorMessage: string | null;
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

function extractTaskId(payload: unknown): string | null {
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

function extractImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = p.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const result = d.result;
  if (!result || typeof result !== 'object') return null;
  const images = (result as Record<string, unknown>).images;
  if (!Array.isArray(images) || !images[0]) return null;
  const first = images[0] as Record<string, unknown>;
  const url = first.url;
  if (typeof url === 'string') return url;
  if (Array.isArray(url) && typeof url[0] === 'string') return url[0];
  return null;
}

function buildRequestBody(params: SubmitParams): Record<string, unknown> {
  const model = IMAGE_MODELS[params.modelId];
  const size = params.size || '1:1';
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;

  if (params.modelId === 'jimeng') {
    return {
      model: model.upstream,
      prompt: params.prompt,
      size,
      resolution: mapResolutionForSeedream(params.resolution),
      n: 1,
      ...(refs ? { image_urls: refs } : {})
    };
  }

  return {
    model: model.upstream,
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

export async function pollApimartTask(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  maxWaitMs?: number
): Promise<TaskPollResult> {
  const deadline = Date.now() + (maxWaitMs ?? 180000);
  const intervalMs = 4000;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    const res = await fetch(`${apiBase(baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    let json: unknown = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }

    if (!res.ok) continue;

    const data =
      json && typeof json === 'object' && 'data' in json
        ? (json as { data: Record<string, unknown> }).data
        : null;
    if (!data) continue;

    const status = String(data.status || '');
    if (status === 'completed') {
      return {
        status,
        imageUrl: extractImageUrl(json),
        errorMessage: null
      };
    }
    if (status === 'failed') {
      return {
        status,
        imageUrl: null,
        errorMessage: String(data.error_message || data.error || 'upstream_failed')
      };
    }
  }

  return { status: 'timeout', imageUrl: null, errorMessage: 'upstream_timeout' };
}
