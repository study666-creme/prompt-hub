import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollAndUpdateJob, type JobRow } from './generation-jobs';

const archiveMocks = vi.hoisted(() => ({
  archiveGenerationResultUrls: vi.fn()
}));
const mediaMocks = vi.hoisted(() => ({
  findFirstExistingStoragePath: vi.fn()
}));
const fastSubmitMocks = vi.hoisted(() => ({
  processFastProviderPendingSubmit: vi.fn(),
  fastSubmitParamsFromJob: vi.fn(() => ({
    upstreamModel: 'gpt-image-2',
    prompt: 'queued prompt',
    resolution: '1k',
    quality: 'medium'
  }))
}));

vi.mock('./image-archive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./image-archive')>()),
  archiveGenerationResultUrls: archiveMocks.archiveGenerationResultUrls
}));

vi.mock('./media-cdn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./media-cdn')>()),
  findFirstExistingStoragePath: mediaMocks.findFirstExistingStoragePath
}));

vi.mock('./fast-provider-submit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fast-provider-submit')>()),
  processFastProviderPendingSubmit: fastSubmitMocks.processFastProviderPendingSubmit,
  fastSubmitParamsFromJob: fastSubmitMocks.fastSubmitParamsFromJob
}));

function updateAdmin() {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe('generation_requests');
      return {
        update(values: Record<string, unknown>) {
          updates.push(values);
          const result = { data: null, error: null };
          const query = {
            eq: vi.fn(() => query),
            then(resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve(result).then(resolve, reject);
            }
          };
          return query;
        }
      };
    }
  };
  return { admin: admin as unknown as SupabaseClient, updates };
}

function recoveryJob(): JobRow {
  return {
    id: 'job-recovery-1',
    user_id: 'user-1',
    status: 'processing',
    credits_charged: 10,
    result_image_url: null,
    error_message: null,
    meta: {
      provider: 'newapi',
      fastSubmitState: 'recovery_required',
      upstreamTaskId: 'upstream-task-1',
      upstreamResultUrls: ['https://image.test/result.png']
    },
    created_at: new Date().toISOString()
  };
}

function queuedJob(): JobRow {
  return {
    id: 'job-queued-1',
    user_id: 'user-1',
    status: 'processing',
    credits_charged: 10,
    result_image_url: null,
    error_message: null,
    meta: {
      provider: 'newapi',
      fastSubmitState: 'queued',
      upstreamModel: 'gpt-image-2'
    },
    created_at: new Date().toISOString()
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  archiveMocks.archiveGenerationResultUrls.mockReset();
  mediaMocks.findFirstExistingStoragePath.mockReset();
  fastSubmitMocks.processFastProviderPendingSubmit.mockReset();
  fastSubmitMocks.fastSubmitParamsFromJob.mockClear();
});

describe('pollAndUpdateJob fast-provider archive recovery', () => {
  it('archives persisted result URLs before polling the upstream task id', async () => {
    const { admin, updates } = updateAdmin();
    archiveMocks.archiveGenerationResultUrls.mockResolvedValueOnce([
      'storage://card-images/user-1/generated/job-recovery-1.png'
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollAndUpdateJob(
      admin,
      'user-1',
      recoveryJob(),
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      undefined,
      { quick: true }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'completed',
      imageUrl: 'storage://card-images/user-1/generated/job-recovery-1.png',
      refunded: false
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'completed',
      result_image_url: 'storage://card-images/user-1/generated/job-recovery-1.png',
      meta: {
        fastSubmitState: 'done',
        syncImageUrl: 'storage://card-images/user-1/generated/job-recovery-1.png'
      }
    });
    expect((updates[0].meta as Record<string, unknown>).upstreamResultUrls).toBeUndefined();
  });

  it('stays processing instead of polling when local archival is temporarily unavailable', async () => {
    const { admin, updates } = updateAdmin();
    archiveMocks.archiveGenerationResultUrls.mockRejectedValueOnce(new Error('storage unavailable'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollAndUpdateJob(
      admin,
      'user-1',
      recoveryJob(),
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      undefined,
      { quick: true }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'processing',
      imageUrl: null,
      refunded: false
    });
  });

  it('nudges the durable queue without starting a second submit owner for queued NewAPI jobs', async () => {
    const { admin } = updateAdmin();
    const queue = { send: vi.fn(async () => undefined) };
    const kicked: Promise<unknown>[] = [];

    const result = await pollAndUpdateJob(
      admin,
      'user-1',
      queuedJob(),
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      { IMAGE_GENERATION_QUEUE: queue } as never,
      { quick: true, kickSubmit: (task) => { kicked.push(task); } }
    );
    await Promise.all(kicked);

    expect(result).toMatchObject({
      status: 'processing',
      imageUrl: null,
      refunded: false
    });
    expect(queue.send).toHaveBeenCalledWith({ jobId: 'job-queued-1', userId: 'user-1' });
    expect(fastSubmitMocks.fastSubmitParamsFromJob).not.toHaveBeenCalled();
    expect(fastSubmitMocks.processFastProviderPendingSubmit).not.toHaveBeenCalled();
  });

});
