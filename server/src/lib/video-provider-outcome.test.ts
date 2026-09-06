import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  drainExpiredVideoSubmitOutcomes,
  finalizeExpiredVideoSubmitOutcome,
  markVideoTaskNotFound,
  selectFairVideoOutcomeBatch,
  VIDEO_RESULT_OUTCOME_TIMEOUT_ERROR,
  VIDEO_SUBMIT_OUTCOME_SLA_MS,
  videoSubmitOutcomeIsExpired
} from './video-provider-outcome';
import { settleVideoRefund, type VideoSubmissionJob } from './video-provider-submit';
import { videoProviderQueueAction } from './video-provider-queue';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn()
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

const now = Date.parse('2026-07-27T12:00:00.000Z');

type MutableJob = VideoSubmissionJob & {
  error_message?: string | null;
  completed_at?: string | null;
};

function job(state: string, startedAt: number, upstreamTaskId?: string) {
  return {
    id: 'video-job-1',
    user_id: 'user-1',
    credits_charged: 12,
    status: 'processing',
    created_at: new Date(startedAt).toISOString(),
    meta: {
      mediaType: 'video',
      videoSubmitState: state,
      videoSubmitStartedAt: new Date(startedAt).toISOString(),
      ...(upstreamTaskId ? { upstreamTaskId } : {})
    }
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function refundAdmin(
  initial: MutableJob,
  options: {
    afterFirstRead?: (row: MutableJob) => void;
    concurrentRefundBarrier?: boolean;
    failRefundMetaWriteOnce?: boolean;
  } = {}
) {
  const row = clone(initial);
  const refundCalls: Array<Record<string, unknown>> = [];
  const appliedRefundKeys = new Set<string>();
  let failRefundMetaWrite = options.failRefundMetaWriteOnce === true;
  let readCount = 0;
  let refundRpcStarted = 0;
  let releaseRefundRpc: (() => void) | null = null;
  const refundRpcBarrier = options.concurrentRefundBarrier
    ? new Promise<void>(resolve => { releaseRefundRpc = resolve; })
    : null;
  const admin = {
    from(table: string) {
      if (table !== 'generation_requests') throw new Error(`unexpected table: ${table}`);
      let updatePayload: Record<string, unknown> | null = null;
      const equals: Array<[string, unknown]> = [];
      const metaFilters: Array<[string, unknown]> = [];
      let committed = false;
      let result: { data: MutableJob | null; error: Error | null };

      const matches = () => equals.every(([field, value]) => (
        row[field as keyof MutableJob] === value
      )) && metaFilters.every(([field, value]) => (
        (row.meta as Record<string, unknown>)[field] === value
      ));
      const commit = () => {
        if (committed) return result;
        committed = true;
        if (!matches()) return result = { data: null, error: null };
        const nextMeta = updatePayload?.meta as Record<string, unknown> | undefined;
        if (failRefundMetaWrite && nextMeta?.refundState === 'refunded') {
          failRefundMetaWrite = false;
          return result = { data: null, error: new Error('refund metadata write interrupted') };
        }
        if (updatePayload) Object.assign(row, clone(updatePayload));
        const data = clone(row);
        if (!updatePayload && readCount++ === 0) options.afterFirstRead?.(row);
        return result = { data, error: null };
      };
      const query = {
        select() { return query; },
        update(payload: Record<string, unknown>) { updatePayload = payload; return query; },
        eq(field: string, value: unknown) { equals.push([field, value]); return query; },
        filter(path: string, operator: string, value: unknown) {
          if (operator !== 'eq' || !path.startsWith('meta->>')) throw new Error('unexpected filter');
          metaFilters.push([path.slice('meta->>'.length), value]);
          return query;
        },
        async maybeSingle() { return commit(); },
        then<TResult1 = { data: MutableJob | null; error: Error | null }>(
          onfulfilled?: ((value: { data: MutableJob | null; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null
        ) {
          return Promise.resolve(commit()).then(onfulfilled);
        }
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'refund_user_credits') throw new Error(`unexpected rpc: ${name}`);
      refundCalls.push(clone(args));
      const key = `${String(args.p_user_id)}:${String(args.p_reason)}:${String(args.p_ref_id)}`;
      const replayed = appliedRefundKeys.has(key);
      appliedRefundKeys.add(key);
      if (refundRpcBarrier) {
        refundRpcStarted += 1;
        if (refundRpcStarted >= 2) releaseRefundRpc?.();
        await refundRpcBarrier;
      }
      return { data: { replayed }, error: null };
    }
  };
  return {
    admin: admin as unknown as SupabaseClient,
    refundCalls,
    appliedRefunds: () => appliedRefundKeys.size,
    row
  };
}

describe('video unknown-outcome SLA', () => {
  it('routes an awaiting debit through recovery without making it directly postable', () => {
    const candidate = job('awaiting_debit', now - 30_000);
    expect(videoSubmitOutcomeIsExpired(candidate, now)).toBe(false);
    expect(videoProviderQueueAction(candidate)).toBe('submit');
  });

  it('expires an ambiguous submit after one hour without making it queue-submittable', () => {
    const candidate = job('outcome_unknown', now - VIDEO_SUBMIT_OUTCOME_SLA_MS - 1);
    expect(videoSubmitOutcomeIsExpired(candidate, now)).toBe(true);
    expect(videoProviderQueueAction(candidate)).toBe('ignore');
  });

  it('never refunds a stale running fence whose upstream checkpoint may have failed', () => {
    const candidate = job('running', now - 8 * VIDEO_SUBMIT_OUTCOME_SLA_MS);
    expect(videoSubmitOutcomeIsExpired(candidate, now)).toBe(false);
    expect(videoProviderQueueAction(candidate)).toBe('ignore');
  });

  it('expires a submitted task that remains result-uncertain for one hour', () => {
    const candidate = job('submitted', now - 8 * VIDEO_SUBMIT_OUTCOME_SLA_MS, 'sd-task-1');
    Object.assign(candidate.meta, {
      videoResultState: 'result_uncertain',
      videoResultErrorCode: 'result_uncertain',
      videoResultUncertainAt: new Date(now - 4 * VIDEO_SUBMIT_OUTCOME_SLA_MS).toISOString()
    });
    expect(videoSubmitOutcomeIsExpired(candidate, now)).toBe(true);
    expect(videoProviderQueueAction(candidate)).toBe('ignore');
  });

  it('does not expire a fresh result-uncertain task', () => {
    const candidate = job('submitted', now - 30_000, 'video-task-1');
    Object.assign(candidate.meta, {
      videoResultState: 'result_uncertain',
      videoResultUncertainAt: new Date(now - 30_000).toISOString()
    });
    expect(videoSubmitOutcomeIsExpired(candidate, now)).toBe(false);
  });

  it('fails and refunds an expired result-uncertain task exactly once', async () => {
    const candidate = job(
      'submitted',
      now - 2 * VIDEO_SUBMIT_OUTCOME_SLA_MS,
      'video-task-uncertain'
    ) as MutableJob;
    candidate.meta = {
      ...(candidate.meta || {}),
      model: 'veo-3.1-fast-flex',
      credits: 35,
      debitSplit: { fromDaily: 5, fromPermanent: 30 },
      videoResultState: 'result_uncertain',
      videoResultUncertainAt: new Date(now - VIDEO_SUBMIT_OUTCOME_SLA_MS - 1).toISOString()
    };
    candidate.credits_charged = 35;
    const { admin, refundCalls, row } = refundAdmin(candidate);

    expect(await finalizeExpiredVideoSubmitOutcome(admin, candidate, now)).toBe(true);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe(VIDEO_RESULT_OUTCOME_TIMEOUT_ERROR);
    expect(row.meta).toMatchObject({
      videoSubmitState: 'failed',
      videoSubmitError: VIDEO_RESULT_OUTCOME_TIMEOUT_ERROR,
      refundState: 'refunded',
      refundPhase: 'result_uncertain'
    });
    expect(refundCalls).toEqual([{
      p_user_id: 'user-1',
      p_amount: 35,
      p_reason: 'video_generation_refund',
      p_ref_id: 'video-job-1',
      p_from_daily: 5,
      p_from_permanent: 30,
      p_meta: { model: 'veo-3.1-fast-flex', phase: 'result_uncertain' }
    }]);

    expect(await finalizeExpiredVideoSubmitOutcome(admin, candidate, now)).toBe(false);
    expect(refundCalls).toHaveLength(1);
  });

  it('does not refund when the task recovers after the timeout read', async () => {
    const candidate = job(
      'submitted',
      now - 2 * VIDEO_SUBMIT_OUTCOME_SLA_MS,
      'video-task-recovered'
    ) as MutableJob;
    candidate.meta = {
      ...(candidate.meta || {}),
      credits: 35,
      debitSplit: { fromDaily: 5, fromPermanent: 30 },
      videoResultState: 'result_uncertain',
      videoResultUncertainAt: new Date(now - VIDEO_SUBMIT_OUTCOME_SLA_MS - 1).toISOString()
    };
    const { admin, refundCalls, row } = refundAdmin(candidate, {
      afterFirstRead(current) {
        const recoveredMeta: Record<string, unknown> = { ...(current.meta || {}), progress: 42 };
        delete recoveredMeta.videoResultState;
        delete recoveredMeta.videoResultErrorCode;
        delete recoveredMeta.videoResultUncertainAt;
        current.meta = recoveredMeta;
      }
    });

    expect(await finalizeExpiredVideoSubmitOutcome(admin, candidate, now)).toBe(false);
    expect(row.status).toBe('processing');
    expect(row.meta).toMatchObject({ videoSubmitState: 'submitted', progress: 42 });
    expect(row.meta).not.toHaveProperty('videoResultState');
    expect(refundCalls).toHaveLength(0);
  });

  it('replays the same refund safely when its metadata write was interrupted', async () => {
    const candidate = job(
      'submitted',
      now - 2 * VIDEO_SUBMIT_OUTCOME_SLA_MS,
      'video-task-refund-recovery'
    ) as MutableJob;
    candidate.credits_charged = 35;
    candidate.meta = {
      ...(candidate.meta || {}),
      model: 'veo-3.1-fast-flex',
      credits: 35,
      debitSplit: { fromDaily: 5, fromPermanent: 30 },
      videoResultState: 'result_uncertain',
      videoResultUncertainAt: new Date(now - VIDEO_SUBMIT_OUTCOME_SLA_MS - 1).toISOString()
    };
    const store = refundAdmin(candidate, { failRefundMetaWriteOnce: true });

    await expect(finalizeExpiredVideoSubmitOutcome(store.admin, candidate, now))
      .rejects.toThrow('refund metadata write interrupted');
    expect(store.row).toMatchObject({
      status: 'failed',
      meta: { videoSubmitState: 'refund_pending', refundState: 'pending' }
    });

    await expect(finalizeExpiredVideoSubmitOutcome(store.admin, candidate, now)).resolves.toBe(true);
    expect(store.row.meta).toMatchObject({ videoSubmitState: 'failed', refundState: 'refunded' });
    expect(store.refundCalls).toHaveLength(2);
    expect(store.appliedRefunds()).toBe(1);
  });

  it('uses one durable wallet key when concurrent settlers race', async () => {
    const candidate = job('refund_pending', now - VIDEO_SUBMIT_OUTCOME_SLA_MS) as MutableJob;
    candidate.status = 'failed';
    candidate.credits_charged = 35;
    candidate.meta = {
      ...(candidate.meta || {}),
      model: 'veo-3.1-fast-flex',
      credits: 35,
      debitSplit: { fromDaily: 5, fromPermanent: 30 },
      refundState: 'pending',
      refundPhase: 'result_uncertain'
    };
    const store = refundAdmin(candidate, { concurrentRefundBarrier: true });

    await expect(Promise.all([
      settleVideoRefund(store.admin, clone(candidate), 'result_uncertain'),
      settleVideoRefund(store.admin, clone(candidate), 'result_uncertain')
    ])).resolves.toEqual([true, true]);

    expect(store.refundCalls).toHaveLength(2);
    expect(store.refundCalls.map(call => [call.p_reason, call.p_ref_id])).toEqual([
      ['video_generation_refund', 'video-job-1'],
      ['video_generation_refund', 'video-job-1']
    ]);
    expect(store.appliedRefunds()).toBe(1);
    expect(store.row.meta).toMatchObject({ videoSubmitState: 'failed', refundState: 'refunded' });
  });

  it('does not expire a fresh unknown result', () => {
    expect(videoSubmitOutcomeIsExpired(job('outcome_unknown', now - 30_000), now)).toBe(false);
  });

  it('does not extend the SLA when the same task remains not found', async () => {
    const firstNotFoundAt = new Date(now - 30_000).toISOString();
    const candidate = job('outcome_unknown', now - 30_000, 'task-missing');
    (candidate.meta as Record<string, unknown>).videoSubmitOutcomeUnknownAt = firstNotFoundAt;
    let updatePayload: Record<string, unknown> = {};
    const query = {
      update(payload: Record<string, unknown>) { updatePayload = payload; return query; },
      eq() { return query; },
      filter() { return query; },
      select() { return query; },
      async maybeSingle() { return { data: { id: candidate.id }, error: null }; }
    };
    const admin = { from: () => query } as unknown as SupabaseClient;

    expect(await markVideoTaskNotFound(admin, candidate, now)).toBe(true);
    expect((updatePayload.meta as Record<string, unknown>).videoSubmitOutcomeUnknownAt).toBe(firstNotFoundAt);
  });

  it('queries only unknown candidates so normal submitted tasks cannot block the SLA', async () => {
    const queries: unknown[][] = [];
    const admin = {
      from() {
        const calls: unknown[] = [];
        const query = {
          select(value: unknown) { calls.push(['select', value]); return query; },
          eq(...args: unknown[]) { calls.push(['eq', ...args]); return query; },
          filter(...args: unknown[]) { calls.push(['filter', ...args]); return query; },
          order(...args: unknown[]) { calls.push(['order', ...args]); return query; },
          async limit(value: number) {
            calls.push(['limit', value]);
            queries.push(calls);
            return { data: [], error: null };
          }
        };
        return query;
      }
    } as unknown as SupabaseClient;
    mocks.createAdminClient.mockReturnValue(admin);

    await expect(drainExpiredVideoSubmitOutcomes({} as Env, { now }))
      .resolves.toEqual({ finalized: 0, eligible: 0 });

    expect(queries).toHaveLength(4);
    expect(queries[0]).toContainEqual([
      'filter', 'meta->>videoSubmitState', 'eq', 'outcome_unknown'
    ]);
    expect(queries[1]).toEqual(expect.arrayContaining([
      ['filter', 'meta->>videoSubmitState', 'eq', 'submitted'],
      ['filter', 'meta->>videoResultState', 'eq', 'result_uncertain'],
      ['order', 'meta->>videoResultUncertainAt', { ascending: true, nullsFirst: true }]
    ]));
    expect(queries.flat(2)).not.toContain('in');
  });

  it('reserves progress for each outcome class when old refunds fill the batch', () => {
    const refundJobs = Array.from({ length: 12 }, (_, index) => ({
      ...job('refund_pending', now - 4 * VIDEO_SUBMIT_OUTCOME_SLA_MS + index),
      id: `refund-${index}`,
      status: 'failed'
    }));
    const unknown = { ...job('outcome_unknown', now - 3_000), id: 'unknown-newer' };
    const uncertain = { ...job('submitted', now - 2_000, 'task-uncertain'), id: 'uncertain-newer' };
    const billing = {
      ...job('completed', now - 1_000),
      id: 'billing-newer',
      status: 'completed'
    };

    const batch = selectFairVideoOutcomeBatch(
      [refundJobs, [unknown], [uncertain], [billing]],
      12,
      0
    );

    expect(batch).toHaveLength(12);
    expect(batch.map(item => item.id)).toEqual(expect.arrayContaining([
      'unknown-newer',
      'uncertain-newer',
      'billing-newer'
    ]));
  });

  it('rotates the first class when the batch is smaller than the class count', () => {
    const groups = [
      [{ ...job('refund_pending', now - 4_000), id: 'refund' }],
      [{ ...job('outcome_unknown', now - 3_000), id: 'unknown' }],
      [{ ...job('submitted', now - 2_000, 'task-1'), id: 'uncertain' }],
      [{ ...job('completed', now - 1_000), id: 'billing', status: 'completed' }]
    ];

    expect(selectFairVideoOutcomeBatch(groups, 2, 0).map(item => item.id))
      .toEqual(['refund', 'unknown']);
    expect(selectFairVideoOutcomeBatch(groups, 2, 2).map(item => item.id))
      .toEqual(['uncertain', 'billing']);
  });
});
