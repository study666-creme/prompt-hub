import type { Env } from '../env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  upstreamBindingsFromEnv: vi.fn(),
  processFastProviderPendingSubmit: vi.fn(),
  fastSubmitParamsFromJob: vi.fn(() => ({
    upstreamModel: 'gpt-image-2',
    prompt: 'test prompt',
    resolution: '1k',
    quality: 'medium'
  }))
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

vi.mock('./image-upstream', () => ({
  upstreamBindingsFromEnv: mocks.upstreamBindingsFromEnv
}));

vi.mock('./fast-provider-submit', () => ({
  processFastProviderPendingSubmit: mocks.processFastProviderPendingSubmit,
  fastSubmitParamsFromJob: mocks.fastSubmitParamsFromJob
}));

import { drainFastProviderPendingSubmits } from './fast-provider-drain';

describe('fast provider pending submit drain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters unconfigured providers before the limit so old rows cannot starve live routes', async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const queuedJob = {
      id: 'job-1',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 1,
      result_image_url: null,
      error_message: null,
      meta: {
        provider: 'newapi',
        fastSubmitState: 'queued',
        upstreamModel: 'gpt-image-2'
      },
      created_at: '2026-07-22T00:00:00.000Z'
    };
    const query = {
      select: vi.fn((...args: unknown[]) => {
        calls.push(['select', ...args]);
        return query;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push(['eq', ...args]);
        return query;
      }),
      filter: vi.fn((...args: unknown[]) => {
        calls.push(['filter', ...args]);
        return query;
      }),
      in: vi.fn((...args: unknown[]) => {
        calls.push(['in', ...args]);
        return query;
      }),
      order: vi.fn((...args: unknown[]) => {
        calls.push(['order', ...args]);
        return query;
      }),
      limit: vi.fn(async (...args: unknown[]) => {
        calls.push(['limit', ...args]);
        return { data: [queuedJob], error: null };
      }),
      gte: vi.fn((...args: unknown[]) => {
        calls.push(['gte', ...args]);
        return query;
      })
    };
    const admin = {
      from: vi.fn((table: string) => {
        calls.push(['from', table]);
        return query;
      })
    };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.upstreamBindingsFromEnv.mockReturnValue({
      newapiKey: 'newapi-key'
    });
    mocks.processFastProviderPendingSubmit.mockResolvedValue(true);

    const result = await drainFastProviderPendingSubmits(
      {} as Env,
      { awaitSubmit: true, maxSubmit: 4 }
    );

    expect(calls).toEqual([
      ['from', 'generation_requests'],
      ['select', '*'],
      ['eq', 'status', 'processing'],
      ['filter', 'meta->>fastSubmitState', 'eq', 'queued'],
      ['in', 'meta->>provider', ['newapi']],
      ['order', 'created_at', { ascending: true }],
      ['limit', 80]
    ]);
    expect(query.gte).not.toHaveBeenCalled();
    expect(mocks.processFastProviderPendingSubmit).toHaveBeenCalledOnce();
    expect(mocks.processFastProviderPendingSubmit).toHaveBeenCalledWith(
      admin,
      'user-1',
      queuedJob,
      expect.objectContaining({ newapiKey: 'newapi-key' }),
      'newapi',
      expect.any(Object),
      expect.any(Object)
    );
    expect(result).toEqual({ submitted: 1, queued: 1 });
  });

});
