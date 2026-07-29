import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processFastProviderPendingSubmit } from './fast-provider-submit';
import type { JobRow } from './generation-jobs';

const archiveMocks = vi.hoisted(() => ({
  archiveGenerationResultUrls: vi.fn()
}));

vi.mock('./image-archive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./image-archive')>()),
  archiveGenerationResultUrls: archiveMocks.archiveGenerationResultUrls
}));

type QueryResult = { data: unknown; error: unknown };

function updateAdmin(results: QueryResult[]) {
  const pending = [...results];
  const updates: Record<string, unknown>[] = [];
  const filters: unknown[][][] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe('generation_requests');
      return {
        update(values: Record<string, unknown>) {
          updates.push(values);
          const updateFilters: unknown[][] = [];
          filters.push(updateFilters);
          const result = pending.shift() || { data: null, error: null };
          const query = {
            eq: vi.fn(() => query),
            filter: vi.fn((...args: unknown[]) => {
              updateFilters.push(args);
              return query;
            }),
            select: vi.fn(() => query),
            maybeSingle: vi.fn(async () => result),
            then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve(result).then(resolve, reject);
            }
          };
          return query;
        }
      };
    }
  };
  return { admin: admin as unknown as SupabaseClient, updates, filters };
}

afterEach(() => {
  vi.unstubAllGlobals();
  archiveMocks.archiveGenerationResultUrls.mockReset();
});

