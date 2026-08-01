import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  deductUserCredits: vi.fn(),
  syncMembershipCredits: vi.fn(),
  findOwnedGenerationRequest: vi.fn(),
  insertGenerationRequest: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchExecutableCatalog: vi.fn(),
  fetchRoutes: vi.fn(),
  resolveRouted: vi.fn(),
  resolveCatalog: vi.fn(),
  fixedCredits: vi.fn(),
  queueSend: vi.fn(),
  processVideoPendingSubmit: vi.fn()
}));

vi.mock('../../lib/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/supabase')>(),
  createAdminClient: mocks.createAdminClient
}));

vi.mock('../../lib/membership-credits', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/membership-credits')>(),
  deductUserCredits: mocks.deductUserCredits,
  syncMembershipCredits: mocks.syncMembershipCredits
}));

vi.mock('../../lib/generation-idempotency', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/generation-idempotency')>(),
  findOwnedGenerationRequest: mocks.findOwnedGenerationRequest,
  insertGenerationRequest: mocks.insertGenerationRequest
}));

vi.mock('../../lib/newapi', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/newapi')>(),
  fetchNewApiModelCatalog: mocks.fetchCatalog,
  fetchNewApiExecutableCatalog: mocks.fetchExecutableCatalog,
  fetchNewApiAdminRoutes: mocks.fetchRoutes,
  resolveNewApiRoutedCatalogModel: mocks.resolveRouted,
  resolveNewApiCatalogModel: mocks.resolveCatalog,
  newApiFixedCreditsForRequest: mocks.fixedCredits
}));

vi.mock('../../lib/video-provider-submit', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/video-provider-submit')>(),
  processVideoPendingSubmit: mocks.processVideoPendingSubmit
}));

import { videoRoutes } from './video';

