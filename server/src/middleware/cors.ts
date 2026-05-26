import { cors } from 'hono/cors';
import { parseCorsOrigins } from '../env';
import type { Env } from '../env';

export function createCorsMiddleware(env: Env) {
  const origins = parseCorsOrigins(env.CORS_ORIGINS || '');
  const isProd = env.ENVIRONMENT === 'production';
  return cors({
    origin: origin => {
      if (!origins.length) {
        if (isProd) return null;
        return '*';
      }
      if (origin && origins.includes(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
    credentials: true
  });
}
