import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { submitChatCompletions, type ChatMessage } from '../../lib/chat-completions';
import { MIN_CREDIT_CHARGE, roundCredits } from '../../lib/credit-math';
import {
  computeChatCostFromTokens,
  estimateChatCost,
  resolveChatModel
} from '../../lib/chat-pricing';
import { ApiError } from '../../lib/errors';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  newApiKeyForRoute,
  newApiTextCreditsForUsage,
  resolveNewApiRoutedCatalogModel,
  type NewApiCatalogModel,
  type NewApiResolvedCatalogModel
} from '../../lib/newapi';
import {
  deductUserCredits,
  incrementLifetimeCreditsSpent,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile, isMembershipActive } from '../../lib/supabase';
import { mergeTaskFlags } from '../../lib/membership-tasks';
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
  noPreset: z.boolean().optional()
});

export const chatRoutes = new Hono<{ Bindings: Env }>();

function estimateTokens(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => {
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = message.role === 'assistant' && message.tool_calls?.length
      ? JSON.stringify(message.tool_calls)
      : '';
    return sum + estimateTokensFromText(`${content}${toolCalls}`);
  }, 0);
}

function legacyBillingMessages(messages: ChatMessage[]) {
  return messages.map(message => {
    const content = typeof message.content === 'string' ? message.content : '';
    if (message.role === 'tool') {
      return { role: 'user' as const, content: `[tool ${message.tool_call_id}] ${content}` };
    }
    const toolCalls = message.role === 'assistant' && message.tool_calls?.length
      ? JSON.stringify(message.tool_calls)
      : '';
    return { role: message.role, content: `${content}${toolCalls}` || '[empty message]' };
  });
}

function billableCredits(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(MIN_CREDIT_CHARGE, roundCredits(value));
}

