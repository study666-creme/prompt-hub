import { Hono } from 'hono';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';
import { fetchNewApiModelCatalog } from '../../lib/newapi';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminCanvasRoutes = new Hono<{ Bindings: Env }>();

adminCanvasRoutes.use('*', requireAdminSecret);
adminCanvasRoutes.use('*', rateLimit(120, 60_000));

type GenRow = {
  id: string;
  user_id: string;
  prompt: string;
  resolution: string | null;
  quality: string | null;
  size_label: string | null;
  credits_charged: number | string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
};

function taskStage(row: Pick<GenRow, 'status'>, meta: Record<string, unknown>) {
  if (row.status === 'completed') return 'completed';
  if (row.status === 'failed') return 'failed';
  if (String(meta.mediaType || '') === 'video') {
    const progress = Number(meta.progress) || 0;
    if (meta.upstreamTaskId) return progress >= 95 ? 'saving_result' : 'service_processing';
    return 'created';
  }
  const submit = String(meta.fastSubmitState || '');
  if (submit === 'queued') return 'waiting_service';
  if (submit === 'running') return 'service_processing';
  if (submit === 'done' && meta.syncImageUrl) return 'saving_result';
  if (meta.upstreamTaskId) return 'waiting_result';
  return 'created';
}

function isVideoMeta(meta: Record<string, unknown>) {
  return String(meta.mediaType || '').trim().toLowerCase() === 'video';
}

