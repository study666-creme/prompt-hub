import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { finalizeFailedJob, pollAndUpdateJob, type JobRow } from './generation-jobs';
import type { ImageUpstreamBindings } from './image-upstream';
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

/** ThinkAI 慢速线：POST 立即返回，后台提交（避免 Worker HTTP 超时 502） */
export async function processIthinkPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  env: Env | undefined,
  params: IthinkSubmitParams
): Promise<void> {
  if (!upstream.ithinkKey) return;
  const meta = (job.meta as Record<string, unknown>) || {};
  if (job.status !== 'processing') return;
  if (meta.ithinkSubmitState === 'running' || meta.ithinkSubmitState === 'done') return;
  if (typeof meta.syncImageUrl === 'string' && meta.syncImageUrl) return;

  await markIthinkSubmitState(admin, job.id, meta, { ithinkSubmitState: 'running' });

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
      throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'ThinkAI 未返回图片');
    }
    await markIthinkSubmitState(admin, job.id, meta, {
      upstreamTaskId: taskId,
      syncImageUrl: imageUrl,
      ithinkSubmitState: 'done',
      ithinkSubmitError: null
    });
    const { data: fresh } = await admin
      .from('generation_requests')
      .select('*')
      .eq('id', job.id)
      .maybeSingle();
    if (fresh) {
      await pollAndUpdateJob(admin, userId, fresh, upstream, env, { quick: false });
    }
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
