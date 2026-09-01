import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { submitChatCompletions, type ChatMessage } from '../../lib/chat-completions';
import {
  billableNewApiTextCredits,
  DEFAULT_PUBLIC_TEXT_MODEL,
  estimateTextTokens,
  fetchFreshNewApiTextModel,
  newApiTextRequestTarget
} from '../../lib/newapi-text';
import { ApiError } from '../../lib/errors';
import type { NewApiCatalogModel } from '../../lib/newapi';
import {
  deductUserCredits,
  refundUserCredits,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient } from '../../lib/supabase';
import { mergeTaskFlags } from '../../lib/membership-tasks';
import { CLIENT_REQUEST_ID_PATTERN } from '../../lib/generation-idempotency';
import { sanitizePublicModelId, sanitizePublicModelLabel } from '../../lib/public-model-projection';
import { rateLimit } from '../../middleware/rate-limit';

const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function').default('function'),
  function: z.object({
    name: z.string().min(1).max(200),
    arguments: z.string().max(64000)
  })
});

const messageSchema = z.union([
  z.object({
    role: z.enum(['user', 'system']),
    content: z.string().min(1).max(64000)
  }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().max(64000).nullable().optional(),
    tool_calls: z.array(toolCallSchema).min(1).max(64).optional()
  }).refine(message => Boolean(message.content?.trim() || message.tool_calls?.length), {
    message: 'assistant message requires content or tool calls'
  }),
  z.object({
    role: z.literal('tool'),
    content: z.string().min(1).max(64000),
    tool_call_id: z.string().min(1).max(200)
  })
]);

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  context: z.string().max(16000).optional(),
  model: z.string().min(1).max(100).optional(),
  thinking: z.boolean().optional(),
  reasoningEffort: z.string().min(1).max(20).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  tools: z.array(z.record(z.unknown())).max(64).optional(),
  toolChoice: z.unknown().optional(),
  attachContext: z.boolean().optional(),
  noPreset: z.boolean().optional(),
  /**
   * 客户端幂等键：同一次逻辑请求的网络重试复用同一个 id，积分扣减按
   * (user, reason, ref_id) ledger 幂等，杜绝客户端重试导致的重复扣费。
   * 缺省时退回历史随机 id（无幂等，行为同旧版）。
   */
  clientRequestId: z.string().min(8).max(128).regex(CLIENT_REQUEST_ID_PATTERN).optional()
});

export const chatRoutes = new Hono<{ Bindings: Env }>();

function estimateTokens(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => {
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = message.role === 'assistant' && message.tool_calls?.length
      ? JSON.stringify(message.tool_calls)
      : '';
    return sum + estimateTextTokens(`${content}${toolCalls}`);
  }, 0);
}

export function publicChatQuotePayload(input: {
  model: string;
  modelLabel: string;
  thinking: boolean;
  final: number;
}) {
  const model = sanitizePublicModelId(input.model) || 'creative-model';
  return {
    model,
    modelLabel: sanitizePublicModelLabel(input.modelLabel, model === 'creative-model' ? '创作模型' : model),
    thinking: input.thinking,
    final: input.final
  };
}

export function publicChatCostPayload(final: number) {
  return { final };
}

function validateReasoningEffort(model: NewApiCatalogModel, value?: string) {
  if (!value) return;
  const parameter = model.parameters.find(item => item.name === 'reasoning_effort');
  const options = (parameter?.options || []).map(String);
  if (options.length && !options.includes(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '该模型不支持所选思考强度');
  }
}

chatRoutes.get('/cost', async c => {
  const model = c.req.query('model') || DEFAULT_PUBLIC_TEXT_MODEL;
  const thinking = c.req.query('thinking') === '1' || c.req.query('thinking') === 'true';
  const inputTokens = Math.max(0, Number(c.req.query('inputTokens') || 0));
  const outputTokens = Math.max(1, Math.min(8192, Number(c.req.query('outputTokens') || 2048)));

  const resolved = await fetchFreshNewApiTextModel(c.env, model);
  const credits = billableNewApiTextCredits(
    resolved.model,
    inputTokens || estimateTextTokens('示例消息'),
    outputTokens
  );
  if (credits == null) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');
  }

  return c.json({
    ok: true,
    data: publicChatQuotePayload({
      ...resolved.publicIdentity,
      thinking,
      final: credits
    })
  });
});

