import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../lib/errors';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 浏览器 fetch 的 Header 只能是 Latin-1；网页后台用 b64: 前缀传 UTF-8 密钥 */
function decodeAdminSecretProvided(raw: string): string {
  const s = raw.trim();
  if (!s.startsWith('b64:')) return s;
  try {
    const binary = atob(s.slice(4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return s;
  }
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
  const rawProvided =
    c.req.header('X-Admin-Secret')?.trim() ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  const provided = decodeAdminSecretProvided(rawProvided);
  if (!provided || !timingSafeEqual(provided, secret)) {
    throw new ApiError(401, 'UNAUTHORIZED', '管理员密钥无效');
  }
  await next();
}
