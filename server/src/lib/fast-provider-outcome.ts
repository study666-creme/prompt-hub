import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import type { DebitSplit } from './membership-credits';
import { refundUserCredits } from './membership-credits';
import type { JobRow } from './generation-jobs';
import { createAdminClient } from './supabase';

export const FAST_PROVIDER_OUTCOME_SLA_MS = 60 * 60 * 1000;
export const FAST_PROVIDER_OUTCOME_TIMEOUT_ERROR = 'upstream_outcome_unknown_timeout';

const REFUND_PENDING_STATE = 'outcome_unknown_refund_pending';
const ACTIVE_UNKNOWN_STATES = new Set(['running', 'outcome_unknown']);

type DrainOptions = {
  now?: number;
  maxFinalize?: number;
};

function parsedTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function fastProviderOutcomeIsExpired(
  job: Pick<JobRow, 'created_at' | 'meta'>,
  now = Date.now(),
  slaMs = FAST_PROVIDER_OUTCOME_SLA_MS
): boolean {
  const meta = (job.meta as Record<string, unknown>) || {};
  const state = String(meta.fastSubmitState || '');
  if (!ACTIVE_UNKNOWN_STATES.has(state)) return false;

  const referenceTime = state === 'outcome_unknown'
    ? parsedTimestamp(meta.fastSubmitOutcomeUnknownAt)
      ?? parsedTimestamp(meta.fastSubmitStartedAt)
      ?? parsedTimestamp(meta.fastSubmitDispatchedAt)
      ?? parsedTimestamp(job.created_at)
    : parsedTimestamp(meta.fastSubmitStartedAt)
      ?? parsedTimestamp(meta.fastSubmitDispatchedAt)
      ?? parsedTimestamp(job.created_at);

  return referenceTime !== null && now - referenceTime >= slaMs;
}

function debitSplit(meta: Record<string, unknown>, amount: number): DebitSplit {
  const split = meta.debitSplit as DebitSplit | undefined;
  return split || { fromDaily: 0, fromPermanent: amount };
}

async function settlePendingRefund(
  admin: SupabaseClient,
  job: JobRow,
  now: number
): Promise<boolean> {
  const meta = (job.meta as Record<string, unknown>) || {};
  if (
    job.status !== 'failed'
    || String(meta.fastSubmitState || '') !== REFUND_PENDING_STATE
  ) {
    return false;
  }

  const amount = Number(job.credits_charged || 0);
  if (!meta.refunded && amount > 0) {
    await refundUserCredits(
      admin,
      job.user_id,
      amount,
      'image_generation_refund',
      job.id,
      debitSplit(meta, amount),
      { reason: 'upstream_timeout' }
    );
  }

  const settledMeta = {
    ...meta,
    fastSubmitState: 'failed',
    fastSubmitRefundSettledAt: new Date(now).toISOString(),
    refunded: meta.refunded === true || amount > 0
  };
  const { error } = await admin
    .from('generation_requests')
    .update({ meta: settledMeta })
    .eq('id', job.id)
    .eq('status', 'failed')
    .filter('meta->>fastSubmitState', 'eq', REFUND_PENDING_STATE);
  if (error) throw error;
  return true;
}

export async function finalizeExpiredFastProviderOutcome(
  admin: SupabaseClient,
  job: JobRow,
  now = Date.now()
): Promise<boolean> {
  const { data: currentData, error: readError } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', job.id)
    .maybeSingle();
  if (readError) throw readError;
  if (!currentData) return false;

  job = currentData as JobRow;
  const meta = (job.meta as Record<string, unknown>) || {};
  if (String(meta.fastSubmitState || '') === REFUND_PENDING_STATE) {
    return settlePendingRefund(admin, job, now);
  }
  if (job.status !== 'processing' || !fastProviderOutcomeIsExpired(job, now)) {
    return false;
  }

  const expectedState = String(meta.fastSubmitState || '');
  const timedOutAt = new Date(now).toISOString();
  const pendingMeta = {
    ...meta,
    fastSubmitState: REFUND_PENDING_STATE,
    fastSubmitError: FAST_PROVIDER_OUTCOME_TIMEOUT_ERROR,
    fastSubmitTimedOutAt: timedOutAt,
    failReason: 'upstream_timeout',
    refunded: meta.refunded === true
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: 'upstream_timeout',
      completed_at: timedOutAt,
      meta: pendingMeta
    })
    .eq('id', job.id)
    .eq('status', 'processing')
    .filter('meta->>fastSubmitState', 'eq', expectedState)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  return settlePendingRefund(admin, data as JobRow, now);
}

export async function drainExpiredFastProviderOutcomes(
  env: Env,
  opts?: DrainOptions
): Promise<{ finalized: number; eligible: number }> {
  const admin = createAdminClient(env);
  const [activeResult, refundResult] = await Promise.all([
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'processing')
      .in('meta->>fastSubmitState', ['running', 'outcome_unknown'])
      .order('created_at', { ascending: true })
      .limit(80),
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'failed')
      .filter('meta->>fastSubmitState', 'eq', REFUND_PENDING_STATE)
      .order('created_at', { ascending: true })
      .limit(80)
  ]);
  if (activeResult.error || refundResult.error) {
    console.error(
      '[fast-outcome] list failed',
      activeResult.error?.message || refundResult.error?.message
    );
    return { finalized: 0, eligible: 0 };
  }

  const now = opts?.now ?? Date.now();
  const maxFinalize = Math.min(40, Math.max(1, opts?.maxFinalize ?? 12));
  const refundPending = (refundResult.data || []) as JobRow[];
  const expiredActive = ((activeResult.data || []) as JobRow[]).filter((job) =>
    fastProviderOutcomeIsExpired(job, now)
  );
  // Resume interrupted refunds first; those jobs have already reached a
  // terminal status and only need the idempotent wallet compensation.
  const eligible = [...refundPending, ...expiredActive];
  const results = await Promise.allSettled(
    eligible.slice(0, maxFinalize).map((job) =>
      finalizeExpiredFastProviderOutcome(admin, job, now)
    )
  );
  let finalized = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value) finalized += 1;
      return;
    }
    console.error('[fast-outcome] finalize failed', eligible[index]?.id, result.reason);
  });
  if (eligible.length) {
    console.log('[fast-outcome] tick', { finalized, eligible: eligible.length });
  }
  return { finalized, eligible: eligible.length };
}
