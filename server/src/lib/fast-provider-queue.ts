import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import {
  processFastProviderPendingSubmit,
  fastSubmitParamsFromJob,
  recoverFastProviderResultArchive
} from './fast-provider-submit';
import type { JobRow } from './generation-jobs';
import { upstreamBindingsFromEnv } from './image-upstream';
import { createAdminClient } from './supabase';

export type FastProviderQueueResult = 'processed' | 'retry' | 'ignored';
export type FastProviderQueueAction = 'submit' | 'mark_outcome_unknown' | 'recover_archive' | 'retry' | 'ignore';

export type FastProviderQueuePayload = { jobId: string; userId: string };
type FastProviderQueueSender = {
  send(payload: FastProviderQueuePayload): Promise<unknown>;
};

export async function persistAndEnqueueFastProviderJob(
  admin: SupabaseClient,
  queue: FastProviderQueueSender,
  payload: FastProviderQueuePayload,
  meta: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta })
    .eq('id', payload.jobId)
    .eq('user_id', payload.userId)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // Some PostgREST-compatible deployments apply the update but omit the
    // requested representation. Verify the durable outbox state with a
    // separate read before treating the write as failed.
    const { data: persisted, error: verifyError } = await admin
      .from('generation_requests')
      .select('id,status,meta')
      .eq('id', payload.jobId)
      .eq('user_id', payload.userId)
      .maybeSingle();
    if (verifyError) throw verifyError;
    const persistedMeta = persisted?.meta && typeof persisted.meta === 'object'
      ? persisted.meta as Record<string, unknown>
      : {};
    if (
      !persisted
      || persisted.status !== 'processing'
      || persistedMeta.fastSubmitState !== 'queued'
      || persistedMeta.upstreamClientRequestId !== meta.upstreamClientRequestId
    ) {
      throw new Error('generation_queue_state_not_persisted');
    }
  }
  try {
    await queue.send(payload);
    return true;
  } catch (queueError) {
    // The database row is the durable outbox. A send error may be ambiguous,
    // so keep it queued for cron instead of refunding a possibly submitted job.
    console.error('[image-queue] enqueue failed; queued outbox retained', payload.jobId, queueError);
    return false;
  }
}

export function fastProviderQueueAction(
  meta: Record<string, unknown>
): FastProviderQueueAction {
  const state = String(meta.fastSubmitState || '');
  if (state === 'queued') return 'submit';
  // A running request may already have reached the paid upstream. Queue
  // redelivery must never mutate or reopen it; the SLA sweeper owns timeout.
  if (state === 'running') return 'retry';
  if (
    (state === 'archiving' || state === 'recovery_required')
    && hasResultUrls(meta)
  ) {
    return 'recover_archive';
  }
  if (
    (state === 'archiving' || state === 'recovery_required')
    && !hasString(meta.upstreamTaskId)
  ) {
    return 'mark_outcome_unknown';
  }
  // Unknown and terminal states cannot safely issue a generation POST.
  return 'ignore';
}

function hasString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasResultUrls(meta: Record<string, unknown>): boolean {
  return Array.isArray(meta.upstreamResultUrls)
    && meta.upstreamResultUrls.some((value) => hasString(value));
}

async function markFastProviderOutcomeUnknown(
  admin: SupabaseClient,
  job: JobRow
): Promise<boolean> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const expectedState = String(meta.fastSubmitState || '');
  if (!['archiving', 'recovery_required'].includes(expectedState)) return false;
  const nextMeta = {
    ...meta,
    fastSubmitState: 'outcome_unknown',
    fastSubmitOutcomeUnknownAt: new Date().toISOString(),
    fastSubmitError: 'upstream_outcome_unknown',
    refunded: false
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', job.id)
    .eq('status', 'processing')
    .filter('meta->>fastSubmitState', 'eq', expectedState)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

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
  const action = fastProviderQueueAction(meta);
  if (action === 'recover_archive') {
    const recovered = await recoverFastProviderResultArchive(admin, job.user_id, job, env);
    return recovered ? 'processed' : 'ignored';
  }
  if (action === 'mark_outcome_unknown') {
    const marked = await markFastProviderOutcomeUnknown(admin, job);
    return marked ? 'processed' : 'ignored';
  }
  if (action === 'retry') return 'retry';
  if (action !== 'submit') return 'ignored';

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
