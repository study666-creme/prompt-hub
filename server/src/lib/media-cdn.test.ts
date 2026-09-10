import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  cardImageExists: vi.fn(),
  deleteFromR2: vi.fn(),
  downloadCardImage: vi.fn(),
  existsInR2: vi.fn(async () => false),
  uploadCardImage: vi.fn()
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

vi.mock('./r2-storage', () => ({
  cardImageExists: mocks.cardImageExists,
  deleteFromR2: mocks.deleteFromR2,
  downloadCardImage: mocks.downloadCardImage,
  existsInR2: mocks.existsInR2,
  uploadCardImage: mocks.uploadCardImage
}));

import { buildPrivateMediaFileUrl, decodeStoragePath, ensureGridPathForSigning, privateMediaContentType, serveCachedStorageImage, serveCachedStorageMedia } from './media-cdn';

function context(env: Env): Context<{ Bindings: Env }> {
  return { env } as Context<{ Bindings: Env }>;
}

function bytes(size = 4096): Uint8Array {
  return new Uint8Array(size);
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

  it('falls back to the existing primary path when grid materialization fails', async () => {
    const env = {
      ENVIRONMENT: 'production',
      MEDIA_STORAGE_MODE: 'r2-first'
    } as Env;
    mocks.createAdminClient.mockReturnValue({});
    mocks.cardImageExists.mockImplementation(async (_env, path) => (
      path === 'user-1/generated/job-1.jpg'
    ));
    mocks.downloadCardImage.mockResolvedValue(null);
    mocks.uploadCardImage.mockResolvedValue(undefined);

    const result = await ensureGridPathForSigning(
      context(env),
      'user-1/generated/job-1.jpg',
      'grid'
    );

    expect(result).toBe('user-1/generated/job-1.jpg');
    expect(mocks.uploadCardImage).not.toHaveBeenCalled();
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

describe('private media file CDN (reference videos and audios)', () => {
  const env = {
    ENVIRONMENT: 'production',
    MEDIA_STORAGE_MODE: 'r2-first',
    ADMIN_API_SECRET: 'test-media-signing-secret'
  } as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createAdminClient.mockReturnValue({});
    mocks.downloadCardImage.mockResolvedValue(null);
    mocks.uploadCardImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps media extensions to their content type and rejects image paths', () => {
    expect(privateMediaContentType('user-1/canvas/video/a.mp4')).toBe('video/mp4');
    expect(privateMediaContentType('user-1/canvas/video/a.MOV')).toBe('video/quicktime');
    expect(privateMediaContentType('user-1/canvas/audio/a.m4a')).toBe('audio/mp4');
    expect(privateMediaContentType('user-1/canvas/audio/a.mp3')).toBe('audio/mpeg');
    expect(privateMediaContentType('user-1/generated/a.jpg')).toBeNull();
    expect(privateMediaContentType('user-1/canvas/video/no-extension')).toBeNull();
  });

  it('serves a stored reference video without image sniffing', async () => {
    const video = blob(bytes(8192), 'application/octet-stream');
    mocks.downloadCardImage.mockResolvedValue(video);

    const response = await serveCachedStorageMedia(
      mediaContext(env),
      'user-1/canvas/video/reference.mp4'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe('8192');
    expect(response.headers.get('x-ph-media-ok')).toBe('1');
  });

  it('refuses non-media objects so the route cannot proxy arbitrary storage keys', async () => {
    await expect(serveCachedStorageMedia(
      mediaContext(env),
      'user-1/generated/job-1.jpg'
    )).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(mocks.downloadCardImage).not.toHaveBeenCalled();
  });

  it('reports a missing media object as not found', async () => {
    mocks.downloadCardImage.mockResolvedValue(null);

    await expect(serveCachedStorageMedia(
      mediaContext(env),
      'user-1/canvas/video/gone.mp4'
    )).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('signs a stored video reference onto the media route', async () => {
    const url = await buildPrivateMediaFileUrl(
      mediaContext(env),
      'user-1/canvas/video/reference.mp4'
    );
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://api.example.test');
    expect(parsed.pathname.startsWith('/api/v1/media/m/')).toBe(true);
    expect(parsed.searchParams.get('e')).toBeTruthy();
    expect(parsed.searchParams.get('s')).toBeTruthy();
    expect(decodeStoragePath(parsed.pathname.slice('/api/v1/media/m/'.length)))
      .toBe('user-1/canvas/video/reference.mp4');
  });
});
