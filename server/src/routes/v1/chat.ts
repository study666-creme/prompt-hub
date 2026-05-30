import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { submitChatCompletions } from '../../lib/chat-completions';
import {
  computeChatCostFromTokens,
  estimateChatCost,
  resolveChatModel
} from '../../lib/chat-pricing';
import { ApiError } from '../../lib/errors';
import {
  deductUserCredits,
  incrementLifetimeCreditsSpent,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile, isMembershipActive } from '../../lib/supabase';
import { mergeTaskFlags } from '../../lib/membership-tasks';
import { rateLimit } from '../../middleware/rate-limit';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(12000)
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  context: z.string().max(16000).optional(),
  model: z.enum(['deepseek-v4-flash', 'deepseek-v4-pro']).optional(),
  attachContext: z.boolean().optional(),
  noPreset: z.boolean().optional()
});

export const chatRoutes = new Hono<{ Bindings: Env }>();

chatRoutes.get('/cost', async c => {
  const user = c.get('user');
  const model = c.req.query('model') || 'deepseek-v4-flash';
  const thinking = c.req.query('thinking') === '1' || c.req.query('thinking') === 'true';
  const inputTokens = Math.max(0, Number(c.req.query('inputTokens') || 0));

  const admin = createAdminClient(c.env);
  const profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);

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

  const apiKey = c.env.CHAT_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '对话服务暂未配置（请设置 CHAT_API_KEY）');
  }

  const modelId = parsed.data.model || 'deepseek-v4-flash';
  const thinking = !!parsed.data.thinking;
  const memberActive = isMembershipActive(profile);

  const messages = [...parsed.data.messages];
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

  const est = estimateChatCost(
    modelId,
    thinking,
    messages,
    profile.membership_tier,
    memberActive
  );
  const balance = spendableCredits(profile);
  if (balance < est.final) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（预估需要 ${est.final}，当前 ${balance}）`
    );
  }

  const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const result = await submitChatCompletions(apiKey, c.env.CHAT_API_BASE_URL, {
    model: modelId,
    messages,
    thinking
  });
  const reply = result.content;
  const usage = result.usage;

  const inputTokens = usage?.prompt_tokens ?? est.inputTokens;
  const outputTokens = usage?.completion_tokens ?? estimateTokensFromText(reply);
  const cost = computeChatCostFromTokens(
    modelId,
    thinking,
    inputTokens,
    outputTokens,
    profile.membership_tier,
    memberActive
  );

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
        model: modelId,
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
      creditsCharged: cost.final,
      creditsRemaining: spendableCredits(profile),
      cost: {
        base: cost.base,
        final: cost.final,
        discountLabel: cost.discountLabel,
        inputTokens,
        outputTokens
      },
      model: modelId,
      thinking
    }
  });
});

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 3));
}
