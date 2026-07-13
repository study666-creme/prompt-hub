import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadCardImage, uploadCardImage, buildPrivateMediaCdnUrl } = vi.hoisted(() => ({
  downloadCardImage: vi.fn(),
  uploadCardImage: vi.fn(),
  buildPrivateMediaCdnUrl: vi.fn(async (_c: unknown, path: string) => `https://api.example/private/${path}`)
}));

vi.mock('./image-archive', () => ({
  generationStorageAssetId: (jobId: string) => String(jobId).replace(/#/g, '-'),
  isStorageRef: (value: string) => String(value).startsWith('storage://'),
  storagePathFromRef: (value: string) => String(value).replace(/^storage:\/\/card-images\//, '')
}));

vi.mock('./r2-storage', () => ({
  downloadCardImage,
  uploadCardImage,
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
});
