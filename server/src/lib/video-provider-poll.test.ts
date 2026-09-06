import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import { ApiError } from './errors';
import type { NewApiVideoTask } from './newapi-video';
import { drainPendingVideoTasks, pollVideoProviderJob } from './video-provider-poll';
import type { VideoSubmissionJob } from './video-provider-submit';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn()
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

const now = new Date('2026-07-28T06:30:00.000Z');

function job(meta: Record<string, unknown> = {}): VideoSubmissionJob {
  return {
    id: 'video-job-1',
    user_id: 'user-1',
    status: 'processing',
    credits_charged: 35,
    created_at: '2026-07-28T05:15:00.000Z',
    meta: {
      mediaType: 'video',
      videoSubmitState: 'submitted',
      upstreamTaskId: 'task-1',
      routeChannelId: 85,
      progress: 30,
      ...meta
    }
  };
}

function memoryAdmin(initial: VideoSubmissionJob) {
  let current = structuredClone(initial);
  let pending: Record<string, unknown> | null = null;
  const query = {
    update(value: Record<string, unknown>) { pending = value; return query; },
    eq() { return query; },
    filter() { return query; },
    select() { return query; },
    async maybeSingle() {
      if (pending) current = { ...current, ...pending } as VideoSubmissionJob;
      pending = null;
      return { data: structuredClone(current), error: null };
    }
  };
  return {
    admin: { from: () => query } as unknown as SupabaseClient,
    row: () => structuredClone(current)
  };
}

function task(value: Partial<NewApiVideoTask>): NewApiVideoTask {
  return {
    id: 'task-1',
    status: 'processing',
    progress: 30,
    errorCode: null,
    errorMessage: null,
    videoUrl: null,
    ...value
  };
}

