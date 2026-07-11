import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { roundCredits } from '../../lib/credit-math';
import { ApiError } from '../../lib/errors';
import { extractErrorMessage } from '../../lib/cors-headers';
import {
  hasAnyImageUpstream,
  isProviderConfigured,
  readJobProvider,
  upstreamBindingsFromEnv
} from '../../lib/image-upstream';
import { processFastProviderPendingSubmit } from '../../lib/fast-provider-submit';
import type { JobRow } from '../../lib/generation-jobs';
import { aspectRatiosForModel } from '../../lib/image-size-options';
import {
  imageModelUiFamily,
  isRetainedPublicImageEntry,
  sanitizePublicModelDescription
} from '../../lib/image-models-catalog';
import { isMidjourneyUpstream } from '../../lib/midjourney-models';
import {
  submitMidjourneyAction,
  submitMidjourneyBlend,
  fetchMidjourneyTaskButtons,
  defaultGridMjButtons,
  filterMjButtonsForClient,
  type SubmitMjActionParams
} from '../../lib/apimart-midjourney';
import type { MjActionKind } from '../../lib/midjourney-models';
import {
  archivePendingJobImage,
  assertJobOwner,
  finalizeFailedJob,
  jobPollNeedsBackgroundArchive,
  pollAndUpdateJob,
  slowProviderProgressNote,
  syncMjImagesFromUpstream
} from '../../lib/generation-jobs';
import { buildMjGalleryUrls, mjGalleryUrlCount } from '../../lib/midjourney-models';
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
  fetchNewApiModelCatalog,
  imageCatalogForNewApiSnapshot,
  newApiCreditsForModel,
  type NewApiCatalogParameter,
  type NewApiCatalogSnapshot,
  type NewApiPricingRule
} from '../../lib/newapi';
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
import {
  isAcceptedRefImageInput,
  resolveGenerationRefUrls
} from '../../lib/generation-ref-images';
import {
  buildPrivateMediaCdnUrl,
  resolveStoragePath,
  serveCachedStorageImage
} from '../../lib/media-cdn';
import type { Context } from 'hono';

function assertOwnMediaPath(userId: string, path: string): void {
  const norm = path.replace(/^\//, '');
  if (!norm.startsWith(`${userId}/`)) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问该图片');
  }
}

function isRemoteHttpImageUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim();
  return /^https?:\/\//i.test(raw);
}

async function resolveJobImageUrlForClient(
  c: Context<{ Bindings: Env }>,
  imageUrl: string | null | undefined
): Promise<string | null> {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  const path = resolveStoragePath(raw);
  if (path) {
    try {
      return await buildPrivateMediaCdnUrl(c, path);
    } catch (e) {
      console.warn('[generate] resolve job image url failed', path, e);
      return raw;
    }
  }
  return raw;
}

const refImageInputSchema = z
  .string()
  .min(1)
  .max(6_000_000)
  .refine(isAcceptedRefImageInput, '参考图须为有效 URL、storage:// 或 data:image');

const mjParamsSchema = z
  .object({
    stylize: z.number().min(0).max(1000).optional(),
    chaos: z.number().min(0).max(100).optional(),
    weird: z.number().min(0).max(3000).optional(),
    negativePrompt: z.string().max(500).optional(),
    seed: z.number().optional(),
    tile: z.boolean().optional(),
    raw: z.boolean().optional(),
    draft: z.boolean().optional(),
    hd: z.boolean().optional(),
    speed: z.enum(['relax', 'fast', 'turbo']).optional(),
    iw: z.number().min(0).max(3).optional(),
    quality: z.enum(['0.25', '0.5', '1', '2']).optional(),
    style: z.string().max(32).optional(),
    cw: z.number().min(0).max(100).optional(),
    sw: z.number().min(0).max(1000).optional(),
    stop: z.number().min(10).max(100).optional(),
    extra: z.string().max(200).optional()
  })
  .optional();

const bodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  model: z
    .string()
    .min(1)
    .max(64)
    .transform((s) => s.trim().toLowerCase())
    .default('image2'),
  resolution: z.enum(['1k', '2k', '4k']).default('1k'),
  quality: z.enum(['standard', 'high', 'ultra']).default('standard'),
  size: z.string().max(32).optional(),
  count: z.number().int().min(1).max(8).default(1),
  refImageUrl: refImageInputSchema.optional().nullable(),
  refImageUrls: z.array(refImageInputSchema).max(16).optional(),
  mjParams: mjParamsSchema
});

function normalizeGenerationBodyAliases(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const body: Record<string, unknown> = { ...input };
  const quality = String(input.quality || '').trim().toLowerCase();
  if (!input.resolution && (quality === '1k' || quality === '2k' || quality === '4k')) {
    body.resolution = quality;
    body.quality = 'standard';
  }
  if (body.refImageUrl == null && typeof input.image === 'string') body.refImageUrl = input.image;
  if (body.refImageUrls == null && Array.isArray(input.images)) body.refImageUrls = input.images;
  if (body.count == null && typeof input.n === 'number') body.count = input.n;
  return body;
}

const mjBlendSchema = z.object({
  refImageUrls: z.array(refImageInputSchema).min(2).max(5),
  model: z
    .string()
    .min(1)
    .max(64)
    .transform((s) => s.trim().toLowerCase())
    .optional(),
  speed: z.enum(['relax', 'fast', 'turbo']).optional()
});

const mjActionSchema = z.object({
  parentJobId: z.string().uuid(),
  action: z.enum([
    'upscale',
    'variation',
    'high_variation',
    'low_variation',
    'reroll',
    'zoom',
    'pan',
    'inpaint',
    'describe',
    'blend',
    'edits',
    'remix_strong',
    'remix_subtle',
    'video',
    'modal'
  ]),
  index: z.number().int().min(1).max(4).optional(),
  customId: z.string().max(256).optional(),
  prompt: z.string().max(8000).optional(),
  zoom: z.number().optional(),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  refImageUrls: z.array(refImageInputSchema).max(8).optional(),
  maskUrl: refImageInputSchema.optional()
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

function kickBackgroundTask(
  c: { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } },
  task: Promise<unknown>
) {
  const wrapped = task.catch((e) => {
    console.error('[generate] background task failed', e);
  });
  if (c.executionCtx) c.executionCtx.waitUntil(wrapped);
  else void wrapped;
}

function pollKickSubmit(
  c: { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } }
) {
  return (task: Promise<unknown>) => kickBackgroundTask(c, task);
}

