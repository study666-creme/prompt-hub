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
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
    credentials: true
  });
}
