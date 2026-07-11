import { Hono } from 'hono';
import { applyCorsHeaders } from './lib/cors-headers';
import { jsonError } from './lib/errors';
import { recordRequestMetric } from './lib/monitoring';
import { diagnoseSupabaseUpstream } from './lib/supabase-upstream';
import { drainFastProviderPendingSubmits } from './lib/fast-provider-drain';
import { processFastProviderQueueMessage } from './lib/fast-provider-queue';
import { createCorsMiddleware } from './middleware/cors';
import { adminRoutes } from './routes/admin';
import { supabaseProxyHandler } from './routes/supabase-proxy';
import { v1 } from './routes/v1';
import { webhookRoutes } from './routes/webhooks/payment';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  applyCorsHeaders(c);
  const corsMw = createCorsMiddleware(c.env);
  return corsMw(c, next);
});

/** 确保错误/边缘响应也带 CORS（避免浏览器只报 CORS 不报真实 500） */
app.use('*', async (c, next) => {
  try {
    await next();
  } finally {
    applyCorsHeaders(c);
  }
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
  let hint: string | undefined;
  if (db === 'misconfigured') {
    hint =
      'SUPABASE_SERVICE_ROLE_KEY 需为 service_role（Legacy eyJ），请 wrangler secret put 后重新 deploy';
  } else if (db === 'error') {
    hint = (await diagnoseSupabaseUpstream(c.env)) || '执行 scripts/apply-grants-once.sql';
  }
  return c.json({
    ok: db === 'ok',
    service: 'prompt-hub-api',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT,
    supabase: db,
    imageProviders: {
      newapi: c.env.NEWAPI_API_KEY?.trim() ? 'configured' : 'missing',
      midjourney: c.env.APIMART_API_KEY?.trim() ? 'configured' : 'missing'
    },
    hint
  });
});

app.get('/api/v1/billing/plans', c =>
  c.json({
    ok: true,
    data: {
      plans: [
        {
          id: 'lite',
          name: '轻量会员包',
          genDiscount: null,
          dailyCredits: 10,
          lumpCredits: 0
        },
        {
          id: 'basic',
          name: '基础版',
          genDiscount: '95折',
          dailyCredits: 13,
          lumpCredits: 130
        },
        {
          id: 'standard',
          name: '标准版',
          genDiscount: '9折',
          dailyCredits: 32,
          lumpCredits: 320
        },
        {
          id: 'pro',
          name: '专业版',
          genDiscount: '85折',
          dailyCredits: 64,
          lumpCredits: 700
        }
      ],
      note: '支付 webhook 待接入；免费会员请完成任务中心领取（直接到账，无需激活码）'
    }
  })
);

app.all('/supabase/*', supabaseProxyHandler);

app.route('/api/v1/webhooks', webhookRoutes);

app.route('/api/admin', adminRoutes);

app.route('/api/v1', v1);

app.onError((err, c) => jsonError(c, err));

app.notFound(c => {
  applyCorsHeaders(c);
  return c.json(
    { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } },
    404
  );
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const startedAt = Date.now();
    try {
      const response = await app.fetch(request, env, ctx);
      ctx.waitUntil(recordRequestMetric(env, request, response, Date.now() - startedAt));
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.waitUntil(
        recordRequestMetric(
          env,
          request,
          new Response(null, { status: 500 }),
          Date.now() - startedAt,
          { message: msg }
        )
      );
      throw err;
    }
  },
  async queue(
    batch: MessageBatch<{ jobId: string; userId: string }>,
    env: Env
  ) {
    for (const message of batch.messages) {
      try {
        const result = await processFastProviderQueueMessage(env, message.body);
        if (result === 'retry') message.retry({ delaySeconds: 60 });
        else message.ack();
      } catch (error) {
        console.error('[image-queue] consume failed', message.id, error);
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await drainFastProviderPendingSubmits(env, { awaitSubmit: true, maxSubmit: 2 });
  }
};
