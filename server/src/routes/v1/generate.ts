import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { roundCredits } from '../../lib/credit-math';
import { ApiError } from '../../lib/errors';
import { extractErrorMessage } from '../../lib/cors-headers';
import {
  hasAnyImageUpstream,
  isProviderConfigured,
  submitImageJobForProvider,
  upstreamBindingsFromEnv
} from '../../lib/image-upstream';
import { providerLabel } from '../../lib/image-models-catalog';
import {
  archivePendingJobImage,
  assertJobOwner,
  finalizeFailedJob,
  jobPollNeedsBackgroundArchive,
  pollAndUpdateJob
} from '../../lib/generation-jobs';
import {
  recoverGenerationJobsToWarehouse,
  importExtraJobImagesToWarehouse,
  repairWarehouseCardImagesFromJobs
} from '../../lib/recover-generation-warehouse';
import {
  computeImageGenerationCost,
  resolveImageModelConfig,
  loadImageModelSettings,
  listResolvedImageModels,
  normalizeImageModelId
} from '../../lib/image-model-settings';
import {
  deductUserCredits,
  refundUserCredits,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
import {
  createAdminClient,
  getOrCreateProfile,
  isMembershipActive
} from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';
import { syncGrsaiUpstreamStatusesFromPublicPage } from '../../lib/grsai-upstream-status';
import {
  isAcceptedRefImageInput,
  resolveGenerationRefUrls
} from '../../lib/generation-ref-images';

const refImageInputSchema = z
  .string()
  .min(1)
  .max(6_000_000)
  .refine(isAcceptedRefImageInput, '参考图须为有效 URL、storage:// 或 data:image');

const bodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  model: z
    .string()
    .min(1)
    .max(64)
    .transform((s) => s.trim().toLowerCase())
    .default('gpt-image-2'),
  resolution: z.enum(['1k', '2k', '4k']).default('1k'),
  quality: z.enum(['standard', 'high', 'ultra']).default('standard'),
  size: z.string().max(32).optional(),
  refImageUrl: refImageInputSchema.optional().nullable(),
  refImageUrls: z.array(refImageInputSchema).max(16).optional()
});

export const generateRoutes = new Hono<{ Bindings: Env }>();

