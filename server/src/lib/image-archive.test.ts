import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const mocks = vi.hoisted(() => ({
  uploadCardImage: vi.fn(),
  cardImageExists: vi.fn()
}));

vi.mock('./mooko', () => ({
  mookoImageFetchCandidates: (url: string) => [url]
}));

vi.mock('./r2-storage', () => ({
  uploadCardImage: mocks.uploadCardImage,
  cardImageExists: mocks.cardImageExists
}));

vi.mock('./media-cdn', () => ({
  storageObjectExistsLight: vi.fn(async () => true)
}));

import {
  archiveGenerationResultUrls,
  archiveRemoteImage,
  isDataImageUrl,
  isParseableDataImageUrl,
  isStorageRef
} from './image-archive';

const env = { MEDIA_STORAGE_MODE: 'r2-first' } as unknown as Env;

describe('image-archive helpers', () => {
  beforeEach(() => {
    mocks.uploadCardImage.mockReset();
    mocks.cardImageExists.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('detects data image urls', () => {
    expect(isDataImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isDataImageUrl('https://gimg.mooko.ai/x.png')).toBe(false);
    expect(isDataImageUrl('storage://card-images/u/gen.png')).toBe(false);
  });

  it('rejects truncated invalid base64 data urls', () => {
    expect(isParseableDataImageUrl('data:image/jpeg;base64,abc!!!')).toBe(false);
    expect(isParseableDataImageUrl('data:image/jpeg;base64,' + 'A'.repeat(200))).toBe(true);
  });

  it('detects storage refs', () => {
    expect(isStorageRef('storage://card-images/u/generated/j1.png')).toBe(true);
    expect(isStorageRef('data:image/png;base64,x')).toBe(false);
  });

  it('downloads a temporary URL once and reuses the bytes for a storage retry', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '4' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.uploadCardImage
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    mocks.cardImageExists.mockResolvedValue(true);

    await expect(archiveRemoteImage(
      {} as never,
      'user-1',
      'job-1',
      'https://temporary.test/result.png',
      { env, maxAttempts: 2 }
    )).resolves.toBe('storage://card-images/user-1/generated/job-1.png');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.uploadCardImage).toHaveBeenCalledTimes(2);
    const firstBytes = mocks.uploadCardImage.mock.calls[0]?.[2] as ArrayBuffer;
    const secondBytes = mocks.uploadCardImage.mock.calls[1]?.[2] as ArrayBuffer;
    expect(new Uint8Array(firstBytes)).toEqual(new Uint8Array(secondBytes));
  });

  it('never falls back to a raw temporary URL when durable storage fails', async () => {
    const raw = 'https://temporary.test/result.png';
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.uploadCardImage.mockRejectedValue(new Error('storage unavailable'));

    await expect(archiveGenerationResultUrls(
      {} as never,
      'user-1',
      'job-2',
      [raw],
      env
    )).rejects.toThrow('storage unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