async function freshTextModel(env: Env, modelId: string): Promise<NewApiResolvedCatalogModel> {
  let snapshot;
  try {
    snapshot = await fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL, { force: true, requireFresh: true });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认实时价格，请稍后重试');
  }
  const routes = await fetchNewApiAdminRoutes(env.NEWAPI_API_BASE_URL, env.NEWAPI_CATALOG_ADMIN_SECRET);
  const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, modelId, 'text');
  if (!resolved) throw new ApiError(400, 'MODEL_UNAVAILABLE', '所选文字模型或线路已不可用，请刷新后重选');
  return resolved;
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
  const user = c.get('user');
  const model = c.req.query('model') || 'creative-5-5';
  const thinking = c.req.query('thinking') === '1' || c.req.query('thinking') === 'true';
  const inputTokens = Math.max(0, Number(c.req.query('inputTokens') || 0));
  const outputTokens = Math.max(1, Math.min(8192, Number(c.req.query('outputTokens') || 2048)));

  const admin = createAdminClient(c.env);
  const profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);

  if (model !== 'deepseek-v4-flash') {
    const resolved = await freshTextModel(c.env, model);
    const catalogModel = resolved.model;
    const credits = billableCredits(newApiTextCreditsForUsage(
      catalogModel,
      inputTokens || estimateTokensFromText('示例消息'),
      outputTokens
    ));
    if (credits == null) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');
    return c.json({
      ok: true,
      data: {
        model: resolved.requestedModelId,
        modelLabel: catalogModel.label,
        thinking,
        base: credits,
        final: credits,
        discountLabel: null,
        note: catalogModel.pricing.mode === 'token' ? '按实际输入/输出 Token 结算' : '按次结算'
      }
    });
  }

  const cost =
    inputTokens > 0
      ? computeChatCostFromTokens(
          model,
          thinking,
          inputTokens,
          2048,
          profile.membership_tier,
          memberActive
        )
      : estimateChatCost(
          model,
          thinking,
          [{ role: 'user', content: '示例消息' }],
          profile.membership_tier,
          memberActive
        );

  return c.json({
    ok: true,
    data: {
      model: resolveChatModel(model).id,
      modelLabel: cost.modelLabel,
      thinking,
      base: cost.base,
      final: cost.final,
      discountLabel: cost.discountLabel,
      note: '按实际 token 用量计费，发送前为估算上限'
    }
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

  const modelId = parsed.data.model || 'creative-5-5';
  const isLegacyModel = modelId === 'deepseek-v4-flash';
  const resolvedCatalogModel = isLegacyModel ? null : await freshTextModel(c.env, modelId);
  const catalogModel = resolvedCatalogModel?.model || null;
  if (catalogModel) validateReasoningEffort(catalogModel, parsed.data.reasoningEffort);
  const rawApiKey = (catalogModel ? c.env.NEWAPI_API_KEY : c.env.CHAT_API_KEY)?.trim();
  const apiKey = rawApiKey && resolvedCatalogModel
    ? newApiKeyForRoute(rawApiKey, resolvedCatalogModel.route)
    : rawApiKey;
  const apiBase = catalogModel ? c.env.NEWAPI_API_BASE_URL : c.env.CHAT_API_BASE_URL;
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '对话服务暂未配置');

  const thinking = !!parsed.data.thinking;
  const memberActive = isMembershipActive(profile);
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
  const legacyEstimate = catalogModel
    ? null
    : estimateChatCost(
        modelId,
        thinking,
        legacyBillingMessages(messages),
        profile.membership_tier,
        memberActive,
        maxOutputTokens
      );
  const estimatedCredits = catalogModel
    ? billableCredits(newApiTextCreditsForUsage(catalogModel, estimatedInputTokens, maxOutputTokens))
    : legacyEstimate?.final ?? null;
  if (estimatedCredits == null) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认该模型实时价格');
  const balance = spendableCredits(profile);
  if (balance < estimatedCredits) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（预估需要 ${estimatedCredits}，当前 ${balance}）`
    );
  }

  const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const result = await submitChatCompletions(apiKey, apiBase, {
    model: catalogModel?.upstreamModel || modelId,
    messages,
    thinking: catalogModel ? false : thinking,
    reasoningEffort: parsed.data.reasoningEffort,
    temperature: parsed.data.temperature,
    maxTokens: maxOutputTokens,
    tools: parsed.data.tools,
    toolChoice: parsed.data.toolChoice
  });
  const reply = result.content;
  const usage = result.usage;

  const inputTokens = usage?.prompt_tokens ?? estimatedInputTokens;
  const outputTokens = usage?.completion_tokens ?? estimateTokensFromText(reply || JSON.stringify(result.toolCalls));
  const legacyCost = catalogModel
    ? null
    : computeChatCostFromTokens(
        modelId,
        thinking,
        inputTokens,
        outputTokens,
        profile.membership_tier,
        memberActive
      );
  const dynamicFinal = catalogModel
    ? billableCredits(newApiTextCreditsForUsage(catalogModel, inputTokens, outputTokens))
    : null;
  const cost = catalogModel
    ? {
        base: dynamicFinal ?? estimatedCredits,
        final: dynamicFinal ?? estimatedCredits,
        discountLabel: null,
        modelLabel: catalogModel.label,
        inputTokens,
        outputTokens
      }
    : legacyCost!;

  if (balance < cost.final) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（本次消耗 ${cost.final}，当前 ${balance}）`
    );
  }

  try {
    const debited = await deductUserCredits(
      admin,
      user.id,
      cost.final,
      'chat_generation',
      chatId,
      {
        model: resolvedCatalogModel?.requestedModelId || modelId,
        thinking,
        base: cost.base,
        discountLabel: cost.discountLabel,
        inputTokens,
        outputTokens
      }
    );
    profile = debited.profile;
    if (cost.final > 0) {
      await incrementLifetimeCreditsSpent(admin, user.id, cost.final);
      profile = await getOrCreateProfile(admin, user.id);
    }
  } catch (debitErr) {
    if (String((debitErr as Error).message).includes('insufficient')) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', '积分不足');
    }
    throw debitErr;
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
      creditsRemaining: spendableCredits(profile),
      cost: {
        base: cost.base,
        final: cost.final,
        discountLabel: cost.discountLabel,
        inputTokens,
        outputTokens
      },
      model: resolvedCatalogModel?.requestedModelId || modelId,
      modelLabel: cost.modelLabel,
      thinking
    }
  });
});

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 3));
}
