import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../env';
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
import {
  fetchNewApiVideoContent,
  fetchNewApiVideoTask,
  submitNewApiVideo,
  type NewApiVideoTask
} from '../../lib/newapi-video';
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
const bodySchema = z.object({
  model: z.string().min(1).max(100),
  prompt: z.string().min(1).max(12000),
  duration: z.coerce.number().int().min(1).max(60).optional(),
  seconds: z.coerce.number().int().min(1).max(60).optional(),
  ratio: z.string().min(1).max(30).optional(),
  aspect_ratio: z.string().min(1).max(30).optional(),
  resolution: z.string().min(1).max(30).default('720p'),
  referenceImages: z.array(imageRef).max(14).optional(),
  image: imageRef.optional(),
  images: z.array(imageRef).max(14).optional(),
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
  model: input.model,
  prompt: input.prompt,
  duration: input.duration ?? input.seconds ?? 5,
  ratio: input.ratio || input.aspect_ratio || '16:9',
  resolution: input.resolution,
  referenceImages: input.referenceImages?.length
    ? input.referenceImages
    : input.image
      ? [input.image]
      : input.images?.length
        ? input.images
        : undefined,
  referenceVideos: input.referenceVideos,
  referenceAudios: input.referenceAudios
}));

export function parseVideoRequestBody(raw: unknown): z.infer<typeof bodySchema> {
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
  upstreamTerminalStatus?: unknown;
  [key: string]: unknown;
};

type VideoJobRow = Record<string, unknown>;

type VideoReconcileDependencies = {
  fetchTask?: typeof fetchNewApiVideoTask;
  refundCredits?: typeof refundUserCredits;
};

const UNKNOWN_VIDEO_ERROR = '上游无法确认视频生成结果，任务已终止';

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
  return model.parameters.find(item => names.includes(item.name)) || null;
}

function validateVideoRequest(model: NewApiCatalogModel, input: z.infer<typeof bodySchema>): void {
  const duration = parameter(model, ['duration']);
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
  validateReferenceCount(model, ['referenceImages', 'images', 'image'], input.referenceImages?.length || 0, '参考图片');
  validateReferenceCount(model, ['referenceVideos'], input.referenceVideos?.length || 0, '参考视频');
  validateReferenceCount(model, ['referenceAudios'], input.referenceAudios?.length || 0, '参考音频');
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
  const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, modelId, 'video');
  if (!resolved) throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选视频模型或线路已不可用，请刷新后重选');
  return resolved;
}

function parseDebitSplit(value: unknown, fallbackAmount = 0): DebitSplit {
  const split = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const parsed = {
    fromDaily: Math.max(0, Number(split.fromDaily) || 0),
    fromPermanent: Math.max(0, Number(split.fromPermanent) || 0)
  };
  return parsed.fromDaily > 0 || parsed.fromPermanent > 0
    ? parsed
    : { fromDaily: 0, fromPermanent: Math.max(0, fallbackAmount) };
}

function taskFailureMessage(task: NewApiVideoTask): string {
  if (task.status === 'unknown') return UNKNOWN_VIDEO_ERROR;
  return task.errorMessage || '视频生成失败';
}

async function readCurrentVideoJob(admin: SupabaseClient, jobId: unknown): Promise<VideoJobRow | null> {
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as VideoJobRow | null) || null;
}

/**
 * Reconciles one submitted video task by polling its existing upstream ID.
 * This path never submits a new video request.
 */
