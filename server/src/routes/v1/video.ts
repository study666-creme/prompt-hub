import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { roundCredits } from '../../lib/credit-math';
import { ApiError } from '../../lib/errors';
import { isAcceptedRefImageInput, resolveGenerationRefUrls } from '../../lib/generation-ref-images';
import { isStorageRef, storagePathFromRef } from '../../lib/image-archive';
import { buildPrivateMediaCdnUrl } from '../../lib/media-cdn';
import {
  CLIENT_REQUEST_ID_PATTERN,
  findOwnedGenerationRequest,
  generationRequestId,
  insertGenerationRequest,
  type GenerationRequestRecord
} from '../../lib/generation-idempotency';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  newApiKeyForRoute,
  newApiFixedCreditsForRequest,
  newApiHasActiveRoute,
  resolveNewApiCatalogModel,
  resolveNewApiRoutedCatalogModel,
  type NewApiCatalogModel,
  type NewApiCatalogSnapshot,
  type NewApiResolvedCatalogModel,
  type NewApiCatalogParameter
} from '../../lib/newapi';
import {
  fetchNewApiVideoContent,
  validateNewApiVideoMediaBindings,
  type NewApiVideoMediaBinding,
  type NewApiVideoMediaBindings
} from '../../lib/newapi-video';
import { pollVideoProviderJob } from '../../lib/video-provider-poll';
import {
  processVideoPendingSubmit,
  settleVideoRefund,
  type VideoSubmissionJob
} from '../../lib/video-provider-submit';
import {
  deductUserCredits,
  spendableCredits,
  syncMembershipCredits,
  type DebitSplit
} from '../../lib/membership-credits';
import { sanitizePublicModelId, sanitizePublicModelLabel } from '../../lib/public-model-projection';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const mediaRef = z.string().refine(value => /^https?:\/\//i.test(value) || isStorageRef(value), '仅支持媒体 URL');
const imageRef = z.string().refine(isAcceptedRefImageInput);
const bodySchema = z.object({
  clientRequestId: z.string().min(8).max(128).regex(CLIENT_REQUEST_ID_PATTERN).optional(),
  product: z.literal('canvas').optional(),
  projectId: z.string().trim().min(1).max(128).optional(),
  nodeId: z.string().trim().min(1).max(128).optional(),
  model: z.string().min(1).max(100),
  prompt: z.string().min(1).max(12000),
  duration: z.coerce.number().int().min(1).max(60).optional(),
  seconds: z.coerce.number().int().min(1).max(60).optional(),
  ratio: z.string().min(1).max(30).optional(),
  aspect_ratio: z.string().min(1).max(30).optional(),
  size: z.string().min(1).max(64).optional(),
  resolution: z.string().min(1).max(30).default('720p'),
  referenceImages: z.array(imageRef).max(14).optional(),
  styleImages: z.array(imageRef).max(14).optional(),
  elementImages: z.array(imageRef).max(14).optional(),
  image: imageRef.optional(),
  images: z.array(imageRef).max(14).optional(),
  first_image: imageRef.optional(),
  last_image: imageRef.optional(),
  referenceVideos: z.array(mediaRef).max(3).optional(),
  referenceAudios: z.array(mediaRef).max(3).optional()
}).superRefine((input, ctx) => {
  if (input.duration != null && input.seconds != null && input.duration !== input.seconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration 与 seconds 不能冲突' });
  }
  if (input.ratio && input.aspect_ratio && input.ratio !== input.aspect_ratio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ratio 与 aspect_ratio 不能冲突' });
  }
  const populatedImageAliases = [
    input.referenceImages?.length ? 'referenceImages' : '',
    input.image ? 'image' : '',
    input.images?.length ? 'images' : ''
  ].filter(Boolean);
  if (populatedImageAliases.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '参考图字段不能重复' });
  }
}).transform(input => ({
  clientRequestId: input.clientRequestId,
  product: input.product,
  projectId: input.projectId,
  nodeId: input.nodeId,
  model: input.model,
  prompt: input.prompt,
  duration: input.duration ?? input.seconds,
  ratio: input.ratio || input.aspect_ratio || '16:9',
  size: input.size,
  resolution: input.resolution,
  referenceImages: input.referenceImages?.length
    ? input.referenceImages
    : input.image
      ? [input.image]
      : input.images?.length
        ? input.images
        : undefined,
  styleImages: input.styleImages,
  elementImages: input.elementImages,
  firstImage: input.first_image,
  lastImage: input.last_image,
  referenceVideos: input.referenceVideos,
  referenceAudios: input.referenceAudios
}));

