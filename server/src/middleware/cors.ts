import { cors } from 'hono/cors';
import { parseCorsOrigins } from '../env';
import type { Env } from '../env';

function isAllowedCorsOrigin(origin: string | undefined, allowlist: string[]): boolean {
  if (!origin) return false;
  if (allowlist.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.prompt-hub-hub.pages.dev')) return true;
    if (host.endsWith('.prompt-hub-web.pages.dev')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  } catch {
    return false;
  }
  return false;
}

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
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
    credentials: true
  });
}
