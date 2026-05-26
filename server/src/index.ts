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

app.get('/health', async c => {
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  let db: 'ok' | 'misconfigured' | 'error' = 'ok';
  if (!key || key.startsWith('sb_publishable_')) {
    db = 'misconfigured';
  } else if (c.env.SUPABASE_URL) {
    try {
      const { createAdminClient } = await import('./lib/supabase');
      const admin = createAdminClient(c.env);
      const { error } = await admin.from('activation_codes').select('code').limit(1);
      if (error) db = 'error';
    } catch {
      db = 'error';
    }
  }
  return c.json({
    ok: db === 'ok',
    service: 'prompt-hub-api',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT,
    supabase: db,
    hint:
      db === 'misconfigured'
        ? 'SUPABASE_SERVICE_ROLE_KEY 需为 sb_secret_，请 wrangler secret put 后重新 deploy'
        : db === 'error'
          ? '执行 scripts/apply-grants-once.sql'
          : undefined
  });
});

app.get('/api/v1/billing/plans', c =>
  c.json({
    ok: true,
    data: {
      plans: [
        {
          id: 'basic',
          name: '基础版',
          genDiscount: '9折',
          dailyCredits: 10,
          lumpCredits: 100
        },
        {
          id: 'standard',
          name: '标准版',
          genDiscount: '8折',
          dailyCredits: 10,
          lumpCredits: 310
        },
        {
          id: 'pro',
          name: '专业版',
          genDiscount: '7折',
          dailyCredits: 10,
          lumpCredits: 1000
        }
      ],
      trial: { freeDays: 3, dailyCredits: 10, starterDays: 14, starterPriceYuan: 1.9 },
      note: '支付 webhook 待接入；试用与 ¥1.9 续杯见 /api/v1/membership 与激活码 STARTER-19-14D'
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
