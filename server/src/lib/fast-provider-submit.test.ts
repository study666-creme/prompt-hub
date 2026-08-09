import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  archiveGenerationResultUrls: vi.fn()
}));

vi.mock('./image-archive', () => ({
  archiveGenerationResultUrls: mocks.archiveGenerationResultUrls
}));

import { processFastProviderPendingSubmit } from './fast-provider-submit';
import type { JobRow } from './generation-jobs';

describe('fast provider submit claim', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.archiveGenerationResultUrls.mockReset();
  });

  it('surfaces database claim failures without calling the image service', async () => {
    const claimQuery = {
      update: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'database unavailable' } }))
    };
    claimQuery.update.mockReturnValue(claimQuery);
    claimQuery.eq.mockReturnValue(claimQuery);
    claimQuery.contains.mockReturnValue(claimQuery);
    claimQuery.select.mockReturnValue(claimQuery);
    const admin = { from: vi.fn(() => claimQuery) };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const job: JobRow = {
      id: 'job-claim-unit',
      user_id: 'user-claim-unit',
      credits_charged: 8,
      status: 'processing',
      prompt: 'product photo',
      resolution: '4k',
      quality: 'high',
      result_image_url: null,
      error_message: null,
      meta: {
        provider: 'newapi',
        upstreamModel: 'image2-A',
        fastSubmitState: 'queued'
      },
      created_at: new Date().toISOString()
    };

    await expect(processFastProviderPendingSubmit(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'image2-A',
        prompt: 'product photo',
        resolution: '4k',
        quality: 'high',
        idempotencyKey: job.id
      }
    )).rejects.toThrow('fast_submit_claim_failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reclaims a running New API submission with the same persisted idempotency key', async () => {
    const runningMeta = {
      provider: 'newapi',
      upstreamModel: 'image2-A',
      fastSubmitState: 'running',
      fastSubmitLeaseId: 'interrupted-lease',
      fastSubmitAttempt: 1
    };
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { meta: { ...runningMeta, fastSubmitState: 'running', fastSubmitLeaseId: 'recovered-lease' } },
        error: null
      }))
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.contains.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ data: [{ url: 'https://temporary.test/replayed.png' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchMock);
    mocks.archiveGenerationResultUrls.mockResolvedValue(['https://archive.test/replayed.png']);
    const job: JobRow = {
      id: 'job-redelivery-unit',
      user_id: 'user-redelivery-unit',
      credits_charged: 8,
      status: 'processing',
      prompt: 'product photo',
      resolution: '4k',
      quality: 'high',
      result_image_url: null,
      error_message: null,
      meta: runningMeta,
      created_at: new Date().toISOString()
    };

    await expect(processFastProviderPendingSubmit(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'image2-A',
        prompt: 'product photo',
        resolution: '4k',
        quality: 'high',
        idempotencyKey: job.id
      },
      undefined,
      { reclaimRunning: true }
    )).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(job.id);
    const patches = query.update.mock.calls.map(([value]) => value as Record<string, unknown>);
    expect(patches[0]).toMatchObject({
      meta: {
        fastSubmitState: 'running',
        fastSubmitAttempt: 2,
        fastSubmitRecoveredAt: expect.any(String)
      }
    });
    expect(patches.at(-1)).toMatchObject({
      status: 'completed',
      result_image_url: 'https://archive.test/replayed.png'
    });
  });

  it('keeps an accepted-looking 5xx submission recoverable without refunding it', async () => {
    const queuedMeta = {
      provider: 'newapi',
      upstreamModel: 'image2-A',
      fastSubmitState: 'queued'
    };
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: {
          meta: {
            ...queuedMeta,
            fastSubmitState: 'running',
            fastSubmitAttempt: 1,
            fastSubmitLeaseId: 'lease-1'
          }
        },
        error: null
      }))
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.contains.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'GATEWAY_TIMEOUT', message: 'request timed out' } }),
      { status: 504, headers: { 'content-type': 'application/json' } }
    )));
    const job: JobRow = {
      id: 'job-uncertain-unit',
      user_id: 'user-uncertain-unit',
      credits_charged: 5,
      status: 'processing',
      prompt: 'product photo',
      resolution: '2k',
      quality: 'standard',
      result_image_url: null,
      error_message: null,
      meta: queuedMeta,
      created_at: new Date().toISOString()
    };

    await expect(processFastProviderPendingSubmit(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'image2-A',
        prompt: 'product photo',
        resolution: '2k',
        quality: 'standard',
        idempotencyKey: job.id
      }
    )).resolves.toBe(true);

    const patches = query.update.mock.calls.map(([value]) => value as Record<string, unknown>);
    expect(patches).not.toContainEqual(expect.objectContaining({ status: 'failed' }));
    expect(patches.at(-1)).toMatchObject({
      meta: {
        fastSubmitState: 'uncertain',
        fastSubmitUncertain: true,
        fastSubmitAttempt: 1
      }
    });
    expect((patches.at(-1)?.meta as Record<string, unknown>).fastSubmitRetryAt).toBeNull();
    expect(admin.from).toHaveBeenCalledTimes(2);
  });

  it('never re-submits or completes an accepted immediate result when archival fails', async () => {
    const queuedMeta = {
      provider: 'newapi',
      upstreamModel: 'image2-A',
      fastSubmitState: 'queued'
    };
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: {
          meta: {
            ...queuedMeta,
            fastSubmitState: 'running',
            fastSubmitAttempt: 1,
            fastSubmitLeaseId: 'lease-archive'
          }
        },
        error: null
      }))
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.contains.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ url: 'https://temporary.test/result.png' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.archiveGenerationResultUrls.mockRejectedValue(new Error('storage unavailable'));
    const job: JobRow = {
      id: 'job-archive-pending-unit',
      user_id: 'user-archive-pending-unit',
      credits_charged: 8,
      status: 'processing',
      prompt: 'product photo',
      resolution: '4k',
      quality: 'high',
      result_image_url: null,
      error_message: null,
      meta: queuedMeta,
      created_at: new Date().toISOString()
    };

    await expect(processFastProviderPendingSubmit(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      'newapi',
      {
        upstreamModel: 'image2-A',
        prompt: 'product photo',
        resolution: '4k',
        quality: 'high',
        idempotencyKey: job.id
      }
    )).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const patches = query.update.mock.calls.map(([value]) => value as Record<string, unknown>);
    expect(patches).not.toContainEqual(expect.objectContaining({ status: 'completed' }));
    expect(patches.at(-1)).toMatchObject({
      meta: {
        fastSubmitState: 'done',
        syncImageUrl: 'https://temporary.test/result.png',
        archivePending: true
      }
    });
  });
});