export async function reconcileNewApiVideoJob(
  admin: SupabaseClient,
  env: Env,
  row: VideoJobRow,
  dependencies: VideoReconcileDependencies = {}
): Promise<VideoJobRow> {
  if (String(row.status || '') !== 'processing') return row;
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  if (meta.mediaType !== 'video') return row;

  const apiKey = env.NEWAPI_API_KEY?.trim();
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务尚未完成提交');
  }
  const routeChannelId = Number(meta.routeChannelId) || 0;
  const route = routeChannelId ? { channelId: routeChannelId } : null;
  const fetchTask = dependencies.fetchTask || fetchNewApiVideoTask;
  const task = await fetchTask(
    newApiKeyForRoute(apiKey, route),
    env.NEWAPI_API_BASE_URL,
    upstreamTaskId
  );

  if (task.status === 'completed') {
    const nextMeta = {
      ...meta,
      progress: 100,
      resultUrl: task.videoUrl,
      upstreamTerminalStatus: task.status
    };
    const { data: updated, error } = await admin.from('generation_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      meta: nextMeta
    }).eq('id', row.id).eq('status', 'processing').select('*').maybeSingle();
    if (error) throw error;
    return (updated as VideoJobRow | null) || await readCurrentVideoJob(admin, row.id) || row;
  }

  if (task.status === 'failed' || task.status === 'unknown') {
    const message = taskFailureMessage(task);
    const nextMeta: VideoMeta = {
      ...meta,
      progress: task.progress ?? (Number(meta.progress) || 0),
      refundState: 'claiming',
      upstreamTerminalStatus: task.status
    };
    const { data: claimed, error } = await admin.from('generation_requests').update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
      meta: nextMeta
    }).eq('id', row.id).eq('status', 'processing').select('*').maybeSingle();
    if (error) throw error;

    // The status compare-and-set makes exactly one GET/cron invocation own the refund.
    if (claimed) {
      const amount = Number(meta.credits) || Number(row.credits_charged) || 0;
      const refundCredits = dependencies.refundCredits || refundUserCredits;
      try {
        await refundCredits(
          admin,
          String(row.user_id || ''),
          amount,
          'video_generation_refund',
          String(row.id || ''),
          parseDebitSplit(meta.debitSplit, amount),
          { model: meta.model, phase: task.status === 'unknown' ? 'upstream_unknown' : 'upstream_failed' }
        );
      } catch (refundError) {
        console.error('[video] refund failed', String(row.id || ''), refundError);
        nextMeta.refundState = 'refund_failed';
        const refundFailureMessage = `${message}，自动退还积分失败`;
        const { data: refundFailed, error: refundStateError } = await admin
          .from('generation_requests')
          .update({ error_message: refundFailureMessage, meta: nextMeta })
          .eq('id', row.id)
          .eq('status', 'failed')
          .select('*')
          .maybeSingle();
        if (refundStateError) throw refundStateError;
        return (refundFailed as VideoJobRow | null) || {
          ...(claimed as VideoJobRow),
          error_message: refundFailureMessage,
          meta: nextMeta
        };
      }
      nextMeta.refundState = 'refunded';
      const { data: refunded, error: refundMetaError } = await admin
        .from('generation_requests')
        .update({ error_message: `${message}，积分已退还`, meta: nextMeta })
        .eq('id', row.id)
        .eq('status', 'failed')
        .select('*')
        .maybeSingle();
      if (refundMetaError) throw refundMetaError;
      return (refunded as VideoJobRow | null) || await readCurrentVideoJob(admin, row.id) || (claimed as VideoJobRow);
    }
    return await readCurrentVideoJob(admin, row.id) || row;
  }

  const nextMeta = {
    ...meta,
    progress: task.progress ?? (Number(meta.progress) || 0)
  };
  const { data: updated, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', row.id)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (updated as VideoJobRow | null) || { ...row, meta: nextMeta };
}

export async function drainNewApiVideoJobs(
  env: Env,
  options?: VideoReconcileDependencies & { admin?: SupabaseClient; maxJobs?: number }
): Promise<{ checked: number; settled: number }> {
  if (!env.NEWAPI_API_KEY?.trim()) return { checked: 0, settled: 0 };
  const admin = options?.admin || createAdminClient(env);
  const maxJobs = Math.max(1, Math.min(20, options?.maxJobs ?? 8));
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'processing')
    .contains('meta', { mediaType: 'video' })
    .order('created_at', { ascending: true })
    .limit(maxJobs);
  if (error) {
    console.error('[video-drain] list failed', error.message);
    return { checked: 0, settled: 0 };
  }

  const jobs = (rows || []) as VideoJobRow[];
  const results = await Promise.allSettled(jobs.map(row => reconcileNewApiVideoJob(admin, env, row, options)));
  let settled = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (String(result.value.status || '') !== 'processing') settled += 1;
      return;
    }
    console.error('[video-drain] reconcile failed', String(jobs[index]?.id || ''), result.reason);
  });
  return { checked: jobs.length, settled };
}

