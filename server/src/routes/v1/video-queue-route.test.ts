import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  queueSend: vi.fn(),
  processVideoPendingSubmit: vi.fn(),
  refundUserCredits: vi.fn(),
  syncMembershipCredits: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchVideoTask: vi.fn()
}));

vi.mock('../../lib/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/supabase')>(),
  createAdminClient: mocks.createAdminClient
}));

vi.mock('../../lib/membership-credits', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/membership-credits')>(),
  refundUserCredits: mocks.refundUserCredits,
  syncMembershipCredits: mocks.syncMembershipCredits
}));

vi.mock('../../lib/newapi', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/newapi')>(),
  fetchNewApiModelCatalog: mocks.fetchCatalog
}));

vi.mock('../../lib/newapi-video', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/newapi-video')>(),
  fetchNewApiVideoTask: mocks.fetchVideoTask
}));

vi.mock('../../lib/video-provider-submit', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/video-provider-submit')>(),
  processVideoPendingSubmit: mocks.processVideoPendingSubmit
}));

import { videoRoutes } from './video';

function appForUser(userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, phoneVerified: false });
    await next();
  });
  app.route('/video', videoRoutes);
  app.onError((error, c) => jsonError(c, error));
  return app;
}

function selectJob(row: Record<string, unknown>) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select() { return query; },
    eq(field: string, value: unknown) { filters.push([field, value]); return query; },
    async maybeSingle() {
      return { data: filters.every(([field, value]) => row[field] === value) ? row : null, error: null };
    }
  };
  return query;
}

function processingRow(state: string) {
  return {
    id: `video-job-${state}`,
    user_id: 'user-1',
    status: 'processing',
    credits_charged: 8,
    error_message: null,
    meta: {
      mediaType: 'video',
      model: 'motion-video',
      credits: 8,
      progress: 0,
      videoSubmitState: state
    }
  };
}

function mutableJobAdmin(initial: Record<string, any>) {
  let row: Record<string, any> = { ...initial, meta: { ...(initial.meta || {}) } };
  const admin = {
    from: vi.fn(() => {
      const filters: Array<[string, unknown]> = [];
      let updatePayload: Record<string, unknown> | null = null;
      const query: Record<string, any> = {};
      query.select = vi.fn(() => query);
      query.update = vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return query;
      });
      query.eq = vi.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      });
      query.filter = vi.fn((field: string, operator: string, value: unknown) => {
        if (operator === 'eq') filters.push([field, value]);
        return query;
      });
      const execute = async () => {
        const matches = filters.every(([field, value]) => {
          if (field.startsWith('meta->>')) return row.meta?.[field.slice('meta->>'.length)] === value;
          return row[field] === value;
        });
        if (!matches) return { data: null, error: null };
        if (updatePayload) row = { ...row, ...updatePayload };
        return { data: row, error: null };
      };
      query.maybeSingle = vi.fn(execute);
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
        execute().then(resolve, reject)
      );
      return query;
    })
  };
  return { admin, row: () => row };
}

beforeEach(() => {
  mocks.createAdminClient.mockReset();
  mocks.queueSend.mockReset();
  mocks.processVideoPendingSubmit.mockReset().mockResolvedValue('processed');
  mocks.refundUserCredits.mockReset().mockResolvedValue(undefined);
  mocks.fetchCatalog.mockRejectedValue(new Error('catalog unavailable'));
  mocks.fetchVideoTask.mockReset();
  mocks.syncMembershipCredits.mockResolvedValue({
    user_id: 'user-1',
    credits: 20,
    daily_credits: 0,
    daily_credits_date: null,
    membership_tier: null,
    membership_until: null,
    credit_grant_mode: 'daily'
  });
});

