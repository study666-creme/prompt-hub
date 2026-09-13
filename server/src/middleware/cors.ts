import { cors } from 'hono/cors';
import { parseCorsOrigins } from '../env';
import type { Env } from '../env';
import { isAllowedCorsOrigin } from '../lib/cors-headers';

export function createCorsMiddleware(env: Env) {
  const origins = parseCorsOrigins(env.CORS_ORIGINS || '');
  const isProd = env.ENVIRONMENT === 'production';
  return cors({
    origin: origin => {
      if (!origins.length) {
        if (isProd) return null;
        return '*';
      }
      if (isAllowedCorsOrigin(origin, origins)) return origin;
      return null;
    },
    // PUT：管理端公告等整体保存接口使用；缺失时浏览器预检会拦下真实请求，
    // 前端表现为「无法连接 API」（2026-09-13 公告管理实测）。
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-Admin-Secret',
      'apikey',
      'x-client-info',
      'prefer',
      'x-supabase-api-version',
      'accept',
      'accept-profile',
      'content-profile'
    ],
    maxAge: 86400,
    credentials: true
  });
}
