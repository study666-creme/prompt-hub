import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const supabaseMocks = vi.hoisted(() => ({
  createAdminClient: vi.fn()
}));

vi.mock('./supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabase')>()),
  createAdminClient: supabaseMocks.createAdminClient
}));

import {
  archiveRemoteImage,
  isDataImageUrl,
  isParseableDataImageUrl,
  isStorageRef
} from './image-archive';

function imageBytes(mime: string, size = 1024): Uint8Array {
  const bytes = new Uint8Array(size);
  if (mime === 'image/jpeg') {
    bytes.set([0xff, 0xd8, 0xff]);
  } else if (mime === 'image/png') {
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  } else if (mime === 'image/webp') {
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  }
  return bytes;
}

function storageAdmin(store: Map<string, Uint8Array>) {
  const upload = vi.fn(async (path: string, body: ArrayBuffer) => {
    store.set(path, new Uint8Array(body));
    return { error: null };
  });
  const download = vi.fn(async (path: string) => {
    const bytes = store.get(path);
    return bytes
      ? { data: new Blob([bytes]), error: null }
      : { data: null, error: { message: 'not found' } };
  });
  const list = vi.fn(async () => ({ data: [], error: null }));
  return {
    client: { storage: { from: () => ({ upload, download, list }) } },
    upload
  };
}

function memoryR2() {
  const store = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, body: ReadableStream | ArrayBuffer | Blob) => {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    store.set(key, bytes);
  });
  const head = vi.fn(async (key: string) => {
    const bytes = store.get(key);
    return bytes ? { size: bytes.byteLength } : null;
  });
  return { bucket: { put, head }, store, put };
}

function streamRejectingR2() {
  const store = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, body: ReadableStream | ArrayBuffer | Blob) => {
    if (body instanceof ReadableStream) throw new TypeError('stream body unsupported');
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    store.set(key, bytes);
  });
  const head = vi.fn(async (key: string) => {
    const bytes = store.get(key);
    return bytes ? { size: bytes.byteLength } : null;
  });
  return { bucket: { put, head }, store, put };
}

describe('image-archive helpers', () => {
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
});

describe('archiveRemoteImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const admin = storageAdmin(new Map());
    supabaseMocks.createAdminClient.mockReturnValue(admin.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['application/json', new TextEncoder().encode(JSON.stringify({ error: 'upstream failed' }))],
    ['image/jpeg', new TextEncoder().encode('<html>' + 'x'.repeat(1024) + '</html>')]
  ])('rejects a 200 response whose body is not an image (%s)', async (contentType, body) => {
    const r2 = memoryR2();
    const admin = storageAdmin(new Map());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': contentType }
    })));

    await expect(archiveRemoteImage(
      admin.client as never,
      'user-1',
      'job-1',
      'https://images.example.test/result',
      {
        maxAttempts: 1,
        env: { MEDIA_STORAGE_MODE: 'r2-first', CARD_IMAGES_R2: r2.bucket } as unknown as Env
      }
    )).rejects.toThrow('fetch_image_failed_200');

    expect(r2.put).not.toHaveBeenCalled();
    expect(admin.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
  ])('archives a valid %s response', async (mime, extension) => {
    const r2 = memoryR2();
    const admin = storageAdmin(new Map());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(imageBytes(mime), {
      status: 200,
      headers: { 'content-type': mime }
    })));

    const result = await archiveRemoteImage(
      admin.client as never,
      'user-1',
      'job-1',
      'https://images.example.test/result',
      {
        maxAttempts: 1,
        env: { MEDIA_STORAGE_MODE: 'r2', CARD_IMAGES_R2: r2.bucket } as unknown as Env
      }
    );

    expect(result).toBe(`storage://card-images/user-1/generated/job-1.${extension}`);
    expect(r2.store.get(`user-1/generated/job-1.${extension}`)?.slice(0, 12))
      .toEqual(imageBytes(mime, 12));
  });

  it('does not consume the response through R2 when storage mode is supabase', async () => {
    const r2 = memoryR2();
    const admin = storageAdmin(new Map());
    supabaseMocks.createAdminClient.mockReturnValue(admin.client);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(imageBytes('image/jpeg'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    })));

    await expect(archiveRemoteImage(
      admin.client as never,
      'user-1',
      'job-1',
      'https://images.example.test/result',
      {
        maxAttempts: 1,
        env: { MEDIA_STORAGE_MODE: 'supabase', CARD_IMAGES_R2: r2.bucket } as unknown as Env
      }
    )).resolves.toBe('storage://card-images/user-1/generated/job-1.jpg');

    expect(r2.put).not.toHaveBeenCalled();
    expect(admin.upload).toHaveBeenCalledOnce();
  });

  it('falls back to a buffered R2 upload when the runtime rejects the response stream', async () => {
    const r2 = streamRejectingR2();
    const admin = storageAdmin(new Map());
    const fetchMock = vi.fn(async () => new Response(imageBytes('image/jpeg'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(archiveRemoteImage(
      admin.client as never,
      'user-1',
      'job-stream-fallback',
      'https://images.example.test/result',
      {
        maxAttempts: 1,
        env: { MEDIA_STORAGE_MODE: 'r2', CARD_IMAGES_R2: r2.bucket } as unknown as Env
      }
    )).resolves.toBe('storage://card-images/user-1/generated/job-stream-fallback.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r2.put).toHaveBeenCalledTimes(2);
    expect(r2.store.get('user-1/generated/job-stream-fallback.jpg')).toBeDefined();
  });
});