function isDecimalCreditsMigrationNeeded(err: unknown): boolean {
  const msg = extractErrorMessage(err);
  if (/could not choose the best candidate function.*apply_credit_delta|function apply_credit_delta\(uuid, integer/i.test(msg)) {
    return true;
  }
  return /invalid input syntax for type integer|is of type integer but expression is of type numeric|column "credits" is of type integer/i.test(
    msg
  );
}

function decimalCreditsSetupMessage(): string {
  return '积分小数迁移未完成或存在旧版扣费函数冲突。请在 Supabase 再执行 migrations/20260602211000_credits_decimal_fixup.sql（含删除旧 integer 版 apply_credit_delta）';
}

function wrapGenerateError(err: unknown, context: string): ApiError {
  if (err instanceof ApiError) return err;
  const msg = extractErrorMessage(err);
  console.error(`[generate] ${context}:`, msg, err);
  if (isDecimalCreditsMigrationNeeded(err)) {
    return new ApiError(503, 'SERVER_CONFIG', decimalCreditsSetupMessage());
  }
  if (/insufficient_credits/i.test(msg)) {
    return new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
  }
  return new ApiError(502, 'GENERATION_FAILED', `${context}：${msg.slice(0, 200) || '未知错误'}`);
}

function readTaskId(meta: Record<string, unknown>): string | null {
  if (typeof meta.upstreamTaskId === 'string') return meta.upstreamTaskId;
  if (typeof meta.apimartTaskId === 'string') return meta.apimartTaskId;
  return null;
}

function friendlyGenerationError(raw: string, opts?: { violationNoRefund?: boolean; debited?: boolean }): string {
  const debited = opts?.debited !== false;
  const refundNote = debited ? '；您的积分已全额退回' : '';
  const s = String(raw || '');
  if (/upstream_content_violation|violation/i.test(s)) {
    if (opts?.violationNoRefund) {
      return '提示词触发内容审核，该模型违规不返还积分，请调整描述后重试';
    }
    return `提示词可能触发内容审核，请调整描述后重试${refundNote}`;
  }
  if (/insufficient balance|insufficient credits/i.test(s)) {
    return `GrsAI 服务商账户积分不足（不是您的站内积分），站长需登录 grsai.com 充值${refundNote}`;
  }
  if (/apikey|api.key|invalid.*api.*key|unauthorized|401/i.test(s)) {
    return `生图 API 密钥无效（apikey error）。站长请在 server 目录执行：npx wrangler secret put IMAGE_API_KEY，填入 GrsAI 控制台里的 Key${refundNote}`;
  }
  if (/不存在该模型|model.*not.*exist|unknown model|invalid model/i.test(s)) {
    return `上游返回模型相关提示（任务可能已在 GrsAI 排队，请强刷页面查看进度）${refundNote}`;
  }
  if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) {
    if (opts?.violationNoRefund) {
      return '提示词可能触发内容审核，该模型违规不返还积分';
    }
    return `提示词可能触发内容审核，请调整描述后重试${refundNote}`;
  }
  if (/upstream_timeout/i.test(s)) {
    return `生图排队超时（香蕉/即梦约 40 分钟，其它约 22 分钟）${debited ? '，积分已全额退回' : ''}；若 GrsAI 后台仍显示进行中可刷新页面尝试恢复`;
  }
  if (/upstream_no_image/i.test(s)) {
    return `上游未返回图片${debited ? '，积分已全额退回' : ''}，请重试`;
  }
  if (/missing_task_id/i.test(s)) {
    return `任务提交异常${debited ? '，积分已全额退回' : ''}，请重试`;
  }
  if (/upstream_failed|upstream_submit/i.test(s)) {
    return `上游生图失败，可缩短提示词后重试${refundNote}`;
  }
  if (/please wait|too many requests|rate limit|busy/i.test(s)) {
    return `生图服务繁忙，请稍等片刻后重试${refundNote}`;
  }
  if (/GrsAI 未返回任务 ID/i.test(s)) {
    return `上游已接单但响应格式异常，请强刷页面查看是否已在生成${refundNote}`;
  }
  return s ? `${s}${refundNote}` : `上游生图失败${refundNote}`;
}

function publicModelPayload(
  settings: Awaited<ReturnType<typeof loadImageModelSettings>>,
  tier: import('../../lib/supabase').Profile['membership_tier'],
  memberActive: boolean
) {
  return listResolvedImageModels(settings, { publicList: true }).map((m) => {
    const resolutions = m.resolutions?.length ? m.resolutions : (['1k'] as const);
    const costByResolution: Record<
      string,
      ReturnType<typeof computeImageGenerationCost>
    > = {};
    for (const res of resolutions) {
      costByResolution[res] = computeImageGenerationCost(
        settings,
        m.id,
        res,
        tier,
        memberActive
      );
    }
    const defaultRes = resolutions[0] || '1k';
    const cost = costByResolution[defaultRes];
    return {
      id: m.id,
      label: m.displayLabel,
      catalogLabel: m.label,
      description: m.description,
      group: m.group,
      provider: m.provider,
      providerLabel: providerLabel(m.provider),
      upstream: m.upstream,
      status: m.status,
      selectable: m.enabled,
      statusNotice: m.statusNotice,
      refundOnViolation: m.refundOnViolation,
      violationNotice: m.violationNotice,
      resolutions: m.resolutions,
      pricingByResolution: m.pricingByResolution,
      creditsByResolution: m.pricingByResolution ? m.creditsByResolution : null,
      costByResolution,
      creditsPerCall: m.effectiveBaseCredits,
      creditsBase: cost.listPrice,
      creditsFinal: cost.final,
      listPrice: cost.listPrice,
      promoPrice: cost.promoPrice,
      appliedDiscount: cost.appliedDiscount,
      modelDiscountPercent: cost.modelDiscountPercent,
      modelDiscountLabel: cost.modelDiscountLabel,
      discountLabel: cost.discountLabel
    };
  });
}