type ParsedVideoRequest = z.infer<typeof bodySchema>;
type VideoRequest = Omit<ParsedVideoRequest, 'duration'> & { duration: number };

export function parseVideoRequestBody(raw: unknown): ParsedVideoRequest {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的视频提示词与参数');
  return parsed.data;
}

type VideoMeta = {
  mediaType?: unknown;
  model?: unknown;
  modelLabel?: unknown;
  upstreamModel?: unknown;
  upstreamTaskId?: unknown;
  routeChannelId?: unknown;
  credits?: unknown;
  debitSplit?: unknown;
  progress?: unknown;
  resultUrl?: unknown;
  refundState?: unknown;
  requestedDuration?: unknown;
  billingUnit?: unknown;
  billingUnitCredits?: unknown;
  actualDurationSeconds?: unknown;
  actualBillableDuration?: unknown;
  billingRefundCredits?: unknown;
  billingReconciliationState?: unknown;
  videoSubmitState?: unknown;
  videoSubmitEnvelope?: unknown;
  videoSubmitQueuedAt?: unknown;
  videoSubmitError?: unknown;
  videoResultState?: unknown;
  videoResultErrorCode?: unknown;
  videoResultUncertainAt?: unknown;
  [key: string]: unknown;
};

export const videoRoutes = new Hono<{ Bindings: Env }>();

function parameterValues(model: NewApiCatalogModel, name: string): string[] {
  const parameter = model.parameters.find(item => item.name === name);
  if (!parameter) return [];
  const values = parameter.options?.length
    ? parameter.options
    : Object.prototype.hasOwnProperty.call(parameter, 'fixed')
      ? [parameter.fixed]
      : [];
  return values.map(value => String(value));
}

function parameter(model: NewApiCatalogModel, names: string[]): NewApiCatalogParameter | null {
  return model.parameters.find(item => {
    const pathName = String(item.path || '').split('.').filter(Boolean).at(-1);
    return names.includes(item.name) || (pathName ? names.includes(pathName) : false);
  }) || null;
}

function mediaParameter(model: NewApiCatalogModel, paths: string[]): NewApiCatalogParameter | null {
  return model.parameters.find(item => {
    const pathName = String(item.path || '').split('.').filter(Boolean).at(-1);
    return pathName ? paths.includes(pathName) : false;
  }) || null;
}

const REFERENCE_IMAGE_PATHS = ['referenceImages', 'reference_images', 'images', 'image'];
const STYLE_IMAGE_PATHS = ['style_references', 'styleImages', 'style_images'];
const ELEMENT_IMAGE_PATHS = ['element_references', 'elementImages', 'element_images'];
const REFERENCE_VIDEO_PATHS = ['referenceVideos', 'reference_videos', 'input_video', 'video'];
const REFERENCE_AUDIO_PATHS = ['referenceAudios', 'reference_audios', 'input_audio', 'audio'];

function mediaBinding(model: NewApiCatalogModel, paths: string[]): NewApiVideoMediaBinding | undefined {
  const declared = mediaParameter(model, paths);
  if (!declared || (declared.type !== 'array' && declared.type !== 'string')) return undefined;
  return { path: declared.path, type: declared.type };
}

export function videoMediaBindings(model: NewApiCatalogModel): NewApiVideoMediaBindings {
  return {
    referenceImages: mediaBinding(model, REFERENCE_IMAGE_PATHS),
    styleImages: mediaBinding(model, STYLE_IMAGE_PATHS),
    elementImages: mediaBinding(model, ELEMENT_IMAGE_PATHS),
    referenceVideos: mediaBinding(model, REFERENCE_VIDEO_PATHS),
    referenceAudios: mediaBinding(model, REFERENCE_AUDIO_PATHS)
  };
}

function integerValue(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function durationBounds(declared: NewApiCatalogParameter | null) {
  const min = Math.max(1, Math.ceil(Number(declared?.min) || 1));
  const rawMax = Number(declared?.max);
  const max = Math.min(60, Number.isFinite(rawMax) ? Math.floor(rawMax) : 60);
  if (min > max) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '该模型的视频时长配置无效');
  return { min, max };
}