function drainAdmin(rows: VideoSubmissionJob[]) {
  const orderCalls: Array<[string, Record<string, unknown>]> = [];
  const current = rows.map(row => structuredClone(row));
  const admin = {
    from() {
      let pending: Record<string, unknown> | null = null;
      let selectedId = '';
      const query = {
        select() { return query; },
        update(value: Record<string, unknown>) { pending = value; return query; },
        eq(column: string, value: unknown) {
          if (column === 'id') selectedId = String(value);
          return query;
        },
        filter() { return query; },
        not() { return query; },
        gte() { return query; },
        order(column: string, options: Record<string, unknown>) {
          orderCalls.push([column, options]);
          return query;
        },
        async limit() { return { data: structuredClone(current), error: null }; },
        async maybeSingle() {
          const index = current.findIndex(row => row.id === selectedId);
          if (index < 0) return { data: null, error: null };
          if (pending) current[index] = { ...current[index], ...pending } as VideoSubmissionJob;
          return { data: structuredClone(current[index]), error: null };
        }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return { admin, orderCalls, rows: () => structuredClone(current) };
}

const env = {
  NEWAPI_API_KEY: 'image-key',
  NEWAPI_VIDEO_API_KEY: 'video-key',
  NEWAPI_API_BASE_URL: 'https://newapi.test'
} as Env;

describe('video provider background polling', () => {
  it('pins the persisted route and checkpoints an uncertain result once', async () => {
    const store = memoryAdmin(job());
    const fetchTask = vi.fn(async () => task({
      status: 'unknown',
      progress: 30,
      errorCode: 'result_uncertain',
      errorMessage: 'pending reconciliation'
    }));

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask,
      now: () => now
    })).resolves.toBe('unknown');

    expect(fetchTask).toHaveBeenCalledWith('video-key-85', 'https://newapi.test', 'task-1');
    expect(store.row().meta).toMatchObject({
      videoSubmitState: 'submitted',
      videoResultState: 'result_uncertain',
      videoResultErrorCode: 'result_uncertain',
      videoResultUncertainAt: now.toISOString(),
      videoLastPolledAt: now.toISOString(),
      videoNextPollAt: '2026-07-28T06:31:00.000Z'
    });
  });

  it('clears uncertainty when the same task returns to processing', async () => {
    const store = memoryAdmin(job({
      videoResultState: 'result_uncertain',
      videoResultErrorCode: 'result_uncertain',
      videoResultUncertainAt: '2026-07-28T06:00:00.000Z'
    }));

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask: async () => task({ status: 'processing', progress: 62 }),
      now: () => now
    })).resolves.toBe('processing');

    expect(store.row().meta).toMatchObject({ progress: 62, videoSubmitState: 'submitted' });
    expect(store.row().meta).not.toHaveProperty('videoResultState');
    expect(store.row().meta).not.toHaveProperty('videoResultUncertainAt');
  });

  it('starts a fresh not-found SLA after a task recovers and disappears again', async () => {
    const store = memoryAdmin(job());
    const firstMissingAt = new Date('2026-07-28T05:00:00.000Z');
    const recoveredAt = new Date('2026-07-28T05:30:00.000Z');
    const secondMissingAt = new Date('2026-07-28T06:30:00.000Z');
    const missing = async () => {
      throw new ApiError(404, 'UPSTREAM_ERROR', 'task not found');
    };

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask: missing,
      now: () => firstMissingAt
    })).resolves.toBe('not_found');
    expect(store.row().meta).toMatchObject({
      videoSubmitState: 'outcome_unknown',
      videoSubmitOutcomeUnknownAt: firstMissingAt.toISOString(),
      videoSubmitError: 'upstream_task_not_found'
    });

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask: async () => task({ status: 'processing', progress: 45 }),
      now: () => recoveredAt
    })).resolves.toBe('processing');
    expect(store.row().meta).not.toHaveProperty('videoSubmitOutcomeUnknownAt');
    expect(store.row().meta).not.toHaveProperty('videoSubmitError');

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask: missing,
      now: () => secondMissingAt
    })).resolves.toBe('not_found');
    expect((store.row().meta as Record<string, unknown>).videoSubmitOutcomeUnknownAt)
      .toBe(secondMissingAt.toISOString());
  });

  it('atomically completes a task without requiring an open browser', async () => {
    const store = memoryAdmin(job());

    await expect(pollVideoProviderJob(store.admin, store.row(), env, {
      fetchTask: async () => task({
        status: 'completed',
        progress: 100,
        videoUrl: 'https://media.example.test/video.mp4'
      }),
      now: () => now
    })).resolves.toBe('completed');

    expect(store.row()).toMatchObject({
      status: 'completed',
      completed_at: now.toISOString(),
      meta: {
        progress: 100,
        videoSubmitState: 'completed',
        resultUrl: 'https://media.example.test/video.mp4',
        billingReconciliationState: 'unverified'
      }
    });
  });

  it('asks the database for oldest due work so newer tasks cannot starve it', async () => {
    const old = job({
      upstreamTaskId: 'task-old',
      videoLastPolledAt: '2026-07-28T05:00:00.000Z',
      videoNextPollAt: '2026-07-28T05:01:00.000Z'
    });
    old.id = 'video-job-old';
    old.created_at = '2026-07-28T04:00:00.000Z';
    const recent = job({
      upstreamTaskId: 'task-recent',
      videoLastPolledAt: '2026-07-28T06:20:00.000Z',
      videoNextPollAt: '2026-07-28T06:21:00.000Z'
    });
    recent.id = 'video-job-recent';
    recent.created_at = '2026-07-28T06:00:00.000Z';
    const store = drainAdmin([recent, old]);
    mocks.createAdminClient.mockReturnValue(store.admin);
    const fetchTask = vi.fn(async (_key: string, _base: string | undefined, taskId: string) =>
      task({ id: taskId, status: 'processing', progress: 40 })
    );

    await expect(drainPendingVideoTasks(env, {
      maxPoll: 1,
      now: now.getTime(),
      fetchTask
    })).resolves.toEqual({ polled: 1, completed: 0, failed: 0, unknown: 0 });

    expect(store.orderCalls).toEqual([
      ['meta->>videoNextPollAt', { ascending: true, nullsFirst: true }],
      ['created_at', { ascending: true }]
    ]);
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(fetchTask.mock.calls[0]?.[2]).toBe('task-old');
    expect(store.rows().find(row => row.id === old.id)?.meta).toMatchObject({
      videoLastPolledAt: now.toISOString(),
      videoNextPollAt: '2026-07-28T06:31:00.000Z'
    });
  });
});
