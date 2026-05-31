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
  deductUserCredits,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
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

function friendlyGenerationError(raw: string): string {
  const s = String(raw || '');
  if (/insufficient balance/i.test(s)) {
    return '生图服务商账户余额不足，请联系站长充值；您的积分已全额退回';
  }
  if (/invalid.*api.*key|unauthorized|401/i.test(s)) {
    return '生图接口密钥无效或已过期，请联系站长检查配置；您的积分已全额退回';
  }
  if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) {
    return '提示词可能触发内容审核，请调整描述后重试；您的积分已全额退回';
  }
  return s || '上游生图失败，您的积分已全额退回';
}

/** 报价接口：轻量、不限流（避免生图页拖动参数时卡 20s+） */
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
    model as ImageModelId,
    resolution as '1k' | '2k' | '4k',
    profile.membership_tier,
    memberActive
  );
  return c.json({ ok: true, data: cost });
});

generateRoutes.post('/', rateLimit(600, 60_000), async c => {
  const user = c.get('user');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的提示词与参数');
  }

  const promptText = parsed.data.prompt.slice(0, 8000);
  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const modelId = parsed.data.model as ImageModelId;
  const { final, base, discountLabel, modelLabel } = computeGenerationCost(
    modelId,
    parsed.data.resolution,
    profile.membership_tier,
    memberActive
  );

  const balance = spendableCredits(profile);
  if (balance < final) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（需要 ${final}，当前 ${balance}）`
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
      prompt: promptText,
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

  let debitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debited = await deductUserCredits(
      admin,
      user.id,
      final,
      'image_generation',
      job.id,
      { model: modelId, resolution: parsed.data.resolution, base, discountLabel }
    );
    profile = debited.profile;
    debitSplit = debited.split;
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
          debitSplit
        }
      })
      .eq('id', job.id);
  } catch (debitErr) {
    await admin
      .from('generation_requests')
      .update({ status: 'failed', error_message: 'debit_failed' })
      .eq('id', job.id);
    if (String((debitErr as Error).message).includes('insufficient')) {
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
          prompt: promptText,
          resolution: parsed.data.resolution,
          quality: parsed.data.quality,
          size: parsed.data.size,
          refImageUrls: refUrls
        }
      );
      const { data: curJob } = await admin
        .from('generation_requests')
        .select('meta')
        .eq('id', job.id)
        .maybeSingle();
      const curMeta = (curJob?.meta as Record<string, unknown>) || {};
      await admin
        .from('generation_requests')
        .update({
          meta: {
            ...curMeta,
            model: modelId,
            modelLabel,
            refImageUrls: refUrls,
            base,
            discountLabel,
            size: parsed.data.size ?? null,
            apimartTaskId,
            debitSplit
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
      throw new ApiError(
        502,
        'GENERATION_FAILED',
        `生图提交失败，积分已全额退回：${friendlyGenerationError(msg)}`
      );
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

  const updated = await syncMembershipCredits(admin, user.id);

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: imageApiKey ? 'processing' : 'completed',
      model: modelId,
      modelLabel,
      creditsCharged: final,
      creditsRemaining: spendableCredits(updated),
      cost: { base, final, discountLabel },
      imageUrl: null,
      demo: !imageApiKey
    }
  });
});

generateRoutes.get('/jobs', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(48);
  if (error) throw error;

  const jobs = [];
  for (const job of rows || []) {
    let status = job.status as string;
    let imageUrl = job.result_image_url as string | null;
    if (job.status === 'processing') {
      const polled = await pollAndUpdateJob(
        admin,
        user.id,
        job,
        c.env.IMAGE_API_KEY || '',
        c.env.IMAGE_API_BASE_URL
      );
      status = polled.status;
      imageUrl = polled.imageUrl;
    }
    const meta = (job.meta as Record<string, unknown>) || {};
    jobs.push({
      id: job.id,
      prompt: job.prompt,
      status,
      imageUrl,
      creditsCharged: job.credits_charged,
      resolution: job.resolution,
      quality: job.quality,
      size: job.size_label,
      model: meta.model,
      modelLabel: meta.modelLabel,
      createdAt: job.created_at
    });
  }

  return c.json({ ok: true, data: { jobs } });
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

  const profile = await syncMembershipCredits(admin, user.id);
  const meta = (job.meta as Record<string, unknown>) || {};

  if (polled.status === 'failed') {
    return c.json({
      ok: true,
      data: {
        jobId: job.id,
        status: 'failed',
        imageUrl: null,
        errorMessage: polled.errorMessage,
        creditsRemaining: spendableCredits(profile),
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
      creditsRemaining: spendableCredits(profile),
      model: meta.model,
      modelLabel: meta.modelLabel
    }
  });
});

