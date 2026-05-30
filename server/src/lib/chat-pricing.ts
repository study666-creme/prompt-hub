import type { Profile } from './supabase';
import { MIN_GENERATION_CHARGE } from './pricing';

export const CHAT_MODELS = {
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    tier: 'flash' as const
  },
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    tier: 'pro' as const
  }
} as const;

export type ChatModelId = keyof typeof CHAT_MODELS;

/** 积分 / 百万 token（图三定价） */
const TOKEN_RATES = {
  flash: { input: 130, output: 260, outputThinking: 300 },
  pro: { input: 1560, output: 3120, outputThinking: 3600 }
} as const;

export function resolveChatModel(model?: string): (typeof CHAT_MODELS)[ChatModelId] {
  if (model && model in CHAT_MODELS) {
    return CHAT_MODELS[model as ChatModelId];
  }
  return CHAT_MODELS['deepseek-v4-flash'];
}

/** 方案 A：9折全部 · 8折仅 Flash · 7折仅 Flash 思考模式 */
export function chatDiscountMultiplier(
  tier: Profile['membership_tier'],
  memberActive: boolean,
  modelTier: 'flash' | 'pro',
  thinking: boolean
): { mult: number; discountLabel: string | null } {
  if (!memberActive || !tier || tier === 'lite') {
    return { mult: 1, discountLabel: null };
  }
  if (tier === 'basic') {
    return { mult: 0.9, discountLabel: '9折' };
  }
  if (tier === 'standard') {
    if (modelTier === 'flash') return { mult: 0.8, discountLabel: '8折' };
    return { mult: 1, discountLabel: null };
  }
  if (tier === 'pro') {
    if (modelTier === 'flash' && thinking) return { mult: 0.7, discountLabel: '7折' };
    if (modelTier === 'flash') return { mult: 0.8, discountLabel: '8折' };
    return { mult: 1, discountLabel: null };
  }
  return { mult: 1, discountLabel: null };
}

export function estimateTokensFromText(text: string): number {
  const len = String(text || '').length;
  return Math.max(1, Math.ceil(len / 3));
}

export function estimateTokensFromMessages(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((sum, m) => sum + estimateTokensFromText(m.content), 0);
}

export function computeChatCostFromTokens(
  modelId: string,
  thinking: boolean,
  inputTokens: number,
  outputTokens: number,
  tier: Profile['membership_tier'],
  memberActive: boolean
): {
  base: number;
  final: number;
  discountLabel: string | null;
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
} {
  const model = resolveChatModel(modelId);
  const rates = TOKEN_RATES[model.tier];
  const outputRate = thinking ? rates.outputThinking : rates.output;
  const baseRaw =
    (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * outputRate;
  const base = Math.max(MIN_GENERATION_CHARGE, Math.ceil(baseRaw));
  const { mult, discountLabel } = chatDiscountMultiplier(
    tier,
    memberActive,
    model.tier,
    thinking
  );
  const final =
    mult < 1 ? Math.max(MIN_GENERATION_CHARGE, Math.floor(base * mult)) : base;
  return {
    base,
    final,
    discountLabel,
    modelLabel: model.label,
    inputTokens,
    outputTokens
  };
}

export function estimateChatCost(
  modelId: string,
  thinking: boolean,
  messages: Array<{ role: string; content: string }>,
  tier: Profile['membership_tier'],
  memberActive: boolean,
  maxOutputTokens = 2048
): ReturnType<typeof computeChatCostFromTokens> {
  const inputTokens = estimateTokensFromMessages(messages);
  return computeChatCostFromTokens(
    modelId,
    thinking,
    inputTokens,
    maxOutputTokens,
    tier,
    memberActive
  );
}
