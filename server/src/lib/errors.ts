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
  const msg = err instanceof Error ? err.message : String(err);
  const configHint =
    msg.includes('sb_secret_') || msg.includes('Publishable')
      ? '请在 server 执行 npm run secret-service-role 并粘贴 sb_secret_ 密钥后 npm run deploy'
      : undefined;
  return c.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: configHint || '服务器内部错误',
        details: configHint ? undefined : msg.slice(0, 200)
      }
    },
    500
  );
}
