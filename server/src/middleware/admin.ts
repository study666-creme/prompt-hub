import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../lib/errors';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireAdminSecret(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const secret = c.env.ADMIN_API_SECRET?.trim();
  if (!secret) {
    throw new ApiError(
      503,
      'ADMIN_NOT_CONFIGURED',
      '管理员接口未配置 ADMIN_API_SECRET'
    );
  }
  const provided =
    c.req.header('X-Admin-Secret')?.trim() ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  if (!provided || !timingSafeEqual(provided, secret)) {
    throw new ApiError(401, 'UNAUTHORIZED', '管理员密钥无效');
  }
  await next();
}
