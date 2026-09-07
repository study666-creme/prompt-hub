import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureCanvasVideoKey, resolveCanvasVideoKey } from './canvas-video-token';

function env(overrides: Record<string, unknown> = {}) {
  return {
    NEWAPI_VIDEO_API_KEY: 'sk-admin-video',
    NEWAPI_API_KEY: '',
    NEWAPI_API_BASE_URL: 'https://newapi.test',
    NEWAPI_CATALOG_ADMIN_SECRET: 'catalog-secret',
    PROMPT_HUB_METRICS: overrides.PROMPT_HUB_METRICS ?? null,
  } as never;
}

describe('canvas video token resolution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the per-user token when the KV mapping exists', async () => {
    const get = vi.fn(async () => 'canvasUserTokenAbc');
    const key = await resolveCanvasVideoKey(env({ PROMPT_HUB_METRICS: { get } }), 'ab5c77dc-570e-4af7-ac38-2d311be96244');
    expect(key).toBe('canvasUserTokenAbc');
    expect(get).toHaveBeenCalledWith('canvas-video-token:ab5c77dc-570e-4af7-ac38-2d311be96244');
  });

  it('falls back to the admin key on a KV miss', async () => {
    const get = vi.fn(async () => null);
    const key = await resolveCanvasVideoKey(env({ PROMPT_HUB_METRICS: { get } }), 'some-user');
    expect(key).toBe('sk-admin-video');
  });

  it('falls back to the admin key when KV read fails', async () => {
    const get = vi.fn(async () => { throw new Error('kv down'); });
    const key = await resolveCanvasVideoKey(env({ PROMPT_HUB_METRICS: { get } }), 'some-user');
    expect(key).toBe('sk-admin-video');
  });

  it('falls back when no user id is available', async () => {
    const get = vi.fn();
    const key = await resolveCanvasVideoKey(env({ PROMPT_HUB_METRICS: { get } }), undefined);
    expect(key).toBe('sk-admin-video');
    expect(get).not.toHaveBeenCalled();
  });

  it('returns undefined when no video key is configured at all', async () => {
    const key = await resolveCanvasVideoKey({ NEWAPI_API_KEY: '', PROMPT_HUB_METRICS: null } as never, 'any-user');
    expect(key).toBeUndefined();
  });

  it('allocates a token through the catalog endpoint on first use and caches it', async () => {
    const kvStore = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://newapi.test/api/model-catalog/admin/ensure-canvas-token');
      expect(String((init?.headers as Record<string, string>)['x-catalog-admin-secret'])).toBe('catalog-secret');
      expect(JSON.parse(String(init?.body))).toEqual({ userId: 'brand-new-user-abcd' });
      return new Response(JSON.stringify({ success: true, key: 'allocatedCanvasKey123', name: 'canvas-brand-ne', created: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await ensureCanvasVideoKey(env({ PROMPT_HUB_METRICS: kv }), 'brand-new-user-abcd');
    expect(first).toBe('allocatedCanvasKey123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith('canvas-video-token:brand-new-user-abcd', 'allocatedCanvasKey123');

    // Second call is served from the KV cache.
    const second = await ensureCanvasVideoKey(env({ PROMPT_HUB_METRICS: kv }), 'brand-new-user-abcd');
    expect(second).toBe('allocatedCanvasKey123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the admin key when the catalog allocation fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const key = await ensureCanvasVideoKey(env({ PROMPT_HUB_METRICS: { get: async () => null, put: async () => undefined } }), 'some-user');
    expect(key).toBe('sk-admin-video');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips allocation when no catalog secret is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const key = await ensureCanvasVideoKey(
      { NEWAPI_VIDEO_API_KEY: 'sk-admin-video', NEWAPI_API_KEY: '', PROMPT_HUB_METRICS: { get: async () => null, put: async () => undefined } } as never,
      'some-user',
    );
    expect(key).toBe('sk-admin-video');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
