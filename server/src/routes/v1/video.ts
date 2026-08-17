import { Hono } from 'hono';
import { z } from 'zod';
import { newApiVideoKey, type Env } from '../../env';
import { roundCredits } from '../../lib/credit-math';
import { ApiError } from '../../lib/errors';
import { isAcceptedRefImageInput, resolveGenerationRefUrls } from '../../lib/generation-ref-images';
import { isStorageRef, storagePathFromRef } from '../../lib/image-archive';
import { buildPrivateMediaCdnUrl } from '../../lib/media-cdn';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  newApiKeyForRoute,
  newApiFixedCreditsForRequest,
  resolveNewApiRoutedCatalogModel,
  type NewApiCatalogModel,
  type NewApiResolvedCatalogModel,
  type NewApiCatalogParameter
} from '../../lib/newapi';
import { fetchNewApiVideoContent, fetchNewApiVideoTask, submitNewApiVideo } from '../../lib/newapi-video';
import {
  deductUserCredits,
  refundUserCredits,
  spendableCredits,
  syncMembershipCredits,
  type DebitSplit
} from '../../lib/membership-credits';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const mediaRef = z.string().refine(value => /^https?:\/\//i.test(value) || isStorageRef(value), '仅支持媒体 URL');
const imageRef = z.string().refine(isAcceptedRefImageInput);
const clientRequestId = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const bodySchema = z.object({
  model: z.string().min(1).max(100),
  prompt: z.string().min(1).max(12000),
  clientRequestId: clientRequestId.optional(),
  duration: z.coerce.number().int().min(1).max(60).optional(),
  seconds: z.coerce.number().int().min(1).max(60).optional(),
  ratio: z.string().min(1).max(30).optional(),
  aspect_ratio: z.string().min(1).max(30).optional(),
  resolution: z.string().min(1).max(30).optional(),
  size: z.string().min(1).max(30).optional(),
  referenceImages: z.array(imageRef).max(30).optional(),
  image: imageRef.optional(),
  images: z.array(imageRef).max(30).optional(),
  reference_images: z.array(imageRef).max(30).optional(),
  input_reference: imageRef.optional(),
  styleImages: z.array(imageRef).max(14).optional(),
  style_references: z.array(imageRef).max(14).optional(),
  elementImages: z.array(imageRef).max(14).optional(),
  element_references: z.array(imageRef).max(14).optional(),
  start_frame: imageRef.optional(),
  first_image: imageRef.optional(),
  end_frame: imageRef.optional(),
  last_image: imageRef.optional(),
  referenceVideos: z.array(mediaRef).max(10).optional(),
  reference_videos: z.array(mediaRef).max(10).optional(),
  video_references: z.array(mediaRef).max(10).optional(),
  videos: z.array(mediaRef).max(10).optional(),
  reference_video: mediaRef.optional(),
  input_video: mediaRef.optional(),
  referenceAudios: z.array(mediaRef).max(10).optional(),
  reference_audios: z.array(mediaRef).max(10).optional(),
  audio_reference: z.array(mediaRef).max(10).optional(),
  audios: z.array(mediaRef).max(10).optional(),
  reference_audio: mediaRef.optional()
}).passthrough().superRefine((input, ctx) => {
  if (input.resolution && input.size && input.resolution !== input.size) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'resolution 与 size 不能冲突' });
  }
}).superRefine((input, ctx) => {
  if (input.duration != null && input.seconds != null && input.duration !== input.seconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration 与 seconds 不能冲突' });
  }
  if (input.ratio && input.aspect_ratio && input.ratio !== input.aspect_ratio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ratio 与 aspect_ratio 不能冲突' });
  }
  const populated = (values: unknown[]) => values.filter(value => Array.isArray(value) ? value.length > 0 : value != null && value !== '').length;
  if (populated([input.referenceImages, input.image, input.images, input.reference_images, input.input_reference]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '参考图字段不能重复' });
  }
  if (populated([input.styleImages, input.style_references]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '风格参考图字段不能重复' });
  }
  if (populated([input.elementImages, input.element_references]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '元素参考图字段不能重复' });
  }
  if (populated([input.start_frame, input.first_image]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '首帧图片字段不能重复' });
  }
  if (populated([input.end_frame, input.last_image]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '尾帧图片字段不能重复' });
  }
  if (populated([input.referenceVideos, input.reference_videos, input.video_references, input.videos, input.reference_video, input.input_video]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '参考视频字段不能重复' });
  }
  if (populated([input.referenceAudios, input.reference_audios, input.audio_reference, input.audios, input.reference_audio]) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '参考音频字段不能重复' });
  }
}).transform(input => ({
  model: input.model,
  prompt: input.prompt,
  clientRequestId: input.clientRequestId,
  duration: input.duration ?? input.seconds ?? 5,
  ratio: input.ratio || input.aspect_ratio || '16:9',
  resolution: input.size || input.resolution || '720p',
  referenceImages: input.referenceImages?.length
    ? input.referenceImages
    : input.image
      ? [input.image]
      : input.images?.length
        ? input.images
        : input.reference_images?.length
          ? input.reference_images
          : input.input_reference
            ? [input.input_reference]
            : undefined,
  styleImages: input.styleImages?.length ? input.styleImages : input.style_references,
  elementImages: input.elementImages?.length ? input.elementImages : input.element_references,
  startFrame: input.start_frame || input.first_image,
  endFrame: input.end_frame || input.last_image,
  referenceVideos: input.referenceVideos?.length
    ? input.referenceVideos
    : input.reference_videos?.length
      ? input.reference_videos
      : input.video_references?.length
        ? input.video_references
        : input.videos?.length
          ? input.videos
          : input.reference_video
            ? [input.reference_video]
            : input.input_video
              ? [input.input_video]
              : undefined,
  referenceAudios: input.referenceAudios?.length
    ? input.referenceAudios
    : input.reference_audios?.length
      ? input.reference_audios
      : input.audio_reference?.length
        ? input.audio_reference
        : input.audios?.length
          ? input.audios
          : input.reference_audio
            ? [input.reference_audio]
            : undefined,
  catalogValues: { ...input }
}));

