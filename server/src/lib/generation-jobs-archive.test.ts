import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import * as imageArchive from './image-archive';
import * as mediaCdn from './media-cdn';
import { pollAndUpdateJob, type JobRow } from './generation-jobs';

describe('generation result archival gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a paid job processing when its temporary result cannot be archived', async () => {
    vi.spyOn(imageArchive, 'archiveGenerationResultUrls')
      .mockRejectedValue(new Error('storage unavailable'));
    const query = {
      update: vi.fn(),
      eq: vi.fn()
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    const job: JobRow = {
      id: 'job-archive-gate',
      user_id: 'user-archive-gate',
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
        fastSubmitState: 'done',
        syncImageUrl: 'https://temporary.test/result.png'
      },
      created_at: new Date().toISOString()
    };

    const result = await pollAndUpdateJob(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      { MEDIA_STORAGE_MODE: 'r2-first' } as unknown as Env,
      { quick: true }
    );

    expect(result).toMatchObject({
      status: 'processing',
      imageUrl: null,
      progressNote: '图片已生成，正在安全保存结果'
    });
    const patches = query.update.mock.calls.map(([value]) => value as Record<string, unknown>);
    expect(patches).not.toContainEqual(expect.objectContaining({ status: 'completed' }));
    expect(patches.at(-1)).toMatchObject({
      meta: {
        syncImageUrl: 'https://temporary.test/result.png',
        archivePending: true
      }
    });
  });

  it('fails a stale pending task in the quick Canvas polling path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'upstream-stale', status: 'processing' }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.spyOn(mediaCdn, 'findFirstExistingStoragePath').mockResolvedValue(null);
    const query = {
      update: vi.fn(),
      eq: vi.fn()
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    const job: JobRow = {
      id: 'job-stale-quick-poll',
      user_id: 'user-stale-quick-poll',
      credits_charged: 0,
      status: 'processing',
      prompt: 'product photo',
      resolution: '1k',
      quality: 'standard',
      result_image_url: null,
      error_message: null,
      meta: {
        provider: 'newapi',
        upstreamModel: 'image2-A',
        upstreamTaskId: 'upstream-stale',
        fastSubmitState: 'done'
      },
      created_at: new Date(Date.now() - 29 * 60 * 1000).toISOString()
    };

    const result = await pollAndUpdateJob(
      admin as never,
      job.user_id,
      job,
      { newapiKey: 'unit-key', newapiBase: 'https://newapi-unit.test' },
      undefined,
      { quick: true }
    );

    expect(result).toEqual({
      status: 'failed',
      imageUrl: null,
      errorMessage: 'upstream_timeout',
      refunded: true
    });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_message: 'upstream_timeout'
    }));
  });
});
