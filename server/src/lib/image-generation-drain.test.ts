import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { JobRow } from './generation-jobs';

const {
  archivePendingJobImageMock,
  createAdminClientMock,
  pollAndUpdateJobMock
} = vi.hoisted(() => ({
  archivePendingJobImageMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  pollAndUpdateJobMock: vi.fn()
}));

vi.mock('./generation-jobs', async importOriginal => ({
  ...await importOriginal<typeof import('./generation-jobs')>(),
  archivePendingJobImage: archivePendingJobImageMock,
  pollAndUpdateJob: pollAndUpdateJobMock
}));

vi.mock('./supabase', async importOriginal => ({
  ...await importOriginal<typeof import('./supabase')>(),
  createAdminClient: createAdminClientMock
}));

import {
  drainPendingImageArchives,
  drainPendingImageTasks
} from './image-generation-drain';

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    credits_charged: 6,
    status: 'processing',
    prompt: 'product photo',
    resolution: '4k',
    quality: 'standard',
    result_image_url: null,
    error_message: null,
    meta: {
      provider: 'newapi',
      upstreamTaskId: 'task_gateway_1',
      fastSubmitState: 'done'
    },
    created_at: '2026-07-26T02:00:00.000Z',
    ...overrides
  };
}

function fakeListAdmin(rows: JobRow[]) {
  return {
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        not() { return query; },
        gte() { return query; },
        order() { return query; },
        limit() { return query; },
        then(resolve: (value: { data: JobRow[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
      };
      return query;
    }
  };
}

const env = {
  NEWAPI_API_KEY: 'unit-key',
  NEWAPI_API_BASE_URL: 'https://newapi.test'
} as Env;

beforeEach(() => {
  vi.clearAllMocks();
});
describe('background image generation drain', () => {
  it('polls an accepted task and immediately archives its temporary result URL', async () => {
    const active = job();
    createAdminClientMock.mockReturnValue(fakeListAdmin([active]));
    pollAndUpdateJobMock.mockResolvedValue({
      status: 'completed',
      imageUrl: 'https://newapi.test/v1/images/content?token=temporary',
      errorMessage: null,
      refunded: false
    });
    archivePendingJobImageMock.mockResolvedValue(true);

    const result = await drainPendingImageTasks(env, { maxPoll: 4 });

    expect(result).toEqual({ polled: 1, completed: 1, failed: 0 });
    expect(pollAndUpdateJobMock).toHaveBeenCalledWith(
      expect.anything(),
      active.user_id,
      active,
      expect.objectContaining({ newapiKey: 'unit-key' }),
      env,
      { quick: true }
    );
    expect(archivePendingJobImageMock).toHaveBeenCalledWith(
      expect.anything(),
      active.user_id,
      active.id,
      env
    );
  });

  it('skips archive retries until their persisted backoff expires', async () => {
    const future = job({
      id: 'future-archive',
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_image_url: 'https://image.test/future.png',
      meta: {
        archivePending: true,
        archiveNextAttemptAt: new Date(Date.now() + 60_000).toISOString()
      }
    });
    const due = job({
      id: 'due-archive',
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_image_url: 'https://image.test/due.png',
      meta: { archivePending: true }
    });
    createAdminClientMock.mockReturnValue(fakeListAdmin([future, due]));
    archivePendingJobImageMock.mockResolvedValue(true);

    const result = await drainPendingImageArchives(env, { maxArchive: 2 });

    expect(result).toEqual({ attempted: 1, archived: 1 });
    expect(archivePendingJobImageMock).toHaveBeenCalledTimes(1);
    expect(archivePendingJobImageMock).toHaveBeenCalledWith(
      expect.anything(),
      due.user_id,
      due.id,
      env
    );
  });
});