export function parseVideoRequestBody(raw: unknown): z.infer<typeof bodySchema> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的视频提示词与参数');
  return parsed.data;
}

type VideoMeta = {
  mediaType?: unknown;
  clientRequestId?: unknown;
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
  for (const name of names) {
    const declared = model.parameters.find(item => item.name === name);
    if (declared) return declared;
  }
  return null;
}

function validateParameterChoice(parameter: NewApiCatalogParameter | null, value: string | number, label: string): void {
  const values = parameter?.options?.length
    ? parameter.options
    : parameter && Object.prototype.hasOwnProperty.call(parameter, 'fixed')
      ? [parameter.fixed]
      : [];
  if (values.length && !values.some(candidate => String(candidate).toLowerCase() === String(value).toLowerCase())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${value} ${label}`);
  }
}

export function validateVideoRequest(model: NewApiCatalogModel, input: z.infer<typeof bodySchema>): void {
  const duration = parameter(model, ['seconds', 'duration']);
  if (duration?.min != null && input.duration < duration.min) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型最短支持 ${duration.min} 秒`);
  }
  if (duration?.max != null && input.duration > duration.max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型最长支持 ${duration.max} 秒`);
  }
  validateParameterChoice(duration, input.duration, '秒时长');
  const ratios = [...parameterValues(model, 'ratio'), ...parameterValues(model, 'aspect_ratio')];
  if (ratios.length && !ratios.some(ratio => ratio.toLowerCase() === input.ratio.toLowerCase())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${input.ratio} 比例`);
  }
  validateParameterChoice(parameter(model, ['size', 'resolution']), input.resolution, '分辨率');
  validateReferenceCount(model, ['images', 'referenceImages', 'reference_images', 'image', 'input_reference'], input.referenceImages?.length || 0, '参考图片');
  validateReferenceCount(model, ['style_references', 'styleImages'], input.styleImages?.length || 0, '风格参考图片');
  validateReferenceCount(model, ['element_references', 'elementImages'], input.elementImages?.length || 0, '元素参考图片');
  validateReferenceCount(model, ['start_frame', 'first_image'], input.startFrame ? 1 : 0, '首帧图片');
  validateReferenceCount(model, ['end_frame', 'last_image'], input.endFrame ? 1 : 0, '尾帧图片');
  validateReferenceCount(model, ['reference_videos', 'referenceVideos', 'video_references', 'videos', 'reference_video', 'input_video'], input.referenceVideos?.length || 0, '参考视频');
  validateReferenceCount(model, ['reference_audios', 'referenceAudios', 'audio_reference', 'audios', 'reference_audio'], input.referenceAudios?.length || 0, '参考音频');
}

