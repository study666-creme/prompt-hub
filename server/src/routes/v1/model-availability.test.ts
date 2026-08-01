import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';
import { modelCatalogRoutes } from './models';
import { videoRoutes } from './video';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function reviewedVideoCatalog(upstream: string, publicId: string) {
  return {
    success: true,
    version: 'availability-route-test',
    pricing_version: 'availability-pricing-test',
    models: [{
      id: upstream,
      public: { id: publicId, label: 'Public video model', description: 'Reviewed public video model.' },
      modality: 'video',
      operation: 'generate',
      selectable: true,
      order: 0,
      endpoint: { method: 'POST', path: '/v1/videos', content_type: 'application/json' },
      parameters: [],
      pricing: { mode: 'fixed', unit: 'request', yuan: 1 }
    }]
  };
}

function testEnv(baseUrl: string): Env {
  return {
    ENVIRONMENT: 'development',
    CORS_ORIGINS: '',
    NEWAPI_API_KEY: 'execution-route-key',
    NEWAPI_API_BASE_URL: baseUrl,
    VIDEO_GENERATION_QUEUE: { send: vi.fn() }
  } as unknown as Env;
}

function modelApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/models', modelCatalogRoutes);
  app.onError((error, c) => jsonError(c, error));
  return app;
}

function videoApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 'availability-route-user', phoneVerified: true });
    await next();
  });
  app.route('/video', videoRoutes);
  app.onError((error, c) => jsonError(c, error));
  return app;
}

function addDatabaseAccessSentinel(env: Env) {
  const accessed = vi.fn();
  for (const property of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
    Object.defineProperty(env, property, {
      configurable: true,
      get() {
        accessed(property);
        throw new Error(`database accessed before availability check: ${property}`);
      }
    });
  }
  return accessed;
}

function videoRequest(model: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'Route-level availability test' })
  };
}

describe('New API executable model routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns only reviewed models visible to the execution credential', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect((init?.method || 'GET').toUpperCase()).toBe('GET');
      if (url.endsWith('/v1/models')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer execution-route-key');
        return jsonResponse({ object: 'list', data: [{ id: 'executable-upstream' }, { id: 'not-reviewed' }] });
      }
      if (url.includes('/api/model-catalog')) {
        return jsonResponse({
          ...reviewedVideoCatalog('executable-upstream', 'executable-public'),
          models: [
            reviewedVideoCatalog('executable-upstream', 'executable-public').models[0],
            { ...reviewedVideoCatalog('catalog-only-upstream', 'catalog-only-public').models[0], order: 1 }
          ]
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await modelApp().request('/models?refresh=1', undefined, testEnv('https://models-route.test/api'));
    const payload = await response.json() as { ok: boolean; data: { models: Array<Record<string, unknown>> } };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.models.map(model => model.id)).toEqual(['executable-public']);
    expect(JSON.stringify(payload)).not.toContain('executable-upstream');
    expect(JSON.stringify(payload)).not.toContain('execution-route-key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails before database, credit, or task work when executable availability is uncertain', async () => {
    const env = testEnv('https://video-uncertain-route.test');
    const databaseAccessed = addDatabaseAccessSentinel(env);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) return jsonResponse({ error: 'temporarily unavailable' }, 503);
      if (url.includes('/api/model-catalog')) return jsonResponse(reviewedVideoCatalog('video-upstream', 'video-public'));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await videoApp().request('/video', videoRequest('video-public'), env);
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(databaseAccessed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a reviewed model absent from the executable list before database, credit, or task work', async () => {
    const env = testEnv('https://video-absent-route.test');
    const databaseAccessed = addDatabaseAccessSentinel(env);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) return jsonResponse({ object: 'list', data: [{ id: 'another-video' }] });
      if (url.includes('/api/model-catalog')) return jsonResponse(reviewedVideoCatalog('video-upstream', 'video-public'));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await videoApp().request('/video', videoRequest('video-public'), env);
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('MODEL_UNAVAILABLE');
    expect(databaseAccessed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
