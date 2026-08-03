import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  cardImageExists: vi.fn(),
  deleteFromR2: vi.fn(),
  downloadCardImage: vi.fn(),
  uploadCardImage: vi.fn()
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

vi.mock('./r2-storage', () => ({
  cardImageExists: mocks.cardImageExists,
  deleteFromR2: mocks.deleteFromR2,
  downloadCardImage: mocks.downloadCardImage,
  uploadCardImage: mocks.uploadCardImage
}));

import { ensureGridPathForSigning, serveCachedStorageImage } from './media-cdn';

function context(env: Env): Context<{ Bindings: Env }> {
  return { env } as Context<{ Bindings: Env }>;
}

function jpegBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

function pngBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function blob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

function mediaContext(env: Env): Context<{ Bindings: Env }> {
  return {
    env,
    req: {
      url: 'https://api.example.test/api/v1/media/i/test',
      query: vi.fn(() => undefined)
    },
    executionCtx: {
      waitUntil: vi.fn()
    }
  } as unknown as Context<{ Bindings: Env }>;
}

describe('generation media grid signing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createAdminClient.mockReturnValue({});
    mocks.deleteFromR2.mockResolvedValue(undefined);
    mocks.downloadCardImage.mockResolvedValue(null);
    mocks.uploadCardImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('materializes a grid before returning its signing path when only the primary exists', async () => {
    const env = {
      ENVIRONMENT: 'production',
      MEDIA_STORAGE_MODE: 'r2-first',
      SUPABASE_URL: 'https://storage.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role'
    } as Env;
    mocks.cardImageExists.mockImplementation(async (_env, path) => (
      path === 'user-1/generated/job-1.jpg'
    ));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jpegBytes(), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    })));

    await expect(ensureGridPathForSigning(
      context(env),
      'user-1/generated/job-1.jpg',
      'grid',
      { requireExistingPrimary: true }
    )).resolves.toBe('user-1/generated/job-1_grid.jpg');

    expect(mocks.uploadCardImage).toHaveBeenCalledOnce();
    expect(mocks.uploadCardImage).toHaveBeenCalledWith(
      env,
      'user-1/generated/job-1_grid.jpg',
      expect.any(Blob),
      'image/jpeg'
    );
  });

  it('signs an existing grid without requiring or downloading the primary', async () => {
    const env = {
      ENVIRONMENT: 'production',
      MEDIA_STORAGE_MODE: 'r2-first'
    } as Env;
    mocks.cardImageExists.mockImplementation(async (_env, path) => (
      path === 'user-1/generated/job-grid_grid.jpg'
    ));

    await expect(ensureGridPathForSigning(
      context(env),
      'user-1/generated/job-grid_grid.jpg',
      'grid',
      { requireExistingPrimary: true }
    )).resolves.toBe('user-1/generated/job-grid_grid.jpg');

    expect(mocks.uploadCardImage).not.toHaveBeenCalled();
    expect(mocks.downloadCardImage).not.toHaveBeenCalled();
  });

  it('returns an explicit not-found error instead of signing when the primary is gone', async () => {
    const env = {
      ENVIRONMENT: 'production',
      MEDIA_STORAGE_MODE: 'r2-first'
    } as Env;
    mocks.cardImageExists.mockResolvedValue(false);

    const promise = ensureGridPathForSigning(
      context(env),
      'user-1/generated/missing.jpg',
      'full',
      { requireExistingPrimary: true }
    );

    await expect(promise).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND'
    });
    expect(mocks.uploadCardImage).not.toHaveBeenCalled();
  });

  it('does not accept a development path guess when strict storage checking is requested', async () => {
    const env = {
      ENVIRONMENT: 'development',
      MEDIA_STORAGE_MODE: 'r2'
    } as Env;
    mocks.cardImageExists.mockResolvedValue(false);

    await expect(ensureGridPathForSigning(
      context(env),
      'user-1/generated/missing.jpg',
      'full',
      { requireExistingPrimary: true, strictStorageCheck: true }
    )).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND'
    });
  });
});

describe('full image CDN validation', () => {
  const env = {
    ENVIRONMENT: 'production',
    MEDIA_STORAGE_MODE: 'r2-first'
  } as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createAdminClient.mockReturnValue({});
    mocks.deleteFromR2.mockResolvedValue(false);
    mocks.downloadCardImage.mockResolvedValue(null);
    mocks.uploadCardImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves and marks a full image only after its magic bytes validate', async () => {
    const cache = {
      match: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true)
    };
    vi.stubGlobal('caches', { default: cache });
    mocks.downloadCardImage.mockResolvedValue(blob(jpegBytes(), 'application/octet-stream'));

    const response = await serveCachedStorageImage(
      mediaContext(env),
      'user-1/generated/job-1.jpg'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-ph-image-ok')).toBe('1');
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('removes a corrupt R2 object and serves a valid storage fallback', async () => {
    const cache = {
      match: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true)
    };
    vi.stubGlobal('caches', { default: cache });
    const corrupt = blob(new TextEncoder().encode('<html>' + 'x'.repeat(4096)), 'image/jpeg');
    const fallback = blob(pngBytes(), 'image/png');
    mocks.downloadCardImage
      .mockResolvedValueOnce(corrupt)
      .mockResolvedValueOnce(fallback);
    mocks.deleteFromR2.mockResolvedValue(true);

    const response = await serveCachedStorageImage(
      mediaContext(env),
      'user-1/generated/job-1.jpg'
    );

    expect(mocks.deleteFromR2).toHaveBeenCalledWith(env, 'user-1/generated/job-1.jpg');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(mocks.uploadCardImage).toHaveBeenCalledWith(
      env,
      'user-1/generated/job-1.jpg',
      fallback,
      'image/png'
    );
  });

  it('rejects a corrupt full image when no valid fallback exists', async () => {
    const cache = {
      match: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true)
    };
    vi.stubGlobal('caches', { default: cache });
    const corrupt = blob(new TextEncoder().encode('{"error":"not an image"}'.padEnd(1024)), 'image/jpeg');
    mocks.downloadCardImage
      .mockResolvedValueOnce(corrupt)
      .mockResolvedValueOnce(null);
    mocks.deleteFromR2.mockResolvedValue(true);

    await expect(serveCachedStorageImage(
      mediaContext(env),
      'user-1/cards/bad.jpg'
    )).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    expect(cache.put).not.toHaveBeenCalled();
  });
});