function metaText(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** 按模型聚合：总量 / 成功 / 失败 / 成功率 / 退款，近 N 天（图片+视频合并） */
function aggregateByModel(rows: GenRow[]) {
  const byModel = new Map<string, {
    model: string;
    label: string;
    mediaType: 'image' | 'video';
    total: number;
    completed: number;
    failed: number;
    processing: number;
    creditsCharged: number;
    creditsRefunded: number;
    users: Set<string>;
  }>();
  for (const row of rows) {
    const meta = row.meta || {};
    const modelId = metaText(meta, 'model') || metaText(meta, 'modelLabel') || 'unknown';
    const label = metaText(meta, 'modelLabel') || modelId;
    const mediaType = isVideoMeta(meta) ? 'video' : 'image';
    const key = `${mediaType}:${modelId}`;
    let entry = byModel.get(key);
    if (!entry) {
      entry = { model: modelId, label, mediaType, total: 0, completed: 0, failed: 0, processing: 0, creditsCharged: 0, creditsRefunded: 0, users: new Set() };
      byModel.set(key, entry);
    }
    entry.total += 1;
    if (row.status === 'completed') entry.completed += 1;
    else if (row.status === 'failed') entry.failed += 1;
    else if (row.status === 'processing' || row.status === 'pending') entry.processing += 1;
    entry.creditsCharged += Number(row.credits_charged) || 0;
    const refund = Number(meta.refundCredits) || 0;
    if (refund > 0) entry.creditsRefunded += refund;
    if (row.user_id) entry.users.add(row.user_id);
  }
  return [...byModel.values()]
    .map(entry => ({
      ...entry,
      users: undefined,
      userCount: entry.users.size,
      successRate: entry.completed + entry.failed > 0
        ? Math.round((entry.completed / (entry.completed + entry.failed)) * 1000) / 10
        : null
    }))
    .sort((a, b) => b.total - a.total);
}

function shortError(row: GenRow): string {
  const meta = row.meta || {};
  return (
    metaText(meta, 'failReason')
    || metaText(meta, 'fastSubmitError')
    || metaText(meta, 'errorMessage')
    || (row.error_message ? row.error_message.trim() : '')
    || '未知错误'
  ).slice(0, 200);
}

adminCanvasRoutes.get('/', async c => {
  try {
    const admin = createAdminClient(c.env);
    const requestedLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(20, Math.floor(requestedLimit))) : 80;
    const daysRaw = Number(c.req.query('statsDays'));
    const statsDays = Math.min(30, Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7));
    const sinceIso = new Date(Date.now() - statsDays * 24 * 60 * 60 * 1000).toISOString();

    const [catalog, jobsResult, statsResult] = await Promise.all([
      fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL, { force: true }),
      admin
        .from('generation_requests')
        .select('id,user_id,prompt,resolution,quality,size_label,credits_charged,status,error_message,created_at,completed_at,meta')
        .order('created_at', { ascending: false })
        .limit(limit),
      admin
        .from('generation_requests')
        .select('id,user_id,prompt,credits_charged,status,error_message,created_at,completed_at,meta')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(3000)
    ]);
    if (jobsResult.error) throw jobsResult.error;
    if (statsResult.error) throw statsResult.error;

    const rows = (jobsResult.data || []) as GenRow[];
    const statsRows = (statsResult.data || []) as GenRow[];

    const userIds = [...new Set(rows.map(row => String(row.user_id || '')).filter(Boolean))];
    const names = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id,display_name')
        .in('user_id', userIds);
      for (const profile of profiles || []) {
        names.set(String(profile.user_id), String(profile.display_name || ''));
      }
    }

    const jobs = rows.map(row => {
      const meta = row.meta && typeof row.meta === 'object' ? row.meta as Record<string, unknown> : {};
      const userId = String(row.user_id || '');
      const video = isVideoMeta(meta);
      return {
        id: row.id,
        userId,
        userName: names.get(userId) || '',
        mediaType: video ? 'video' : 'image',
        prompt: String(row.prompt || '').replace(/\s+/g, ' ').slice(0, 180),
        publicModel: meta.model || null,
        publicModelLabel: meta.modelLabel || meta.model || null,
        actualModel: meta.upstreamModel || null,
        service: meta.provider || (video ? 'newapi' : null),
        status: row.status,
        stage: taskStage(row, meta),
        submittedToService: video
          ? !!meta.upstreamTaskId || row.status === 'completed'
          : meta.fastSubmitState === 'done' || !!meta.upstreamTaskId || row.status === 'completed',
        serviceTaskId: meta.upstreamTaskId || null,
        serviceRequestId: meta.upstreamRequestId || null,
        submitState: meta.fastSubmitState || null,
        resolution: row.resolution,
        quality: row.quality,
        size: row.size_label,
        duration: video ? Number(meta.duration) || null : null,
        referenceCount: Array.isArray(meta.refImageUrls) ? meta.refImageUrls.length : 0,
        credits: row.credits_charged,
        error: row.error_message || meta.fastSubmitError || meta.failReason || null,
        createdAt: row.created_at,
        completedAt: row.completed_at
      };
    });

    const publicImageUpstreams = new Set(catalog.imageCatalogEntries.map(model => model.upstream));
    const models = catalog.models
      .filter(model => publicImageUpstreams.has(model.upstreamModel))
      .map(model => ({
        id: model.id,
        label: model.label,
        actualModel: model.upstreamModel,
        modality: model.modality,
        operation: model.operation,
        service: 'newapi',
        endpoint: '/v1/images/generations',
        pricing: model.pricing,
        parameters: model.parameters
      }));

    const videoModels = catalog.models
      .filter(model => model.modality === 'video')
      .map(model => ({
        id: model.id,
        label: model.label,
        actualModel: model.upstreamModel,
        endpoint: '/v1/videos',
        pricing: model.pricing,
        parameters: (model.parameters || []).map(p => p.name).filter(name =>
          !['model', 'prompt'].includes(name)
        )
      }));

    // 错误日志：近 N 天失败任务（图片+视频），最新在前
    const errorLogs = statsRows
      .filter(row => row.status === 'failed')
      .slice(0, 100)
      .map(row => {
        const meta = row.meta && typeof row.meta === 'object' ? row.meta as Record<string, unknown> : {};
        return {
          id: row.id,
          mediaType: isVideoMeta(meta) ? 'video' : 'image',
          userName: names.get(String(row.user_id || '')) || '',
          userId: row.user_id,
          model: metaText(meta, 'modelLabel') || metaText(meta, 'model') || '—',
          entry: isVideoMeta(meta) ? '画布视频' : '生图',
          error: shortError(row),
          creditsCharged: Number(row.credits_charged) || 0,
          refunded: Number(meta.refundCredits) > 0 || meta.refundState === 'refunded',
          createdAt: row.created_at
        };
      });

    const modelStats = aggregateByModel(statsRows);
    const completed = jobs.filter(job => job.status === 'completed').length;
    const failed = jobs.filter(job => job.status === 'failed').length;
    const processing = jobs.filter(job => job.status === 'processing').length;

    return c.json({
      ok: true,
      data: {
        catalog: {
          available: catalog.available,
          stale: catalog.stale,
          version: catalog.version,
          pricingVersion: catalog.pricingVersion,
          models
        },
        videoModels,
        jobs,
        errorLogs,
        modelStats: {
          days: statsDays,
          rows: modelStats
        },
        jobsSummary: {
          total: jobs.length,
          completed,
          failed,
          processing,
          videoCount: jobs.filter(job => job.mediaType === 'video').length
        }
      }
    });
  } catch (error) {
    return jsonError(c, error);
  }
});