function friendlyGenerationError(raw: string, opts?: { violationNoRefund?: boolean; debited?: boolean }): string {
  const debited = opts?.debited !== false;
  const refundNote = debited ? '；您的积分已全额退回' : '';
  const s = String(raw || '');
  if (/prohibited words or images|prohibited|flagged as containing/i.test(s)) {
    if (opts?.violationNoRefund) {
      return '提示词触发内容审核（含禁用词/图），该模型违规不返还积分，请改描述后重试';
    }
    return `提示词触发内容审核（含禁用词/图），请改描述后重试${refundNote}`;
  }
  if (/upstream_content_violation|violation/i.test(s)) {
    if (opts?.violationNoRefund) {
      return '提示词触发内容审核，该模型违规不返还积分，请调整描述后重试';
    }
    return `提示词可能触发内容审核，请调整描述后重试${refundNote}`;
  }
  if (/insufficient balance|insufficient credits/i.test(s)) {
    return `生成服务暂不可用，请联系站长${refundNote}`;
  }
  if (/upstream_auth_failed|无效.*令牌|invalid.*token/i.test(s)) {
    return `生成服务认证失败，请联系站长${refundNote}`;
  }
  if (/upstream_submit_not_configured/i.test(s)) {
    return `生图服务未配置，请联系站长${refundNote}`;
  }
  if (/upstream_model_rejected/i.test(s)) {
    return `当前模型暂不可用，请换其他模型或联系站长${refundNote}`;
  }
  if (/apikey|api.key|invalid.*api.*key|unauthorized|401|无效.*令牌|invalid.*token/i.test(s)) {
    return `生图服务认证失败，请联系站长${refundNote}`;
  }
  if (/不存在该模型|model.*not.*exist|unknown model|invalid model/i.test(s)) {
    return `模型相关提示，任务可能仍在排队，请强刷页面查看进度${refundNote}`;
  }
  if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) {
    if (opts?.violationNoRefund) {
      return '提示词可能触发内容审核，该模型违规不返还积分';
    }
    return `提示词可能触发内容审核，请调整描述后重试${refundNote}`;
  }
  if (/upstream_timeout/i.test(s)) {
    return `生图排队超时${debited ? '，积分已全额退回' : ''}；若仍在生成中可刷新页面尝试恢复`;
  }
  if (/upstream_no_image/i.test(s)) {
    return `生成服务未返回图片${debited ? '，积分已全额退回' : ''}，请重试`;
  }
  if (/upstream_image_archive_failed|invalid_data_url|invalid base64/i.test(s)) {
    return `图片入库失败${debited ? '，积分已全额退回' : ''}，请重试`;
  }
  if (/upstream_submit_not_started/i.test(s)) {
    return `未能连接生图服务，积分已退回；请强刷后重试或换其他模型`;
  }
  if (/upstream_submit_interrupted/i.test(s)) {
    return `提交被中断，积分已退回；请等 1 分钟后重试，勿重复连点`;
  }
  if (/upstream_submit_stale/i.test(s)) {
    return `生图长时间无响应，积分已退回；请稍后再试或换其他模型`;
  }
  if (/missing_task_id/i.test(s)) {
    return `任务提交异常${debited ? '，积分已全额退回' : ''}，请重试`;
  }
  if (/upstream_failed|upstream_submit/i.test(s)) {
    return `生图失败，可缩短提示词后重试${refundNote}`;
  }
  if (/please wait|too many requests|rate limit|busy/i.test(s)) {
    return `生图服务繁忙，请稍等片刻后重试${refundNote}`;
  }
  if (/GrsAI 未返回任务 ID/i.test(s)) {
    return `任务已接收但响应格式异常，请强刷页面查看是否已在生成${refundNote}`;
  }
  return `生图失败${refundNote}，请重试`;
}

function parameterOptions(
  parameters: NewApiCatalogParameter[],
  name: string
): string[] {
  const parameter = parameters.find(item => item.name === name);
  if (!parameter) return [];
  const values = parameter.options?.length
    ? parameter.options
    : Object.prototype.hasOwnProperty.call(parameter, 'fixed')
      ? [parameter.fixed]
      : [];
  return values.map(value => String(value));
}