const userId = '11111111-1111-4111-8111-111111111111';
const model = {
  id: 'public-video',
  upstreamModel: 'upstream-video',
  label: '公开视频模型',
  description: '',
  modality: 'video' as const,
  operation: 'generate' as const,
  order: 0,
  endpoint: { method: 'POST' as const, path: '/v1/videos', contentType: 'application/json' as const },
  parameters: [
    { name: 'duration', path: 'duration', label: '时长', type: 'integer' as const, required: false, options: [8] },
    { name: 'ratio', path: 'ratio', label: '比例', type: 'string' as const, required: false, options: ['16:9'] },
    { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string' as const, required: false, options: ['720p'] }
  ],
  pricing: { mode: 'fixed' as const, unit: 'request' as const, credits: 12 }
};

function app() {
  const result = new Hono<{ Bindings: Env }>();
  result.use('*', async (c, next) => {
    c.set('user', { id: userId, phoneVerified: false });
    await next();
  });
  result.route('/video', videoRoutes);
  result.onError((error, c) => jsonError(c, error));
  return result;
}

describe('video creation durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOwnedGenerationRequest.mockResolvedValue({ row: null, error: null });
    mocks.fetchCatalog.mockResolvedValue({ models: [model], rules: [], available: true });
    mocks.fetchExecutableCatalog.mockResolvedValue({ models: [model], rules: [], available: true });
    mocks.fetchRoutes.mockResolvedValue({
      available: true,
      fetchedAt: '2026-07-28T00:00:00.000Z',
      error: null,
      routes: {
        'upstream-video': [{
          channelId: 7,
          channelName: 'video-route',
          status: 'active',
          enabled: true,
          groups: ['default'],
          actualModel: 'upstream-video',
          priority: 10,
          weight: 1,
          upstreamHost: 'video.example.test'
        }]
      }
    });
    mocks.resolveRouted.mockResolvedValue({ model, route: { channelId: 7 } });
    mocks.resolveCatalog.mockReturnValue(model);
    mocks.fixedCredits.mockReturnValue(12);
    mocks.processVideoPendingSubmit.mockResolvedValue('processed');
    mocks.syncMembershipCredits.mockResolvedValue({
      user_id: userId,
      credits: 100,
      daily_credits: 0,
      daily_credits_date: null,
      membership_tier: null,
      membership_until: null,
      credit_grant_mode: 'daily'
    });
    mocks.deductUserCredits.mockResolvedValue({
      profile: { credits: 88, daily_credits: 0, daily_credits_date: null },
      split: { fromDaily: 0, fromPermanent: 12 },
      replayed: false
    });

    let insertedRow: Record<string, unknown> = {};
    mocks.insertGenerationRequest.mockImplementation(
      async (_admin, _userId, requestId, values) => {
        insertedRow = { id: requestId, user_id: userId, ...values };
        return { row: insertedRow, error: null, replayed: false };
      }
    );
    const query: Record<string, any> = {};
    query.update = vi.fn((payload: Record<string, unknown>) => {
      insertedRow = { ...insertedRow, ...payload };
      return query;
    });
    query.eq = vi.fn(() => query);
    query.filter = vi.fn(() => query);
    query.select = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: insertedRow, error: null }));
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });
  });

  it('persists a complete recovery envelope before debit and queues the same job', async () => {
    const env = {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env;
    const clientRequestId = 'canvas:video-create-001';
    const response = await app().request('http://local.test/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId,
        product: 'canvas',
        model: model.id,
        prompt: '镜头缓慢推进',
        duration: 8,
        ratio: '16:9',
        resolution: '720p'
      })
    }, env);

    expect(response.status).toBe(200);
    const insertCall = mocks.insertGenerationRequest.mock.calls[0];
    const requestId = String(insertCall[2]);
    const insertedValues = insertCall[3] as Record<string, any>;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(insertedValues.meta).toMatchObject({
      videoSubmitState: 'awaiting_debit',
      routeChannelId: 7,
      videoSubmitEnvelope: {
        idempotencyKey: `prompt-hub-video:${requestId}`,
        upstreamModel: 'upstream-video',
        prompt: '镜头缓慢推进',
        duration: 8,
        ratio: '16:9',
        resolution: '720p'
      }
    });
    expect(mocks.deductUserCredits).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      12,
      'video_generation',
      requestId,
      expect.objectContaining({ idempotencyKey: clientRequestId })
    );
    expect(mocks.queueSend).toHaveBeenCalledWith({
      kind: 'video',
      jobId: requestId,
      userId
    });
    expect(mocks.processVideoPendingSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: requestId }),
      expect.objectContaining({ VIDEO_GENERATION_QUEUE: expect.anything() })
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { jobId: requestId, status: 'processing', creditsCharged: 12 }
    });
  });

  it('preserves awaiting_debit when the wallet response is ambiguous', async () => {
    const env = {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env;
    mocks.deductUserCredits.mockRejectedValueOnce(new TypeError('database transport interrupted'));

    const response = await app().request('http://local.test/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'canvas:video-debit-uncertain-001',
        product: 'canvas',
        model: model.id,
        prompt: '镜头缓慢推进',
        duration: 8,
        ratio: '16:9',
        resolution: '720p'
      })
    }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '视频任务扣费状态正在确认，请稍后查看任务' }
    });
    const admin = mocks.createAdminClient.mock.results[0]?.value;
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.queueSend).not.toHaveBeenCalled();
    expect(mocks.processVideoPendingSubmit).not.toHaveBeenCalled();
    expect(mocks.insertGenerationRequest.mock.calls[0]?.[3]).toMatchObject({
      status: 'processing',
      meta: { videoSubmitState: 'awaiting_debit' }
    });
  });

  it('rejects a video model with no active route before creating or charging', async () => {
    mocks.fetchRoutes.mockResolvedValueOnce({
      available: true,
      fetchedAt: '2026-07-28T00:00:00.000Z',
      error: null,
      routes: {}
    });
    mocks.resolveRouted.mockResolvedValueOnce({ model, route: null });
    const response = await app().request('http://local.test/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'canvas:video-no-active-route-001',
        product: 'canvas',
        model: model.id,
        prompt: '镜头缓慢推进',
        duration: 8,
        ratio: '16:9',
        resolution: '720p'
      })
    }, {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'MODEL_UNAVAILABLE' }
    });
    expect(mocks.insertGenerationRequest).not.toHaveBeenCalled();
    expect(mocks.deductUserCredits).not.toHaveBeenCalled();
    expect(mocks.queueSend).not.toHaveBeenCalled();
  });

  it('preserves the exact per-second quote for later shortfall settlement', async () => {
    const perSecondModel = {
      ...model,
      parameters: model.parameters.map(parameter => parameter.name === 'duration'
        ? { ...parameter, options: [6] }
        : parameter),
      pricing: { mode: 'fixed' as const, unit: 'second' as const, credits: 46.3 }
    };
    mocks.resolveRouted.mockResolvedValueOnce({ model: perSecondModel, route: { channelId: 7 } });
    mocks.fixedCredits.mockReturnValueOnce(46.3);
    mocks.deductUserCredits.mockResolvedValueOnce({
      profile: { credits: 53.7, daily_credits: 0, daily_credits_date: null },
      split: { fromDaily: 0, fromPermanent: 46.3 },
      replayed: false
    });

    const response = await app().request('http://local.test/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'canvas:video-per-second-quote-001',
        product: 'canvas',
        model: model.id,
        prompt: '镜头缓慢推进',
        duration: 6,
        ratio: '16:9',
        resolution: '720p'
      })
    }, {
      CORS_ORIGINS: '',
      NEWAPI_API_KEY: 'secret',
      NEWAPI_API_BASE_URL: 'https://newapi.test',
      VIDEO_GENERATION_QUEUE: { send: mocks.queueSend }
    } as unknown as Env);

    expect(response.status).toBe(200);
    const insertedValues = mocks.insertGenerationRequest.mock.calls[0]?.[3] as Record<string, any>;
    expect(insertedValues.meta).toMatchObject({
      credits: 46.3,
      requestedDuration: 6,
      billingUnit: 'second'
    });
    expect(insertedValues.meta.billingUnitCredits).toBeCloseTo(46.3 / 6, 12);
    expect(mocks.deductUserCredits).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      46.3,
      'video_generation',
      expect.any(String),
      expect.any(Object)
    );
  });
});
