import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  pollAndUpdateJob: vi.fn(),
  normalizeGenerationPollResult: vi.fn(),
  jobPollNeedsBackgroundArchive: vi.fn(),
  archivePendingJobImage: vi.fn(),
  warmJobGridImage: vi.fn(),
  assertJobOwner: vi.fn(),
  upstreamBindingsFromEnv: vi.fn(),
  syncMembershipCredits: vi.fn(),
  spendableCredits: vi.fn(),
  buildPrivateMediaCdnUrl: vi.fn(),
  ensureGridPathForSigning: vi.fn()
}));

vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/supabase')>()),
  createAdminClient: mocks.createAdminClient
}));

vi.mock('../../lib/generation-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/generation-jobs')>()),
  pollAndUpdateJob: mocks.pollAndUpdateJob,
  normalizeGenerationPollResult: mocks.normalizeGenerationPollResult,
  jobPollNeedsBackgroundArchive: mocks.jobPollNeedsBackgroundArchive,
  archivePendingJobImage: mocks.archivePendingJobImage,
  warmJobGridImage: mocks.warmJobGridImage,
  assertJobOwner: mocks.assertJobOwner
}));

vi.mock('../../lib/image-upstream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/image-upstream')>()),
  upstreamBindingsFromEnv: mocks.upstreamBindingsFromEnv
}));

vi.mock('../../lib/membership-credits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/membership-credits')>()),
  syncMembershipCredits: mocks.syncMembershipCredits,
  spendableCredits: mocks.spendableCredits
}));

vi.mock('../../lib/media-cdn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media-cdn')>()),
  buildPrivateMediaCdnUrl: mocks.buildPrivateMediaCdnUrl,
  ensureGridPathForSigning: mocks.ensureGridPathForSigning
}));

import { generateRoutes } from './generate';

const userId = '11111111-1111-4111-8111-111111111111';
const env = { ENVIRONMENT: 'production', CORS_ORIGINS: '' } as Env;
const upstreamUrl = 'https://console.example.test/upstream-result.png';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-settle-1',
    user_id: userId,
    status: 'completed',
    result_image_url: upstreamUrl,
    meta: { model: 'image2' },
    prompt: 'settle contract',
    created_at: '2026-07-27T00:00:00.000Z',
    completed_at: '2026-07-27T00:00:01.000Z',
    resolution: '1k',
    quality: 'standard',
    size_label: '1024x1024',
    credits_charged: 2,
    ...overrides
  };
}

function app(waitUntilCalls: Array<Promise<unknown>>) {
  const server = new Hono<{ Bindings: Env }>();
  server.use('*', async (c, next) => {
    (c as any).set('user', { id: userId });
    Object.defineProperty(c, 'executionCtx', {
      configurable: true,
      value: { waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p) }
    });
    await next();
  });
  server.route('/', generateRoutes);
  server.onError((error, context) => jsonError(context, error));
  return server;
}

function chainQuery(row: Record<string, unknown>) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return query;
}

describe('GET /jobs/:jobId settle delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => chainQuery(jobRow())) });
    mocks.pollAndUpdateJob.mockResolvedValue({
      status: 'completed',
      imageUrl: upstreamUrl,
      progressNote: ''
    });
    mocks.normalizeGenerationPollResult.mockImplementation((v: unknown) => v);
    mocks.jobPollNeedsBackgroundArchive.mockImplementation(
      (url: string | null | undefined) => /^https?:\/\//i.test(String(url || ''))
    );
    mocks.archivePendingJobImage.mockImplementation(
      () => new Promise(() => {})
    );
    mocks.warmJobGridImage.mockResolvedValue(false);
    mocks.assertJobOwner.mockImplementation(() => {});
    mocks.upstreamBindingsFromEnv.mockReturnValue({});
    mocks.syncMembershipCredits.mockResolvedValue({ credits_remaining: 100 });
    mocks.spendableCredits.mockReturnValue(100);
    mocks.buildPrivateMediaCdnUrl.mockImplementation(async (_c, path) => `https://signed.test/${path}`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the upstream imageUrl immediately without awaiting archive, scheduling archive in the background', async () => {
    const waitUntilCalls: Array<Promise<unknown>> = [];
    const response = await app(waitUntilCalls).request(
      'http://localhost/jobs/job-settle-1?settle=1',
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { status: string; imageUrl: string } };
    expect(body.data.status).toBe('completed');
    expect(body.data.imageUrl).toBe(upstreamUrl);
    expect(mocks.archivePendingJobImage).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      'job-settle-1',
      env
    );
    expect(waitUntilCalls.length).toBeGreaterThan(0);
  });

  it('keeps a completed-without-image poll recoverable instead of returning a broken card', async () => {
    mocks.pollAndUpdateJob.mockResolvedValue({
      status: 'processing',
      imageUrl: null,
      progressNote: '图片已生成，正在同步到图库'
    });
    mocks.jobPollNeedsBackgroundArchive.mockReturnValue(false);
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => chainQuery(jobRow({
      result_image_url: null,
      status: 'completed'
    }))) });
    const waitUntilCalls: Array<Promise<unknown>> = [];
    const response = await app(waitUntilCalls).request(
      'http://localhost/jobs/job-settle-1?settle=1',
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { status: string; imageUrl: string | null } };
    expect(body.data.status).toBe('processing');
    expect(body.data.imageUrl).toBeNull();
  });
});
