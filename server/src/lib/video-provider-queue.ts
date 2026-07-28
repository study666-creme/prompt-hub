import type { GenerationSubmissionQueueMessage, Env } from '../env';
import { createAdminClient } from './supabase';
import {
  processVideoPendingSubmit,
  type VideoSubmissionJob,
  type VideoSubmitResult,
  videoMeta
} from './video-provider-submit';

export type VideoProviderQueueAction = 'submit' | 'settle_refund' | 'retry' | 'ignore';

export function videoProviderQueueAction(job: Pick<VideoSubmissionJob, 'status' | 'meta'>): VideoProviderQueueAction {
  const meta = videoMeta(job.meta);
  if (job.status === 'failed' && meta.refundState === 'pending') return 'settle_refund';
  if (job.status !== 'processing' || meta.mediaType !== 'video') return 'ignore';
  const state = String(meta.videoSubmitState || '');
  if (state === 'awaiting_debit' || state === 'queued') return 'submit';
  // running/outcome_unknown/not_found may already represent a paid request.
  // They are terminal for submission and are finalized only by the SLA.
  return 'ignore';
}

export async function processVideoQueueMessage(
  env: Env,
  payload: GenerationSubmissionQueueMessage
): Promise<VideoSubmitResult> {
  if (!payload?.jobId || !payload?.userId) return 'ignored';
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', payload.jobId)
    .eq('user_id', payload.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'ignored';

  const job = data as VideoSubmissionJob;
  const action = videoProviderQueueAction(job);
  if (action === 'ignore') return 'ignored';
  return processVideoPendingSubmit(admin, job, env);
}