function omittedVideoDuration(model: NewApiCatalogModel): number {
  const declared = parameter(model, ['duration', 'seconds']);
  const { min, max } = durationBounds(declared);
  if (declared && Object.prototype.hasOwnProperty.call(declared, 'fixed')) {
    const fixed = integerValue(declared.fixed);
    if (fixed == null || fixed < min || fixed > max) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', '该模型的视频时长配置无效');
    }
    return fixed;
  }
  const options = (declared?.options || [])
    .map(integerValue)
    .filter((value): value is number => value != null && value >= min && value <= max);
  const fallback = integerValue(declared?.default);
  if (options.length) return fallback != null && options.includes(fallback) ? fallback : options[0];
  return Math.max(min, Math.min(max, fallback ?? 5));
}

function fixedStringParameter(model: NewApiCatalogModel, names: string[]): string | null {
  const declared = parameter(model, names);
  if (!declared || !Object.prototype.hasOwnProperty.call(declared, 'fixed')) return null;
  return String(declared.fixed ?? '').trim() || null;
}

export function resolveVideoRequest(model: NewApiCatalogModel, input: ParsedVideoRequest): VideoRequest {
  const declaredDuration = parameter(model, ['duration', 'seconds']);
  const duration = declaredDuration && Object.prototype.hasOwnProperty.call(declaredDuration, 'fixed')
    ? omittedVideoDuration(model)
    : input.duration ?? omittedVideoDuration(model);
  const referenceImages = [...(input.referenceImages || [])];
  let firstImage = input.firstImage;
  let lastImage = input.lastImage;
  if (!videoMediaBindings(model).referenceImages && referenceImages.length) {
    if (!firstImage && mediaParameter(model, ['first_image'])) firstImage = referenceImages.shift();
    if (!lastImage && mediaParameter(model, ['last_image'])) lastImage = referenceImages.shift();
  }
  return {
    ...input,
    duration,
    referenceImages: referenceImages.length ? referenceImages : undefined,
    firstImage,
    lastImage,
    ratio: fixedStringParameter(model, ['ratio', 'aspect_ratio']) || input.ratio,
    resolution: fixedStringParameter(model, ['resolution']) || input.resolution,
    size: fixedStringParameter(model, ['size']) || input.size
  };
}

export function validateVideoRequest(model: NewApiCatalogModel, input: VideoRequest): void {
  const duration = parameter(model, ['duration', 'seconds']);
  const durations = [...parameterValues(model, 'duration'), ...parameterValues(model, 'seconds')];
  if (durations.length && !durations.includes(String(input.duration))) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型仅支持 ${durations.join('、')} 秒`);
  }
  if (duration?.min != null && input.duration < duration.min) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型最短支持 ${duration.min} 秒`);
  }
  if (duration?.max != null && input.duration > duration.max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型最长支持 ${duration.max} 秒`);
  }
  const ratios = [...parameterValues(model, 'ratio'), ...parameterValues(model, 'aspect_ratio')];
  if (ratios.length && !ratios.includes(input.ratio)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${input.ratio} 比例`);
  }
  const resolutions = parameterValues(model, 'resolution');
  if (resolutions.length && !resolutions.includes(input.resolution)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${input.resolution} 分辨率`);
  }
  const sizes = parameterValues(model, 'size');
  const sizeParameter = parameter(model, ['size']);
  if (sizeParameter?.required && !input.size) {
    throw new ApiError(400, 'VALIDATION_ERROR', '该模型需要画面尺寸');
  }
  if (sizes.length && input.size && !sizes.includes(input.size)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${input.size} 尺寸`);
  }
  validateReferenceCount(mediaParameter(model, REFERENCE_IMAGE_PATHS), input.referenceImages?.length || 0, '参考图片');
  validateReferenceCount(mediaParameter(model, STYLE_IMAGE_PATHS), input.styleImages?.length || 0, '风格参考图片');
  validateReferenceCount(mediaParameter(model, ELEMENT_IMAGE_PATHS), input.elementImages?.length || 0, '元素参考图片');
  validateReferenceCount(mediaParameter(model, ['first_image']), input.firstImage ? 1 : 0, '首帧图片');
  validateReferenceCount(mediaParameter(model, ['last_image']), input.lastImage ? 1 : 0, '尾帧图片');
  validateReferenceCount(mediaParameter(model, REFERENCE_VIDEO_PATHS), input.referenceVideos?.length || 0, '参考视频');
  validateReferenceCount(mediaParameter(model, REFERENCE_AUDIO_PATHS), input.referenceAudios?.length || 0, '参考音频');
  validateAggregateReferenceCount(model, input);
  validateNewApiVideoMediaBindings({
    upstreamModel: model.upstreamModel,
    prompt: input.prompt,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    size: input.size,
    referenceImages: input.referenceImages,
    styleImages: input.styleImages,
    elementImages: input.elementImages,
    firstImage: input.firstImage,
    lastImage: input.lastImage,
    referenceVideos: input.referenceVideos,
    referenceAudios: input.referenceAudios,
    mediaBindings: videoMediaBindings(model)
  });
}