describe('video queued status route', () => {
  it('nudges an interrupted pre-debit job into the recovery consumer', async () => {
    const row = processingRow('awaiting_debit');
    mocks.createAdminClient.mockReturnValue({ from: () => selectJob(row) });
    const env = {
      CORS_ORIGINS: '',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env;

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    expect(mocks.queueSend).toHaveBeenCalledWith({
      kind: 'video',
      jobId: row.id,
      userId: 'user-1'
    });
    expect(mocks.processVideoPendingSubmit).not.toHaveBeenCalled();
  });

  it('returns processing and starts a direct idempotent fallback for a never-claimed queued job', async () => {
    const row = processingRow('queued');
    mocks.createAdminClient.mockReturnValue({ from: () => selectJob(row) });
    const env = {
      CORS_ORIGINS: '',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env;

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { jobId: row.id, status: 'processing', progress: 0, videoUrl: null }
    });
    expect(mocks.queueSend).toHaveBeenCalledWith({
      kind: 'video',
      jobId: row.id,
      userId: 'user-1'
    });
    expect(mocks.processVideoPendingSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: row.id }),
      expect.objectContaining({ VIDEO_GENERATION_QUEUE: expect.anything() })
    );
  });

  it('never nudges an unknown outcome back into the paid queue', async () => {
    const row = processingRow('outcome_unknown');
    mocks.createAdminClient.mockReturnValue({ from: () => selectJob(row) });
    const env = {
      CORS_ORIGINS: '',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env;

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    expect(mocks.queueSend).not.toHaveBeenCalled();
    expect(mocks.processVideoPendingSubmit).not.toHaveBeenCalled();
  });

  it('persists an uncertain accepted result without failing, refunding, or resubmitting it', async () => {
    const row = {
      ...processingRow('submitted'),
      id: 'video-job-result-uncertain',
      meta: {
        ...processingRow('submitted').meta,
        upstreamTaskId: 'task-result-uncertain',
        routeChannelId: 7
      }
    };
    const store = mutableJobAdmin(row);
    mocks.createAdminClient.mockReturnValue(store.admin);
    mocks.fetchVideoTask.mockResolvedValue({
      id: 'task-result-uncertain',
      status: 'unknown',
      progress: 30,
      errorCode: 'result_uncertain',
      errorMessage: 'private provider says outcome is unresolved',
      videoUrl: null
    });
    const env = {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test'
    } as unknown as Env;

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      env
    );
    const body = await response.json();
    const persisted = store.row();

    expect(response.status).toBe(200);
    expect(persisted).toMatchObject({
      status: 'processing',
      meta: {
        upstreamTaskId: 'task-result-uncertain',
        videoSubmitState: 'submitted',
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain',
        progress: 30
      }
    });
    expect(persisted.meta.videoResultUncertainAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(persisted.meta.videoSubmitOutcomeUnknownAt).toBeUndefined();
    expect(body).toMatchObject({
      ok: true,
      data: {
        jobId: row.id,
        status: 'submission_unknown',
        progress: 30,
        errorMessage: '任务结果暂时无法确认，请勿重复生成'
      }
    });
    expect(JSON.stringify(body)).not.toContain('private provider');
    expect(mocks.processVideoPendingSubmit).not.toHaveBeenCalled();
    expect(mocks.queueSend).not.toHaveBeenCalled();
  });

  it('clears result uncertainty when the same upstream task resumes processing', async () => {
    const row = {
      ...processingRow('submitted'),
      id: 'video-job-result-resumed',
      meta: {
        ...processingRow('submitted').meta,
        upstreamTaskId: 'task-result-resumed',
        progress: 30,
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain',
        videoResultUncertainAt: '2026-07-28T00:00:00.000Z'
      }
    };
    const store = mutableJobAdmin(row);
    mocks.createAdminClient.mockReturnValue(store.admin);
    mocks.fetchVideoTask.mockResolvedValue({
      id: 'task-result-resumed',
      status: 'processing',
      progress: 45,
      errorCode: null,
      errorMessage: null,
      videoUrl: null
    });
    const env = {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test'
    } as unknown as Env;

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      env
    );
    const body = await response.json();
    const persisted = store.row();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { jobId: row.id, status: 'processing', progress: 45, errorMessage: null }
    });
    expect(persisted.status).toBe('processing');
    expect(persisted.meta.videoSubmitState).toBe('submitted');
    expect(persisted.meta.videoResultState).toBeUndefined();
    expect(persisted.meta.videoResultErrorCode).toBeUndefined();
    expect(persisted.meta.videoResultUncertainAt).toBeUndefined();
  });

  it('preserves the first uncertainty timestamp across repeated unknown polls', async () => {
    const firstUncertainAt = '2026-07-28T00:00:00.000Z';
    const row = {
      ...processingRow('submitted'),
      id: 'video-job-result-still-uncertain',
      meta: {
        ...processingRow('submitted').meta,
        upstreamTaskId: 'task-result-still-uncertain',
        progress: 30,
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain',
        videoResultUncertainAt: firstUncertainAt
      }
    };
    const store = mutableJobAdmin(row);
    mocks.createAdminClient.mockReturnValue(store.admin);
    mocks.fetchVideoTask.mockResolvedValue({
      id: 'task-result-still-uncertain',
      status: 'unknown',
      progress: 35,
      errorCode: 'result_uncertain',
      errorMessage: 'still reconciling',
      videoUrl: null
    });

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      {
        CORS_ORIGINS: '',
        NEWAPI_API_KEY: 'secret',
        NEWAPI_API_BASE_URL: 'https://newapi.test'
      } as unknown as Env
    );

    expect(response.status).toBe(200);
    expect(store.row().meta.videoResultUncertainAt).toBe(firstUncertainAt);
    expect(store.row().meta.progress).toBe(35);
  });

  it('clears uncertainty and completes when the upstream task resolves', async () => {
    const row = {
      ...processingRow('submitted'),
      id: 'video-job-result-completed',
      meta: {
        ...processingRow('submitted').meta,
        upstreamTaskId: 'task-result-completed',
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain',
        videoResultUncertainAt: '2026-07-28T00:00:00.000Z'
      }
    };
    const store = mutableJobAdmin(row);
    mocks.createAdminClient.mockReturnValue(store.admin);
    mocks.fetchVideoTask.mockResolvedValue({
      id: 'task-result-completed',
      status: 'completed',
      progress: 100,
      errorCode: null,
      errorMessage: null,
      videoUrl: 'https://video.test/result.mp4'
    });

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      {
        CORS_ORIGINS: '',
        NEWAPI_API_KEY: 'secret',
        NEWAPI_API_BASE_URL: 'https://newapi.test'
      } as unknown as Env
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { status: 'completed', progress: 100, videoUrl: `/api/v1/video/jobs/${row.id}/content` }
    });
    expect(store.row().status).toBe('completed');
    expect(store.row().meta.videoSubmitState).toBe('completed');
    expect(store.row().meta.videoResultState).toBeUndefined();
    expect(store.row().meta.videoResultUncertainAt).toBeUndefined();
    expect(mocks.refundUserCredits).not.toHaveBeenCalled();
  });

  it('clears uncertainty and refunds once on a definitive upstream failure', async () => {
    const row = {
      ...processingRow('submitted'),
      id: 'video-job-result-failed',
      meta: {
        ...processingRow('submitted').meta,
        upstreamTaskId: 'task-result-failed',
        debitSplit: { fromDaily: 0, fromPermanent: 8 },
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain',
        videoResultUncertainAt: '2026-07-28T00:00:00.000Z'
      }
    };
    const store = mutableJobAdmin(row);
    mocks.createAdminClient.mockReturnValue(store.admin);
    mocks.fetchVideoTask.mockResolvedValue({
      id: 'task-result-failed',
      status: 'failed',
      progress: 35,
      errorCode: 'provider_rejected',
      errorMessage: 'definitive failure',
      videoUrl: null
    });

    const response = await appForUser('user-1').request(
      `http://local.test/video/jobs/${row.id}`,
      {},
      {
        CORS_ORIGINS: '',
        NEWAPI_API_KEY: 'secret',
        NEWAPI_API_BASE_URL: 'https://newapi.test'
      } as unknown as Env
    );

    expect(response.status).toBe(200);
    expect(store.row().status).toBe('failed');
    expect(store.row().meta.videoSubmitState).toBe('failed');
    expect(store.row().meta.refundState).toBe('refunded');
    expect(store.row().meta.videoResultState).toBeUndefined();
    expect(store.row().meta.videoResultUncertainAt).toBeUndefined();
    expect(mocks.refundUserCredits).toHaveBeenCalledTimes(1);
  });
});
