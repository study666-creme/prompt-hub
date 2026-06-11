import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { finalizeFailedJob, type JobRow } from './generation-jobs';
import type { ImageUpstreamBindings } from './image-upstream';
import { completeMookoJobWithImage } from './mooko-submit';
import { submitIthinkImageJob } from './ithink';

type IthinkSubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
};

async function markIthinkSubmitState(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>,
  patch: Record<string, unknown>
) {
  await admin
    .from('generation_requests')
    .update({ meta: { ...meta, ...patch } })
    .eq('id', jobId);
}

/** 仅 queued → running 的原子认领，避免 waitUntil 与 Cron 重复 POST 扣费 */
async function claimIthinkSubmit(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (String(meta.ithinkSubmitState || '') !== 'queued') return null;
  const attempts = Number(meta.ithinkSubmitAttempts || 0);
  if (attempts >= 1) return null;
  const nextMeta = {
    ...meta,
    ithinkSubmitState: 'running',
    ithinkSubmitStartedAt: new Date().toISOString(),
    ithinkSubmitAttempts: attempts + 1
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', jobId)
    .eq('status', 'processing')
    .filter('meta->>ithinkSubmitState', 'eq', 'queued')
    .select('meta')
    .maybeSingle();
  if (error || !data?.meta) return null;
  return data.meta as Record<string, unknown>;
}

/** ThinkAI 慢速线：POST 立即返回，后台提交（避免 Worker HTTP 超时 502） */
export async function processIthinkPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  env: Env | undefined,
  params: IthinkSubmitParams
): Promise<void> {
  const meta = (job.meta as Record<string, unknown>) || {};
  if (!upstream.ithinkKey) {
    await markIthinkSubmitState(admin, job.id, meta, {
      ithinkSubmitState: 'failed',
      ithinkSubmitError: 'upstream_submit_not_configured'
    });
    if (job.status === 'processing') {
      await finalizeFailedJob(admin, userId, job, 'upstream_submit_not_configured');
    }
    return;
  }
  if (job.status !== 'processing') return;
  if (meta.ithinkSubmitState === 'done') return;
  if (typeof meta.syncImageUrl === 'string' && meta.syncImageUrl) {
    await completeMookoJobWithImage(admin, job.id, meta, meta.syncImageUrl, [meta.syncImageUrl]);
    return;
  }
  /** 同步 POST 约 50–120s；running 期间禁止再次 POST */
  if (meta.ithinkSubmitState === 'running') return;

  const claimed = await claimIthinkSubmit(admin, job.id, meta);
  if (!claimed) return;

  try {
    const upstreamModel =
      params.upstreamModel.trim()
      || env?.ITHINK_UPSTREAM_MODEL?.trim()
      || String(meta.upstreamModel || 'gpt-image-2');
    const { taskId, imageUrl } = await submitIthinkImageJob(
      upstream.ithinkKey,
      upstream.ithinkBase,
      {
        upstreamModel,
        prompt: params.prompt,
        resolution: '1k',
        quality: params.quality,
        size: params.size
      }
    );
    if (!imageUrl) {
      throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_no_image');
    }
    const nextMeta = {
      ...claimed,
      upstreamTaskId: taskId,
      syncImageUrl: imageUrl,
      ithinkSubmitState: 'done',
      ithinkSubmitError: null,
      ithinkSubmitFinishedAt: new Date().toISOString()
    };
    await completeMookoJobWithImage(admin, job.id, nextMeta, imageUrl, [imageUrl]);
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String((e as Error)?.message || e);
    console.error('[ithink] background submit failed', job.id, msg);
    await markIthinkSubmitState(admin, job.id, meta, {
      ithinkSubmitState: 'failed',
      ithinkSubmitError: msg.slice(0, 400)
    });
    const { data: fresh } = await admin
      .from('generation_requests')
      .select('*')
      .eq('id', job.id)
      .maybeSingle();
    if (fresh && fresh.status === 'processing') {
      await finalizeFailedJob(admin, userId, fresh, msg.slice(0, 400));
    }
  }
}
