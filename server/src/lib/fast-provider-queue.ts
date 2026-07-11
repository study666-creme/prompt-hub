import type { Env } from '../env';
import { processFastProviderPendingSubmit, fastSubmitParamsFromJob } from './fast-provider-submit';
import type { JobRow } from './generation-jobs';
import { upstreamBindingsFromEnv } from './image-upstream';
import { createAdminClient } from './supabase';

export type FastProviderQueueResult = 'processed' | 'retry' | 'ignored';

export async function processFastProviderQueueMessage(
  env: Env,
  payload: { jobId: string; userId: string }
): Promise<FastProviderQueueResult> {
  if (!payload?.jobId || !payload?.userId) return 'ignored';
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', payload.jobId)
    .eq('user_id', payload.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'processing') return 'ignored';

  const job = data as JobRow;
  const meta = (job.meta as Record<string, unknown>) || {};
  if (meta.provider !== 'newapi') return 'ignored';
  const state = String(meta.fastSubmitState || '');
  if (state === 'running') {
    const startedAt = Date.parse(String(meta.fastSubmitStartedAt || ''));
    const runningMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    if (runningMs < 10 * 60_000) return 'retry';
    const resetMeta = {
      ...meta,
      fastSubmitState: 'queued',
      fastSubmitRecoveredAt: new Date().toISOString()
    };
    const { error: resetError } = await admin
      .from('generation_requests')
      .update({ meta: resetMeta })
      .eq('id', job.id)
      .eq('status', 'processing')
      .filter('meta->>fastSubmitState', 'eq', 'running');
    if (resetError) throw resetError;
    return 'retry';
  }
  if (state !== 'queued') return 'ignored';

  const upstream = upstreamBindingsFromEnv(env);
  const processed = await processFastProviderPendingSubmit(
    admin,
    job.user_id,
    job,
    upstream,
    'newapi',
    fastSubmitParamsFromJob(job),
    env
  );
  return processed ? 'processed' : 'retry';
}
