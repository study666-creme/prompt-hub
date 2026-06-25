import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminDiagnosticsRoutes = new Hono<{ Bindings: Env }>();

adminDiagnosticsRoutes.use('*', requireAdminSecret);
/** 单次冒烟：最多 36 次轮询，间隔 4–5s，禁止并发刷请求 */
adminDiagnosticsRoutes.use('*', rateLimit(3, 60_000));

adminDiagnosticsRoutes.post('/apimart-smoke', async c => {
  const key = c.env.APIMART_API_KEY?.trim();
  if (!key) return c.json({ ok: false, error: 'APIMART_API_KEY missing' }, 500);
  let body: { model?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* optional body */
  }
  const upstream = String(body.model || 'wan2.7-image').trim();
  const { submitApimartImageJob, fetchApimartTaskOnce } = await import('../../lib/apimart');
  const params = {
    upstreamModel: upstream,
    prompt: 'a single red apple on white background, product photo',
    resolution: '1k' as const,
    quality: 'high' as const,
    size: '1:1'
  };
  const taskId = await submitApimartImageJob(key, c.env.APIMART_API_BASE_URL, params);
  const maxPolls = 36;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 4000 : 5000));
    const polled = await fetchApimartTaskOnce(key, c.env.APIMART_API_BASE_URL, taskId);
    if (polled.status === 'completed' && polled.imageUrl) {
      return c.json({ ok: true, upstream, taskId, imageUrl: polled.imageUrl, polls: i + 1 });
    }
    if (polled.status === 'failed') {
      return c.json({ ok: false, upstream, taskId, error: polled.errorMessage, polls: i + 1 }, 502);
    }
  }
  return c.json({ ok: false, upstream, taskId, error: 'timeout' }, 504);
});