function validateReferenceCount(model: NewApiCatalogModel, names: string[], count: number, label: string): void {
  const declared = parameter(model, names);
  const required = declared?.required === true || Number(declared?.min_items || 0) > 0;
  const min = declared?.type === 'array' ? Number(declared.min_items || (required ? 1 : 0)) : required ? 1 : 0;
  const max = declared?.type === 'array' ? Number(declared.max_items ?? Number.POSITIVE_INFINITY) : declared ? 1 : 0;
  if (count < min) throw new ApiError(400, 'VALIDATION_ERROR', `该模型至少需要 ${min} 个${label}`);
  if (count > max) throw new ApiError(400, 'VALIDATION_ERROR', `该模型最多支持 ${max} 个${label}`);
}

async function freshVideoModel(env: Env, modelId: string): Promise<NewApiResolvedCatalogModel> {
  let snapshot;
  try {
    snapshot = await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL, { force: true, requireFresh: true });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认实时价格，请稍后重试');
  }
  const routes = await fetchNewApiAdminRoutes(env.NEWAPI_API_BASE_URL, env.NEWAPI_CATALOG_ADMIN_SECRET);
  if (!routes.available) {
    throw new ApiError(503, 'ROUTING_UNAVAILABLE', '暂时无法确认视频模型可用渠道，请稍后重试');
  }
  const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, modelId, 'video');
  if (!resolved) throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选视频模型或线路已不可用，请刷新后重选');
  return resolved;
}

function parseDebitSplit(value: unknown): DebitSplit {
  const split = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    fromDaily: Math.max(0, Number(split.fromDaily) || 0),
    fromPermanent: Math.max(0, Number(split.fromPermanent) || 0)
  };
}

function videoPayload(row: Record<string, unknown>, creditsRemaining?: number) {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  const refunded = row.status === 'failed' && meta.refundState === 'refunded';
  const rawError = String(row.error_message || '视频生成失败');
  return {
    jobId: String(row.id || ''),
    status: String(row.status || 'processing'),
    model: String(meta.model || ''),
    modelLabel: String(meta.modelLabel || ''),
    progress: Number(meta.progress) || 0,
    videoUrl: row.status === 'completed' ? `/api/v1/video/jobs/${encodeURIComponent(String(row.id || ''))}/content` : null,
    errorMessage: row.status === 'failed'
      ? (refunded && !/已自动退回|已退款/.test(rawError) ? `${rawError}，积分已自动退回` : rawError)
      : null,
    refunded: row.status === 'failed' ? refunded : undefined,
    creditsCharged: Number(meta.credits) || Number(row.credits_charged) || 0,
    ...(creditsRemaining == null ? {} : { creditsRemaining })
  };
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

async function findVideoRequestByClientId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  value: string,
) {
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('user_id', userId)
    .filter('meta->>mediaType', 'eq', 'video')
    .filter('meta->>clientRequestId', 'eq', value)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function decodedClientRequestId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function replaceResolvedAliases(
  values: Record<string, unknown>,
  aliases: readonly string[],
  resolved: string[]
) {
  const next = { ...values };
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(next, alias)) continue;
    next[alias] = Array.isArray(next[alias]) ? resolved : resolved[0];
  }
  return next;
}

