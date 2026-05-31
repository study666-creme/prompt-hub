import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { submitChatCompletions } from '../../lib/chat-completions';
import {
  computeChatCostFromTokens,
  estimateChatCost,
  estimateTokensFromText
} from '../../lib/chat-pricing';
import { ApiError } from '../../lib/errors';
import {
  deductUserCredits,
  incrementLifetimeCreditsSpent,
  spendableCredits,
  syncMembershipCredits
} from '../../lib/membership-credits';
import { createAdminClient, getOrCreateProfile, isMembershipActive } from '../../lib/supabase';
import { submitVisionChat } from '../../lib/vision-chat';
import { rateLimit } from '../../middleware/rate-limit';

const optimizeSchema = z.object({
  prompt: z.string().min(2).max(4000),
  target: z.enum(['general', 'sd', 'anime']).optional()
});

const reverseSchema = z.object({
  imageBase64: z.string().min(32).max(6_000_000).optional(),
  imageUrl: z.string().url().max(2048).optional()
});

const REVERSE_PROMPT_CREDITS = 5;

const OPTIMIZE_SYSTEM: Record<string, string> = {
  general:
    '你是 AI 绘图提示词专家。用户给出草稿提示词，请优化为更清晰、可出图的描述。保留用户意图，补充光线、构图、材质与风格词。输出仅一段优化后的提示词，中文为主，关键美术词可用英文，不要解释。',
  sd: '你是 Stable Diffusion / 全能绘图提示词专家。优化用户提示词：补充 quality tags（masterpiece, best quality 等）、镜头、光线、细节。输出仅一段英文为主的提示词，逗号分隔，不要解释。',
  anime:
    '你是二次元插画提示词专家。优化用户提示词：补充角色、画风、配色、构图与质量词。输出仅一段提示词，中英混合可，不要解释。'
};

const REVERSE_SYSTEM =
  '你是 AI 绘图提示词反推专家。根据图片内容，写一段可直接用于 AI 生图的详细提示词。描述主体、外观、服装、动作、背景、光线、镜头、风格与质量词。输出仅一段提示词，不要标题、不要分点、不要解释。';

export const promptToolsRoutes = new Hono<{ Bindings: Env }>();

promptToolsRoutes.post('/optimize', rateLimit(90, 60_000), async c => {
  const user = c.get('user');
  const parsed = optimizeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请填写有效的提示词');
  }

  const apiKey = c.env.CHAT_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '优化服务暂未配置（需 CHAT_API_KEY）');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const memberActive = isMembershipActive(profile);
  const modelId = 'deepseek-v4-flash';
  const target = parsed.data.target || 'general';
  const messages = [
    { role: 'system' as const, content: OPTIMIZE_SYSTEM[target] || OPTIMIZE_SYSTEM.general },
    { role: 'user' as const, content: parsed.data.prompt.trim() }
  ];

  const est = estimateChatCost(modelId, false, messages, profile.membership_tier, memberActive, 1024);
  const balance = spendableCredits(profile);
  if (balance < est.final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（预估 ${est.final}，当前 ${balance}）`);
  }

  const toolId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const result = await submitChatCompletions(apiKey, c.env.CHAT_API_BASE_URL, {
    model: modelId,
    messages,
    thinking: false
  });

  const inputTokens = result.usage?.prompt_tokens ?? est.inputTokens;
  const outputTokens = result.usage?.completion_tokens ?? estimateTokensFromText(result.content);
  const cost = computeChatCostFromTokens(
    modelId,
    false,
    inputTokens,
    outputTokens,
    profile.membership_tier,
    memberActive
  );

  if (balance < cost.final) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', `积分不足（本次 ${cost.final}，当前 ${balance}）`);
  }

  const debited = await deductUserCredits(admin, user.id, cost.final, 'prompt_optimize', toolId, {
    target,
    inputTokens,
    outputTokens
  });
  profile = debited.profile;
  if (cost.final > 0) {
    await incrementLifetimeCreditsSpent(admin, user.id, cost.final);
    profile = await getOrCreateProfile(admin, user.id);
  }

  return c.json({
    ok: true,
    data: {
      prompt: result.content,
      creditsCharged: cost.final,
      creditsRemaining: spendableCredits(profile)
    }
  });
});

promptToolsRoutes.post('/reverse', rateLimit(60, 60_000), async c => {
  const user = c.get('user');
  const parsed = reverseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.imageBase64 && !parsed.data.imageUrl)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请上传图片或提供图片地址');
  }

  const apiKey = c.env.IMAGE_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '反推服务暂未配置（需 IMAGE_API_KEY 视觉模型）');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const balance = spendableCredits(profile);
  if (balance < REVERSE_PROMPT_CREDITS) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（需要 ${REVERSE_PROMPT_CREDITS}，当前 ${balance}）`
    );
  }

  let imageUrl = parsed.data.imageUrl || '';
  if (parsed.data.imageBase64) {
    const raw = parsed.data.imageBase64.trim();
    imageUrl = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
  }

  const toolId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const prompt = await submitVisionChat(apiKey, c.env.IMAGE_API_BASE_URL, {
    system: REVERSE_SYSTEM,
    userText: '请反推这张图的 AI 生图提示词。',
    imageUrl
  });

  const debited = await deductUserCredits(
    admin,
    user.id,
    REVERSE_PROMPT_CREDITS,
    'prompt_reverse',
    toolId,
    { fixed: REVERSE_PROMPT_CREDITS }
  );
  profile = debited.profile;
  if (REVERSE_PROMPT_CREDITS > 0) {
    await incrementLifetimeCreditsSpent(admin, user.id, REVERSE_PROMPT_CREDITS);
    profile = await getOrCreateProfile(admin, user.id);
  }

  return c.json({
    ok: true,
    data: {
      prompt,
      creditsCharged: REVERSE_PROMPT_CREDITS,
      creditsRemaining: spendableCredits(profile)
    }
  });
});
