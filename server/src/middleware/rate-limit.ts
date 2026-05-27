import { createMiddleware } from 'hono/factory';
import { applyCorsHeaders } from '../lib/cors-headers';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 简易速率限制（单实例；生产建议 Cloudflare Rate Limiting / KV） */
export function rateLimit(max: number, windowMs: number) {
  return createMiddleware(async (c, next) => {
    const user = c.get('user') as { id: string } | undefined;
    const key = user?.id || c.req.header('cf-connecting-ip') || 'anon';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      applyCorsHeaders(c);
      return c.json(
        {
          ok: false,
          error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' }
        },
        429
      );
    }
    await next();
  });
}
