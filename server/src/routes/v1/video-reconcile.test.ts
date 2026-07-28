import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import * as newApiVideo from '../../lib/newapi-video';
import { drainNewApiVideoJobs, reconcileNewApiVideoJob } from './video';

type TestRow = Record<string, unknown>;

function testRow(): TestRow {
  return {
    id: 'job_1',
    user_id: 'user_1',
    status: 'processing',
    credits_charged: 35,
    error_message: null,
    meta: {
      mediaType: 'video',
      model: 'veo-fast',
      upstreamTaskId: 'task_1',
      credits: 35,
      debitSplit: { fromDaily: 5, fromPermanent: 30 },
      progress: 30
    }
  };
}

function memoryAdmin(initial: TestRow) {
  let current = { ...initial };
  const from = vi.fn(() => {
    let updatePayload: TestRow | null = null;
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.update = vi.fn((payload: TestRow) => {
      updatePayload = payload;
      return builder;
    });
    builder.eq = vi.fn((field: string, value: unknown) => {
      filters.push([field, value]);
      return builder;
    });
    builder.contains = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(async () => ({
      data: filters.every(([field, value]) => current[field] === value) ? [{ ...current }] : [],
      error: null
    }));
    builder.maybeSingle = vi.fn(async () => {
      const matches = filters.every(([field, value]) => current[field] === value);
      if (!matches) return { data: null, error: null };
      if (updatePayload) current = { ...current, ...updatePayload };
      return { data: { ...current }, error: null };
    });
    return builder;
  });
  return {
    admin: { from } as unknown as SupabaseClient,
    row: () => current
  };
}

const env = {
  NEWAPI_API_KEY: 'master-key',
  NEWAPI_API_BASE_URL: 'https://newapi.test'
} as Env;

describe('video task reconciliation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('settles UNKNOWN as failed and refunds exactly once across concurrent GET/cron checks', async () => {
    const store = memoryAdmin(testRow());
    const fetchTask = vi.fn(async () => ({
      id: 'task_1',
      status: 'unknown' as const,
      progress: 30,
      errorMessage: null,
      videoUrl: null
    }));
    const refundCredits = vi.fn(async () => undefined);

    const results = await Promise.all([
      reconcileNewApiVideoJob(store.admin, env, testRow(), { fetchTask, refundCredits }),
      reconcileNewApiVideoJob(store.admin, env, testRow(), { fetchTask, refundCredits })
    ]);

    expect(results.every(row => row.status === 'failed')).toBe(true);
    expect(refundCredits).toHaveBeenCalledOnce();
    expect(refundCredits).toHaveBeenCalledWith(
      store.admin,
      'user_1',
      35,
      'video_generation_refund',
      'job_1',
      { fromDaily: 5, fromPermanent: 30 },
      { model: 'veo-fast', phase: 'upstream_unknown' }
    );
    expect(store.row()).toMatchObject({
      status: 'failed',
      error_message: expect.stringContaining('积分已退还'),
      meta: { refundState: 'refunded', upstreamTerminalStatus: 'unknown' }
    });
    expect(fetchTask).toHaveBeenCalledTimes(2);
    expect(fetchTask).toHaveBeenCalledWith('master-key', 'https://newapi.test', 'task_1');
  });

  it('re-reads the stored winner when a completed CAS loses to another terminal update', async () => {
    const store = memoryAdmin(testRow());
    const refundCredits = vi.fn(async () => undefined);
    const completedTask = vi.fn(async () => ({
      id: 'task_1',
      status: 'completed' as const,
      progress: 100,
      errorMessage: null,
      videoUrl: 'https://video.test/out.mp4'
    }));
    const unknownTask = vi.fn(async () => ({
      id: 'task_1',
      status: 'unknown' as const,
      progress: 30,
      errorMessage: null,
      videoUrl: null
    }));

    const [completed, casLoser] = await Promise.all([
      reconcileNewApiVideoJob(store.admin, env, testRow(), { fetchTask: completedTask, refundCredits }),
      reconcileNewApiVideoJob(store.admin, env, testRow(), { fetchTask: unknownTask, refundCredits })
    ]);

    expect(completed.status).toBe('completed');
    expect(casLoser.status).toBe('completed');
    expect(store.row().status).toBe('completed');
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it('persists an accurate refund_failed state when the automatic refund throws', async () => {
    const store = memoryAdmin(testRow());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refundCredits = vi.fn(async () => {
      throw new Error('ledger unavailable');
    });

    const result = await reconcileNewApiVideoJob(store.admin, env, testRow(), {
      fetchTask: async () => ({
        id: 'task_1',
        status: 'unknown',
        progress: 30,
        errorMessage: null,
        videoUrl: null
      }),
      refundCredits
    });

    expect(refundCredits).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'failed',
      error_message: expect.stringContaining('自动退还积分失败'),
      meta: { refundState: 'refund_failed', upstreamTerminalStatus: 'unknown' }
    });
  });

  it('lets the cron drain settle an existing task without submitting another video POST', async () => {
    const store = memoryAdmin(testRow());
    const submitSpy = vi.spyOn(newApiVideo, 'submitNewApiVideo');
    const fetchTask = vi.fn(async () => ({
      id: 'task_1',
      status: 'unknown' as const,
      progress: 30,
      errorMessage: null,
      videoUrl: null
    }));
    const refundCredits = vi.fn(async () => undefined);

    const result = await drainNewApiVideoJobs(env, {
      admin: store.admin,
      maxJobs: 1,
      fetchTask,
      refundCredits
    });

    expect(result).toEqual({ checked: 1, settled: 1 });
    expect(fetchTask).toHaveBeenCalledOnce();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(refundCredits).toHaveBeenCalledOnce();
  });
});
