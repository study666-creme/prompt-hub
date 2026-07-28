import type { Env } from '../env';
import { processVideoQueueMessage } from './video-provider-queue';
import { createAdminClient } from './supabase';
import type { VideoSubmissionJob } from './video-provider-submit';

export async function drainVideoPendingSubmits(
  env: Env,
  opts?: { maxSubmit?: number }
): Promise<{ submitted: number; queued: number }> {
  if (!env.NEWAPI_API_KEY?.trim()) return { submitted: 0, queued: 0 };
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'processing')
    .filter('meta->>mediaType', 'eq', 'video')
    .in('meta->>videoSubmitState', ['awaiting_debit', 'queued'])
    .order('created_at', { ascending: true })
    .limit(80);
  if (error) {
    console.error('[video-drain] list failed', error.message);
    return { submitted: 0, queued: 0 };
  }

  const queued = (data || []) as VideoSubmissionJob[];
  const batch = queued.slice(0, Math.min(12, Math.max(1, opts?.maxSubmit ?? 2)));
  const results = await Promise.allSettled(batch.map(job => processVideoQueueMessage(env, {
    kind: 'video',
    jobId: job.id,
    userId: job.user_id
  })));
  const submitted = results.filter(result => result.status === 'fulfilled' && result.value === 'processed').length;
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.error('[video-drain] submit failed', batch[index]?.id, result.reason);
  });
  return { submitted, queued: queued.length };
}