function publicDirectModelParameters(
  model: NonNullable<ReturnType<typeof resolveImageModelConfig>>
): NewApiCatalogParameter[] {
  const parameters: NewApiCatalogParameter[] = [
    { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: model.id },
    { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
    {
      name: 'resolution',
      path: 'resolution',
      label: '分辨率',
      type: 'string',
      required: false,
      default: model.resolutions[0] || '1k',
      options: [...model.resolutions]
    },
    {
      name: 'size',
      path: 'size',
      label: '画面比例',
      type: 'string',
      required: false,
      default: aspectRatiosForModel(model.id)[0] || '1:1',
      options: [...aspectRatiosForModel(model.id)]
    },
    {
      name: 'refImageUrls',
      path: 'refImageUrls',
      label: '参考图',
      type: 'array',
      required: false,
      min_items: 1,
      max_items: model.uiFamily === 'midjourney' ? 5 : 16,
      items: { type: 'string', format: 'uri-or-data-image' }
    }
  ];
  if (!model.fixedQualityLow && model.uiFamily !== 'midjourney') {
    parameters.push({
      name: 'quality',
      path: 'quality',
      label: '质量',
      type: 'string',
      required: false,
      default: 'standard',
      options: ['standard', 'high', 'ultra']
    });
  }
  if (model.uiFamily === 'midjourney') {
    parameters.push(
      { name: 'speed', path: 'mjParams.speed', label: '速度', type: 'string', required: false, default: 'relax', options: ['relax', 'fast', 'turbo'] },
      { name: 'stylize', path: 'mjParams.stylize', label: '风格化', type: 'number', required: false, min: 0, max: 1000 },
      { name: 'chaos', path: 'mjParams.chaos', label: '变化度', type: 'number', required: false, min: 0, max: 100 },
      { name: 'weird', path: 'mjParams.weird', label: '怪异度', type: 'number', required: false, min: 0, max: 3000 },
      { name: 'seed', path: 'mjParams.seed', label: '随机种子', type: 'integer', required: false },
      { name: 'quality', path: 'mjParams.quality', label: '质量', type: 'string', required: false, options: ['0.25', '0.5', '1', '2'] },
      { name: 'iw', path: 'mjParams.iw', label: '参考图权重', type: 'number', required: false, min: 0, max: 3 },
      { name: 'raw', path: 'mjParams.raw', label: 'Raw 模式', type: 'boolean', required: false, default: false },
      { name: 'tile', path: 'mjParams.tile', label: '无缝平铺', type: 'boolean', required: false, default: false }
    );
  }
  return parameters;
}

function publicNewApiParameters(
  modelId: string,
  rule: NewApiPricingRule
): NewApiCatalogParameter[] {
  return rule.parameters.map(parameter =>
    parameter.name === 'model'
      ? { ...parameter, fixed: modelId }
      : { ...parameter }
  );
}

function newApiRuleForModel(
  model: NonNullable<ReturnType<typeof resolveImageModelConfig>>,
  snapshot: NewApiCatalogSnapshot
): NewApiPricingRule | null {
  if (model.provider !== 'newapi') return null;
  return snapshot.rules.find(rule => rule.model === model.upstream) || null;
}

function publicModelPayload(
  settings: Awaited<ReturnType<typeof loadImageModelSettings>>,
  tier: import('../../lib/supabase').Profile['membership_tier'],
  memberActive: boolean,
  opts: { newApiCatalog: NewApiCatalogSnapshot }
) {
  const catalogEntries = imageCatalogForNewApiSnapshot(opts.newApiCatalog);
  const newApiRules = opts.newApiCatalog.rules;
  const withFixedCredits = (
    cost: ReturnType<typeof computeImageGenerationCost>,
    credits: number,
    modelLabel = cost.modelLabel
  ): ReturnType<typeof computeImageGenerationCost> => ({
    ...cost,
    base: credits,
    final: credits,
    listPrice: credits,
    promoPrice: credits,
    appliedDiscount: 'fixed',
    discountLabel: '卡藏 API 实时价',
    modelDiscountPercent: 100,
    modelDiscountLabel: null,
    modelLabel
  });

  return listResolvedImageModels(settings, { publicList: true, catalogEntries })
    .filter(isRetainedImageModel)
    .map((m) => {
    const resolutions = m.resolutions?.length ? m.resolutions : (['1k'] as const);
    const defaultRes = resolutions[0] || '1k';
    const costBySpeed = m.pricingBySpeed
      ? (['relax', 'fast', 'turbo'] as const).reduce(
          (acc, speed) => {
            acc[speed] = computeImageGenerationCost(
              settings,
              m.id,
              defaultRes,
              tier,
              memberActive,
              { mjSpeed: speed, catalogEntries }
            );
            return acc;
          },
          {} as Record<'relax' | 'fast' | 'turbo', ReturnType<typeof computeImageGenerationCost>>
        )
      : null;
    const costByResolution = m.pricingByResolution
      ? resolutions.reduce(
          (acc, res) => {
            acc[res] = computeImageGenerationCost(
              settings,
              m.id,
              res,
              tier,
              memberActive,
              { catalogEntries }
            );
            return acc;
          },
          {} as Record<string, ReturnType<typeof computeImageGenerationCost>>
        )
      : null;
    const remoteNewApiCredits = m.provider === 'newapi'
      ? newApiCreditsForModel(newApiRules, m.upstream, defaultRes)
      : null;
    const cost =
      costBySpeed?.relax
      ?? costByResolution?.[defaultRes]
      ?? computeImageGenerationCost(settings, m.id, defaultRes, tier, memberActive, { catalogEntries });
    const finalCost = remoteNewApiCredits != null && remoteNewApiCredits > 0
      ? withFixedCredits(cost, remoteNewApiCredits, m.label)
      : cost;
    const finalCostByResolution = m.provider === 'newapi' && costByResolution
      ? Object.fromEntries(
          Object.entries(costByResolution).map(([res, resCost]) => {
            const credits = newApiCreditsForModel(newApiRules, m.upstream, res);
            return [
              res,
              credits != null && credits > 0 ? withFixedCredits(resCost, credits, m.label) : resCost
            ];
          })
        )
      : costByResolution;
    const finalCreditsByResolution =
      m.provider === 'newapi' && m.pricingByResolution
        ? Object.fromEntries(
            resolutions.map((res) => [
              res,
              newApiCreditsForModel(newApiRules, m.upstream, res)
                ?? m.creditsByResolution?.[res]
                ?? m.defaultCredits
            ])
          )
        : m.pricingByResolution
          ? m.creditsByResolution
          : null;
    const finalPromoByResolution =
      m.provider === 'newapi' && m.pricingByResolution
        ? Object.fromEntries(
            resolutions.map((res) => {
              const credits = newApiCreditsForModel(newApiRules, m.upstream, res);
              return [res, credits ?? m.promoByResolution?.[res] ?? m.defaultCredits];
            })
          )
        : m.pricingByResolution
          ? m.promoByResolution
          : null;
    const newApiRule = newApiRuleForModel(m, opts.newApiCatalog);
    return {
      id: m.id,
      label: m.provider === 'newapi' ? m.label : m.displayLabel,
      catalogLabel: m.label,
      description: sanitizePublicModelDescription(m.description) || null,
      group: m.group,
      uiFamily: m.uiFamily,
      sortOrder: settings.models[m.id]?.sortOrder ?? m.sortOrder,
      status: m.status,
      selectable: m.enabled,
      statusNotice: m.statusNotice,
      refundOnViolation: m.refundOnViolation,
      violationNotice: m.violationNotice,
      fixedQualityLow: !!m.fixedQualityLow,
      modality: 'image',
      endpoint: { method: 'POST', path: '/api/v1/generate', contentType: 'application/json' },
      catalogVersion: opts.newApiCatalog.version || null,
      pricingVersion: opts.newApiCatalog.pricingVersion || null,
      parameters: newApiRule
        ? publicNewApiParameters(m.id, newApiRule)
        : publicDirectModelParameters(m),
      aspectRatios: newApiRule
        ? parameterOptions(newApiRule.parameters, 'size')
        : [...aspectRatiosForModel(m.id)],
      resolutions: m.resolutions,
      pricingByResolution: m.pricingByResolution,
      creditsByResolution: finalCreditsByResolution,
      promoByResolution: finalPromoByResolution,
      pricingBySpeed: m.pricingBySpeed,
      creditsBySpeed: m.pricingBySpeed ? m.creditsBySpeed : null,
      promoBySpeed: m.pricingBySpeed ? m.promoBySpeed : null,
      costBySpeed,
      costByResolution: finalCostByResolution,
      creditsPerCall: m.creditsPerCall,
      creditsBase: finalCost.listPrice,
      creditsFinal: finalCost.final,
      cost: { credits: finalCost.final },
      listPrice: finalCost.listPrice,
      promoPrice: finalCost.promoPrice,
      appliedDiscount: finalCost.appliedDiscount,
      modelDiscountPercent: finalCost.modelDiscountPercent,
      modelDiscountLabel: finalCost.modelDiscountLabel,
      discountLabel: finalCost.discountLabel,
      promoPriceFlat: m.promoPrice
    };
    });
}

async function computeGenerationCostForRequest(
  env: Env,
  settings: Awaited<ReturnType<typeof loadImageModelSettings>>,
  resolved: NonNullable<ReturnType<typeof resolveImageModelConfig>>,
  modelId: string,
  resolution: string,
  tier: import('../../lib/supabase').Profile['membership_tier'],
  memberActive: boolean,
  opts?: {
    mjSpeed?: string | null;
    newApiCatalog?: NewApiCatalogSnapshot;
  }
): Promise<ReturnType<typeof computeImageGenerationCost>> {
  const snapshot = opts?.newApiCatalog ?? await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL);
  const catalogEntries = imageCatalogForNewApiSnapshot(snapshot);
  const baseCost = computeImageGenerationCost(
    settings,
    modelId,
    resolution,
    tier,
    memberActive,
    { mjSpeed: opts?.mjSpeed, catalogEntries }
  );
  if (resolved.provider !== 'newapi') return baseCost;
  const credits = newApiCreditsForModel(
    snapshot.rules,
    resolved.upstream,
    resolution
  );
  if (credits == null || credits <= 0) return baseCost;
  return {
    ...baseCost,
    base: credits,
    final: credits,
    listPrice: credits,
    promoPrice: credits,
    appliedDiscount: 'fixed',
    discountLabel: '卡藏 API 实时价',
    modelDiscountPercent: 100,
    modelDiscountLabel: null,
    modelLabel: resolved.label
  };
}

function modelUnavailableMessage(resolved: NonNullable<
  ReturnType<typeof resolveImageModelConfig>
>): string {
  if (resolved.status === 'maintenance') {
    return resolved.statusNotice || '该模型维护中，请稍后再试';
  }
  return '所选模型已下架，请换用其他模型';
}

function isRetainedImageModel(model: NonNullable<ReturnType<typeof resolveImageModelConfig>>) {
  return isRetainedPublicImageEntry(model);
}