function modelUnavailableMessage(resolved: NonNullable<
  ReturnType<typeof resolveImageModelConfig>
>): string {
  if (resolved.status === 'maintenance') {
    return resolved.statusNotice || '该模型维护中，请稍后再试';
  }
  return '所选模型已下架，请换用其他模型';
}

generateRoutes.get('/models', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  void syncGrsaiUpstreamStatusesFromPublicPage().catch((e) => {
    console.warn('[generate] grsai status sync', e);
  });
  const settings = await loadImageModelSettings(admin);
  const profile = await getOrCreateProfile(admin, user.id);
  const memberActive = isMembershipActive(profile);
  return c.json({
    ok: true,
    data: {
      providers: ['grsai', 'apimart', 'ithink'],
      globalDiscountPercent: settings.globalDiscountPercent,
      models: publicModelPayload(settings, profile.membership_tier, memberActive)
    }
  });
});

/** 报价接口：轻量、不限流（避免生图页拖动参数时卡 20s+） */
generateRoutes.get('/cost', async c => {
  const resolution = c.req.query('resolution') || '1k';
  const model = normalizeImageModelId(c.req.query('model') || 'gpt-image-2');
  if (!['1k', '2k', '4k'].includes(resolution)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的分辨率');
  }
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const settings = await loadImageModelSettings(admin);
  const profile = await getOrCreateProfile(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const resolved = resolveImageModelConfig(model, settings);
  if (!resolved || !resolved.enabled) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      resolved ? modelUnavailableMessage(resolved) : '模型不可用'
    );
  }
  if (resolved.resolutions.length && !resolved.resolutions.includes(resolution as '1k')) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${resolution.toUpperCase()} 输出`);
  }
  const cost = computeImageGenerationCost(
    settings,
    model,
    resolution,
    profile.membership_tier,
    memberActive
  );
  return c.json({
    ok: true,
    data: {
      ...cost,
      refundOnViolation: resolved.refundOnViolation,
      violationNotice: resolved.violationNotice,
      resolutions: resolved.resolutions
    }
  });
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
  const settings = await loadImageModelSettings(admin);
  const modelId = normalizeImageModelId(parsed.data.model);
  const resolved = resolveImageModelConfig(modelId, settings);
  if (!resolved || !resolved.enabled) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      resolved ? modelUnavailableMessage(resolved) : '所选模型不可用'
    );
  }
  if (
    resolved.resolutions.length
    && !resolved.resolutions.includes(parsed.data.resolution)
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `该模型不支持 ${parsed.data.resolution.toUpperCase()}，请切换分辨率`
    );
  }

  const { final: rawFinal, base, discountLabel, modelLabel, refundOnViolation, violationNotice } =
    computeImageGenerationCost(
      settings,
      modelId,
      parsed.data.resolution,
      profile.membership_tier,
      memberActive
    );
  const final = roundCredits(rawFinal);

  const balance = spendableCredits(profile);
  if (balance < final) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（需要 ${final}，当前 ${balance}）`
    );
  }

  const rawRefInputs =
    parsed.data.refImageUrls?.length
      ? parsed.data.refImageUrls
      : parsed.data.refImageUrl
        ? [parsed.data.refImageUrl]
        : [];
  const refUrls = rawRefInputs.length
    ? await resolveGenerationRefUrls(c, admin, user.id, rawRefInputs)
    : [];

  const upstream = upstreamBindingsFromEnv(c.env);
  const lineProvider = resolved.provider;
  if (hasAnyImageUpstream(upstream) && !isProviderConfigured(upstream, lineProvider)) {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      `${providerLabel(lineProvider)} 线路未开通，请换用其他线路或联系站长配置密钥`
    );
  }

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
        upstreamModel: resolved.upstream,
        modelLabel,
        provider: lineProvider,
        refImageUrls: refUrls,
        base,
        discountLabel,
        size: parsed.data.size ?? null,
        refundOnViolation,
        violationNotice
      }
    })
    .select('id')
    .single();

  if (jobErr) {
    throw wrapGenerateError(jobErr, '创建生图任务失败');
  }

  let upstreamTaskId: string | null = null;
  let debited = false;
  let debitSplit = { fromDaily: 0, fromPermanent: 0 };

  const baseMeta = {
    model: modelId,
    upstreamModel: resolved.upstream,
    modelLabel,
    provider: lineProvider,
    refImageUrls: refUrls,
    base,
    discountLabel,
    size: parsed.data.size ?? null,
    refundOnViolation,
    violationNotice
  };

  try {
    const debitedResult = await deductUserCredits(
      admin,
      user.id,
      final,
      'image_generation',
      job.id,
      { model: modelId, resolution: parsed.data.resolution, base, discountLabel }
    );
    profile = debitedResult.profile;
    debitSplit = debitedResult.split;
    debited = true;
  } catch (debitErr) {
    await admin
      .from('generation_requests')
      .update({
        status: 'failed',
        error_message: 'debit_failed',
        completed_at: new Date().toISOString(),
        meta: {
          ...baseMeta,
          failReason: 'debit_failed',
          submitFailedBeforeDebit: true
        }
      })
      .eq('id', job.id);
    if (String((debitErr as Error).message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw wrapGenerateError(debitErr, '扣减积分失败');
  }

  if (hasAnyImageUpstream(upstream)) {
    try {
      const submitted = await submitImageJobForProvider(upstream, lineProvider, {
        upstreamModel: resolved.upstream,
        prompt: promptText,
        resolution: parsed.data.resolution,
        quality: parsed.data.quality,
        size: parsed.data.size,
        refImageUrls: refUrls
      });
      upstreamTaskId = submitted.taskId;
      if (submitted.immediateImageUrl) {
        baseMeta.syncImageUrl = submitted.immediateImageUrl;
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'upstream_submit_failed';
      if (debited) {
        await refundUserCredits(
          admin,
          user.id,
          final,
          'image_generation_refund',
          job.id,
          debitSplit,
          { reason: msg, model: modelId }
        );
      }
      await admin
        .from('generation_requests')
        .update({
          status: 'failed',
          error_message: msg,
          completed_at: new Date().toISOString(),
          meta: {
            ...baseMeta,
            failReason: msg,
            debitSplit,
            refunded: debited,
            submitFailedBeforeDebit: false
          }
        })
        .eq('id', job.id);
      throw new ApiError(
        502,
        'GENERATION_FAILED',
        `生图提交失败：${friendlyGenerationError(msg, { debited })}`
      );
    }
  }

  if (hasAnyImageUpstream(upstream) && upstreamTaskId) {
    const metaAfterSubmit: Record<string, unknown> = {
      ...baseMeta,
      upstreamTaskId,
      debitSplit
    };
    if (typeof baseMeta.syncImageUrl === 'string') {
      metaAfterSubmit.syncImageUrl = baseMeta.syncImageUrl;
    }
    await admin
      .from('generation_requests')
      .update({ meta: metaAfterSubmit })
      .eq('id', job.id);
  } else if (!hasAnyImageUpstream(upstream)) {
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
      status: hasAnyImageUpstream(upstream) ? 'processing' : 'completed',
      model: modelId,
      modelLabel,
      creditsCharged: final,
      creditsRemaining: spendableCredits(updated),
      cost: { base, final, discountLabel },
      refundOnViolation,
      violationNotice,
      imageUrl: null,
      demo: !hasAnyImageUpstream(upstream)
    }
  });
});