chatRoutes.post('/', rateLimit(120, 60_000), async c => {
  const user = c.get('user');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的对话内容');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);

  const modelId = parsed.data.model || DEFAULT_PUBLIC_TEXT_MODEL;
  const resolvedCatalogModel = await fetchFreshNewApiTextModel(c.env, modelId);
  const catalogModel = resolvedCatalogModel.model;
  validateReasoningEffort(catalogModel, parsed.data.reasoningEffort);
  const requestTarget = newApiTextRequestTarget(c.env, resolvedCatalogModel);

  const thinking = !!parsed.data.thinking;
  const maxOutputTokens = parsed.data.maxTokens || 2048;

  const messages: ChatMessage[] = [...parsed.data.messages];
  const ctx = parsed.data.context?.trim();
  const attachContext = parsed.data.attachContext !== false;
  const noPreset = !!parsed.data.noPreset;

  if (!noPreset) {
    if (attachContext && ctx) {
      messages.unshift({
        role: 'system',
        content: `你是 Prompt Hub 资产创作助手，帮助用户扩写镜头、对白与场景描述。请用简体中文，回答简洁实用。\n\n【当前创作上下文】\n${ctx.slice(0, 12000)}`
      });
    } else {
      messages.unshift({
        role: 'system',
        content:
          '你是 Prompt Hub 资产创作助手，帮助用户扩写镜头、对白与场景描述。请用简体中文，回答简洁实用。'
      });
    }
  }

  const estimatedInputTokens = estimateTokens(messages);
  const estimatedCredits = billableNewApiTextCredits(
    catalogModel,
    estimatedInputTokens,
    maxOutputTokens
  );
  if (estimatedCredits == null) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');
  const balance = spendableCredits(profile);
  if (balance < estimatedCredits) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（预估需要 ${estimatedCredits}，当前 ${balance}）`
    );
  }

  // 扣费改为「预扣最坏情况 + 调用后结算」，与生图流程同纪律：
  //   1) 预扣按 maxTokens 输出估算的 credits —— 保证上游消耗发生前积分已锁定，
  //      上游失败（网络/超时）立刻全额退款，杜绝"先调用后扣费"下上游已消耗
  //      却 402 漏收的窗口；
  //   2) 成功后按实际 usage 结算差价（多退少补，delta 补扣失败仅记日志不阻断
  //      回复 —— 差额上限被 maxTokens 约束，风险有界）；
  //   3) 带 clientRequestId 时三笔账（预扣/结算/退款）都以同一 ref 幂等，
  //      客户端网络重试不会重复扣费。
  const clientRequestId = parsed.data.clientRequestId?.trim() || '';
  const chatRef = clientRequestId
    ? `chat_generation:${clientRequestId}`
    : `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const settleRef = `${chatRef}:settle`;
  const refundRef = `${chatRef}:refund`;

  let debitedProfile = profile;
  let reserveSplit: { fromDaily: number; fromPermanent: number } = {
    fromDaily: 0,
    fromPermanent: estimatedCredits
  };
  try {
    const reserved = await deductUserCredits(
      admin,
      user.id,
      estimatedCredits,
      'chat_generation',
      chatRef,
      {
        model: resolvedCatalogModel.requestedModelId,
        thinking,
        base: estimatedCredits,
        discountLabel: null,
        phase: 'reserve'
      }
    );
    debitedProfile = reserved.profile;
    // 扣减返回真实 debitSplit；replay 响应拿不到时兜底全退永久积分
    // （宁可控小概率多退，也不静默吞用户的钱）。
    if (
      reserved.split
      && (Number.isFinite(Number(reserved.split.fromDaily)) || Number.isFinite(Number(reserved.split.fromPermanent)))
    ) {
      reserveSplit = {
        fromDaily: Number(reserved.split.fromDaily) || 0,
        fromPermanent: Number(reserved.split.fromPermanent) || 0
      };
    }
  } catch (debitErr) {
    if (String((debitErr as Error).message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw debitErr;
  }

  let result;
  try {
    result = await submitChatCompletions(requestTarget.apiKey, requestTarget.baseUrl, {
      model: requestTarget.model,
      messages,
      thinking,
      reasoningEffort: parsed.data.reasoningEffort,
      temperature: parsed.data.temperature,
      maxTokens: maxOutputTokens,
      tools: parsed.data.tools,
      toolChoice: parsed.data.toolChoice,
      idempotencyKey: clientRequestId || undefined
    });
  } catch (upstreamErr) {
    // 上游失败：预扣全退（幂等 ref + 预扣的真实 split，重试安全），再把
    // 原错误抛给客户端。
    try {
      await refundUserCredits(
        admin,
        user.id,
        estimatedCredits,
        'chat_generation_refund',
        refundRef,
        reserveSplit,
        { model: resolvedCatalogModel.requestedModelId, phase: 'reserve_refund' }
      );
    } catch (refundErr) {
      console.error('[chat] reserve refund failed after upstream error', {
        user: user.id,
        ref: refundRef,
        amount: estimatedCredits,
        err: String((refundErr as Error)?.message || refundErr)
      });
    }
    throw upstreamErr;
  }

  const reply = result.content;
  const usage = result.usage;

  const inputTokens = usage?.prompt_tokens ?? estimatedInputTokens;
  const outputTokens = usage?.completion_tokens ?? estimateTextTokens(reply || JSON.stringify(result.toolCalls));
  const dynamicFinal = billableNewApiTextCredits(catalogModel, inputTokens, outputTokens);
  const finalCredits = dynamicFinal ?? estimatedCredits;
  const cost = {
    base: finalCredits,
    final: finalCredits,
    discountLabel: null,
    modelLabel: resolvedCatalogModel.publicIdentity.modelLabel,
    inputTokens,
    outputTokens
  };

  // 结算差价（|delta| < 0.01 忽略，避免微额账目抖动）。
  const delta = Math.round((finalCredits - estimatedCredits) * 100) / 100;
  if (Math.abs(delta) >= 0.01) {
    try {
      if (delta > 0) {
        const settled = await deductUserCredits(
          admin,
          user.id,
          delta,
          'chat_generation',
          settleRef,
          { model: resolvedCatalogModel.requestedModelId, phase: 'settle_topup' }
        );
        debitedProfile = settled.profile;
      } else {
        await refundUserCredits(
          admin,
          user.id,
          -delta,
          'chat_generation_refund',
          settleRef,
          reserveSplit,
          { model: resolvedCatalogModel.requestedModelId, phase: 'settle_rebate' }
        );
      }
    } catch (settleErr) {
      // 差价结算失败不阻断回复：差额上限被 maxTokens 约束、预扣按最坏情况
      // 估算，风险有界；记录日志供对账。
      console.warn('[chat] settle delta failed', {
        user: user.id,
        ref: settleRef,
        delta,
        err: String((settleErr as Error)?.message || settleErr)
      });
    }
  }

  void mergeTaskFlags(admin, user.id, { asset_studio_chat_used: true }).catch((err) => {
    console.error('asset studio chat task flag merge failed', err);
  });

  return c.json({
    ok: true,
    data: {
      reply,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      creditsCharged: cost.final,
      creditsRemaining: spendableCredits(debitedProfile),
      cost: publicChatCostPayload(cost.final),
      model: resolvedCatalogModel.publicIdentity.model,
      modelLabel: resolvedCatalogModel.publicIdentity.modelLabel,
      thinking
    }
  });
});