function assertSupportedImageParameters(
  model: NonNullable<ReturnType<typeof resolveImageModelConfig>>,
  data: z.infer<typeof bodySchema>,
  rule: NewApiPricingRule | null
): void {
  const allowedRatios = rule
    ? parameterOptions(rule.parameters, 'size')
    : [...aspectRatiosForModel(model.id)];
  if (data.size && allowedRatios.length && !allowedRatios.includes(data.size)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${data.size} 比例`);
  }
  if (rule) {
    const countParameter = rule.parameters.find(parameter => parameter.name === 'n' || parameter.name === 'count');
    const fixedCount = countParameter && Object.prototype.hasOwnProperty.call(countParameter, 'fixed')
      ? Number(countParameter.fixed)
      : null;
    const allowedCounts = (countParameter?.options || [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0);
    const minCount = Number.isFinite(Number(countParameter?.min)) ? Math.max(1, Number(countParameter?.min)) : 1;
    const maxCount = Number.isFinite(Number(countParameter?.max))
      ? Math.max(minCount, Number(countParameter?.max))
      : fixedCount && fixedCount > 0
        ? fixedCount
        : allowedCounts.length
          ? Math.max(...allowedCounts)
          : 1;
    if (
      !countParameter
      || (fixedCount && data.count !== fixedCount)
      || (allowedCounts.length > 0 && !allowedCounts.includes(data.count))
      || data.count < minCount
      || data.count > maxCount
    ) {
      const label = fixedCount && fixedCount > 0 ? `${fixedCount}` : `${minCount}-${maxCount}`;
      throw new ApiError(400, 'VALIDATION_ERROR', `该模型生成张数仅支持 ${label}`);
    }
  }
  const referenceCount = (data.refImageUrls?.length || 0) + (data.refImageUrl ? 1 : 0);
  if (!referenceCount) return;
  const imageParameter = rule?.parameters.find(parameter => parameter.name === 'images');
  const singleImageParameter = rule?.parameters.find(parameter => parameter.name === 'image');
  const maxReferences = imageParameter?.max_items
    ?? (singleImageParameter ? 1 : model.uiFamily === 'midjourney' ? 5 : 16);
  if (referenceCount > maxReferences) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型最多支持 ${maxReferences} 张参考图`);
  }
}

async function requireFreshNewApiCatalog(env: Env): Promise<NewApiCatalogSnapshot> {
  try {
    return await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL, {
      force: true,
      requireFresh: true
    });
  } catch {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      '暂时无法确认实时价格，请稍后重试'
    );
  }
}

generateRoutes.get('/models', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const [settings, profile, newApiCatalog] = await Promise.all([
    loadImageModelSettings(admin),
    getOrCreateProfile(admin, user.id),
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL)
  ]);
  const memberActive = isMembershipActive(profile);
  return c.json({
    ok: true,
    data: {
      globalDiscountPercent: settings.globalDiscountPercent,
      catalogVersion: newApiCatalog.version || null,
      pricingVersion: newApiCatalog.pricingVersion || null,
      catalogStale: newApiCatalog.stale,
      models: publicModelPayload(settings, profile.membership_tier, memberActive, { newApiCatalog })
    }
  });
});

/** 报价接口：轻量、不限流（避免生图页拖动参数时卡 20s+） */
generateRoutes.get('/cost', async c => {
  const resolution = c.req.query('resolution') || '1k';
  const model = normalizeImageModelId(c.req.query('model') || 'image2');
  if (!['1k', '2k', '4k'].includes(resolution)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的分辨率');
  }
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const [settings, profile, cachedNewApiCatalog] = await Promise.all([
    loadImageModelSettings(admin),
    getOrCreateProfile(admin, user.id),
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL)
  ]);
  const memberActive = isMembershipActive(profile);
  let newApiCatalog = cachedNewApiCatalog;
  let catalogEntries = imageCatalogForNewApiSnapshot(newApiCatalog);
  let resolved = resolveImageModelConfig(model, settings, catalogEntries);
  if (resolved?.provider === 'newapi') {
    newApiCatalog = await requireFreshNewApiCatalog(c.env);
    catalogEntries = imageCatalogForNewApiSnapshot(newApiCatalog);
    resolved = resolveImageModelConfig(model, settings, catalogEntries);
  }
  if (!resolved || !resolved.enabled || !isRetainedImageModel(resolved)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      resolved ? modelUnavailableMessage(resolved) : '模型不可用'
    );
  }
  if (resolved.resolutions.length && !resolved.resolutions.includes(resolution as '1k')) {
    throw new ApiError(400, 'VALIDATION_ERROR', `该模型不支持 ${resolution.toUpperCase()} 输出`);
  }
  const speed = c.req.query('speed') || '';
  const cost = await computeGenerationCostForRequest(
    c.env,
    settings,
    resolved,
    model,
    resolution,
    profile.membership_tier,
    memberActive,
    { mjSpeed: speed || null, newApiCatalog }
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
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(normalizeGenerationBodyAliases(rawBody));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的提示词与参数');
  }

  const promptText = parsed.data.prompt.slice(0, 8000);
  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const [settings, cachedNewApiCatalog] = await Promise.all([
    loadImageModelSettings(admin),
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL)
  ]);
  let newApiCatalog = cachedNewApiCatalog;
  let catalogEntries = imageCatalogForNewApiSnapshot(newApiCatalog);
  const modelId = normalizeImageModelId(parsed.data.model);
  let resolved = resolveImageModelConfig(modelId, settings, catalogEntries);
  if (resolved?.provider === 'newapi') {
    newApiCatalog = await requireFreshNewApiCatalog(c.env);
    catalogEntries = imageCatalogForNewApiSnapshot(newApiCatalog);
    resolved = resolveImageModelConfig(modelId, settings, catalogEntries);
  }
  if (!resolved || !resolved.enabled || !isRetainedImageModel(resolved)) {
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
  const newApiRule = newApiRuleForModel(resolved, newApiCatalog);
  assertSupportedImageParameters(
    resolved,
    parsed.data,
    newApiRule
  );

  const jobResolution = parsed.data.resolution;
  const jobQuality = resolved.fixedQualityLow ? 'low' : parsed.data.quality;
  const isMidjourney = resolved.uiFamily === 'midjourney' || isMidjourneyUpstream(resolved.upstream);
  const mjParams = isMidjourney && parsed.data.mjParams ? parsed.data.mjParams : undefined;

  const unitCost = await computeGenerationCostForRequest(
      c.env,
      settings,
      resolved,
      modelId,
      jobResolution,
      profile.membership_tier,
      memberActive,
      { mjSpeed: mjParams?.speed || null, newApiCatalog }
    );
  const count = newApiRule ? parsed.data.count : 1;
  const base = roundCredits(unitCost.base * count);
  const final = roundCredits(unitCost.final * count);
  const { discountLabel, modelLabel, refundOnViolation, violationNotice } = unitCost;

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
      '该模型暂不可用，请换用其他模型或联系站长'
    );
  }

  const { data: insertedJob, error: jobErr } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: promptText,
      resolution: jobResolution,
      quality: jobQuality,
      size_label: parsed.data.size ?? null,
      credits_charged: final,
      status: 'processing',
      meta: {
        model: modelId,
        upstreamModel: resolved.upstream,
        modelLabel,
        provider: lineProvider,
        refImageUrls: refUrls,
        count,
        base,
        discountLabel,
        size: parsed.data.size ?? null,
        refundOnViolation,
        violationNotice,
        fixedQualityLow: !!resolved.fixedQualityLow,
        ...(isMidjourney ? { isMidjourney: true, mjParams: mjParams || {} } : {})
      }
    })
    .select('*')
    .single();

  if (jobErr || !insertedJob) {
    throw wrapGenerateError(jobErr, '创建生图任务失败');
  }
  const job = insertedJob as JobRow;

  let upstreamTaskId: string | null = null;
  let submitImmediateUrl: string | null = null;
  let debited = false;
  let debitSplit = { fromDaily: 0, fromPermanent: 0 };

  const baseMeta = {
    model: modelId,
    upstreamModel: resolved.upstream,
    modelLabel,
    provider: lineProvider,
    refImageUrls: refUrls,
    count,
    ...(newApiRule ? { newApiParameters: newApiRule.parameters } : {}),
    base,
    discountLabel,
    size: parsed.data.size ?? null,
    refundOnViolation,
    violationNotice,
    fixedQualityLow: !!resolved.fixedQualityLow,
    ...(isMidjourney ? { isMidjourney: true, mjParams: mjParams || {} } : {})
  };

  try {
    const debitedResult = await deductUserCredits(
      admin,
      user.id,
      final,
      'image_generation',
      job.id,
      { model: modelId, resolution: parsed.data.resolution, count, base, discountLabel }
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

  const submitParams = {
    upstreamModel: resolved.upstream,
    prompt: promptText,
    resolution: jobResolution,
    quality: jobQuality,
    fixedQualityLow: !!resolved.fixedQualityLow,
    size: parsed.data.size,
    count,
    refImageUrls: refUrls,
    catalogParameters: newApiRule?.parameters,
    ...(mjParams ? { mjParams } : {})
  };

  /** 上游同步提交易超 CF 请求时限；改后台提交后立即返回 jobId。 */
  if (
    hasAnyImageUpstream(upstream)
    && (lineProvider === 'apimart' || lineProvider === 'newapi')
    && isProviderConfigured(upstream, lineProvider)
  ) {
    const useDurableQueue = lineProvider === 'newapi' && !!c.env.IMAGE_GENERATION_QUEUE;
    const fastMeta: Record<string, unknown> = {
      ...baseMeta,
      debitSplit,
      fastSubmitState: 'queued',
      ...(useDurableQueue ? { queueEnqueuedAt: new Date().toISOString() } : {})
    };
    await admin
      .from('generation_requests')
      .update({ meta: fastMeta })
      .eq('id', job.id);
    const queuedJob: JobRow = { ...job, meta: fastMeta };
    if (useDurableQueue) {
      try {
        await c.env.IMAGE_GENERATION_QUEUE!.send({ jobId: job.id, userId: user.id });
      } catch (queueError) {
        console.error('[generate] image queue enqueue failed', job.id, queueError);
      }
    } else {
      kickBackgroundTask(
        c,
        processFastProviderPendingSubmit(admin, user.id, queuedJob, upstream, lineProvider, submitParams, c.env)
      );
    }
  }

  if (hasAnyImageUpstream(upstream) && upstreamTaskId) {
    await admin
      .from('generation_requests')
      .update({
        meta: {
          ...baseMeta,
          upstreamTaskId,
          debitSplit,
          ...(submitImmediateUrl ? { syncImageUrl: submitImmediateUrl } : {})
        }
      })
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
      demo: !hasAnyImageUpstream(upstream),
      progressNote: hasAnyImageUpstream(upstream)
        ? '已扣积分，正在提交（请勿重复点生成）'
        : null
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
      const polled = await pollAndUpdateJob(
        admin,
        user.id,
        job,
        upstreamBindingsFromEnv(c.env),
        c.env,
        { quick: true, kickSubmit: pollKickSubmit(c) }
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
      model: meta.model,
      modelLabel: meta.modelLabel,
      createdAt: job.created_at
    };
  });
  return c.json({ ok: true, data: { jobs, days, limit } });
});