generateRoutes.get('/jobs', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(24);
  if (error) throw error;

  const sortedRows = [...(rows || [])].sort((a, b) => {
    const rank = (s: string) => (s === 'processing' ? 0 : s === 'failed' ? 1 : 2);
    const ra = rank(String(a.status || ''));
    const rb = rank(String(b.status || ''));
    if (ra !== rb) return ra - rb;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });

  const jobs = [];
  let bonusPollBudget = 3;
  let failedRecoverBudget = 12;
  for (const job of sortedRows) {
    const meta = (job.meta as Record<string, unknown>) || {};
    const taskId = readTaskId(meta);
    const needsBonusSync =
      job.status === 'completed'
      && !!taskId
      && !!job.result_image_url
      && (!Array.isArray(meta.extraImageUrls) || meta.extraImageUrls.length === 0);
    const needsMissingImageRecover =
      job.status === 'completed'
      && !!taskId
      && !job.result_image_url;
    let status = job.status as string;
    let imageUrl = job.result_image_url as string | null;
    let extraFromMeta = Array.isArray(meta.extraImageUrls)
      ? (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u)
      : undefined;
    const failedUpstreamRecoverable =
      job.status === 'failed'
      && !!taskId
      && failedRecoverBudget > 0;
    const shouldPoll =
      job.status === 'processing'
      || failedUpstreamRecoverable
      || needsMissingImageRecover
      || (needsBonusSync && bonusPollBudget > 0);
    if (failedUpstreamRecoverable) failedRecoverBudget -= 1;
    if (shouldPoll) {
      if (needsBonusSync && job.status === 'completed') bonusPollBudget -= 1;
      const useQuick =
        job.status === 'processing'
        && !failedUpstreamRecoverable
        && !needsMissingImageRecover;
      const polled = await pollAndUpdateJob(
        admin,
        user.id,
        job,
        upstreamBindingsFromEnv(c.env),
        c.env,
        { quick: useQuick }
      );
      status = polled.status;
      imageUrl = polled.imageUrl;
      if (polled.extraImageUrls?.length) {
        extraFromMeta = polled.extraImageUrls;
      }
    }
    jobs.push({
      id: job.id,
      prompt: job.prompt,
      status,
      imageUrl,
      extraImageUrls: extraFromMeta?.length ? extraFromMeta : undefined,
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

/** 恢复用：拉取更久远的生图任务（只读，不扣积分） */
generateRoutes.get('/jobs/history', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const daysRaw = Number(c.req.query('days'));
  const limitRaw = Number(c.req.query('limit'));
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, Math.floor(daysRaw))) : 90;
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('id,prompt,status,result_image_url,meta,created_at,resolution,quality,size_label,credits_charged')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const jobs = (rows || []).map((job) => {
    const meta = (job.meta as Record<string, unknown>) || {};
    const extraImageUrls = Array.isArray(meta.extraImageUrls)
      ? (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u)
      : [];
    return {
      id: job.id,
      prompt: job.prompt,
      status: job.status,
      imageUrl: job.result_image_url as string | null,
      extraImageUrls: extraImageUrls.length ? extraImageUrls : undefined,
      apimartTaskId: typeof meta.apimartTaskId === 'string' ? meta.apimartTaskId : null,
      provider: typeof meta.provider === 'string' ? meta.provider : null,
      model: meta.model,
      modelLabel: meta.modelLabel,
      createdAt: job.created_at
    };
  });
  return c.json({ ok: true, data: { jobs, days, limit } });
});

const recoverWarehouseSchema = z.object({
  max: z.number().int().min(1).max(80).optional(),
  days: z.number().int().min(1).max(365).optional(),
  mode: z.enum(['import', 'repair', 'extras', 'settle']).optional(),
  jobIds: z.array(z.string().min(8).max(64)).max(10).optional()
});

/** 服务端一键恢复生图到卡片库（绕过浏览器 media/fetch 401） */
generateRoutes.post('/recover-warehouse', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  let body: z.infer<typeof recoverWarehouseSchema> = {};
  try {
    const raw = await c.req.json();
    body = recoverWarehouseSchema.parse(raw ?? {});
  } catch {
    body = {};
  }
  try {
    const mode = body.mode || 'import';
    const common = { max: body.max, days: body.days };
    const upstream = upstreamBindingsFromEnv(c.env);

    if (mode === 'settle') {
      const ids = Array.isArray(body.jobIds) ? body.jobIds.filter(Boolean).slice(0, 10) : [];
      let settled = 0;
      const failures: Array<{ jobId: string; reason: string }> = [];

      const loadJobs = async () => {
        if (ids.length) {
          const { data: rows, error } = await admin
            .from('generation_requests')
            .select('*')
            .eq('user_id', user.id)
            .in('id', ids);
          if (error) throw error;
          return rows || [];
        }
        const since = new Date(Date.now() - (common.days ?? 7) * 24 * 3600 * 1000).toISOString();
        const { data: rows, error } = await admin
          .from('generation_requests')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['processing', 'failed'])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(Math.min(10, common.max ?? 8));
        if (error) throw error;
        return rows || [];
      };

      for (const job of await loadJobs()) {
        try {
          const polled = await pollAndUpdateJob(admin, user.id, job, upstream, c.env);
          if (polled.status === 'completed' && polled.imageUrl) {
            settled += 1;
          } else if (polled.status === 'failed') {
            failures.push({ jobId: String(job.id), reason: String(polled.errorMessage || 'failed') });
          }
        } catch (e) {
          failures.push({
            jobId: String(job.id),
            reason: String((e as Error)?.message || e).slice(0, 120)
          });
        }
      }

      const imported = await recoverGenerationJobsToWarehouse(admin, user.id, common);
      const repaired = await repairWarehouseCardImagesFromJobs(admin, user.id, common);
      return c.json({
        ok: true,
        data: {
          settled,
          imported: imported.imported,
          repaired: repaired.repaired ?? 0,
          skipped: imported.skipped + (repaired.skipped ?? 0),
          failures: [...failures, ...imported.failures].slice(0, 30),
          cardIds: [...imported.cardIds, ...(repaired.cardIds ?? [])],
          hint: settled > 0 || imported.imported > 0 || (repaired.repaired ?? 0) > 0
            ? undefined
            : '上游仍无可用图片，请稍后再试或点占位上的重试'
        }
      });
    }

    const result =
      mode === 'repair'
        ? await repairWarehouseCardImagesFromJobs(admin, user.id, common)
        : mode === 'extras'
          ? await importExtraJobImagesToWarehouse(admin, user.id, common)
          : await recoverGenerationJobsToWarehouse(admin, user.id, common);
    return c.json({ ok: true, data: result });
  } catch (e) {
    console.error('[recover-warehouse]', user.id, e);
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      500,
      'RECOVER_FAILED',
      String((e as Error)?.message || e).slice(0, 200)
    );
  }
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

  const settle = c.req.query('settle') === '1' || c.req.query('settle') === 'true';
  const polled = await pollAndUpdateJob(
    admin,
    user.id,
    job,
    upstreamBindingsFromEnv(c.env),
    c.env,
    { quick: !settle }
  );

  const { data: freshJob } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  const liveJob = freshJob || job;
  const liveMeta = (liveJob.meta as Record<string, unknown>) || {};
  const liveImageUrl =
    polled.imageUrl || (liveJob.result_image_url as string | null) || null;
  const liveStatus =
    polled.status === 'processing' && liveJob.status === 'completed'
      ? 'completed'
      : polled.status;

  const profile = await syncMembershipCredits(admin, user.id);
  const meta = liveMeta;
  const violationNoRefund = meta.refundOnViolation === false;

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
        message: friendlyGenerationError(String(polled.errorMessage || ''), {
          violationNoRefund: violationNoRefund && polled.refunded === false
        })
      }
    });
  }

  const updatedMeta = liveMeta;
  const extraImageUrls =
    polled.extraImageUrls
    || (Array.isArray(updatedMeta.extraImageUrls) ? (updatedMeta.extraImageUrls as string[]) : undefined);

  if (jobPollNeedsBackgroundArchive(liveImageUrl) && c.executionCtx) {
    c.executionCtx.waitUntil(
      archivePendingJobImage(admin, user.id, jobId, c.env).catch((e) => {
        console.warn('[generate] waitUntil archive failed', jobId, e);
      })
    );
  }

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: liveStatus,
      imageUrl: liveImageUrl,
      extraImageUrls: extraImageUrls?.length ? extraImageUrls : undefined,
      creditsRemaining: spendableCredits(profile),
      model: meta.model,
      modelLabel: meta.modelLabel
    }
  });
});
