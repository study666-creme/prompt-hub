import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  buildPrivateMediaCdnUrl: vi.fn(),
  createAdminClient: vi.fn(),
  ensureGridPathForSigning: vi.fn()
}));

vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/supabase')>()),
  createAdminClient: mocks.createAdminClient
}));

vi.mock('../../lib/media-cdn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media-cdn')>()),
  buildPrivateMediaCdnUrl: mocks.buildPrivateMediaCdnUrl,
  ensureGridPathForSigning: mocks.ensureGridPathForSigning
}));

import { generateRoutes } from './generate';

const userId = '11111111-1111-4111-8111-111111111111';
const env = { ENVIRONMENT: 'production', CORS_ORIGINS: '' } as Env;

function app() {
  const server = new Hono<{ Bindings: Env }>();
  server.use('*', async (c, next) => {
    (c as any).set('user', { id: userId });
    await next();
  });
  server.route('/', generateRoutes);
  server.onError((error, context) => jsonError(context, error));
  return server;
}

function recentQuery(rows: unknown[]) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return query;
}

function completedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    prompt: 'test image',
    status: 'completed',
    result_image_url: 'storage://card-images/user-1/generated/existing.jpg',
    meta: { model: 'image2' },
    created_at: '2026-07-27T00:00:00.000Z',
    completed_at: '2026-07-27T00:00:01.000Z',
    resolution: '1k',
    quality: 'standard',
    size_label: '1024x1024',
    credits_charged: 1,
    ...overrides
  };
}

function setRows(rows: unknown[]) {
  const query = recentQuery(rows);
  mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });
  return query;
}

describe('/jobs/recent image existence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureGridPathForSigning.mockImplementation(async (_c, path) => {
      if (String(path).includes('missing')) throw { status: 404, code: 'NOT_FOUND' };
      return path;
    });
    mocks.buildPrivateMediaCdnUrl.mockImplementation(async (_c, path) => `https://signed.test/${path}`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not sign or return a completed job whose only stored image is missing', async () => {
    setRows([completedJob({
      result_image_url: 'storage://card-images/user-1/generated/missing.jpg'
    })]);

    const response = await app().request('http://localhost/jobs/recent', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { jobs: [] }
    });
    expect(mocks.buildPrivateMediaCdnUrl).not.toHaveBeenCalled();
    expect(mocks.ensureGridPathForSigning).toHaveBeenCalledWith(
      expect.anything(),
      'user-1/generated/missing.jpg',
      'full',
      { requireExistingPrimary: true, strictStorageCheck: true }
    );
  });

  it('signs existing primary images and drops missing gallery entries', async () => {
    setRows([completedJob({
      meta: {
        model: 'image2',
        extraImageUrls: [
          'storage://card-images/user-1/generated/missing-extra.jpg',
          'storage://card-images/user-1/generated/extra.jpg'
        ],
        mjGridUrls: ['storage://card-images/user-1/generated/missing-grid.jpg'],
        mjGalleryUrls: ['storage://card-images/user-1/generated/gallery.jpg'],
        mjCompositeUrl: 'storage://card-images/user-1/generated/missing-composite.jpg'
      }
    })]);

    const response = await app().request('http://localhost/jobs/recent', {}, env);
    const body = await response.json() as { data: { jobs: Array<Record<string, unknown>> } };

    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0]).toMatchObject({
      imageUrl: 'https://signed.test/user-1/generated/existing.jpg',
      extraImageUrls: ['https://signed.test/user-1/generated/extra.jpg'],
      mjGalleryUrls: ['https://signed.test/user-1/generated/gallery.jpg']
    });
    expect(body.data.jobs[0].mjGridUrls).toBeUndefined();
    expect(body.data.jobs[0].mjCompositeUrl).toBeUndefined();
  });

  it('keeps ordinary upstream HTTP URLs without a storage existence check', async () => {
    const upstream = 'https://upstream.example.test/images/result.png';
    setRows([completedJob({ result_image_url: upstream })]);

    const response = await app().request('http://localhost/jobs/recent', {}, env);
    const body = await response.json() as { data: { jobs: Array<{ imageUrl: string }> } };

    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0].imageUrl).toBe(upstream);
    expect(mocks.ensureGridPathForSigning).not.toHaveBeenCalled();
    expect(mocks.buildPrivateMediaCdnUrl).not.toHaveBeenCalled();
  });
});