generateRoutes.get('/jobs/recent', async c => {
  const user = c.get('user');
  const admin = createAdminClient(c.env);
  const daysRaw = Number(c.req.query('days'));
  const limitRaw = Number(c.req.query('limit'));
  const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, Math.floor(daysRaw))) : 7;
  const limit = Number.isFinite(limitRaw) ? Math.min(400, Math.max(1, Math.floor(limitRaw))) : 200;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('id,prompt,status,result_image_url,meta,created_at,completed_at,resolution,quality,size_label,credits_charged')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const stringList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((u): u is string => typeof u === 'string' && !!u.trim())
      : [];

  const jobs = (await Promise.all((rows || [])
    .map(async (job) => {
      const meta = (job.meta as Record<string, unknown>) || {};
      const extraImageUrls = stringList(meta.extraImageUrls);
      const mjGridUrls = stringList(meta.mjGridUrls);
      const mjGalleryUrls = stringList(meta.mjGalleryUrls);
      const mjCompositeUrl =
        typeof meta.mjCompositeUrl === 'string' && meta.mjCompositeUrl.trim()
          ? meta.mjCompositeUrl
          : null;
      const isMidjourney =
        meta.isMidjourney === true
        || mjGridUrls.length > 0
        || mjGalleryUrls.length > 0
        || !!mjCompositeUrl;
      const imageUrl = await resolveJobImageUrlForClient(c, job.result_image_url as string | null);
      const extraImageUrlsOut = (await Promise.all(
        extraImageUrls.map((u) => resolveJobImageUrlForClient(c, u))
      )).filter((u): u is string => typeof u === 'string' && !!u);
      const mjGridUrlsOut = (await Promise.all(
        mjGridUrls.map((u) => resolveJobImageUrlForClient(c, u))
      )).filter((u): u is string => typeof u === 'string' && !!u);
      const mjGalleryUrlsOut = (await Promise.all(
        mjGalleryUrls.map((u) => resolveJobImageUrlForClient(c, u))
      )).filter((u): u is string => typeof u === 'string' && !!u);
      const mjCompositeUrlOut = mjCompositeUrl
        ? await resolveJobImageUrlForClient(c, mjCompositeUrl)
        : null;
      const hasAnyImage =
        !!imageUrl
        || extraImageUrlsOut.length > 0
        || mjGridUrlsOut.length > 0
        || mjGalleryUrlsOut.length > 0
        || !!mjCompositeUrlOut;
      if (job.status !== 'completed' || !hasAnyImage) return null;
      return {
        id: job.id,
        prompt: job.prompt,
        status: job.status,
        imageUrl,
        extraImageUrls: extraImageUrlsOut.length ? extraImageUrlsOut : undefined,
        creditsCharged: job.credits_charged,
        resolution: job.resolution,
        quality: job.quality,
        size: job.size_label,
        model: meta.model,
        modelLabel: meta.modelLabel,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        isMidjourney,
        mjGridUrls: mjGridUrlsOut.length ? mjGridUrlsOut : undefined,
        mjCompositeUrl: mjCompositeUrlOut || undefined,
        mjGalleryUrls: mjGalleryUrlsOut.length ? mjGalleryUrlsOut : undefined,
        mjButtons: Array.isArray(meta.mjButtons) ? meta.mjButtons : undefined
      };
    })))
    .filter((job): job is NonNullable<typeof job> => !!job);

  return c.json({ ok: true, data: { jobs, days, limit, retentionDays: 7 } });
});

