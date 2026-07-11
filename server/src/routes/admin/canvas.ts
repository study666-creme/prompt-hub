import { Hono } from 'hono';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';
import { fetchNewApiModelCatalog } from '../../lib/newapi';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

type ServiceLog = {
  id?: number;
  created_at?: number;
  type?: number;
  model_name?: string;
  channel?: number;
  quota?: number;
  use_time?: number;
  request_id?: string;
  content?: string;
};

export const adminCanvasRoutes = new Hono<{ Bindings: Env }>();

adminCanvasRoutes.use('*', requireAdminSecret);
adminCanvasRoutes.use('*', rateLimit(120, 60_000));

function taskStage(row: Record<string, unknown>, meta: Record<string, unknown>) {
  if (row.status === 'completed') return 'completed';
  if (row.status === 'failed') return 'failed';
  const submit = String(meta.fastSubmitState || '');
  if (submit === 'queued') return 'waiting_service';
  if (submit === 'running') return 'service_processing';
  if (submit === 'done' && meta.syncImageUrl) return 'saving_result';
  if (meta.upstreamTaskId) return 'waiting_result';
  return 'created';
}

async function fetchServiceLogs(env: Env): Promise<{ available: boolean; error?: string; items: ServiceLog[] }> {
  const key = env.NEWAPI_API_KEY?.trim();
  const base = (env.NEWAPI_API_BASE_URL || 'https://newapi.prompt-hubs.com').replace(/\/$/, '');
  if (!key) return { available: false, error: '服务日志密钥未配置', items: [] };
  try {
    const response = await fetch(`${base}/api/log/token`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json() as { success?: boolean; message?: string; data?: ServiceLog[] };
    if (!response.ok || payload.success === false || !Array.isArray(payload.data)) {
      throw new Error(payload.message || `HTTP ${response.status}`);
    }
    return { available: true, items: payload.data.slice(0, 120) };
  } catch (error) {
    return { available: false, error: String((error as Error).message || error).slice(0, 160), items: [] };
  }
}

adminCanvasRoutes.get('/', async c => {
  try {
    const admin = createAdminClient(c.env);
    const requestedLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(20, Math.floor(requestedLimit))) : 80;
    const [catalog, jobsResult, serviceLogs] = await Promise.all([
      fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL, { force: true }),
      admin
        .from('generation_requests')
        .select('id,user_id,prompt,resolution,quality,size_label,credits_charged,status,error_message,created_at,completed_at,meta')
        .order('created_at', { ascending: false })
        .limit(limit),
      fetchServiceLogs(c.env)
    ]);
    if (jobsResult.error) throw jobsResult.error;

    const rows = (jobsResult.data || []) as Record<string, unknown>[];
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
      return {
        id: row.id,
        userId,
        userName: names.get(userId) || '',
        prompt: String(row.prompt || '').replace(/\s+/g, ' ').slice(0, 180),
        publicModel: meta.model || null,
        publicModelLabel: meta.modelLabel || meta.model || null,
        actualModel: meta.upstreamModel || null,
        service: meta.provider || null,
        status: row.status,
        stage: taskStage(row, meta),
        submittedToService: meta.fastSubmitState === 'done' || !!meta.upstreamTaskId || row.status === 'completed',
        serviceTaskId: meta.upstreamTaskId || null,
        serviceRequestId: meta.upstreamRequestId || null,
        submitState: meta.fastSubmitState || null,
        submitStartedAt: meta.fastSubmitStartedAt || null,
        submitFinishedAt: meta.fastSubmitFinishedAt || null,
        resolution: row.resolution,
        quality: row.quality,
        size: row.size_label,
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
        jobs,
        serviceLogs: {
          available: serviceLogs.available,
          error: serviceLogs.error || null,
          consoleUrl: 'https://console.prompt-hubs.com/usage-logs/task',
          items: serviceLogs.items.map(item => ({
            id: item.id,
            createdAt: item.created_at ? new Date(item.created_at * 1000).toISOString() : null,
            status: item.type === 2 ? 'success' : item.type === 5 ? 'failed' : 'other',
            model: item.model_name || null,
            channel: item.channel || null,
            creditsRaw: item.quota || 0,
            durationSeconds: item.use_time || 0,
            requestId: item.request_id || null,
            detail: item.content || ''
          }))
        }
      }
    });
  } catch (error) {
    return jsonError(c, error);
  }
});
