import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { calculateVideoBillingAdjustment } from './video-billing';
import type { DebitSplit } from './membership-credits';
import { refundUserCredits } from './membership-credits';
import { createAdminClient } from './supabase';
import {
  settleVideoRefund,
  type VideoSubmissionJob,
  videoMeta
} from './video-provider-submit';

export const VIDEO_SUBMIT_OUTCOME_SLA_MS = 60 * 60 * 1000;
export const VIDEO_SUBMIT_OUTCOME_TIMEOUT_ERROR = 'video_upstream_outcome_unknown_timeout';
export const VIDEO_RESULT_OUTCOME_TIMEOUT_ERROR = 'video_upstream_result_unknown_timeout';
const VIDEO_OUTCOME_DRAIN_INTERVAL_MS = 2 * 60 * 1000;

function parsedTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function videoSubmitOutcomeIsExpired(
  job: Pick<VideoSubmissionJob, 'created_at' | 'status' | 'meta'>,
  now = Date.now(),
  slaMs = VIDEO_SUBMIT_OUTCOME_SLA_MS
): boolean {
  if (job.status !== 'processing') return false;
  const meta = videoMeta(job.meta);
  const state = String(meta.videoSubmitState || '');
  const resultUncertain = state === 'submitted'
    && String(meta.videoResultState || '') === 'result_uncertain';
  // A stale `running` row may already have received an upstream task id whose
  // local checkpoint failed. It must be reconciled manually, never refunded by
  // the ambiguous-submit SLA. Only an explicitly persisted unknown outcome is
  // eligible for timeout settlement.
  if (state !== 'outcome_unknown' && !resultUncertain) return false;
  const referenceTime = resultUncertain
    ? parsedTimestamp(meta.videoResultUncertainAt)
      ?? parsedTimestamp(meta.videoSubmitFinishedAt)
      ?? parsedTimestamp(meta.videoSubmitStartedAt)
      ?? parsedTimestamp(job.created_at)
    : parsedTimestamp(meta.videoSubmitOutcomeUnknownAt)
      ?? parsedTimestamp(meta.videoSubmitStartedAt)
      ?? parsedTimestamp(meta.videoSubmitQueuedAt)
      ?? parsedTimestamp(job.created_at);
  return referenceTime !== null && now - referenceTime >= slaMs;
}

