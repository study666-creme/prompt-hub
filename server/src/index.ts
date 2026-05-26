import { Hono } from 'hono';
import { jsonError } from './lib/errors';
import { createCorsMiddleware } from './middleware/cors';
import { adminRoutes } from './routes/admin';
import { v1 } from './routes/v1';
import { webhookRoutes } from './routes/webhooks/payment';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const corsMw = createCorsMiddleware(c.env);
  return corsMw(c, next);
});

app.get('/health', c =>
  c.json({
    ok: true,
    service: 'prompt-hub-api',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT
  })
);

app.get('/api/v1/billing/plans', c =>
  c.json({
    ok: true,
    data: {
      plans: [
        { id: 'basic', name: '基础版', genDiscount: '9折', monthlyCredits: 100 },
        { id: 'standard', name: '标准版', genDiscount: '8折', monthlyCredits: 310 },
        { id: 'pro', name: '专业版', genDiscount: '7折', monthlyCredits: 1000 }
      ],
      note: '支付 webhook 待接入；当前请用激活码或联系运营开通'
    }
  })
);

app.route('/api/v1/webhooks', webhookRoutes);

app.route('/api/admin', adminRoutes);

app.route('/api/v1', v1);

app.onError((err, c) => jsonError(c, err));

app.notFound(c =>
  c.json(
    { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } },
    404
  )
);

export default app;