function videoPayload(row: Record<string, unknown>, creditsRemaining?: number) {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as VideoMeta;
  return {
    jobId: String(row.id || ''),
    status: String(row.status || 'processing'),
    model: String(meta.model || ''),
    modelLabel: String(meta.modelLabel || ''),
    progress: Number(meta.progress) || 0,
    videoUrl: row.status === 'completed' ? `/api/v1/video/jobs/${encodeURIComponent(String(row.id || ''))}/content` : null,
    errorMessage: row.status === 'failed' ? String(row.error_message || '视频生成失败') : null,
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

videoRoutes.post('/', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const input = parseVideoRequestBody(await c.req.json().catch(() => ({})));

  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频服务暂未配置');
  const resolved = await freshVideoModel(c.env, input.model);
  const { model, route } = resolved;
  validateVideoRequest(model, input);
  const credits = newApiFixedCreditsForRequest(model, {
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio
  });
  if (credits == null || credits <= 0) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const final = roundCredits(credits);
  if (spendableCredits(profile) < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${spendableCredits(profile)}）`);
  }
  const referenceImages = input.referenceImages?.length
    ? await resolveGenerationRefUrls(c, admin, user.id, input.referenceImages)
    : [];
  const [referenceVideos, referenceAudios] = await Promise.all([
    resolveMediaReferences(c, user.id, input.referenceVideos),
    resolveMediaReferences(c, user.id, input.referenceAudios)
  ]);
  const baseMeta: VideoMeta = {
    mediaType: 'video',
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
  if (insertError || !inserted) throw new ApiError(502, 'GENERATION_FAILED', '创建视频任务失败');

  let split: DebitSplit = { fromDaily: 0, fromPermanent: 0 };
  let submittedMeta: VideoMeta = baseMeta;
  try {
    const debited = await deductUserCredits(admin, user.id, final, 'video_generation', inserted.id, {
      model: model.id,
      duration: input.duration,
      resolution: input.resolution
    });
    profile = debited.profile;
    split = debited.split;
    submittedMeta = { ...baseMeta, debitSplit: split };
    await admin.from('generation_requests').update({ meta: submittedMeta }).eq('id', inserted.id);

    const task = await submitNewApiVideo(newApiKeyForRoute(apiKey, route), c.env.NEWAPI_API_BASE_URL, {
      upstreamModel: model.upstreamModel,
      prompt: input.prompt,
      duration: input.duration,
      ratio: input.ratio,
      resolution: input.resolution,
      referenceImages,
      referenceVideos,
      referenceAudios
    });
    submittedMeta = {
      ...submittedMeta,
      upstreamTaskId: task.id,
      progress: task.progress || 0,
      resultUrl: task.videoUrl,
      ...(task.status === 'failed' || task.status === 'unknown'
        ? { upstreamTerminalStatus: task.status }
        : {})
    };
    if (task.status === 'failed' || task.status === 'unknown') {
      throw new ApiError(502, 'UPSTREAM_ERROR', taskFailureMessage(task));
    }
    const status = task.status === 'completed' ? 'completed' : 'processing';
    const meta: VideoMeta = {
      ...submittedMeta,
      ...(status === 'completed' ? { upstreamTerminalStatus: task.status } : {})
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
    let storedMessage = message;
    let refundState = 'not_needed';
    if (split.fromDaily > 0 || split.fromPermanent > 0) {
      refundState = 'claiming';
      try {
        await refundUserCredits(admin, user.id, final, 'video_generation_refund', inserted.id, split, { model: model.id, phase: 'submit_error' });
        refundState = 'refunded';
        storedMessage = `${message}，积分已退还`;
      } catch (refundError) {
        console.error('[video] submit refund failed', String(inserted.id || ''), refundError);
        refundState = 'refund_failed';
        storedMessage = `${message}，自动退还积分失败`;
      }
    }
    await admin.from('generation_requests').update({
      status: 'failed',
      error_message: storedMessage.slice(0, 300),
      completed_at: new Date().toISOString(),
      meta: { ...submittedMeta, debitSplit: split, refundState }
    }).eq('id', inserted.id);
    if (message.includes('insufficient')) throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
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
    return c.json({ ok: true, data: videoPayload(row, spendableCredits(profile)) });
  }

  const reconciled = await reconcileNewApiVideoJob(admin, c.env, row as VideoJobRow);
  const profile = await syncMembershipCredits(admin, user.id);
  return c.json({ ok: true, data: videoPayload(reconciled, spendableCredits(profile)) });
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
  const headers = new Headers();
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(upstream.body, { status: upstream.status, headers });
});
