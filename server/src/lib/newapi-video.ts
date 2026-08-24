import { ApiError } from './errors';
import type { NewApiCatalogParameter } from './newapi';

export type NewApiVideoSubmitParams = {
  upstreamModel: string;
  idempotencyKey?: string;
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

const CONTENT_RETRY_DELAYS_MS = [500, 1_500, 3_500, 7_000] as const;

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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const CORE_PARAMETER_NAMES = new Set([
  'model',
  'prompt',
  'duration_seconds',
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

const H3_SUPER_RESOLUTIONS = new Set(['2K', '4K']);
const H3_SUPER_WORKFLOWS = new Set(['cf-multi-reference', 'cf-fl2v', 'cf-mj']);

type VideoMediaKind = 'image' | 'video' | 'audio';
type VideoMediaRole = 'reference' | 'first_frame' | 'last_frame' | 'source_video' | 'audio_reference' | 'style_reference' | 'element_reference';
type VideoMediaInput = { kind: VideoMediaKind; role: VideoMediaRole; url: string };

function cleanReferences(values: string[] | undefined, parameter?: NewApiCatalogParameter): string[] {
  const clean = (values || []).map(value => value.trim()).filter(Boolean);
  const declaredMax = parameter?.max_items;
  if (declaredMax == null) return clean;
  return clean.slice(0, Math.max(0, Math.floor(declaredMax)));
}

function findParameter(parameters: NewApiCatalogParameter[], names: readonly string[]): NewApiCatalogParameter | undefined {
  return parameters.find(parameter => names.includes(parameter.name));
}

function declaredScalar(parameter: NewApiCatalogParameter | undefined, requested: unknown): unknown {
  if (parameter && hasOwn(parameter, 'fixed')) return parameter.fixed;
  if (requested != null && requested !== '') return requested;
  return parameter && hasOwn(parameter, 'default') ? parameter.default : undefined;
}

function appendMediaInputs(
  target: VideoMediaInput[],
  kind: VideoMediaKind,
  role: VideoMediaRole,
  values: string[]
): void {
  for (const url of values) target.push({ kind, role, url });
}

function videoOptions(params: NewApiVideoSubmitParams, parameters: NewApiCatalogParameter[]): Record<string, unknown> {
  const options: Record<string, unknown> = { async: true, n: 1 };
  for (const parameter of parameters) {
    if (CORE_PARAMETER_NAMES.has(parameter.name) || MEDIA_PARAMETER_NAMES.has(parameter.name)) continue;
    const supplied = hasOwn(params.catalogValues || {}, parameter.name);
    if (!hasOwn(parameter, 'fixed') && !supplied) continue;
    const value = hasOwn(parameter, 'fixed') ? parameter.fixed : params.catalogValues![parameter.name];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    options[parameter.name] = value;
  }
  return options;
}

function isMiniMaxH3(model: string) {
  return /^minimax[ _-]*h3(?:$|[ _-])/i.test(model.trim());
}

function h3SuperResolutionBody(
  params: NewApiVideoSubmitParams,
  resolution: unknown,
): Record<string, unknown> | null {
  if (!isMiniMaxH3(params.upstreamModel) || typeof resolution !== 'string') return null;
  const size = resolution.trim().toUpperCase();
  if (!H3_SUPER_RESOLUTIONS.has(size)) return null;

  const requestedWorkflow = params.catalogValues?.workflow_id;
  const workflow = typeof requestedWorkflow === 'string' && H3_SUPER_WORKFLOWS.has(requestedWorkflow)
    ? requestedWorkflow
    : params.startFrame || params.endFrame
      ? 'cf-fl2v'
      : 'cf-multi-reference';
  const images = [
    ...(params.referenceImages || []),
    ...(params.startFrame ? [params.startFrame] : []),
    ...(params.endFrame ? [params.endFrame] : []),
  ].map(value => value.trim()).filter(Boolean);

  // The H3 super-resolution workflows use the native New API envelope. In
  // particular, `size` selects the 2K/4K tier and `workflow_id` selects the
  // ComfyUI workflow; sending `resolution` or `aspect_ratio` makes the
  // upstream interpret the tier as an ordinary aspect-ratio size.
  return {
    model: params.upstreamModel,
    prompt: params.prompt,
    seconds: params.duration,
    workflow_id: workflow,
    size,
    ...(images.length ? { images } : {}),
    ...(params.referenceVideos?.length ? { reference_videos: params.referenceVideos } : {}),
    ...(params.referenceAudios?.length ? { reference_audios: params.referenceAudios } : {}),
  };
}

export function buildNewApiVideoRequestBody(params: NewApiVideoSubmitParams): Record<string, unknown> {
  const parameters = (params.catalogParameters || []).filter(parameter => parameter?.name);
  const duration = declaredScalar(findParameter(parameters, ['duration_seconds', 'seconds', 'duration']), params.duration);
  const resolution = declaredScalar(findParameter(parameters, ['resolution', 'size']), params.resolution);
  const aspectRatio = declaredScalar(findParameter(parameters, ['aspect_ratio', 'ratio']), params.ratio);
  const h3SuperResolution = h3SuperResolutionBody(params, resolution);
  if (h3SuperResolution) return h3SuperResolution;
  const mediaInputs: VideoMediaInput[] = [];

  const imageParameter = findParameter(parameters, ['referenceImages', 'images', 'reference_images', 'image', 'input_reference']);
  appendMediaInputs(mediaInputs, 'image', 'reference', cleanReferences(params.referenceImages, imageParameter));
  appendMediaInputs(mediaInputs, 'image', 'style_reference', cleanReferences(params.styleImages, findParameter(parameters, ['styleImages', 'style_references'])));
  appendMediaInputs(mediaInputs, 'image', 'element_reference', cleanReferences(params.elementImages, findParameter(parameters, ['elementImages', 'element_references'])));
  appendMediaInputs(mediaInputs, 'image', 'first_frame', cleanReferences(params.startFrame ? [params.startFrame] : undefined, findParameter(parameters, ['start_frame', 'first_image'])));
  appendMediaInputs(mediaInputs, 'image', 'last_frame', cleanReferences(params.endFrame ? [params.endFrame] : undefined, findParameter(parameters, ['end_frame', 'last_image'])));

  const videoParameter = findParameter(parameters, ['referenceVideos', 'reference_videos', 'video_references', 'videos', 'reference_video', 'input_video']);
  const videoRole: VideoMediaRole = videoParameter?.path.split('.').at(-1) === 'input_video' ? 'source_video' : 'reference';
  appendMediaInputs(mediaInputs, 'video', videoRole, cleanReferences(params.referenceVideos, videoParameter));
  appendMediaInputs(mediaInputs, 'audio', 'audio_reference', cleanReferences(
    params.referenceAudios,
    findParameter(parameters, ['referenceAudios', 'reference_audios', 'audio_reference', 'audios', 'reference_audio'])
  ));

  const operation = mediaInputs.some(input => input.kind === 'video')
    ? 'video_to_video'
    : mediaInputs.some(input => input.kind === 'image')
      ? 'image_to_video'
      : 'text_to_video';
  return {
    version: 'video.v1',
    model: params.upstreamModel,
    operation,
    prompt: params.prompt,
    ...(duration != null && duration !== '' ? { duration_seconds: Number(duration) } : {}),
    ...(resolution != null && resolution !== '' ? { resolution } : {}),
    ...(aspectRatio != null && aspectRatio !== '' ? { aspect_ratio: aspectRatio } : {}),
    ...(mediaInputs.length ? { media_inputs: mediaInputs } : {}),
    options: videoOptions(params, parameters)
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {})
    },
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
  const url = `${apiBase(baseUrl)}/v1/videos/${encodeURIComponent(taskId)}/content`;
  for (let attempt = 0; attempt <= CONTENT_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(range ? { Range: range } : {})
      }
    });
    if (response.ok) return response;
    const retryable = response.status === 404
      || response.status === 408
      || response.status === 425
      || response.status === 429
      || response.status >= 500;
    const payload = await jsonResponse(response);
    if (!retryable || attempt >= CONTENT_RETRY_DELAYS_MS.length) {
      throw new ApiError(response.status >= 500 ? 502 : response.status, 'UPSTREAM_ERROR', errorMessage(payload, response.status));
    }
    await new Promise<void>(resolve => setTimeout(resolve, CONTENT_RETRY_DELAYS_MS[attempt]));
  }
  throw new ApiError(502, 'UPSTREAM_ERROR', '视频内容暂时无法读取');
}