videoRoutes.post('/', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const input = parseVideoRequestBody(await c.req.json().catch(() => ({})));

  const apiKey = newApiVideoKey(c.env);
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频服务暂未配置');
  const admin = createAdminClient(c.env);
  if (input.clientRequestId) {
    const existing = await findVideoRequestByClientId(admin, user.id, input.clientRequestId);
    if (existing) {
      const profile = await syncMembershipCredits(admin, user.id);
      return c.json({ ok: true, data: videoPayload(existing, spendableCredits(profile)) });
    }
  }
  const resolved = await freshVideoModel(c.env, input.model);
  const { model, route } = resolved;
  validateVideoRequest(model, input);
  const credits = newApiFixedCreditsForRequest(model, {
    duration: input.duration,
    seconds: input.duration,
    resolution: input.resolution,
    size: input.resolution,
    ratio: input.ratio,
    aspect_ratio: input.ratio
  });
  if (credits == null || credits <= 0) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');

  let profile = await syncMembershipCredits(admin, user.id);
  const final = roundCredits(credits);
  if (spendableCredits(profile) < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${spendableCredits(profile)}）`);
  }
  const [referenceImages, styleImages, elementImages, startFrame, endFrame, referenceVideos, referenceAudios] = await Promise.all([
    input.referenceImages?.length
      ? resolveGenerationRefUrls(c, admin, user.id, input.referenceImages)
      : Promise.resolve([]),
    input.styleImages?.length
      ? resolveGenerationRefUrls(c, admin, user.id, input.styleImages)
      : Promise.resolve([]),
    input.elementImages?.length
      ? resolveGenerationRefUrls(c, admin, user.id, input.elementImages)
      : Promise.resolve([]),
    input.startFrame
      ? resolveGenerationRefUrls(c, admin, user.id, [input.startFrame])
      : Promise.resolve([]),
    input.endFrame
      ? resolveGenerationRefUrls(c, admin, user.id, [input.endFrame])
      : Promise.resolve([]),
    resolveMediaReferences(c, user.id, input.referenceVideos),
    resolveMediaReferences(c, user.id, input.referenceAudios)
  ]);
  let catalogValues = replaceResolvedAliases(
    input.catalogValues,
    ['referenceImages', 'image', 'images', 'reference_images', 'input_reference'],
    referenceImages
  );
  catalogValues = replaceResolvedAliases(catalogValues, ['styleImages', 'style_references'], styleImages);
  catalogValues = replaceResolvedAliases(catalogValues, ['elementImages', 'element_references'], elementImages);
  catalogValues = replaceResolvedAliases(catalogValues, ['start_frame', 'first_image'], startFrame);
  catalogValues = replaceResolvedAliases(catalogValues, ['end_frame', 'last_image'], endFrame);
  catalogValues = replaceResolvedAliases(
    catalogValues,
    ['referenceVideos', 'reference_videos', 'video_references', 'videos', 'reference_video', 'input_video'],
    referenceVideos
  );
  catalogValues = replaceResolvedAliases(
    catalogValues,
    ['referenceAudios', 'reference_audios', 'audio_reference', 'audios', 'reference_audio'],
    referenceAudios
  );
  const baseMeta: VideoMeta = {
    mediaType: 'video',
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    model: resolved.requestedModelId,
    modelLabel: model.label,
    upstreamModel: model.upstreamModel,
    ...(route?.channelId ? { routeChannelId: route.channelId } : {}),
    credits: final,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    progress: 0
  };
  const { data: inserted, error: insertError } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: input.prompt,
      resolution: input.resolution,
      quality: 'standard',
      size_label: input.ratio,
      credits_charged: final,
      status: 'processing',
      meta: baseMeta
    })
    .select('*')
    .single();
  if (insertError || !inserted) {
    // A concurrent retry may have won the same client request identity. Return
    // that durable row instead of charging or submitting a second task.
    if (input.clientRequestId) {
      const existing = await findVideoRequestByClientId(admin, user.id, input.clientRequestId);
      if (existing) {
        const current = await syncMembershipCredits(admin, user.id);
        return c.json({ ok: true, data: videoPayload(existing, spendableCredits(current)) });
      }
    }
    throw new ApiError(502, 'GENERATION_FAILED', '创建视频任务失败');
  }

  let split: DebitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debited = await deductUserCredits(admin, user.id, final, 'video_generation', inserted.id, {
      model: model.id,
      duration: input.duration,
      resolution: input.resolution
    });
    profile = debited.profile;
    split = debited.split;
    await admin.from('generation_requests').update({ meta: { ...baseMeta, debitSplit: split } }).eq('id', inserted.id);

    const task = await submitNewApiVideo(newApiKeyForRoute(apiKey, route), c.env.NEWAPI_API_BASE_URL, {
      upstreamModel: model.upstreamModel,
      ...(input.clientRequestId ? { idempotencyKey: input.clientRequestId } : {}),
      prompt: input.prompt,
      duration: input.duration,
      ratio: input.ratio,
      resolution: input.resolution,
      referenceImages,
      styleImages,
      elementImages,
      startFrame: startFrame[0],
      endFrame: endFrame[0],
      referenceVideos,
      referenceAudios,
      catalogValues,
      catalogParameters: model.parameters
    });
    if (task.status === 'failed') {
      throw new ApiError(502, 'UPSTREAM_ERROR', task.errorMessage || '视频生成失败');
    }
    const status = task.status === 'completed' ? 'completed' : 'processing';
    const meta: VideoMeta = {
      ...baseMeta,
      debitSplit: split,
      upstreamTaskId: task.id,
      progress: task.progress || 0,
      resultUrl: task.videoUrl
    };
    await admin.from('generation_requests').update({
      status,
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      meta
    }).eq('id', inserted.id);
    const updated = await syncMembershipCredits(admin, user.id);
    return c.json({ ok: true, data: videoPayload({ ...inserted, status, meta }, spendableCredits(updated)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频任务提交失败';
    if (split.fromDaily > 0 || split.fromPermanent > 0) {
      await refundUserCredits(admin, user.id, final, 'video_generation_refund', inserted.id, split, { model: model.id, phase: 'submit_error' });
    }
    await admin.from('generation_requests').update({
      status: 'failed',
      error_message: message.slice(0, 300),
      completed_at: new Date().toISOString(),
      meta: { ...baseMeta, debitSplit: split, refundState: 'refunded' }
    }).eq('id', inserted.id);
    if (message.includes('insufficient')) throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    throw error;
  }
});

videoRoutes.get('/requests/:clientRequestId', async c => {
  const user = c.get('user');
  const value = clientRequestId.safeParse(decodedClientRequestId(c.req.param('clientRequestId')));
  if (!value.success) throw new ApiError(400, 'VALIDATION_ERROR', '请求标识格式不正确');
  const admin = createAdminClient(c.env);
  const row = await findVideoRequestByClientId(admin, user.id, value.data);
  if (!row) throw new ApiError(404, 'NOT_FOUND', '视频请求不存在');
  const profile = await syncMembershipCredits(admin, user.id);
  return c.json({ ok: true, data: videoPayload(row, spendableCredits(profile)) });
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
    return c.json({ ok: true, data: videoPayload(row, spendableCredits(profile)) });
  }

  const apiKey = newApiVideoKey(c.env);
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务尚未完成提交');
  const routeChannelId = Number(meta.routeChannelId) || 0;
  const route = routeChannelId ? { channelId: routeChannelId } : null;
  const task = await fetchNewApiVideoTask(newApiKeyForRoute(apiKey, route), c.env.NEWAPI_API_BASE_URL, upstreamTaskId);
  if (task.status === 'completed') {
    const nextMeta = { ...meta, progress: 100, resultUrl: task.videoUrl };
    const { data: updated } = await admin.from('generation_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      meta: nextMeta
    }).eq('id', row.id).eq('status', 'processing').select('*').maybeSingle();
    const profile = await syncMembershipCredits(admin, user.id);
    return c.json({ ok: true, data: videoPayload(updated || { ...row, status: 'completed', meta: nextMeta }, spendableCredits(profile)) });
  }
  if (task.status === 'failed') {
    const nextMeta = { ...meta, progress: task.progress || 0, refundState: 'claiming' };
    const { data: claimed } = await admin.from('generation_requests').update({
      status: 'failed',
      error_message: task.errorMessage || '视频生成失败',
      completed_at: new Date().toISOString(),
      meta: nextMeta
    }).eq('id', row.id).eq('status', 'processing').select('*').maybeSingle();
    if (claimed) {
      await refundUserCredits(
        admin,
        user.id,
        Number(meta.credits) || Number(row.credits_charged) || 0,
        'video_generation_refund',
        row.id,
        parseDebitSplit(meta.debitSplit),
        { model: meta.model, phase: 'upstream_failed' }
      );
      nextMeta.refundState = 'refunded';
      await admin.from('generation_requests').update({ meta: nextMeta }).eq('id', row.id);
    }
    const profile = await syncMembershipCredits(admin, user.id);
    return c.json({ ok: true, data: videoPayload(claimed || { ...row, status: 'failed', error_message: task.errorMessage, meta: nextMeta }, spendableCredits(profile)) });
  }
  const nextMeta = { ...meta, progress: task.progress || Number(meta.progress) || 0 };
  await admin.from('generation_requests').update({ meta: nextMeta }).eq('id', row.id).eq('status', 'processing');
  const profile = await syncMembershipCredits(admin, user.id);
  return c.json({ ok: true, data: videoPayload({ ...row, meta: nextMeta }, spendableCredits(profile)) });
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
  const apiKey = newApiVideoKey(c.env);
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频内容暂不可用');
  const routeChannelId = Number(meta.routeChannelId) || 0;
  const route = routeChannelId ? { channelId: routeChannelId } : null;
  const upstream = await fetchNewApiVideoContent(newApiKeyForRoute(apiKey, route), c.env.NEWAPI_API_BASE_URL, upstreamTaskId, c.req.header('Range'));
  const headers = new Headers();
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(upstream.body, { status: upstream.status, headers });
});
