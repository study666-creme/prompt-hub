import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  fastProviderQueueAction,
  persistAndEnqueueFastProviderJob
} from './fast-provider-queue';

describe('durable image submission queue', () => {
  it('submits only jobs that have never started dispatch', () => {
    expect(fastProviderQueueAction({ fastSubmitState: 'queued' })).toBe('submit');
  });

  it('never mutates or reopens running requests during queue redelivery', () => {
    expect(fastProviderQueueAction({
      fastSubmitState: 'running',
      fastSubmitStartedAt: new Date().toISOString()
    })).toBe('retry');
    expect(fastProviderQueueAction({
      fastSubmitState: 'running',
      fastSubmitStartedAt: '2020-01-01T00:00:00.000Z',
      upstreamRequestId: 'req_123'
    })).toBe('retry');
    expect(fastProviderQueueAction({
      fastSubmitState: 'running',
      fastSubmitStartedAt: '2020-01-01T00:00:00.000Z',
      upstreamTaskId: 'task_123'
    })).toBe('retry');
  });

  it('retries local archival without issuing another generation request', () => {
    expect(fastProviderQueueAction({
      fastSubmitState: 'recovery_required',
      upstreamResultUrls: ['https://image.test/result.png']
    })).toBe('recover_archive');
    expect(fastProviderQueueAction({
      fastSubmitState: 'recovery_required'
    })).toBe('mark_outcome_unknown');
  });

  it('ignores terminal states', () => {
    expect(fastProviderQueueAction({ fastSubmitState: 'done' })).toBe('ignore');
    expect(fastProviderQueueAction({ fastSubmitState: 'failed' })).toBe('ignore');
  });

  it('does not enqueue before the queued correlation state is persisted', async () => {
    const persistenceError = { message: 'database unavailable' };
    const query = {
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: persistenceError }))
    };
    const admin = {
      from: vi.fn(() => ({ update: vi.fn(() => query) }))
    } as unknown as SupabaseClient;
    const queue = { send: vi.fn(async () => undefined) };

    await expect(persistAndEnqueueFastProviderJob(
      admin,
      queue,
      { jobId: 'job-1', userId: 'user-1' },
      { fastSubmitState: 'queued', upstreamClientRequestId: 'job-1' }
    )).rejects.toBe(persistenceError);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('keeps the durable queued row when queue delivery returns an ambiguous error', async () => {
    const query = {
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: 'job-2' }, error: null }))
    };
    const admin = {
      from: vi.fn(() => ({ update: vi.fn(() => query) }))
    } as unknown as SupabaseClient;
    const queueError = new Error('queue transport interrupted');
    const queue = { send: vi.fn(async () => { throw queueError; }) };

    await expect(persistAndEnqueueFastProviderJob(
      admin,
      queue,
      { jobId: 'job-2', userId: 'user-1' },
      { fastSubmitState: 'queued', upstreamClientRequestId: 'job-2' }
    )).resolves.toBe(false);
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it('verifies a persisted queued row when the update response omits its representation', async () => {
    const updateQuery = {
      eq: vi.fn(() => updateQuery),
      select: vi.fn(() => updateQuery),
      maybeSingle: vi.fn(async () => ({ data: null, error: null }))
    };
    const verifyQuery = {
      eq: vi.fn(() => verifyQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: 'job-3',
          status: 'processing',
          meta: { fastSubmitState: 'queued', upstreamClientRequestId: 'job-3' }
        },
        error: null
      }))
    };
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce({ update: vi.fn(() => updateQuery) })
        .mockReturnValueOnce({ select: vi.fn(() => verifyQuery) })
    } as unknown as SupabaseClient;
    const queue = { send: vi.fn(async () => undefined) };

    await expect(persistAndEnqueueFastProviderJob(
      admin,
      queue,
      { jobId: 'job-3', userId: 'user-1' },
      { fastSubmitState: 'queued', upstreamClientRequestId: 'job-3' }
    )).resolves.toBe(true);
    expect(queue.send).toHaveBeenCalledTimes(1);
  });
});
