import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadCardImage, uploadCardImage, buildPrivateMediaCdnUrl, cardImageExists } = vi.hoisted(() => ({
  downloadCardImage: vi.fn(),
  uploadCardImage: vi.fn(),
  buildPrivateMediaCdnUrl: vi.fn(async (_c: unknown, path: string) => `https://api.example/private/${path}`),
  cardImageExists: vi.fn()
}));

vi.mock('./image-archive', () => ({
  generationStorageAssetId: (jobId: string) => String(jobId).replace(/#/g, '-'),
  isStorageRef: (value: string) => String(value).startsWith('storage://'),
  storagePathFromRef: (value: string) => String(value).replace(/^storage:\/\/card-images\//, '')
}));

vi.mock('./r2-storage', () => ({
  downloadCardImage,
  uploadCardImage,
  cardImageExists,
  hasR2: () => true,
  mediaStorageMode: () => 'r2'
}));

vi.mock('./media-cdn', () => ({
  apiOriginFromRequest: () => 'https://api.example',
  buildPrivateMediaCdnUrl,
  resolveStoragePath: () => null
}));

import { resolveGenerationRefUrls } from './generation-ref-images';

function sourceJobAdmin(jobId = 'source-job') {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: [{ id: jobId }], error: null }))
  };
  return { from: vi.fn(() => chain) };
}

describe('generation reference image stabilization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadCardImage.mockImplementation(async (_env, path: string) =>
      path.endsWith('/generated/source-job.png')
        ? new Blob([new Uint8Array(1024)], { type: 'image/png' })
        : null
    );
    cardImageExists.mockImplementation(async () => false);
  });

  it('rehosts an expired upstream URL from its archived source job', async () => {
    const c = { env: {}, req: { url: 'https://api.example/api/v1/generate' } } as never;
    const admin = sourceJobAdmin() as never;
    const result = await resolveGenerationRefUrls(c, admin, 'user-1', [
      'https://file2.aitohumanize.com/file/expired.png'
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/^https:\/\/api\.example\/private\/user-1\/imagegen\/upstream\//);
    expect(downloadCardImage).toHaveBeenCalledWith(
      {},
      'user-1/generated/source-job.png'
    );
    expect(uploadCardImage).toHaveBeenCalledTimes(1);
    expect(buildPrivateMediaCdnUrl).toHaveBeenCalledTimes(1);
  });

  it('signs an already-stored canvas reference in place without re-upload', async () => {
    cardImageExists.mockImplementation(async (_env, path: string) => path === 'user-1/canvas/frame-1.png');
    downloadCardImage.mockImplementation(async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }));
    const c = { env: {}, req: { url: 'https://api.example/api/v1/video' } } as never;
    const admin = { from: vi.fn() } as never;
    const result = await resolveGenerationRefUrls(c, admin, 'user-1', [
      'storage://card-images/user-1/canvas/frame-1.png',
      'storage://card-images/user-1/canvas/frame-2.png',
      'storage://card-images/user-1/canvas/frame-3.png'
    ]);

    // Existing objects are signed in place; missing ones fall back to re-upload.
    expect(result[0]).toBe('https://api.example/private/user-1/canvas/frame-1.png');
    expect(result[1]).toMatch(/^https:\/\/api\.example\/private\/user-1\/imagegen\/upstream\//);
    expect(result[2]).toMatch(/^https:\/\/api\.example\/private\/user-1\/imagegen\/upstream\//);
    expect(cardImageExists).toHaveBeenCalledTimes(3);
    expect(downloadCardImage).toHaveBeenCalledTimes(2);
    expect(uploadCardImage).toHaveBeenCalledTimes(2);
  });

  it('falls back to re-upload when the storage existence check times out', { timeout: 15_000 }, async () => {
    cardImageExists.mockImplementation(async () => new Promise<boolean>(() => {
      /* never resolves */
    }));
    downloadCardImage.mockImplementation(async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }));
    const c = { env: {}, req: { url: 'https://api.example/api/v1/video' } } as never;
    const admin = { from: vi.fn() } as never;
    const result = await resolveGenerationRefUrls(c, admin, 'user-1', [
      'storage://card-images/user-1/canvas/frame-1.png'
    ]);

    expect(result[0]).toMatch(/^https:\/\/api\.example\/private\/user-1\/imagegen\/upstream\//);
    expect(uploadCardImage).toHaveBeenCalledTimes(1);
  });
});