function validateReferenceCount(declared: NewApiCatalogParameter | null, count: number, label: string): void {
  const required = declared?.required === true || Number(declared?.min_items || 0) > 0;
  const min = declared?.type === 'array' ? Number(declared.min_items || (required ? 1 : 0)) : required ? 1 : 0;
  const max = declared?.type === 'array' ? Number(declared.max_items ?? Number.POSITIVE_INFINITY) : declared ? 1 : 0;
  if (count < min) throw new ApiError(400, 'VALIDATION_ERROR', `该模型至少需要 ${min} 个${label}`);
  if (count > max) throw new ApiError(400, 'VALIDATION_ERROR', `该模型最多支持 ${max} 个${label}`);
}

function validateAggregateReferenceCount(model: NewApiCatalogModel, input: VideoRequest): void {
  const bindings = videoMediaBindings(model);
  const counted: Array<[NewApiVideoMediaBinding | undefined, number]> = [
    [bindings.referenceImages, input.referenceImages?.length || 0],
    [bindings.styleImages, input.styleImages?.length || 0],
    [bindings.elementImages, input.elementImages?.length || 0],
    [mediaBinding(model, ['first_image']), input.firstImage ? 1 : 0],
    [mediaBinding(model, ['last_image']), input.lastImage ? 1 : 0],
    [bindings.referenceVideos, input.referenceVideos?.length || 0],
    [bindings.referenceAudios, input.referenceAudios?.length || 0]
  ];
  const checked = new Set<string>();
  for (const parameter of model.parameters) {
    const constraint = parameter.aggregateConstraint;
    if (!constraint) continue;
    const key = `${constraint.maxTotalItems}:${[...constraint.fields].sort().join(',')}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const total = counted.reduce((sum, [binding, count]) => {
      if (!binding || !count) return sum;
      const pathTail = binding.path.split('.').filter(Boolean).at(-1);
      return constraint.fields.some(field => field === binding.path || field === pathTail) ? sum + count : sum;
    }, 0);
    if (total > constraint.maxTotalItems) {
      throw new ApiError(400, 'VALIDATION_ERROR', `参考素材最多可使用 ${constraint.maxTotalItems} 个`);
    }
  }
}

type FreshVideoModel = NewApiResolvedCatalogModel & {
  publicIdentity: { model: string; modelLabel: string };
};

async function freshVideoModel(env: Env, modelId: string): Promise<FreshVideoModel> {
  let snapshot;
  try {
    snapshot = await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL, { force: true, requireFresh: true });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认实时价格，请稍后重试');
  }
  const routes = await fetchNewApiAdminRoutes(env.NEWAPI_API_BASE_URL, env.NEWAPI_CATALOG_ADMIN_SECRET);
  const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, modelId, 'video');
  if (!resolved || !newApiHasActiveRoute(routes, resolved.model.upstreamModel)) {
    throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选视频模型已不可用，请刷新后重选');
  }
  const publicModel = resolveNewApiCatalogModel(snapshot, resolved.model.upstreamModel, 'video');
  return {
    ...resolved,
    publicIdentity: publicModel
      ? { model: publicModel.id, modelLabel: publicModel.label }
      : { model: 'video-model', modelLabel: '视频模型' }
  };
}

const VIDEO_RESULT_UNCERTAIN_PUBLIC_MESSAGE = '任务结果暂时无法确认，请勿重复生成';

function normalizedVideoProgress(value: unknown): number {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
}

export function projectPublicVideoResultState(row: Record<string, unknown>) {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  const storedStatus = String(row.status || 'processing');
  const resultUncertain = storedStatus === 'processing' && meta.videoResultState === 'result_uncertain';
  return {
    status: resultUncertain ? 'submission_unknown' : storedStatus,
    progress: normalizedVideoProgress(meta.progress),
    errorMessage: resultUncertain
      ? VIDEO_RESULT_UNCERTAIN_PUBLIC_MESSAGE
      : storedStatus === 'failed'
        ? '视频生成未完成，请调整参数后重试'
        : null
  };
}

export function projectPublicVideoPayload(
  row: Record<string, unknown>,
  identity: { model: string; modelLabel: string },
  creditsRemaining?: number
) {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  const model = sanitizePublicModelId(identity.model) || 'video-model';
  const result = projectPublicVideoResultState(row);
  return {
    jobId: String(row.id || ''),
    status: result.status,
    model,
    modelLabel: sanitizePublicModelLabel(identity.modelLabel, model === 'video-model' ? '视频模型' : model),
    progress: result.progress,
    videoUrl: result.status === 'completed' ? `/api/v1/video/jobs/${encodeURIComponent(String(row.id || ''))}/content` : null,
    errorMessage: result.errorMessage,
    creditsCharged: Number(meta.credits) || Number(row.credits_charged) || 0,
    ...(creditsRemaining == null ? {} : { creditsRemaining })
  };
}

export function publicVideoIdentityFromSnapshot(
  snapshot: NewApiCatalogSnapshot,
  value: unknown
) {
  const meta = value && typeof value === 'object' ? value as VideoMeta : {};
  const candidates = [meta.model, meta.upstreamModel]
    .map(candidate => String(candidate || '').trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const model = resolveNewApiCatalogModel(snapshot, candidate, 'video');
    if (model) return { model: model.id, modelLabel: model.label };
  }
  return { model: 'video-model', modelLabel: '视频模型' };
}

export function isPublicVideoContentResponse(ok: boolean, contentType: string): boolean {
  return ok && (
    !contentType
    || /^video\//i.test(contentType)
    || /^(?:application|binary)\/octet-stream\b/i.test(contentType)
  );
}

async function videoPayload(env: Env, row: Record<string, unknown>, creditsRemaining?: number) {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  if (meta.mediaType !== 'video') {
    throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '该请求标识已用于其他生成任务');
  }
  let identity = { model: 'video-model', modelLabel: '视频模型' };
  try {
    const snapshot = await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL);
    identity = publicVideoIdentityFromSnapshot(snapshot, meta);
  } catch {
    // The task remains readable with a generic public identity when catalog refresh is unavailable.
  }
  return projectPublicVideoPayload(row, identity, creditsRemaining);
}

export async function videoRequestFingerprint(input: ParsedVideoRequest): Promise<string> {
  const canonical = JSON.stringify({
    model: input.model,
    prompt: input.prompt,
    duration: input.duration ?? null,
    ratio: input.ratio,
    size: input.size ?? null,
    resolution: input.resolution,
    referenceImages: input.referenceImages ?? [],
    ...(input.styleImages?.length ? { styleImages: input.styleImages } : {}),
    ...(input.elementImages?.length ? { elementImages: input.elementImages } : {}),
    firstImage: input.firstImage ?? null,
    lastImage: input.lastImage ?? null,
    referenceVideos: input.referenceVideos ?? [],
    referenceAudios: input.referenceAudios ?? [],
    product: input.product ?? null,
    projectId: input.projectId ?? null,
    nodeId: input.nodeId ?? null
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function resolveMediaReferences(
  c: Parameters<typeof buildPrivateMediaCdnUrl>[0],
  userId: string,
  refs: string[] | undefined
) {
  const urls: string[] = [];
  for (const raw of refs || []) {
    const value = String(raw || '').trim();
    if (/^https?:\/\//i.test(value)) {
      urls.push(value);
      continue;
    }
    const path = storagePathFromRef(value);
    if (!path || !path.replace(/^\//, '').startsWith(`${userId}/`)) {
      throw new ApiError(403, 'FORBIDDEN', '无权使用该媒体素材');
    }
    urls.push(await buildPrivateMediaCdnUrl(c, path));
  }
  return urls;
}

class VideoQueueStateUncertainError extends Error {
  constructor() {
    super('video_queue_state_uncertain');
    this.name = 'VideoQueueStateUncertainError';
  }
}

async function persistQueuedVideoMeta(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  userId: string,
  meta: VideoMeta
): Promise<void> {
  const result = await admin
    .from('generation_requests')
    .update({ meta })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'awaiting_debit')
    .select('*')
    .maybeSingle();
  if (result.data) return;

  const verified = await admin
    .from('generation_requests')
    .select('id,status,meta')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  const persistedMeta = verified.data?.meta && typeof verified.data.meta === 'object'
    ? verified.data.meta as VideoMeta
    : {};
  if (
    verified.data?.status === 'processing'
    && persistedMeta.videoSubmitState === 'queued'
    && videoMetaEnvelopeKey(persistedMeta) === videoMetaEnvelopeKey(meta)
  ) {
    return;
  }
  if (verified.error || !verified.data || persistedMeta.videoSubmitState !== 'awaiting_debit') {
    throw new VideoQueueStateUncertainError();
  }
  throw result.error || new Error('video_queue_state_not_persisted');
}

function kickBackgroundVideoSubmit(
  c: { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } },
  task: Promise<unknown>
) {
  const wrapped = task.catch((error) => {
    console.warn('[video] background submit fallback failed', error);
  });
  let executionCtx: { waitUntil: (p: Promise<unknown>) => void } | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  if (executionCtx) executionCtx.waitUntil(wrapped);
  else void wrapped;
}

function videoMetaEnvelopeKey(meta: VideoMeta): string {
  const envelope = meta.videoSubmitEnvelope && typeof meta.videoSubmitEnvelope === 'object'
    ? meta.videoSubmitEnvelope as Record<string, unknown>
    : {};
  return String(envelope.idempotencyKey || '');
}

videoRoutes.post('/', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const parsed = parseVideoRequestBody(await c.req.json().catch(() => ({})));
  const requestFingerprint = await videoRequestFingerprint(parsed);
  const admin = createAdminClient(c.env);
  const requestId = parsed.clientRequestId
    ? await generationRequestId(user.id, parsed.clientRequestId)
    : crypto.randomUUID();
  if (parsed.clientRequestId) {
    const existing = await findOwnedGenerationRequest<GenerationRequestRecord>(
      admin,
      user.id,
      requestId,
      parsed.clientRequestId
    );
    if (existing.error) throw new ApiError(502, 'GENERATION_FAILED', '读取视频任务失败');
    if (existing.row) {
      const existingMeta = existing.row.meta && typeof existing.row.meta === 'object'
        ? existing.row.meta as VideoMeta
        : {};
      const storedFingerprint = String(existingMeta.requestFingerprint || '');
      if (storedFingerprint && storedFingerprint !== requestFingerprint) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '该请求标识已用于不同的视频参数');
      }
      return c.json({ ok: true, data: await videoPayload(c.env, existing.row) });
    }
  }

  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频服务暂未配置');
  if (!c.env.VIDEO_GENERATION_QUEUE) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频生成队列暂不可用，请稍后重试');
  }
  const resolved = await freshVideoModel(c.env, parsed.model);
  const { model, route, publicIdentity } = resolved;
  const input = resolveVideoRequest(model, parsed);
  validateVideoRequest(model, input);
  const credits = newApiFixedCreditsForRequest(model, {
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio
  });
  if (credits == null || credits <= 0) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');

  let profile = await syncMembershipCredits(admin, user.id);
  const final = roundCredits(credits);
  if (spendableCredits(profile) < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${spendableCredits(profile)}）`);
  }
  const [referenceImages, styleImages, elementImages, firstImageRefs, lastImageRefs, referenceVideos, referenceAudios] = await Promise.all([
    input.referenceImages?.length ? resolveGenerationRefUrls(c, admin, user.id, input.referenceImages) : Promise.resolve([]),
    input.styleImages?.length ? resolveGenerationRefUrls(c, admin, user.id, input.styleImages) : Promise.resolve([]),
    input.elementImages?.length ? resolveGenerationRefUrls(c, admin, user.id, input.elementImages) : Promise.resolve([]),
    input.firstImage ? resolveGenerationRefUrls(c, admin, user.id, [input.firstImage]) : Promise.resolve([]),
    input.lastImage ? resolveGenerationRefUrls(c, admin, user.id, [input.lastImage]) : Promise.resolve([]),
    resolveMediaReferences(c, user.id, input.referenceVideos),
    resolveMediaReferences(c, user.id, input.referenceAudios)
  ]);
  const firstImage = firstImageRefs[0];
  const lastImage = lastImageRefs[0];
  const videoSubmitEnvelope = {
    idempotencyKey: `prompt-hub-video:${requestId}`,
    upstreamModel: model.upstreamModel,
    prompt: input.prompt,
    duration: input.duration,
    ratio: input.ratio,
    size: input.size,
    resolution: input.resolution,
    referenceImages,
    styleImages,
    elementImages,
    firstImage,
    lastImage,
    referenceVideos,
    referenceAudios,
    mediaBindings: videoMediaBindings(model)
  };
  const baseMeta: VideoMeta = {
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    product: input.product,
    projectId: input.projectId,
    nodeId: input.nodeId,
    mediaType: 'video',
    model: publicIdentity.model,
    modelLabel: publicIdentity.modelLabel,
    upstreamModel: model.upstreamModel,
    ...(route?.channelId ? { routeChannelId: route.channelId } : {}),
    credits: final,
    duration: input.duration,
    requestedDuration: input.duration,
    billingUnit: model.pricing.unit,
    ...(model.pricing.unit === 'second' ? { billingUnitCredits: final / input.duration } : {}),
    ratio: input.ratio,
    size: input.size,
    resolution: input.resolution,
    progress: 0,
    requestFingerprint,
    videoSubmitState: 'awaiting_debit',
    videoSubmitEnvelope
  };
  const insertedResult = await insertGenerationRequest<GenerationRequestRecord>(admin, user.id, requestId, {
      prompt: input.prompt,
      resolution: input.resolution,
      quality: 'standard',
      size_label: input.ratio,
      credits_charged: final,
      status: 'processing',
      meta: baseMeta
    }, input.clientRequestId);
  if (insertedResult.error || !insertedResult.row) {
    throw new ApiError(502, 'GENERATION_FAILED', '创建视频任务失败');
  }
  if (insertedResult.replayed) {
    return c.json({ ok: true, data: await videoPayload(c.env, insertedResult.row) });
  }
  const inserted = insertedResult.row;

  let split: DebitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debited = await deductUserCredits(admin, user.id, final, 'video_generation', inserted.id, {
      product: input.product,
      projectId: input.projectId,
      nodeId: input.nodeId,
      idempotencyKey: input.clientRequestId,
      model: model.id,
      duration: input.duration,
      resolution: input.resolution
    });
    profile = debited.profile;
    split = debited.split;
    const queuedMeta: VideoMeta = {
      ...baseMeta,
      debitSplit: split,
      videoSubmitState: 'queued',
      videoSubmitQueuedAt: new Date().toISOString(),
      videoSubmitEnvelope
    };
    await persistQueuedVideoMeta(admin, inserted.id, user.id, queuedMeta);
    try {
      await c.env.VIDEO_GENERATION_QUEUE.send({
        kind: 'video',
        jobId: inserted.id,
        userId: user.id
      });
    } catch (queueError) {
      // The row is the durable outbox. Cron will reclaim only the still-queued
      // job, so an ambiguous queue send cannot duplicate the paid POST.
      console.error('[video] queue send failed; durable outbox retained', inserted.id, queueError);
    }
    kickBackgroundVideoSubmit(
      c,
      processVideoPendingSubmit(
        admin,
        { ...inserted, status: 'processing', meta: queuedMeta } as VideoSubmissionJob,
        c.env
      )
    );
    return c.json({
      ok: true,
      data: await videoPayload(
        c.env,
        { ...inserted, status: 'processing', meta: queuedMeta },
        spendableCredits(profile)
      )
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频任务提交失败';
    if (error instanceof VideoQueueStateUncertainError) {
      console.error('[video] queue state uncertain; preserving debit for reconciliation', inserted.id);
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务状态正在确认，请稍后查看任务');
    }
    const debited = split.fromDaily > 0 || split.fromPermanent > 0;
    const definitiveDebitFailure = /insufficient|amount_invalid/i.test(message);
    if (!debited && !definitiveDebitFailure) {
      // The wallet RPC may have committed before its response was interrupted.
      // Keep awaiting_debit so cron can replay the same ledger ref safely and
      // recover the original debit split without issuing a generation POST.
      console.error('[video] debit outcome uncertain; awaiting idempotent recovery', inserted.id, error);
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务扣费状态正在确认，请稍后查看任务');
    }
    const failedMeta: VideoMeta = {
      ...baseMeta,
      debitSplit: split,
      videoSubmitState: debited ? 'refund_pending' : 'failed',
      refundState: debited ? 'pending' : 'not_required',
      refundPhase: 'queue_prepare_error'
    };
    const { data: failedJob } = await admin.from('generation_requests').update({
      status: 'failed',
      error_message: message.slice(0, 300),
      completed_at: new Date().toISOString(),
      meta: failedMeta
    })
      .eq('id', inserted.id)
      .eq('user_id', user.id)
      .eq('status', 'processing')
      .filter('meta->>videoSubmitState', 'eq', 'awaiting_debit')
      .select('*')
      .maybeSingle();
    if (debited && failedJob) {
      try {
        await settleVideoRefund(admin, failedJob as VideoSubmissionJob, 'queue_prepare_error');
      } catch (refundError) {
        console.error('[video] queue preparation refund pending', inserted.id, refundError);
      }
    }
    if (/insufficient/i.test(message)) throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    throw error;
  }
});

