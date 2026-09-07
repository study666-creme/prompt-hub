import type { Context } from 'hono';
import { parseCorsOrigins, type Env } from '../env';

/** 与 middleware/cors.ts 共用，保证错误响应也带 CORS 头 */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowlist: string[]
): boolean {
  if (!origin) return false;
  if (allowlist.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return u.protocol === 'http:' || u.protocol === 'https:';
    }
    if (u.protocol !== 'https:') return false;
    if (host === 'prompt-hubs.com' || host === 'www.prompt-hubs.com') return true;
    if (host === 'prompt-hub.cn' || host === 'www.prompt-hub.cn') return true;
    if (host.endsWith('.prompt-hub-hub.pages.dev')) return true;
    if (host.endsWith('.prompt-hub-web.pages.dev')) return true;
    // vercel.app / chrome-extension:// 不做通配放行：任何人在 vercel.app 部署
    // 页面、或发布任意扩展，都能借这两个后缀发起带凭据跨域请求。具体白名单
    // 域名（见 CORS_ORIGINS）走上方 allowlist.includes 精确匹配；官方浏览器
    // 扩展的 background 请求持 host_permissions，本身不受 CORS 约束。
  } catch {
    return false;
  }
  return false;
}

export function applyCorsHeaders(c: Context) {
  const env = c.env as Env;
  const origin = c.req.header('Origin');
  const allowlist = parseCorsOrigins(env.CORS_ORIGINS || '');
  if (!origin || !isAllowedCorsOrigin(origin, allowlist)) return;
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Vary', 'Origin');
}

export function isSchemaMigrationError(err: unknown): boolean {
  const msg = extractErrorMessage(err);
  const code = (err as { code?: string })?.code;
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    /membership_task_claims|membership_task_flags|lifetime_credits_spent/i.test(
      msg
    ) ||
    /does not exist|Could not find the table|schema cache/i.test(msg) ||
    (code === '42501' && /membership_task_claims/i.test(msg))
  );
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || '';
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.details === 'string' && o.details) return o.details;
    if (typeof o.hint === 'string' && o.hint) return o.hint;
    try {
      return JSON.stringify(err);
    } catch {
      return '';
    }
  }
  return String(err ?? '');
}