const recoverWarehouseSchema = z.object({
  max: z.number().int().min(1).max(24).optional(),
  days: z.number().int().min(1).max(365).optional(),
  hours: z.number().int().min(1).max(168).optional(),
  offset: z.number().int().min(0).max(5000).optional(),
  mode: z.enum(['import', 'repair', 'extras', 'settle']).optional(),
  providerScope: z.enum(['all', 'grs', 'grsai', 'apimart', 'newapi']).optional(),
  jobIds: z.array(z.string().min(8).max(64)).max(10).optional(),
  deletedGenerationJobTombstones: z.record(z.string(), z.number()).optional()
});

type RecoverProviderScope = 'all' | 'grs' | 'apimart' | 'newapi';

function normalizeRecoverProviderScope(
  scope: z.infer<typeof recoverWarehouseSchema>['providerScope']
): RecoverProviderScope | undefined {
  if (scope === 'grsai') return 'grs';
  if (scope === 'all' || scope === 'grs' || scope === 'apimart' || scope === 'newapi') return scope;
  return undefined;
}

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
    const providerScope = normalizeRecoverProviderScope(body.providerScope);
    const common = {
      max: body.max,
      days: body.days,
      hours: body.hours,
      offset: body.offset,
      providerScope,
      env: c.env,
      deletedGenerationJobTombstones: body.deletedGenerationJobTombstones
    };
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
          const polled = await pollAndUpdateJob(admin, user.id, job, upstream, c.env, {
            kickSubmit: pollKickSubmit(c)
          });
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

      const imported = ids.length
        ? await recoverGenerationJobsToWarehouse(admin, user.id, { ...common, jobIds: ids })
        : { imported: 0, skipped: 0, failures: [], cardIds: [] as string[] };
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
            : '生成服务仍无可用图片，请稍后再试或点占位上的重试'
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

/** Midjourney 二次操作（放大 / 变体 / 重新生成等） */
generateRoutes.post('/mj-action', rateLimit(300, 60_000), async (c) => {
  const user = c.get('user');
  const parsed = mjActionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的 Midjourney 操作参数');
  }
  if (parsed.data.action === 'upscale') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      '放大功能已关闭：四宫格 4 张已自动保存，请直接切换或下载，无需付费截取同一张图'
    );
  }
  const customId = parsed.data.customId || '';
  if (/upsample|upscale/i.test(customId)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      '放大功能已关闭：普通放大只是从四宫格截取，与已保存图相同，且仍会扣积分'
    );
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const settings = await loadImageModelSettings(admin);

  const { data: parentJob, error: parentErr } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', parsed.data.parentJobId)
    .maybeSingle();
  if (parentErr || !parentJob) {
    throw new ApiError(404, 'NOT_FOUND', '父任务不存在');
  }
  assertJobOwner(parentJob, user.id);

  const parentMeta = (parentJob.meta as Record<string, unknown>) || {};
  if (!parentMeta.isMidjourney) {
    throw new ApiError(400, 'VALIDATION_ERROR', '该任务不是 Midjourney 作品，无法执行此操作');
  }
  const parentTaskId =
    typeof parentMeta.upstreamTaskId === 'string'
      ? parentMeta.upstreamTaskId
      : typeof parentMeta.apimartTaskId === 'string'
        ? parentMeta.apimartTaskId
        : null;
  if (!parentTaskId) {
    throw new ApiError(400, 'VALIDATION_ERROR', '父任务尚未完成提交，请稍后再试');
  }

  const modelId = normalizeImageModelId(String(parentMeta.model || 'apimart-mj-v61'));
  const resolved = resolveImageModelConfig(modelId, settings);
  if (!resolved || !resolved.enabled || !isRetainedImageModel(resolved)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '模型不可用');
  }

  const jobResolution = '1k';
  const parentMjSpeed =
    typeof parentMeta.mjSpeed === 'string'
      ? parentMeta.mjSpeed
      : parentMeta.mjParams &&
          typeof parentMeta.mjParams === 'object' &&
          parentMeta.mjParams !== null &&
          'speed' in parentMeta.mjParams
        ? String((parentMeta.mjParams as { speed?: string }).speed || '')
        : null;
  const { final: rawFinal, base, discountLabel, modelLabel, refundOnViolation, violationNotice } =
    computeImageGenerationCost(
      settings,
      modelId,
      jobResolution,
      profile.membership_tier,
      memberActive,
      { mjSpeed: parentMjSpeed }
    );
  const final = roundCredits(rawFinal);
  const balance = spendableCredits(profile);
  if (balance < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${balance}）`);
  }

  const upstream = upstreamBindingsFromEnv(c.env);
  if (!isProviderConfigured(upstream, 'apimart')) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Midjourney 线路未配置，请联系站长');
  }

  const promptText = String(parsed.data.prompt || parentJob.prompt || '').slice(0, 8000);
  const rawRefInputs = parsed.data.refImageUrls?.length ? parsed.data.refImageUrls : [];
  const refUrls = rawRefInputs.length
    ? await resolveGenerationRefUrls(c, admin, user.id, rawRefInputs)
    : [];

  const { data: job, error: jobErr } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: promptText || `[MJ ${parsed.data.action}]`,
      resolution: jobResolution,
      quality: 'standard',
      size_label: typeof parentMeta.size === 'string' ? parentMeta.size : null,
      credits_charged: final,
      status: 'processing',
      meta: {
        model: modelId,
        upstreamModel: resolved.upstream,
        modelLabel,
        provider: 'apimart',
        base,
        discountLabel,
        refundOnViolation,
        violationNotice,
        isMidjourney: true,
        mjAction: parsed.data.action,
        mjParentJobId: parsed.data.parentJobId,
        mjParentTaskId: parentTaskId,
        mjSpeed: parentMjSpeed || 'relax',
        size: typeof parentMeta.size === 'string' ? parentMeta.size : null
      }
    })
    .select('id')
    .single();
  if (jobErr) {
    throw wrapGenerateError(jobErr, '创建 Midjourney 操作任务失败');
  }

  let debited = false;
  let debitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debitedResult = await deductUserCredits(
      admin,
      user.id,
      final,
      'image_generation',
      job.id,
      { model: modelId, mjAction: parsed.data.action, mjSpeed: parentMjSpeed, base, discountLabel }
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
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    if (String((debitErr as Error).message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw wrapGenerateError(debitErr, '扣减积分失败');
  }

  const actionParams: SubmitMjActionParams = {
    action: parsed.data.action as MjActionKind,
    parentTaskId,
    index: parsed.data.index,
    customId: parsed.data.customId,
    prompt: promptText || undefined,
    zoom: parsed.data.zoom,
    direction: parsed.data.direction,
    imageUrls: refUrls.length ? refUrls : undefined,
    maskUrl: parsed.data.maskUrl || undefined
  };

  const fastMeta: Record<string, unknown> = {
    model: modelId,
    upstreamModel: resolved.upstream,
    modelLabel,
    provider: 'apimart',
    base,
    discountLabel,
    refundOnViolation,
    violationNotice,
    isMidjourney: true,
    mjAction: parsed.data.action,
    mjParentJobId: parsed.data.parentJobId,
    mjParentTaskId: parentTaskId,
    mjSpeed: parentMjSpeed || 'relax',
    debitSplit,
    fastSubmitState: 'queued'
  };

  await admin.from('generation_requests').update({ meta: fastMeta }).eq('id', job.id);

  kickBackgroundTask(
    c,
    (async () => {
      try {
        const taskId = await submitMidjourneyAction(
          upstream.apimartKey!,
          upstream.apimartBase,
          actionParams
        );
        await admin
          .from('generation_requests')
          .update({
            meta: {
              ...fastMeta,
              upstreamTaskId: taskId,
              fastSubmitState: 'done',
              fastSubmitFinishedAt: new Date().toISOString()
            }
          })
          .eq('id', job.id);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : String((e as Error).message || e);
        if (debited && final > 0) {
          await refundUserCredits(
            admin,
            user.id,
            final,
            'image_generation_refund',
            job.id,
            debitSplit,
            { reason: msg, mjAction: parsed.data.action }
          );
        }
        await finalizeFailedJob(admin, user.id, job as JobRow, msg);
      }
    })()
  );

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: 'processing',
      creditsCharged: final,
      creditsRemaining: spendableCredits(profile)
    }
  });
});

/** Midjourney 独立混图（2～5 张垫图） */
generateRoutes.post('/mj-blend', rateLimit(300, 60_000), async (c) => {
  const user = c.get('user');
  const parsed = mjBlendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '混图需要 2～5 张有效参考图');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const settings = await loadImageModelSettings(admin);

  const modelId = normalizeImageModelId(parsed.data.model || 'apimart-mj-v81');
  const resolved = resolveImageModelConfig(modelId, settings);
  if (!resolved || !resolved.enabled || !isMidjourneyUpstream(resolved.upstream)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请选择可用的 Midjourney 模型');
  }

  const jobResolution = '1k';
  const blendSpeed = parsed.data.speed || null;
  const { final: rawFinal, base, discountLabel, modelLabel, refundOnViolation, violationNotice } =
    computeImageGenerationCost(
      settings,
      modelId,
      jobResolution,
      profile.membership_tier,
      memberActive,
      { mjSpeed: blendSpeed }
    );
  const final = roundCredits(rawFinal);
  const balance = spendableCredits(profile);
  if (balance < final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（需要 ${final}，当前 ${balance}）`);
  }

  const upstream = upstreamBindingsFromEnv(c.env);
  if (!isProviderConfigured(upstream, 'apimart')) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Midjourney 线路未配置，请联系站长');
  }

  const refUrls = await resolveGenerationRefUrls(c, admin, user.id, parsed.data.refImageUrls);
  if (refUrls.length < 2) {
    throw new ApiError(400, 'VALIDATION_ERROR', '混图需要至少 2 张可访问的参考图');
  }

  const { data: job, error: jobErr } = await admin
    .from('generation_requests')
    .insert({
      user_id: user.id,
      prompt: '[MJ 混图]',
      resolution: jobResolution,
      quality: 'standard',
      size_label: null,
      credits_charged: final,
      status: 'processing',
      meta: {
        model: modelId,
        upstreamModel: resolved.upstream,
        modelLabel,
        provider: 'apimart',
        refImageUrls: refUrls,
        base,
        discountLabel,
        refundOnViolation,
        violationNotice,
        isMidjourney: true,
        mjAction: 'blend',
        mjSpeed: blendSpeed || 'relax'
      }
    })
    .select('id')
    .single();
  if (jobErr) {
    throw wrapGenerateError(jobErr, '创建 Midjourney 混图任务失败');
  }

  let debited = false;
  let debitSplit = { fromDaily: 0, fromPermanent: 0 };
  try {
    const debitedResult = await deductUserCredits(
      admin,
      user.id,
      final,
      'image_generation',
      job.id,
      { model: modelId, mjAction: 'blend', mjSpeed: blendSpeed, base, discountLabel }
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
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    if (String((debitErr as Error).message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw wrapGenerateError(debitErr, '扣减积分失败');
  }

  const fastMeta: Record<string, unknown> = {
    model: modelId,
    upstreamModel: resolved.upstream,
    modelLabel,
    provider: 'apimart',
    refImageUrls: refUrls,
    base,
    discountLabel,
    refundOnViolation,
    violationNotice,
    isMidjourney: true,
    mjAction: 'blend',
    mjSpeed: blendSpeed || 'relax',
    debitSplit,
    fastSubmitState: 'queued'
  };
  await admin.from('generation_requests').update({ meta: fastMeta }).eq('id', job.id);

  kickBackgroundTask(
    c,
    (async () => {
      try {
        const taskId = await submitMidjourneyBlend(
          upstream.apimartKey!,
          upstream.apimartBase,
          refUrls.slice(0, 5),
          blendSpeed
        );
        await admin
          .from('generation_requests')
          .update({
            meta: {
              ...fastMeta,
              upstreamTaskId: taskId,
              fastSubmitState: 'done',
              fastSubmitFinishedAt: new Date().toISOString()
            }
          })
          .eq('id', job.id);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : String((e as Error).message || e);
        if (debited && final > 0) {
          await refundUserCredits(
            admin,
            user.id,
            final,
            'image_generation_refund',
            job.id,
            debitSplit,
            { reason: msg, mjAction: 'blend' }
          );
        }
        await finalizeFailedJob(admin, user.id, job as JobRow, msg);
      }
    })()
  );

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: 'processing',
      creditsCharged: final,
      creditsRemaining: spendableCredits(profile)
    }
  });
});

