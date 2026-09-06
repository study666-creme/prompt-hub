import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { ApiError } from './errors';

const { deductUserCreditsMock, refundUserCreditsMock } = vi.hoisted(() => ({
  deductUserCreditsMock: vi.fn(),
  refundUserCreditsMock: vi.fn()
}));

vi.mock('./membership-credits', async importOriginal => ({
  ...await importOriginal<typeof import('./membership-credits')>(),
  deductUserCredits: deductUserCreditsMock,
  refundUserCredits: refundUserCreditsMock
}));

import { videoProviderQueueAction } from './video-provider-queue';
import {
  processVideoPendingSubmit,
  type VideoSubmissionJob,
  videoMeta
} from './video-provider-submit';

type MutableJob = VideoSubmissionJob & {
  error_message?: string | null;
  completed_at?: string | null;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeAdminOptions = {
  failSubmittedCheckpointUpdates?: number;
  failCheckpointReads?: number;
};

function fakeAdmin(initial: MutableJob, options: FakeAdminOptions = {}) {
  const row = clone(initial);
  let submittedCheckpointFailures = options.failSubmittedCheckpointUpdates ?? 0;
  let checkpointReadFailures = options.failCheckpointReads ?? 0;
  const admin = {
    from(table: string) {
      if (table !== 'generation_requests') throw new Error(`unexpected table: ${table}`);
      let updatePayload: Record<string, unknown> | null = null;
      const equals: Array<[string, unknown]> = [];
      const metaFilters: Array<[string, unknown]> = [];
      let committed = false;
      let result: { data: MutableJob | null; error: Error | null };

      const matches = () => equals.every(([field, value]) => row[field as keyof MutableJob] === value)
        && metaFilters.every(([field, value]) => (row.meta || {})[field] === value);
      const commit = () => {
        if (committed) return result;
        committed = true;
        if (!matches()) return result = { data: null, error: null };
        const nextMeta = videoMeta(updatePayload?.meta);
        if (String(nextMeta.videoSubmitState || '') === 'submitted' && submittedCheckpointFailures > 0) {
          submittedCheckpointFailures -= 1;
          return result = { data: null, error: new Error('checkpoint update unavailable') };
        }
        if (!updatePayload && String(videoMeta(row.meta).videoSubmitState || '') === 'running' && checkpointReadFailures > 0) {
          checkpointReadFailures -= 1;
          return result = { data: null, error: new Error('checkpoint verification unavailable') };
        }
        if (updatePayload) Object.assign(row, clone(updatePayload));
        return result = { data: clone(row), error: null };
      };
      const query = {
        select() {
          return query;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return query;
        },
        eq(field: string, value: unknown) {
          equals.push([field, value]);
          return query;
        },
        filter(path: string, operator: string, value: unknown) {
          if (operator !== 'eq' || !path.startsWith('meta->>')) throw new Error('unexpected filter');
          metaFilters.push([path.slice('meta->>'.length), value]);
          return query;
        },
        async maybeSingle() {
          return commit();
        },
        then<TResult1 = { data: MutableJob | null; error: Error | null }>(
          onfulfilled?: ((value: { data: MutableJob | null; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null
        ) {
          return Promise.resolve(commit()).then(onfulfilled);
        }
      };
      return query;
    }
  };
  return { admin: admin as unknown as SupabaseClient, row };
}

function queuedJob(): MutableJob {
  return {
    id: 'video-job-1',
    user_id: 'user-1',
    credits_charged: 12,
    status: 'processing',
    prompt: 'slow camera move',
    created_at: '2026-07-24T00:00:00.000Z',
    meta: {
      mediaType: 'video',
      model: 'motion-video',
      routeChannelId: 7,
      credits: 12,
      debitSplit: { fromDaily: 2, fromPermanent: 10 },
      videoSubmitState: 'queued',
      videoSubmitEnvelope: {
        idempotencyKey: 'prompt-hub-video:video-job-1',
        upstreamModel: 'grok-imagine-video',
        prompt: 'slow camera move',
        duration: 6,
        ratio: '16:9',
        resolution: '720p',
        generateAudio: true
      }
    }
  };
}

function awaitingDebitJob(): MutableJob {
  const job = queuedJob();
  job.meta = {
    ...job.meta,
    videoSubmitState: 'awaiting_debit'
  };
  delete (job.meta as Record<string, unknown>).debitSplit;
  return job;
}

const env = {
  NEWAPI_API_KEY: 'image-secret',
  NEWAPI_VIDEO_API_KEY: 'video-secret',
  NEWAPI_API_BASE_URL: 'https://newapi.test'
} as Env;

beforeEach(() => {
  deductUserCreditsMock.mockReset().mockResolvedValue({
    profile: {},
    split: { fromDaily: 2, fromPermanent: 10 },
    replayed: false
  });
  refundUserCreditsMock.mockReset();
});

describe('durable video submission', () => {
  it('does not fall back to the image key when the video key is missing', async () => {
    const job = queuedJob();
    const { admin } = fakeAdmin(job);
    const submit = vi.fn();

    await expect(processVideoPendingSubmit(admin, job, {
      NEWAPI_API_KEY: 'image-only-key',
      NEWAPI_API_BASE_URL: 'https://newapi.test'
    } as Env, { submit })).resolves.toBe('retry');

    expect(submit).not.toHaveBeenCalled();
  });

  it('recovers a crash before debit/queue preparation without charging twice', async () => {
    const job = awaitingDebitJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn().mockResolvedValue({
      id: 'upstream-task-recovered',
      status: 'queued' as const,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      videoUrl: null
    });

    expect(await processVideoPendingSubmit(
      admin,
      job,
      env,
      { submit, attemptId: () => 'attempt-recovered' }
    )).toBe('processed');

    expect(deductUserCreditsMock).toHaveBeenCalledTimes(1);
    expect(deductUserCreditsMock).toHaveBeenCalledWith(
      admin,
      'user-1',
      12,
      'video_generation',
      'video-job-1',
      expect.objectContaining({ model: 'motion-video', duration: undefined, resolution: undefined })
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(row.meta).toMatchObject({
      debitSplit: { fromDaily: 2, fromPermanent: 10 },
      videoSubmitState: 'submitted',
      upstreamTaskId: 'upstream-task-recovered'
    });
  });

  it('keeps an ambiguous wallet result recoverable and never reaches the paid POST', async () => {
    const job = awaitingDebitJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn();
    deductUserCreditsMock.mockRejectedValue(new TypeError('database transport interrupted'));

    await expect(processVideoPendingSubmit(admin, job, env, { submit })).rejects.toThrow(
      'database transport interrupted'
    );
    expect(row.meta).toMatchObject({ videoSubmitState: 'awaiting_debit' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('fails an uncharged awaiting job when its balance is no longer sufficient', async () => {
    const job = awaitingDebitJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn();
    deductUserCreditsMock.mockRejectedValue(new Error('insufficient_credits'));

    expect(await processVideoPendingSubmit(admin, job, env, { submit })).toBe('processed');
    expect(row.status).toBe('failed');
    expect(row.meta).toMatchObject({
      videoSubmitState: 'failed',
      refundState: 'not_required'
    });
    expect(submit).not.toHaveBeenCalled();
    expect(refundUserCreditsMock).not.toHaveBeenCalled();
  });

  it('atomically claims a queued job and sends one paid POST', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const submit = vi.fn(async (key: string, _base: string | undefined, params: Record<string, unknown>) => {
      expect(key).toBe('video-secret-7');
      expect(params.idempotencyKey).toBe('prompt-hub-video:video-job-1');
      await waiting;
      return {
        id: 'upstream-task-1',
        status: 'queued' as const,
        progress: 0,
        errorCode: null,
        errorMessage: null,
        videoUrl: null
      };
    });

    const first = processVideoPendingSubmit(admin, job, env, { submit, attemptId: () => 'attempt-1' });
    const second = processVideoPendingSubmit(admin, job, env, { submit, attemptId: () => 'attempt-2' });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await second).toBe('ignored');
    release();
    expect(await first).toBe('processed');
    expect(row.meta).toMatchObject({
      videoSubmitState: 'submitted',
      videoSubmitAttempts: 1,
      upstreamTaskId: 'upstream-task-1'
    });
  });

  it('records an ambiguous transport result without refunding or reopening submission', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    expect(await processVideoPendingSubmit(admin, job, env, { submit, attemptId: () => 'attempt-1' }))
      .toBe('processed');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(row.meta).toMatchObject({
      videoSubmitState: 'outcome_unknown',
      videoSubmitError: 'fetch failed'
    });
    expect(videoProviderQueueAction(row)).toBe('ignore');
    expect(await processVideoPendingSubmit(admin, clone(row), env, { submit })).toBe('ignored');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(refundUserCreditsMock).not.toHaveBeenCalled();
  });

  it('checkpoints an explicit uncertain submit result without refunding or reopening submission', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn().mockResolvedValue({
      id: 'upstream-task-uncertain',
      status: 'unknown' as const,
      progress: 30,
      errorCode: 'result_uncertain',
      errorMessage: 'the accepted task outcome is still being reconciled',
      videoUrl: null
    });

    expect(await processVideoPendingSubmit(admin, job, env, { submit, attemptId: () => 'attempt-1' }))
      .toBe('processed');
    expect(row.status).toBe('processing');
    expect(row.meta).toMatchObject({
      upstreamTaskId: 'upstream-task-uncertain',
      progress: 30,
      videoSubmitState: 'submitted',
      videoResultState: 'result_uncertain',
      videoResultErrorCode: 'result_uncertain'
    });
    expect(row.meta?.videoResultUncertainAt).toBeTruthy();
    expect(videoProviderQueueAction(row)).toBe('ignore');
    expect(await processVideoPendingSubmit(admin, clone(row), env, { submit })).toBe('ignored');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(refundUserCreditsMock).not.toHaveBeenCalled();
  });

  it('finalizes an immediate completion through the shared result state machine', async () => {
    const job = queuedJob();
    job.meta = {
      ...(job.meta || {}),
      billingUnit: 'second',
      billingUnitCredits: 2,
      requestedDuration: 6
    };
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn().mockResolvedValue({
      id: 'upstream-task-completed',
      status: 'completed' as const,
      progress: 100,
      errorCode: null,
      errorMessage: null,
      videoUrl: 'https://video.test/result.mp4',
      billedDurationSeconds: 5
    });

    expect(await processVideoPendingSubmit(
      admin,
      job,
      env,
      { submit, attemptId: () => 'attempt-completed' }
    )).toBe('processed');

    expect(submit).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({
      status: 'completed',
      credits_charged: 10,
      meta: {
        upstreamTaskId: 'upstream-task-completed',
        videoSubmitState: 'completed',
        actualDurationSeconds: 5,
        billingReconciliationState: 'refunded',
        billingRefundCredits: 2
      }
    });
    expect(refundUserCreditsMock).toHaveBeenCalledWith(
      admin,
      'user-1',
      2,
      'video_duration_adjustment_refund',
      'video-job-1:duration-adjustment',
      { fromDaily: 2, fromPermanent: 0 },
      expect.objectContaining({ requestedDuration: 6, billedDurationSeconds: 5 })
    );
  });

  it('retries and verifies the task checkpoint without repeating the paid POST', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job, {
      failSubmittedCheckpointUpdates: 1,
      failCheckpointReads: 1
    });
    const checkpointDelay = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({
      id: 'upstream-task-after-checkpoint-retry',
      status: 'queued' as const,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      videoUrl: null
    });

    expect(await processVideoPendingSubmit(
      admin,
      job,
      env,
      { submit, attemptId: () => 'attempt-1', checkpointDelay }
    )).toBe('processed');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(checkpointDelay).toHaveBeenCalledTimes(1);
    expect(row.meta).toMatchObject({
      videoSubmitState: 'submitted',
      upstreamTaskId: 'upstream-task-after-checkpoint-retry'
    });
  });

  it('keeps the running fence and surfaces an unconfirmed task checkpoint', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job, {
      failSubmittedCheckpointUpdates: 3,
      failCheckpointReads: 3
    });
    const checkpointDelay = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({
      id: 'upstream-task-unconfirmed',
      status: 'queued' as const,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      videoUrl: null
    });

    await expect(processVideoPendingSubmit(
      admin,
      job,
      env,
      { submit, attemptId: () => 'attempt-1', checkpointDelay }
    )).rejects.toThrow('checkpoint verification unavailable');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(checkpointDelay).toHaveBeenCalledTimes(2);
    expect(row.meta).toMatchObject({
      videoSubmitState: 'running',
      videoSubmitAttemptId: 'attempt-1'
    });
    expect(videoProviderQueueAction(row)).toBe('ignore');
    expect(await processVideoPendingSubmit(admin, clone(row), env, { submit })).toBe('ignored');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(refundUserCreditsMock).not.toHaveBeenCalled();
  });

  it('persists a deterministic rejection and settles its refund once', async () => {
    const job = queuedJob();
    const { admin, row } = fakeAdmin(job);
    const submit = vi.fn().mockRejectedValue(new ApiError(400, 'UPSTREAM_ERROR', 'invalid duration'));

    expect(await processVideoPendingSubmit(admin, job, env, { submit, attemptId: () => 'attempt-1' }))
      .toBe('processed');
    expect(row.status).toBe('failed');
    expect(row.meta).toMatchObject({
      videoSubmitState: 'failed',
      refundState: 'refunded',
      videoSubmitError: 'invalid duration'
    });
    expect(refundUserCreditsMock).toHaveBeenCalledTimes(1);
    expect(refundUserCreditsMock).toHaveBeenCalledWith(
      admin,
      'user-1',
      12,
      'video_generation_refund',
      'video-job-1',
      { fromDaily: 2, fromPermanent: 10 },
      { model: 'motion-video', phase: 'submit_error' }
    );

    expect(await processVideoPendingSubmit(admin, clone(row), env, { submit })).toBe('ignored');
    expect(refundUserCreditsMock).toHaveBeenCalledTimes(1);
  });
});
