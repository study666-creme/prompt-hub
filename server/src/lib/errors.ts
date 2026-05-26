import type { Context } from 'hono';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(c: Context, err: unknown) {
  if (err instanceof ApiError) {
    return c.json(
      {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? undefined
        }
      },
      err.status as 400
    );
  }
  console.error(err);
  return c.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误'
      }
    },
    500
  );
}
