import { ApiError } from './errors';
import type { NewApiCatalogParameter } from './newapi';

export type NewApiVideoSubmitParams = {
  upstreamModel: string;
  prompt: string;
  duration: number;
  ratio: string;
  resolution: string;
  referenceImages?: string[];
  styleImages?: string[];
  elementImages?: string[];
  startFrame?: string;
  endFrame?: string;
  referenceVideos?: string[];
  referenceAudios?: string[];
  catalogValues?: Record<string, unknown>;
  catalogParameters?: NewApiCatalogParameter[];
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

function boundedRefs(parameter: NewApiCatalogParameter, refs: string[]): string[] {
  const max = parameter.max_items == null ? refs.length : Math.max(0, Math.floor(parameter.max_items));
  return refs.slice(0, max);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function declaredValue(parameter: NewApiCatalogParameter, requested: unknown): unknown {
  if (hasOwn(parameter, 'fixed')) return parameter.fixed;
  const candidate = requested ?? (hasOwn(parameter, 'default') ? parameter.default : undefined);
  if (!parameter.options?.length || candidate == null) return candidate;
  return parameter.options.find(option => String(option).toLowerCase() === String(candidate).toLowerCase()) ?? candidate;
}

function firstDeclared(
  declared: Map<string, NewApiCatalogParameter>,
  names: readonly string[]
): NewApiCatalogParameter | null {
  for (const name of names) {
    const parameter = declared.get(name);
    if (parameter) return parameter;
  }
  return null;
}

function setDeclaredMedia(
  body: Record<string, unknown>,
  parameter: NewApiCatalogParameter | null,
  refs: string[] | undefined
): void {
  const clean = (refs || []).map(value => value.trim()).filter(Boolean);
  if (!parameter || !clean.length) return;
  const bounded = boundedRefs(parameter, clean);
  setRequestPath(body, parameter.path, parameter.type === 'array' ? bounded : bounded[0]);
}

const CORE_PARAMETER_NAMES = new Set([
  'model',
  'prompt',
  'seconds',
  'duration',
  'size',
  'resolution',
  'aspect_ratio',
  'ratio'
]);

const MEDIA_PARAMETER_NAMES = new Set([
  'referenceImages',
  'images',
  'reference_images',
  'image',
  'input_reference',
  'styleImages',
  'style_references',
  'elementImages',
  'element_references',
  'start_frame',
  'first_image',
  'end_frame',
  'last_image',
  'referenceVideos',
  'reference_videos',
  'video_references',
  'videos',
  'reference_video',
  'input_video',
  'referenceAudios',
  'reference_audios',
  'audio_reference',
  'audios',
  'reference_audio'
]);

function hasRequestValue(value: unknown): boolean {
  if (value == null || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function catalogValue(parameter: NewApiCatalogParameter, value: unknown): unknown {
  const declared = declaredValue(parameter, value);
  if (parameter.type === 'array') return Array.isArray(declared) ? declared : [declared];
  return Array.isArray(declared) ? declared[0] : declared;
}

function buildCatalogRequestBody(params: NewApiVideoSubmitParams): Record<string, unknown> {
  const parameters = (params.catalogParameters || []).filter(parameter => parameter?.name && parameter.path);
  const declared = new Map(parameters.map(parameter => [parameter.name, parameter]));
  const body: Record<string, unknown> = {};
  const set = (names: readonly string[], requested: unknown) => {
    const parameter = firstDeclared(declared, names);
    if (parameter) setRequestPath(body, parameter.path, declaredValue(parameter, requested));
  };

  // Fixed catalog fields are part of the upstream contract, not browser
  // choices. Apply every one by its declared path before dynamic values are
  // projected into the mutually compatible field families below.
  for (const parameter of parameters) {
    if (hasOwn(parameter, 'fixed')) setRequestPath(body, parameter.path, parameter.fixed);
  }

  // Preserve model-specific controls such as generate_audio,
  // reference_strength, and prompt_enhance. Core aliases and media slots are
  // handled separately so legacy and native fields are never emitted together.
  for (const parameter of parameters) {
    if (hasOwn(parameter, 'fixed')
      || CORE_PARAMETER_NAMES.has(parameter.name)
      || MEDIA_PARAMETER_NAMES.has(parameter.name)
      || !hasOwn(params.catalogValues || {}, parameter.name)) continue;
    const value = params.catalogValues![parameter.name];
    if (hasRequestValue(value)) setRequestPath(body, parameter.path, catalogValue(parameter, value));
  }

  set(['model'], params.upstreamModel);
  set(['prompt'], params.prompt);
  set(['seconds', 'duration'], params.duration);
  set(['size', 'resolution'], params.resolution);

  const ratioParameter = firstDeclared(declared, ['aspect_ratio', 'ratio']);
  if (ratioParameter && (ratioParameter.options?.length || hasOwn(ratioParameter, 'fixed') || hasOwn(ratioParameter, 'default'))) {
    setRequestPath(body, ratioParameter.path, declaredValue(ratioParameter, params.ratio));
  }

  setDeclaredMedia(body, firstDeclared(declared, ['images', 'referenceImages', 'reference_images', 'image', 'input_reference']), params.referenceImages);
  setDeclaredMedia(body, firstDeclared(declared, ['style_references', 'styleImages']), params.styleImages);
  setDeclaredMedia(body, firstDeclared(declared, ['element_references', 'elementImages']), params.elementImages);
  setDeclaredMedia(body, firstDeclared(declared, ['start_frame', 'first_image']), params.startFrame ? [params.startFrame] : undefined);
  setDeclaredMedia(body, firstDeclared(declared, ['end_frame', 'last_image']), params.endFrame ? [params.endFrame] : undefined);
  setDeclaredMedia(body, firstDeclared(declared, ['reference_videos', 'referenceVideos', 'video_references', 'videos', 'reference_video', 'input_video']), params.referenceVideos);
  setDeclaredMedia(body, firstDeclared(declared, ['reference_audios', 'referenceAudios', 'audio_reference', 'audios', 'reference_audio']), params.referenceAudios);
  return body;
}

export function buildNewApiVideoRequestBody(params: NewApiVideoSubmitParams): Record<string, unknown> {
  if (params.catalogParameters?.length) return buildCatalogRequestBody(params);

  const isSd = params.upstreamModel.toLowerCase().startsWith('sd');
  return {
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
}

export async function submitNewApiVideo(
  apiKey: string,
  baseUrl: string | undefined,
  params: NewApiVideoSubmitParams
): Promise<NewApiVideoTask> {
  const body = buildNewApiVideoRequestBody(params);
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