export async function markVideoTaskNotFound(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  now = Date.now()
): Promise<boolean> {
  const meta = videoMeta(job.meta);
  if (job.status !== 'processing' || !meta.upstreamTaskId) return false;
  const firstNotFoundAt = typeof meta.videoSubmitOutcomeUnknownAt === 'string'
    && Number.isFinite(Date.parse(meta.videoSubmitOutcomeUnknownAt))
    ? meta.videoSubmitOutcomeUnknownAt
    : new Date(now).toISOString();
  const nextMeta = {
    ...meta,
    videoSubmitState: 'outcome_unknown',
    videoSubmitOutcomeUnknownAt: firstNotFoundAt,
    videoSubmitError: 'upstream_task_not_found'
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>upstreamTaskId', 'eq', String(meta.upstreamTaskId))
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function finalizeExpiredVideoSubmitOutcome(
  admin: SupabaseClient,
  candidate: VideoSubmissionJob,
  now = Date.now()
): Promise<boolean> {
  const { data: current, error: readError } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', candidate.id)
    .eq('user_id', candidate.user_id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return false;
  const job = current as VideoSubmissionJob;
  const meta = videoMeta(job.meta);
  if (job.status === 'failed' && meta.refundState === 'pending') {
    return settleVideoRefund(admin, job, String(meta.refundPhase || 'unknown_outcome'));
  }
  if (!videoSubmitOutcomeIsExpired(job, now)) return false;

  const expectedState = String(meta.videoSubmitState || '');
  const resultUncertain = expectedState === 'submitted'
    && String(meta.videoResultState || '') === 'result_uncertain';
  const timeoutError = resultUncertain
    ? VIDEO_RESULT_OUTCOME_TIMEOUT_ERROR
    : VIDEO_SUBMIT_OUTCOME_TIMEOUT_ERROR;
  const timedOutAt = new Date(now).toISOString();
  const pendingMeta = {
    ...meta,
    videoSubmitState: 'refund_pending',
    videoSubmitError: timeoutError,
    videoSubmitTimedOutAt: timedOutAt,
    refundState: 'pending',
    refundPhase: resultUncertain
      ? 'result_uncertain'
      : meta.videoSubmitError === 'upstream_task_not_found'
        ? 'upstream_not_found'
        : 'unknown_outcome'
  };
  let claim = admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: timeoutError,
      completed_at: timedOutAt,
      meta: pendingMeta
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', expectedState);
  if (resultUncertain) {
    claim = claim.filter('meta->>videoResultState', 'eq', 'result_uncertain');
    const expectedTaskId = String(meta.upstreamTaskId || '').trim();
    if (expectedTaskId) claim = claim.filter('meta->>upstreamTaskId', 'eq', expectedTaskId);
    const expectedUncertainAt = String(meta.videoResultUncertainAt || '').trim();
    if (expectedUncertainAt) {
      claim = claim.filter('meta->>videoResultUncertainAt', 'eq', expectedUncertainAt);
    }
  }
  const { data, error } = await claim.select('*').maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return settleVideoRefund(admin, data as VideoSubmissionJob, String(pendingMeta.refundPhase));
}

function billingDebitSplit(meta: Record<string, unknown>, amount: number): DebitSplit {
  const split = videoMeta(meta.debitSplit);
  const fromDaily = Math.min(amount, Math.max(0, Number(split.fromDaily) || 0));
  return {
    fromDaily,
    fromPermanent: Math.min(amount - fromDaily, Math.max(0, Number(split.fromPermanent) || 0))
  };
}

export async function settleVideoBillingAdjustment(
  admin: SupabaseClient,
  candidate: VideoSubmissionJob
): Promise<boolean> {
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', candidate.id)
    .eq('user_id', candidate.user_id)
    .eq('status', 'completed')
    .filter('meta->>billingReconciliationState', 'eq', 'pending')
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const job = data as VideoSubmissionJob;
  const meta = videoMeta(job.meta);
  const adjustment = calculateVideoBillingAdjustment({
    requestedDuration: meta.requestedDuration,
    reportedDurationSeconds: meta.actualDurationSeconds,
    quotedCredits: meta.credits ?? job.credits_charged,
    unitCredits: meta.billingUnitCredits
  });
  if (!adjustment) {
    const { error: updateError } = await admin
      .from('generation_requests')
      .update({ meta: { ...meta, billingReconciliationState: 'verified' } })
      .eq('id', job.id)
      .eq('status', 'completed')
      .filter('meta->>billingReconciliationState', 'eq', 'pending');
    if (updateError) throw updateError;
    return true;
  }

  await refundUserCredits(
    admin,
    job.user_id,
    adjustment.refundCredits,
    'video_duration_adjustment_refund',
    `${job.id}:duration-adjustment`,
    billingDebitSplit(meta, adjustment.refundCredits),
    {
      model: meta.model,
      requestedDuration: adjustment.requestedDuration,
      billedDurationSeconds: adjustment.reportedDurationSeconds,
      actualBillableDuration: adjustment.actualBillableDuration
    }
  );
  const { error: updateError } = await admin
    .from('generation_requests')
    .update({
      credits_charged: adjustment.actualCredits,
      meta: {
        ...meta,
        credits: adjustment.actualCredits,
        actualBillableDuration: adjustment.actualBillableDuration,
        billingRefundCredits: adjustment.refundCredits,
        billingReconciliationState: 'refunded'
      }
    })
    .eq('id', job.id)
    .eq('status', 'completed')
    .filter('meta->>billingReconciliationState', 'eq', 'pending');
  if (updateError) throw updateError;
  return true;
}

function oldestFirst(left: VideoSubmissionJob, right: VideoSubmissionJob): number {
  const leftTime = Date.parse(left.created_at);
  const rightTime = Date.parse(right.created_at);
  return (Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY)
    - (Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY);
}

export function selectFairVideoOutcomeBatch(
  groups: readonly (readonly VideoSubmissionJob[])[],
  limit: number,
  rotation = 0
): VideoSubmissionJob[] {
  const maxItems = Math.max(0, Math.floor(limit));
  if (!maxItems || !groups.length) return [];
  const queues = groups.map(group => [...group].sort(oldestFirst));
  const offsets = queues.map(() => 0);
  const start = ((Math.floor(rotation) % queues.length) + queues.length) % queues.length;
  const selected: VideoSubmissionJob[] = [];

  while (selected.length < maxItems) {
    let progressed = false;
    for (let offset = 0; offset < queues.length && selected.length < maxItems; offset += 1) {
      const index = (start + offset) % queues.length;
      const item = queues[index][offsets[index]];
      if (!item) continue;
      offsets[index] += 1;
      selected.push(item);
      progressed = true;
    }
    if (!progressed) break;
  }
  return selected;
}

export async function drainExpiredVideoSubmitOutcomes(
  env: Env,
  opts?: { now?: number; maxFinalize?: number }
): Promise<{ finalized: number; eligible: number }> {
  const admin = createAdminClient(env);
  const [unknownResult, uncertainResult, refundResult, billingResult] = await Promise.all([
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'processing')
      .filter('meta->>mediaType', 'eq', 'video')
      .filter('meta->>videoSubmitState', 'eq', 'outcome_unknown')
      .order('created_at', { ascending: true })
      .limit(80),
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'processing')
      .filter('meta->>mediaType', 'eq', 'video')
      .filter('meta->>videoSubmitState', 'eq', 'submitted')
      .filter('meta->>videoResultState', 'eq', 'result_uncertain')
      .order('meta->>videoResultUncertainAt', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(80),
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'failed')
      .filter('meta->>mediaType', 'eq', 'video')
      .filter('meta->>refundState', 'eq', 'pending')
      .order('created_at', { ascending: true })
      .limit(80),
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'completed')
      .filter('meta->>mediaType', 'eq', 'video')
      .filter('meta->>billingReconciliationState', 'eq', 'pending')
      .order('created_at', { ascending: true })
      .limit(80)
  ]);
  if (unknownResult.error || uncertainResult.error || refundResult.error || billingResult.error) {
    console.error(
      '[video-outcome] list failed',
      unknownResult.error?.message
        || uncertainResult.error?.message
        || refundResult.error?.message
        || billingResult.error?.message
    );
    return { finalized: 0, eligible: 0 };
  }

  const now = opts?.now ?? Date.now();
  const refundPending = (refundResult.data || []) as VideoSubmissionJob[];
  const expiredUnknown = ((unknownResult.data || []) as VideoSubmissionJob[])
    .filter(job => videoSubmitOutcomeIsExpired(job, now));
  const expiredUncertain = ((uncertainResult.data || []) as VideoSubmissionJob[])
    .filter(job => videoSubmitOutcomeIsExpired(job, now));
  const billingPending = (billingResult.data || []) as VideoSubmissionJob[];
  const maxFinalize = Math.min(40, Math.max(1, opts?.maxFinalize ?? 12));
  const groups = [refundPending, expiredUnknown, expiredUncertain, billingPending];
  const eligible = groups.reduce((total, group) => total + group.length, 0);
  const batch = selectFairVideoOutcomeBatch(
    groups,
    maxFinalize,
    Math.floor(now / VIDEO_OUTCOME_DRAIN_INTERVAL_MS)
  );
  const results = await Promise.allSettled(
    batch.map(job => job.status === 'completed'
      ? settleVideoBillingAdjustment(admin, job)
      : finalizeExpiredVideoSubmitOutcome(admin, job, now))
  );
  let finalized = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value) finalized += 1;
    } else {
      console.error('[video-outcome] finalize failed', batch[index]?.id, result.reason);
    }
  });
  return { finalized, eligible };
}
