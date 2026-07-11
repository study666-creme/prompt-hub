import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { roundCredits } from '../../lib/credit-math';
import { ApiError } from '../../lib/errors';
import { isAcceptedRefImageInput, resolveGenerationRefUrls } from '../../lib/generation-ref-images';
import { isStorageRef, storagePathFromRef } from '../../lib/image-archive';
import { buildPrivateMediaCdnUrl } from '../../lib/media-cdn';
import {
  fetchNewApiModelCatalog,
  newApiFixedCreditsForRequest,
  resolveNewApiCatalogModel,
  type NewApiCatalogModel,
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
const bodySchema = z.object({
  model: z.string().min(1).max(100),
  prompt: z.string().min(1).max(12000),
  duration: z.coerce.number().int().min(1).max(60).default(5),
  ratio: z.string().min(1).max(30).default('16:9'),
  resolution: z.string().min(1).max(30).default('720p'),
  referenceImages: z.array(z.string().refine(isAcceptedRefImageInput)).max(14).optional(),
  referenceVideos: z.array(mediaRef).max(3).optional(),
  referenceAudios: z.array(mediaRef).max(3).optional()
});

type VideoMeta = {
  mediaType?: unknown;
  model?: unknown;
  modelLabel?: unknown;
  upstreamModel?: unknown;
  upstreamTaskId?: unknown;
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

async function freshVideoModel(env: Env, modelId: string) {
  let snapshot;
  try {
    snapshot = await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL, { force: true, requireFresh: true });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认上游实时价格，请稍后重试');
  }
  const model = resolveNewApiCatalogModel(snapshot, modelId, 'video');
  if (!model) throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选视频模型已下架，请刷新后重选');
  return model;
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
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的视频提示词与参数');

  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频服务暂未配置');
  const model = await freshVideoModel(c.env, parsed.data.model);
  validateVideoRequest(model, parsed.data);
  const credits = newApiFixedCreditsForRequest(model, {
    duration: parsed.data.duration,
    resolution: parsed.data.resolution,
    ratio: parsed.data.ratio
  });
  if (credits == null || credits <= 0) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const final = roundCredits(credits);
  if (spendableCredits(profile) < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${spendableCredits(profile)}）`);
  }
  const referenceImages = parsed.data.referenceImages?.length
    ? await resolveGenerationRefUrls(c, admin, user.id, parsed.data.referenceImages)
    : [];
  const [referenceVideos, referenceAudios] = await Promise.all([
    resolveMediaReferences(c, user.id, parsed.data.referenceVideos),
    resolveMediaReferences(c, user.id, parsed.data.referenceAudios)
  ]);
  const baseMeta: VideoMeta = {
    mediaType: 'video',
    model: model.id,
    modelLabel: model.label,
    upstreamModel: model.upstreamModel,
    credits: final,
    duration: parsed.data.duration,
    ratio: parsed.data.ratio,
    resolution: parsed.data.resolution,
    progress: 0
  };
  const { data: inserted, error: insertError } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: parsed.data.prompt,
      resolution: parsed.data.resolution,
      quality: 'standard',
      size_label: parsed.data.ratio,
      credits_charged: final,
      status: 'processing',
      meta: baseMeta
    })
    .select('*')
    .single();
  if (insertError || !inserted) throw new ApiError(502, 'GENERATION_FAILED', '创建视频任务失败');

  let split: DebitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debited = await deductUserCredits(admin, user.id, final, 'video_generation', inserted.id, {
      model: model.id,
      duration: parsed.data.duration,
      resolution: parsed.data.resolution
    });
    profile = debited.profile;
    split = debited.split;
    await admin.from('generation_requests').update({ meta: { ...baseMeta, debitSplit: split } }).eq('id', inserted.id);

    const task = await submitNewApiVideo(apiKey, c.env.NEWAPI_API_BASE_URL, {
      upstreamModel: model.upstreamModel,
      prompt: parsed.data.prompt,
      duration: parsed.data.duration,
      ratio: parsed.data.ratio,
      resolution: parsed.data.resolution,
      referenceImages,
      referenceVideos,
      referenceAudios
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

  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频任务尚未完成提交');
  const task = await fetchNewApiVideoTask(apiKey, c.env.NEWAPI_API_BASE_URL, upstreamTaskId);
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
  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  const upstreamTaskId = String(meta.upstreamTaskId || '');
  if (!apiKey || !upstreamTaskId) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '视频内容暂不可用');
  const upstream = await fetchNewApiVideoContent(apiKey, c.env.NEWAPI_API_BASE_URL, upstreamTaskId, c.req.header('Range'));
  const headers = new Headers();
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(upstream.body, { status: upstream.status, headers });
});
