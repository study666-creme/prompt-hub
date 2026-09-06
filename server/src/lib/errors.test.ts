import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ApiError, jsonError } from './errors';

function errorApp(path: string, error: ApiError) {
  const app = new Hono<{ Bindings: { CORS_ORIGINS?: string } }>();
  app.get(path, () => {
    throw error;
  });
  app.onError((err, c) => jsonError(c, err));
  return app;
}

function request(app: ReturnType<typeof errorApp>, path: string) {
  return app.request(path, undefined, { CORS_ORIGINS: '' });
}

describe('public error projection', () => {
  it.each([
    ['UPSTREAM_ERROR', 502],
    ['SUPABASE_UPSTREAM', 502],
    ['DB_ERROR', 500],
    ['SERVER_CONFIG', 503],
    ['APIMART_ERROR', 502]
  ])('maps internal code %s to a public service error', async (code, status) => {
    const app = errorApp(
      '/api/v1/test',
      new ApiError(status, code, 'upstream provider database failure', { route: 2 })
    );

    const response = await request(app, '/api/v1/test');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用，请稍后重试'
      }
    });
  });

  it('keeps reviewed business codes on ordinary-user routes', async () => {
    const app = errorApp(
      '/api/v1/test',
      new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足')
    );

    const response = await request(app, '/api/v1/test');
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: '积分不足'
      }
    });
  });

  it('does not expose messages attached to unreviewed error codes', async () => {
    const app = errorApp(
      '/api/v1/test',
      new ApiError(502, 'PRIVATE_BACKEND_FAILURE', 'model mapping alpha-7 rejected the request')
    );

    const response = await request(app, '/api/v1/test');
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用，请稍后重试'
      }
    });
  });

  it('preserves private diagnostics on administrator routes', async () => {
    const app = errorApp(
      '/api/admin/test',
      new ApiError(502, 'UPSTREAM_ERROR', 'provider route failed', { channel: 2 })
    );

    const response = await request(app, '/api/admin/test');
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'provider route failed',
        details: { channel: 2 }
      }
    });
  });
});