videoRoutes.get('/jobs/:jobId', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const { data: row, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', c.req.param('jobId'))
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !row) throw new ApiError(404, 'NOT_FOUND', '视频任务不存在');
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  if (meta.mediaType !== 'video') throw new ApiError(404, 'NOT_FOUND', '视频任务不存在');
  if (row.status !== 'processing') {
    const profile = await syncMembershipCredits(admin, user.id);
    return c.json({ ok: true, data: await videoPayload(c.env, row, spendableCredits(profile)) });
  }

  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!upstreamTaskId) {
    if (
      (meta.videoSubmitState === 'awaiting_debit' || meta.videoSubmitState === 'queued')
      && c.env.VIDEO_GENERATION_QUEUE
    ) {
      try {
        await c.env.VIDEO_GENERATION_QUEUE.send({ kind: 'video', jobId: row.id, userId: user.id });
      } catch (queueError) {
        console.warn('[video] queued status nudge failed', row.id, queueError);
      }
    }
    if (meta.videoSubmitState === 'queued') {
      kickBackgroundVideoSubmit(
        c,
        processVideoPendingSubmit(admin, row as VideoSubmissionJob, c.env)
      );
    }
    const profile = await syncMembershipCredits(admin, user.id);
    return c.json({ ok: true, data: await videoPayload(c.env, row, spendableCredits(profile)) });
  }
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务状态暂不可用');
  try {
    await pollVideoProviderJob(admin, row as VideoSubmissionJob, c.env);
  } catch (fetchError) {
    console.warn('[video] status lookup failed; preserving durable task state', row.id, fetchError);
  }
  const { data: refreshed, error: refreshError } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', row.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (refreshError) console.warn('[video] refreshed task read failed', row.id, refreshError);
  const profile = await syncMembershipCredits(admin, user.id);
  return c.json({
    ok: true,
    data: await videoPayload(c.env, refreshed || row, spendableCredits(profile))
  });
});

videoRoutes.get('/jobs/:jobId/content', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const { data: row } = await admin
    .from('generation_requests')
    .select('id,user_id,status,meta')
    .eq('id', c.req.param('jobId'))
    .eq('user_id', user.id)
    .maybeSingle();
  const meta = (row?.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  if (!row || row.status !== 'completed' || meta.mediaType !== 'video') throw new ApiError(404, 'NOT_FOUND', '视频尚未完成');
  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频内容暂不可用');
  const routeChannelId = Number(meta.routeChannelId) || 0;
  const route = routeChannelId ? { channelId: routeChannelId } : null;
  const upstream = await fetchNewApiVideoContent(newApiKeyForRoute(apiKey, route), c.env.NEWAPI_API_BASE_URL, upstreamTaskId, c.req.header('Range'));
  const contentType = upstream.headers.get('Content-Type') || '';
  if (!isPublicVideoContentResponse(upstream.ok, contentType)) {
    console.error('[video] content fetch failed', upstream.status, contentType.slice(0, 80));
    throw new ApiError(502, 'GENERATION_FAILED', '视频内容暂不可用');
  }
  const headers = new Headers();
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(upstream.body, { status: upstream.status, headers });
});