/** 画布/插件：鉴权后直接拉任务成图（避免浏览器跨域 fetch CDN 失败） */
generateRoutes.get('/jobs/:jobId/image', async c => {
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

  let imageRef = job.result_image_url as string | null;
  const status = String(job.status || '');

  if (!imageRef && status === 'processing') {
    const polled = await pollAndUpdateJob(
      admin,
      user.id,
      job,
      upstreamBindingsFromEnv(c.env),
      c.env,
      { quick: false, kickSubmit: pollKickSubmit(c) }
    );
    if (polled.imageUrl) {
      const { data: fresh } = await admin
        .from('generation_requests')
        .select('result_image_url, status')
        .eq('id', jobId)
        .maybeSingle();
      imageRef = (fresh?.result_image_url as string | null) || polled.imageUrl;
    }
  }

  if (!imageRef) {
    throw new ApiError(404, 'NOT_FOUND', status === 'failed' ? '任务已失败' : '任务尚未出图');
  }

  if (jobPollNeedsBackgroundArchive(imageRef)) {
    try {
      await archivePendingJobImage(admin, user.id, jobId, c.env);
      const { data: archived } = await admin
        .from('generation_requests')
        .select('result_image_url')
        .eq('id', jobId)
        .maybeSingle();
      if (archived?.result_image_url) {
        imageRef = archived.result_image_url as string;
      }
    } catch (e) {
      console.warn('[generate] job image archive failed', jobId, e);
    }
  }

  const path = resolveStoragePath(imageRef);
  if (path) {
    assertOwnMediaPath(user.id, path);
    return serveCachedStorageImage(c, path);
  }

  if (isRemoteHttpImageUrl(imageRef)) {
    const upstream = await fetch(imageRef, { redirect: 'follow' });
    if (!upstream.ok) {
      throw new ApiError(502, 'UPSTREAM_ERROR', '生成图片暂不可用');
    }
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=120'
      }
    });
  }

  throw new ApiError(404, 'NOT_FOUND', '无效图片路径');
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
  const upstream = upstreamBindingsFromEnv(c.env);
  const jobMeta = (job.meta as Record<string, unknown>) || {};
  let polled = await pollAndUpdateJob(
    admin,
    user.id,
    job,
    upstreamBindingsFromEnv(c.env),
    c.env,
    { quick: !settle, kickSubmit: pollKickSubmit(c) }
  );

  if (settle && polled.status === 'processing') {
    polled = await pollAndUpdateJob(
      admin,
      user.id,
      job,
      upstreamBindingsFromEnv(c.env),
      c.env,
      { quick: false, kickSubmit: pollKickSubmit(c) }
    );
  } else if (
    polled.status === 'processing'
    && c.executionCtx
    && false
  ) {
    c.executionCtx.waitUntil(
      pollAndUpdateJob(
        admin,
        user.id,
        job,
        upstreamBindingsFromEnv(c.env),
        c.env,
        { quick: false }
      ).catch((e) => {
        console.warn('[generate] background settle failed', jobId, e);
      })
    );
  }

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

  let responseImageUrl = liveImageUrl;
  if (settle && liveStatus === 'completed' && jobPollNeedsBackgroundArchive(liveImageUrl)) {
    try {
      await archivePendingJobImage(admin, user.id, jobId, c.env);
      const { data: archivedRow } = await admin
        .from('generation_requests')
        .select('result_image_url')
        .eq('id', jobId)
        .maybeSingle();
      if (archivedRow?.result_image_url) {
        responseImageUrl = archivedRow.result_image_url as string;
      }
    } catch (e) {
      console.warn('[generate] settle archive failed', jobId, e);
    }
  } else if (jobPollNeedsBackgroundArchive(liveImageUrl) && c.executionCtx) {
    c.executionCtx.waitUntil(
      archivePendingJobImage(admin, user.id, jobId, c.env).catch((e) => {
        console.warn('[generate] waitUntil archive failed', jobId, e);
      })
    );
  }

  responseImageUrl = await resolveJobImageUrlForClient(c, responseImageUrl);
  const responseExtraUrls = extraImageUrls?.length
    ? await Promise.all(extraImageUrls.map((u) => resolveJobImageUrlForClient(c, u)))
    : undefined;

  let responseMeta: Record<string, unknown> = { ...updatedMeta };
  if (meta.isMidjourney === true && liveStatus === 'completed') {
    const mjTaskId =
      typeof meta.upstreamTaskId === 'string'
        ? meta.upstreamTaskId
        : typeof meta.apimartTaskId === 'string'
          ? meta.apimartTaskId
          : null;
    const curGalleryCount = mjGalleryUrlCount(responseMeta);
    const hasMjComposite =
      typeof responseMeta.mjCompositeUrl === 'string' && !!responseMeta.mjCompositeUrl.trim();
    const needsMjGallerySync = !hasMjComposite || curGalleryCount < 5;
    if (mjTaskId && upstream.apimartKey && (settle || needsMjGallerySync)) {
      try {
        await syncMjImagesFromUpstream(
          admin,
          liveJob as JobRow,
          upstream,
          mjTaskId,
          { settle: !!settle || needsMjGallerySync }
        );
        const { data: mjFresh } = await admin
          .from('generation_requests')
          .select('meta, result_image_url')
          .eq('id', jobId)
          .maybeSingle();
        if (mjFresh?.meta && typeof mjFresh.meta === 'object') {
          responseMeta = mjFresh.meta as Record<string, unknown>;
        }
        if (mjFresh?.result_image_url) {
          responseImageUrl = await resolveJobImageUrlForClient(
            c,
            mjFresh.result_image_url as string
          );
        }
      } catch (e) {
        console.warn('[generate] mj gallery sync failed', jobId, e);
      }
    }
  }

  let mjGalleryUrlsOut: string[] | undefined;
  if (meta.isMidjourney === true) {
    const rawGallery = Array.isArray(responseMeta.mjGalleryUrls)
      ? (responseMeta.mjGalleryUrls as string[]).filter(Boolean)
      : buildMjGalleryUrls(
          typeof responseMeta.mjCompositeUrl === 'string' ? responseMeta.mjCompositeUrl : null,
          Array.isArray(responseMeta.mjGridUrls) ? (responseMeta.mjGridUrls as string[]) : []
        );
    if (rawGallery.length) {
      mjGalleryUrlsOut = (await Promise.all(
        rawGallery.map((u) => resolveJobImageUrlForClient(c, u))
      )).filter((u): u is string => typeof u === 'string' && !!u);
    }
  }

  let mjButtonsOut = Array.isArray(meta.mjButtons) ? meta.mjButtons : undefined;
  if (
    meta.isMidjourney === true
    && liveStatus === 'completed'
    && !mjButtonsOut?.length
    && upstream.apimartKey
  ) {
    const mjTaskId =
      typeof meta.upstreamTaskId === 'string'
        ? meta.upstreamTaskId
        : typeof meta.apimartTaskId === 'string'
          ? meta.apimartTaskId
          : null;
    if (mjTaskId) {
      try {
        const fetched = await fetchMidjourneyTaskButtons(
          upstream.apimartKey,
          upstream.apimartBase,
          mjTaskId
        );
        mjButtonsOut = filterMjButtonsForClient(fetched.length ? fetched : defaultGridMjButtons());
        if (mjButtonsOut.length) {
          await admin
            .from('generation_requests')
            .update({ meta: { ...liveMeta, mjButtons: mjButtonsOut } })
            .eq('id', jobId);
        }
      } catch {
        mjButtonsOut = filterMjButtonsForClient(defaultGridMjButtons());
      }
    }
  }

  if (mjButtonsOut?.length) {
    mjButtonsOut = filterMjButtonsForClient(mjButtonsOut);
  }

  return c.json({
    ok: true,
    data: {
      jobId: job.id,
      status: liveStatus,
      imageUrl: responseImageUrl,
      extraImageUrls: responseExtraUrls?.filter(Boolean).length ? responseExtraUrls.filter(Boolean) : undefined,
      creditsRemaining: spendableCredits(profile),
      model: meta.model,
      modelLabel: meta.modelLabel,
      provider: meta.provider,
      resolution: liveJob.resolution || null,
      progressNote: polled.progressNote || slowProviderProgressNote(meta, readJobProvider(meta)),
      isMidjourney: meta.isMidjourney === true,
      mjTaskId:
        typeof meta.upstreamTaskId === 'string'
          ? meta.upstreamTaskId
          : typeof meta.apimartTaskId === 'string'
            ? meta.apimartTaskId
            : undefined,
      mjButtons: mjButtonsOut,
      mjGridUrls: Array.isArray(responseMeta.mjGridUrls) ? responseMeta.mjGridUrls : undefined,
      mjCompositeUrl:
        typeof responseMeta.mjCompositeUrl === 'string' ? responseMeta.mjCompositeUrl : undefined,
      mjGalleryUrls: mjGalleryUrlsOut?.length ? mjGalleryUrlsOut : undefined,
      mjAction: typeof meta.mjAction === 'string' ? meta.mjAction : undefined,
      mjParentJobId: typeof meta.mjParentJobId === 'string' ? meta.mjParentJobId : undefined
    }
  });
});
