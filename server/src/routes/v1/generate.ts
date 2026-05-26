import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { submitApimartImageJob } from '../../lib/apimart';
import { ApiError } from '../../lib/errors';
import {
  assertJobOwner,
  finalizeFailedJob,
  pollAndUpdateJob
} from '../../lib/generation-jobs';
import { computeGenerationCost, type ImageModelId } from '../../lib/pricing';
import {
  createAdminClient,
  getOrCreateProfile,
  isMembershipActive
} from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const bodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.enum(['quanneng2', 'jimeng']).default('quanneng2'),
  resolution: z.enum(['1k', '2k', '4k']).default('1k'),
  quality: z.enum(['standard', 'high', 'ultra']).default('standard'),
  size: z.string().max(32).optional(),
  refImageUrl: z.string().url().optional().nullable(),
  refImageUrls: z.array(z.string().url()).max(16).optional()
});

export const generateRoutes = new Hono<{ Bindings: Env }>();

generateRoutes.use('*', rateLimit(60, 60_000));

generateRoutes.post('/', async c => {
  const user = c.get('user');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的提示词与参数');
  }

  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const modelId = parsed.data.model as ImageModelId;
  const { final, base, discountLabel, modelLabel } = computeGenerationCost(
    modelId,
    parsed.data.resolution,
    profile.membership_tier,
    memberActive
  );

  if (profile.credits < final) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（需要 ${final}，当前 ${profile.credits}）`
    );
  }

  const refUrls =
    parsed.data.refImageUrls?.length
      ? parsed.data.refImageUrls
      : parsed.data.refImageUrl
        ? [parsed.data.refImageUrl]
        : [];

  const { data: job, error: jobErr } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: parsed.data.prompt,
      resolution: parsed.data.resolution,
      quality: parsed.data.quality,
      size_label: parsed.data.size ?? null,
      credits_charged: final,
      status: 'processing',
      meta: {
        model: modelId,
        modelLabel,
        refImageUrls: refUrls,
        base,
        discountLabel,
        size: parsed.data.size ?? null
      }
    })
    .select('id')
    .single();

  if (jobErr) throw jobErr;

  const { error: debitErr } = await admin.rpc('apply_credit_delta', {
    p_user_id: user.id,
    p_delta: -final,
    p_reason: 'image_generation',
    p_ref_id: job.id,
    p_meta: { model: modelId, resolution: parsed.data.resolution, base, discountLabel }
  });

  if (debitErr) {
    await admin
      .from('generation_requests')
      .update({ status: 'failed', error_message: 'debit_failed' })
      .eq('id', job.id);
    if (String(debitErr.message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw debitErr;
  }

  const imageApiKey = c.env.IMAGE_API_KEY;
  let apimartTaskId: string | null = null;

  if (imageApiKey) {
    try {
      apimartTaskId = await submitApimartImageJob(
        imageApiKey,
        c.env.IMAGE_API_BASE_URL,
        {
          modelId,
          prompt: parsed.data.prompt,
          resolution: parsed.data.resolution,
          quality: parsed.data.quality,
          size: parsed.data.size,
          refImageUrls: refUrls
        }
      );
      await admin
        .from('generation_requests')
        .update({
          meta: {
            model: modelId,
            modelLabel,
            refImageUrls: refUrls,
            base,
            discountLabel,
            size: parsed.data.size ?? null,
            apimartTaskId
          }
        })
        .eq('id', job.id);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'upstream_submit_failed';
      await finalizeFailedJob(admin, user.id, {
        id: job.id,
        user_id: user.id,
        credits_charged: final,
        status: 'processing',
        result_image_url: null,
        error_message: null,
        meta: {},
        created_at: new Date().toISOString()
      }, msg);
      throw new ApiError(502, 'GENERATION_FAILED', `生图提交失败，积分已全额退回：${msg}`);
    }
  } else {
    await admin
      .from('generation_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
  }

  const updated = await getOrCreateProfile(admin, user.id);

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: imageApiKey ? 'processing' : 'completed',
      model: modelId,
      modelLabel,
      creditsCharged: final,
      creditsRemaining: updated.credits,
      cost: { base, final, discountLabel },
      imageUrl: null,
      demo: !imageApiKey
    }
  });
});

generateRoutes.get('/jobs/:jobId', async c => {
  const user = c.get('user');
  const jobId = c.req.param('jobId');
  const admin = createAdminClient(c.env);

  const { data: job, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !job) {
    throw new ApiError(404, 'NOT_FOUND', '任务不存在');
  }

  assertJobOwner(job, user.id);

  const polled = await pollAndUpdateJob(
    admin,
    user.id,
    job,
    c.env.IMAGE_API_KEY || '',
    c.env.IMAGE_API_BASE_URL
  );

  const profile = await getOrCreateProfile(admin, user.id);
  const meta = (job.meta as Record<string, unknown>) || {};

  if (polled.status === 'failed') {
    return c.json({
      ok: true,
      data: {
        jobId: job.id,
        status: 'failed',
        imageUrl: null,
        errorMessage: polled.errorMessage,
        creditsRemaining: profile.credits,
        refunded: polled.refunded,
        message: '生图失败，积分已全额退回'
      }
    });
  }

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: polled.status,
      imageUrl: polled.imageUrl,
      creditsRemaining: profile.credits,
      model: meta.model,
      modelLabel: meta.modelLabel
    }
  });
});

generateRoutes.get('/cost', async c => {
  const resolution = c.req.query('resolution') || '1k';
  const model = c.req.query('model') || 'quanneng2';
  if (!['1k', '2k', '4k'].includes(resolution)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的分辨率');
  }
  if (!['quanneng2', 'jimeng'].includes(model)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的模型');
  }
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const profile = await getOrCreateProfile(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const cost = computeGenerationCost(
    model,
    resolution,
    profile.membership_tier,
    memberActive
  );
  return c.json({ ok: true, data: cost });
});