describe('fast provider submission recovery', () => {
  it('submits once when a successful claim omits its update representation', async () => {
    let claimedMeta: Record<string, unknown> = {};
    const updateQuery = {
      eq: vi.fn(() => updateQuery),
      filter: vi.fn(() => updateQuery),
      select: vi.fn(() => updateQuery),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
    };
    const verifyQuery = {
      eq: vi.fn(() => verifyQuery),
      filter: vi.fn(() => verifyQuery),
      maybeSingle: vi.fn(async () => ({ data: { meta: claimedMeta }, error: null }))
    };
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce({
          update: vi.fn((values: Record<string, unknown>) => {
            claimedMeta = values.meta as Record<string, unknown>;
            return updateQuery;
          })
        })
        .mockReturnValueOnce({ select: vi.fn(() => verifyQuery) })
        .mockReturnValue({ update: vi.fn(() => updateQuery) })
    } as unknown as SupabaseClient;
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ data: { task_id: 'upstream-task-claim-readback', status: 'queued' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchMock);
    const job = {
      id: 'job-claim-readback',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 10,
      result_image_url: null,
      error_message: null,
      meta: { provider: 'newapi', fastSubmitState: 'queued' },
      created_at: '2026-01-01T00:00:00.000Z'
    } as JobRow;

    await expect(processFastProviderPendingSubmit(
      admin,
      'user-1',
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'gpt-image-2',
        prompt: 'apple',
        resolution: '1k',
        quality: 'standard'
      }
    )).resolves.toBe(true);

    expect(verifyQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('guards request-id and completion checkpoints with the active submit attempt', async () => {
    const runningMeta = {
      provider: 'newapi',
      fastSubmitState: 'running',
      fastSubmitAttemptId: 'attempt-3',
      upstreamClientRequestId: 'job-3'
    };
    const { admin, updates, filters } = updateAdmin([
      { data: { meta: runningMeta }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: { task_id: 'upstream-task-3', status: 'queued' } }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'request-3'
        }
      }
    )));
    const job = {
      id: 'job-3',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 10,
      result_image_url: null,
      error_message: null,
      meta: { provider: 'newapi', fastSubmitState: 'queued' },
      created_at: '2026-01-01T00:00:00.000Z'
    } as JobRow;

    await expect(processFastProviderPendingSubmit(
      admin,
      'user-1',
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'gpt-image-2',
        prompt: 'apple',
        resolution: '1k',
        quality: 'standard'
      }
    )).resolves.toBe(true);

    expect(updates[0]).toMatchObject({
      meta: {
        fastSubmitState: 'running',
        fastSubmitAttemptId: expect.any(String)
      }
    });
    expect(filters[1]).toEqual([
      ['meta->>fastSubmitState', 'eq', 'running'],
      ['meta->>fastSubmitAttemptId', 'eq', 'attempt-3']
    ]);
    expect(filters[2]).toEqual([
      ['meta->>fastSubmitState', 'eq', 'running'],
      ['meta->>fastSubmitAttemptId', 'eq', 'attempt-3']
    ]);
  });

  it('keeps the queue delivery retryable when recovery state cannot be checkpointed', async () => {
    const runningMeta = {
      provider: 'newapi',
      fastSubmitState: 'running',
      upstreamClientRequestId: 'job-1'
    };
    const recoveryError = { message: 'checkpoint unavailable' };
    const { admin, updates } = updateAdmin([
      { data: { meta: runningMeta }, error: null },
      { data: null, error: recoveryError }
    ]);
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection closed after dispatch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const job = {
      id: 'job-1',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 10,
      result_image_url: null,
      error_message: null,
      meta: { provider: 'newapi', fastSubmitState: 'queued' },
      created_at: '2026-01-01T00:00:00.000Z'
    } as JobRow;

    const processed = await processFastProviderPendingSubmit(
      admin,
      'user-1',
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'gpt-image-2',
        prompt: 'apple',
        resolution: '1k',
        quality: 'standard'
      }
    );

    expect(processed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
      meta: {
        fastSubmitState: 'outcome_unknown',
        fastSubmitError: 'upstream_outcome_unknown',
        refunded: false
      }
    });
  });

  it('keeps a returned task id when its first database checkpoint fails', async () => {
    const runningMeta = {
      provider: 'newapi',
      fastSubmitState: 'running',
      upstreamClientRequestId: 'job-2'
    };
    const { admin, updates } = updateAdmin([
      { data: { meta: runningMeta }, error: null },
      { data: null, error: { message: 'first checkpoint failed' } },
      { data: null, error: null }
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: { task_id: 'upstream-task-2', status: 'queued' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )));
    const job = {
      id: 'job-2',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 10,
      result_image_url: null,
      error_message: null,
      meta: { provider: 'newapi', fastSubmitState: 'queued' },
      created_at: '2026-01-01T00:00:00.000Z'
    } as JobRow;

    const processed = await processFastProviderPendingSubmit(
      admin,
      'user-1',
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'gpt-image-2',
        prompt: 'apple',
        resolution: '1k',
        quality: 'standard'
      }
    );

    expect(processed).toBe(true);
    expect(updates).toHaveLength(3);
    expect(updates[2]).toMatchObject({
      meta: {
        upstreamTaskId: 'upstream-task-2',
        fastSubmitState: 'recovery_required',
        refunded: false
      }
    });
  });

  it('keeps the queue delivery retryable when a returned image cannot be archived', async () => {
    const runningMeta = {
      provider: 'newapi',
      fastSubmitState: 'running',
      upstreamClientRequestId: 'job-3'
    };
    const { admin, updates } = updateAdmin([
      { data: { meta: runningMeta }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    archiveMocks.archiveGenerationResultUrls.mockRejectedValueOnce(new Error('storage unavailable'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: [{ url: 'https://image.test/result.png' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )));
    const job = {
      id: 'job-3',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 10,
      result_image_url: null,
      error_message: null,
      meta: { provider: 'newapi', fastSubmitState: 'queued' },
      created_at: '2026-01-01T00:00:00.000Z'
    } as JobRow;

    const processed = await processFastProviderPendingSubmit(
      admin,
      'user-1',
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'gpt-image-2',
        prompt: 'apple',
        resolution: '1k',
        quality: 'standard'
      }
    );

    expect(processed).toBe(false);
    expect(archiveMocks.archiveGenerationResultUrls).toHaveBeenCalledWith(
      admin,
      'user-1',
      'job-3',
      ['https://image.test/result.png'],
      undefined
    );
    expect(updates).toHaveLength(3);
    expect(updates[1]).toMatchObject({
      meta: {
        fastSubmitState: 'archiving',
        upstreamResultUrls: ['https://image.test/result.png']
      }
    });
    expect(updates[2]).toMatchObject({
      meta: {
        fastSubmitState: 'recovery_required',
        upstreamResultUrls: ['https://image.test/result.png'],
        refunded: false
      }
    });
  });
});
