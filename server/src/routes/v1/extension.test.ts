import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  appendQuickCard: vi.fn(),
  createAdminClient: vi.fn(),
  findUserCardForExtension: vi.fn(),
  getOrCreateProfile: vi.fn(),
  resolveImageRefForJob: vi.fn(),
  ensureWarehouseJobThumb: vi.fn()
}));

vi.mock('../../lib/extension-card', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/extension-card')>(),
  appendQuickCard: mocks.appendQuickCard,
  findUserCardForExtension: mocks.findUserCardForExtension
}));

vi.mock('../../lib/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/supabase')>(),
  createAdminClient: mocks.createAdminClient,
  getOrCreateProfile: mocks.getOrCreateProfile
}));

vi.mock('../../lib/recover-generation-warehouse', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/recover-generation-warehouse')>(),
  resolveImageRefForJob: mocks.resolveImageRefForJob
}));

vi.mock('../../lib/warehouse-thumb', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/warehouse-thumb')>(),
  ensureWarehouseJobThumb: mocks.ensureWarehouseJobThumb
}));

import { extensionRoutes } from './extension';

const userId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const env = { CORS_ORIGINS: '' } as unknown as Env;

function app() {
  const result = new Hono<{ Bindings: Env }>();
  result.use('*', async (context, next) => {
    context.set('user', { id: userId, email: 'user@example.test', phoneVerified: false });
    await next();
  });
  result.route('/extension', extensionRoutes);
  result.onError((error, context) => jsonError(context, error));
  return result;
}

function generationAdmin(job: Record<string, unknown> | null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: job, error: null }));
  return { from: vi.fn(() => query) };
}

describe('Canvas card bridge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue({});
    mocks.getOrCreateProfile.mockResolvedValue({ user_id: userId, storage_bytes: 0 });
    mocks.resolveImageRefForJob.mockResolvedValue(
      `storage://card-images/${userId}/generated/${jobId}.png`
    );
    mocks.appendQuickCard.mockResolvedValue({
      cardId: `canvas_${jobId.replace(/-/g, '_')}`,
      cardCount: 7,
      publishedToCommunity: false,
      communityPostId: null,
      replayed: false
    });
  });

  it('returns one exact owned card for a deep link', async () => {
    const card = {
      id: 'card_123',
      title: '卡片',
      prompt: '提示词',
      imageRef: `storage://card-images/${userId}/card.jpg`,
      hasImage: true,
      tags: [],
      group: null,
      genJobId: jobId,
      isMidjourney: false,
      updatedAt: 1
    };
    mocks.findUserCardForExtension.mockResolvedValue(card);
    mocks.ensureWarehouseJobThumb.mockResolvedValue({ url: 'https://media.test/thumb', gridPath: 'thumb' });

    const response = await app().request('http://local.test/extension/cards/card_123', undefined, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { card: { id: 'card_123', thumbUrl: 'https://media.test/thumb' } }
    });
    expect(mocks.findUserCardForExtension).toHaveBeenCalledWith(expect.anything(), userId, 'card_123');
  });

  it('stores an owned completed Canvas result without accepting a client image URL', async () => {
    const job = {
      id: jobId,
      user_id: userId,
      prompt: '玻璃茶壶产品照',
      status: 'completed',
      result_image_url: 'https://temporary-upstream.test/image.png',
      meta: { product: 'canvas', projectId: 'project-1', nodeId: 'node-1' },
      resolution: '1k'
    };
    mocks.createAdminClient.mockReturnValue(generationAdmin(job));

    const response = await app().request('http://local.test/extension/canvas-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationJobId: jobId, artifactIndex: 0 })
    }, env);

    expect(response.status).toBe(200);
    expect(mocks.resolveImageRefForJob).toHaveBeenCalledWith(
      expect.anything(), userId, jobId, job, expect.anything()
    );
    expect(mocks.appendQuickCard).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.anything(),
      expect.objectContaining({
        prompt: '玻璃茶壶产品照',
        imageRef: `storage://card-images/${userId}/generated/${jobId}.png`,
        sourceKey: `canvas-result:${jobId}:0`,
        genJobId: jobId,
        publishToCommunity: false
      })
    );
    const storedInput = mocks.appendQuickCard.mock.calls[0][3];
    expect(storedInput).not.toHaveProperty('imageBase64');
    expect(storedInput).not.toHaveProperty('sourceUrl');
  });

  it('rejects completed jobs that do not carry a Canvas origin marker', async () => {
    mocks.createAdminClient.mockReturnValue(generationAdmin({
      id: jobId,
      user_id: userId,
      prompt: '普通站内生成',
      status: 'completed',
      result_image_url: `storage://card-images/${userId}/generated/${jobId}.png`,
      meta: {}
    }));

    const response = await app().request('http://local.test/extension/canvas-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationJobId: jobId })
    }, env);
    expect(response.status).toBe(409);
    expect(mocks.resolveImageRefForJob).not.toHaveBeenCalled();
    expect(mocks.appendQuickCard).not.toHaveBeenCalled();
  });
});
