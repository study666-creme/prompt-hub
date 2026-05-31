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
  target: z.enum(['general', 'sd', 'anime', 'jimeng', 'guofeng', 'realistic', 'glamour']).optional()
});

const reverseSchema = z.object({
  imageBase64: z.string().min(32).max(6_000_000).optional(),
  imageUrl: z.string().url().max(2048).optional()
});

const fissionSchema = z.object({
  imageBase64: z.string().min(32).max(6_000_000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  count: z.number().int().min(3).max(6).optional(),
  /** 客户端传入的画风锁定句（来自 ART_STYLES.tag） */
  styleTag: z.string().max(300).optional()
});

const REVERSE_PROMPT_CREDITS = 2;
/** 净化读图：忠实描述 + 固定净化后缀，供参考图重绘 */
const PURIFY_DESCRIBE_CREDITS = 2;
/** 裂变视觉：Gemini Flash 高清读图（比反推 lite 贵，但更能识别卡面/边框/版式） */
const FISSION_VISION_CREDITS = 3;
const DEFAULT_FISSION_VISION_MODEL = 'gemini-2.5-flash';
const FISSION_VISION_FALLBACK = 'gemini-2.5-flash-lite';
/** 裂变策划：DeepSeek V4 Pro（比 Flash 更懂创意发散与 JSON 结构） */
const FISSION_CHAT_PRICING_MODEL = 'deepseek-v4-pro';
const DEFAULT_FISSION_CHAT_MODEL = 'deepseek-v4-pro';
/** 反推视觉模型：Apimart gemini-2.5-flash-lite（低成本，不用 gpt-4o 兜底以免亏本） */
const DEFAULT_REVERSE_VISION_MODEL = 'gemini-2.5-flash-lite';
const REVERSE_VISION_FALLBACK = 'gemini-2.5-flash';
/** 优化走 DeepSeek 官方 CHAT_MODEL（wrangler 默认 deepseek-chat） */
const OPTIMIZE_PRICING_MODEL = 'deepseek-v4-flash';

const OPTIMIZE_SYSTEM: Record<string, string> = {
  general:
    '你是 AI 绘图提示词专家。用户给出草稿提示词，请优化为更清晰、可出图的描述。保留用户意图，补充光线、构图、材质与风格词。输出仅一段优化后的中文提示词；除非原意或出图效果确实需要，否则不要写英文，不要解释。',
  sd:
    '你是 Stable Diffusion / 全能绘图提示词专家。优化用户提示词：补充画质、镜头、光线、构图与细节描述。输出仅一段中文提示词；除非用户原文或特定 SD 效果确实需要英文 tag，否则不要堆砌 masterpiece/best quality 等英文，不要解释。',
  anime:
    '你是二次元插画提示词专家。优化用户提示词：补充角色、画风、配色、构图与质量描述。输出仅一段中文提示词，不要解释。',
  jimeng:
    '你是即梦 / 抖音 / 小红书爆款生图提示词专家。优化用户提示词：补充画质词（4K/8K/超高清/电影质感）、主体细节、竖屏 9:16 构图（人物占 60% 左右）、强情绪与吸睛元素、色调氛围、镜头与光线。适合封面级出图。输出仅一段中文提示词，不要解释。',
  guofeng:
    '你是国风 / 仙侠 / 汉服生图提示词专家。优化用户提示词：补充朝代感服饰、发饰、场景（园林/山水/宫殿）、丁达尔光/柔雾/飘带动态、水墨或工笔质感、仙气氛围与质量词。输出仅一段中文提示词，不要解释。',
  realistic:
    '你是写实摄影 / 写真提示词专家。优化用户提示词：补充镜头焦段感（如 85mm/35mm）、光线（伦勃朗/自然光/胶片）、肤质与材质真实感、景深、构图与 4K 画质描述。输出仅一段中文提示词，不要解释。',
  glamour:
    '你是高级时尚性感人像提示词专家。优化用户提示词：强调女性身体线条、肤质与氛围张力，姿态要有呼吸感与吸引力，但人物必须穿着完整（泳装/礼服/连体衣/运动装/时尚外搭等），禁止裸露私密部位、禁止色情与性暗示描写。补充 S 曲线构图、锁骨肩线腰臀比例、轮廓光与肤光、浅景深、电影级调色。风格参考高级时尚杂志/泳装画报，适合社区公开发布。输出仅一段中文提示词，不要解释。'
};

const REVERSE_SYSTEM =
  '你是 AI 绘图提示词反推专家。根据图片内容，写一段可直接用于 AI 生图的详细提示词。描述主体、外观、服装、动作、背景、光线、镜头、风格与质量词。输出仅一段提示词，不要标题、不要分点、不要解释。';

const PURIFY_VISION_SYSTEM =
  '你是 AI 生图「画质净化/忠实重绘」专家。根据图片写一段生图提示词，必须完整、准确地描述现有画面内容（主体、外观、服装、姿态、背景、构图、色调、风格、光线），以便重绘时保持内容不变。只描述图中已有内容，不要添加新元素。输出仅一段提示词，不要解释。';

/** 追加在视觉描述后，约束模型只做净化不重绘 */
const PURIFY_PROMPT_SUFFIX =
  '忠实重绘同一张图，仅做画质净化：去除 AI 噪点、脏污颗粒、糊成一团、JPEG 伪影与过度平滑，边缘更干净、渐变更顺滑、细节更清晰；禁止改变主体、构图、姿态、配色与风格，禁止新增或删除元素。masterpiece, best quality, image restoration, denoise, deartifact';

const PURIFY_GENERIC_PROMPT =
  'exact same image content and composition as reference, faithful redraw, image cleanup and denoising, remove AI generation noise grain smudges dirty artifacts and compression blocks, cleaner edges smoother gradients sharper details, no new elements no content change, masterpiece, best quality';

const FISSION_VISION_SYSTEM =
  '你是生图美学分析师。请客观提取这张图最突出的「美学 DNA」——观者第一眼会记住的风格特征，而非具体人物身份。\n' +
  '必须涵盖：①呈现媒介/版式（如实识别图中实际存在的形式：卡牌、海报、电影剧照、概念设定、场景巨构、建筑、产品摄影、UI 界面、插画页等——有什么写什么，没有就不写）；' +
  '②气质情绪与题材类型；③主色与点缀色、光线类型；④构图与景别、主体占比；⑤画风与渲染质感。\n' +
  '禁止：具体五官、可识别角色/IP 名、品牌文字、独有姿势细节。输出 80～220 字中文。';

const FISSION_CHAT_SYSTEM =
  '你是 AI 生图「裂变」策划。根据「美学 DNA」，生成若干条全新生图提示词。\n' +
  '规则：\n' +
  '1) 每条必须继承 DNA 的核心美学（媒介/版式、色调、气质、质感——DNA 里有什么就保留什么，不要擅自改成别的风格）；\n' +
  '2) 主体、场景、姿态、配色细节、镜头与次要元素在条与条之间明显不同；若 DNA 主体是人像/角色，每条换不同 archetype，禁止复刻同一张脸/发型/服装组合；\n' +
  '3) 每条完整可独立生图，中文为主，关键美术词可用英文，含光线与质量词。\n' +
  '输出必须是纯 JSON 数组字符串，例如 ["提示词1","提示词2"]，不要 markdown、不要解释。';

function parseJsonPromptArray(raw: string, expected: number): string[] {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start >= 0 && end > start) {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } else {
      throw new ApiError(502, 'UPSTREAM_ERROR', '裂变提示词解析失败，请重试');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '裂变提示词格式异常');
  }
  const prompts = parsed
    .map((p) => String(p || '').trim())
    .filter((p) => p.length >= 8);
  if (prompts.length < Math.min(2, expected)) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '裂变提示词数量不足，请换图重试');
  }
  return prompts.slice(0, expected);
}

export const promptToolsRoutes = new Hono<{ Bindings: Env }>();

promptToolsRoutes.get('/info', async c => {
  const reverseModel = c.env.REVERSE_VISION_MODEL || DEFAULT_REVERSE_VISION_MODEL;
  const chatModel = c.env.CHAT_MODEL || 'deepseek-chat';
  return c.json({
    ok: true,
    data: {
      reverse: {
        model: reverseModel,
        upstream: 'IMAGE_API_KEY → Apimart /v1/chat/completions（vision）',
        creditsPerCall: REVERSE_PROMPT_CREDITS,
        note: 'Apimart gemini-2.5-flash-lite 低成本视觉；收 2 积分/次（仅 Gemini 系列，不 fallback 到 GPT-4o）'
      },
      optimize: {
        model: chatModel,
        pricingModel: OPTIMIZE_PRICING_MODEL,
        upstream: 'CHAT_API_KEY → DeepSeek /v1/chat/completions',
        creditsPerCall: '按 token，通常 1～2 积分',
        note: 'DeepSeek 官方价见文档；最低 1 积分/次'
      },
      fission: {
        visionModel: c.env.FISSION_VISION_MODEL || DEFAULT_FISSION_VISION_MODEL,
        chatModel: c.env.FISSION_CHAT_MODEL || DEFAULT_FISSION_CHAT_MODEL,
        creditsVision: FISSION_VISION_CREDITS,
        creditsPerPlanEstimate: FISSION_VISION_CREDITS + 2,
        upstream: 'IMAGE_API（Gemini Flash 视觉）+ CHAT_API（DeepSeek V4 Pro）',
        note: '视觉 3 积分 + Pro 对话按 token（通常 1～3 积分）；自动识别图中最突出的媒介/版式，批量生图仅按提示词出图'
      },
      purify: {
        creditsPerDescribe: PURIFY_DESCRIBE_CREDITS,
        creditsPerImageEstimate: PURIFY_DESCRIBE_CREDITS + 7,
        note: '读图 2 积分/张 + 参考图重绘（与普通生图同价）；保持内容仅净化画质'
      }
    }
  });
});

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
  const modelId = OPTIMIZE_PRICING_MODEL;
  const upstreamModel = c.env.CHAT_MODEL || 'deepseek-chat';
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
    model: upstreamModel,
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
      creditsRemaining: spendableCredits(profile),
      model: upstreamModel,
      modelLabel: cost.modelLabel,
      upstream: 'CHAT_API'
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

  const reverseModel = c.env.REVERSE_VISION_MODEL || DEFAULT_REVERSE_VISION_MODEL;
  const toolId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const visionParams = {
    system: REVERSE_SYSTEM,
    userText: '请反推这张图的 AI 生图提示词。',
    imageUrl
  };
  let prompt = '';
  const fallbacks = [reverseModel, REVERSE_VISION_FALLBACK].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr: unknown = null;
  for (const model of fallbacks) {
    try {
      prompt = await submitVisionChat(apiKey, c.env.IMAGE_API_BASE_URL, { ...visionParams, model });
      break;
    } catch (e) {
      lastErr = e;
      if (model === fallbacks[fallbacks.length - 1]) throw e;
    }
  }
  if (!prompt) throw lastErr;

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
      creditsRemaining: spendableCredits(profile),
      model: reverseModel,
      modelLabel: 'Gemini 2.5 Flash Lite Vision',
      upstream: 'IMAGE_API'
    }
  });
});

promptToolsRoutes.post('/purify-describe', rateLimit(60, 60_000), async c => {
  const user = c.get('user');
  const parsed = reverseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.imageBase64 && !parsed.data.imageUrl)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请上传图片或提供图片地址');
  }

  const apiKey = c.env.IMAGE_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '净化服务暂未配置（需 IMAGE_API_KEY 视觉模型）');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);
  const balance = spendableCredits(profile);
  if (balance < PURIFY_DESCRIBE_CREDITS) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（净化读图需要 ${PURIFY_DESCRIBE_CREDITS}，当前 ${balance}）`
    );
  }

  let imageUrl = parsed.data.imageUrl || '';
  if (parsed.data.imageBase64) {
    const raw = parsed.data.imageBase64.trim();
    imageUrl = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
  }

  const reverseModel = c.env.REVERSE_VISION_MODEL || DEFAULT_REVERSE_VISION_MODEL;
  const toolId = `pur_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const visionParams = {
    system: PURIFY_VISION_SYSTEM,
    userText: '请描述这张图的现有内容，用于忠实重绘净化。',
    imageUrl
  };
  let contentDesc = '';
  const fallbacks = [reverseModel, REVERSE_VISION_FALLBACK].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr: unknown = null;
  for (const model of fallbacks) {
    try {
      contentDesc = await submitVisionChat(apiKey, c.env.IMAGE_API_BASE_URL, { ...visionParams, model });
      break;
    } catch (e) {
      lastErr = e;
      if (model === fallbacks[fallbacks.length - 1]) throw e;
    }
  }
  if (!contentDesc) throw lastErr;

  const prompt = `${contentDesc.trim()}；${PURIFY_PROMPT_SUFFIX}`;

  const debited = await deductUserCredits(
    admin,
    user.id,
    PURIFY_DESCRIBE_CREDITS,
    'prompt_purify_describe',
    toolId,
    { fixed: PURIFY_DESCRIBE_CREDITS }
  );
  profile = debited.profile;
  if (PURIFY_DESCRIBE_CREDITS > 0) {
    await incrementLifetimeCreditsSpent(admin, user.id, PURIFY_DESCRIBE_CREDITS);
    profile = await getOrCreateProfile(admin, user.id);
  }

  return c.json({
    ok: true,
    data: {
      prompt,
      contentDescription: contentDesc.trim(),
      creditsCharged: PURIFY_DESCRIBE_CREDITS,
      creditsRemaining: spendableCredits(profile),
      model: reverseModel,
      modelLabel: 'Gemini 2.5 Flash Lite Vision',
      upstream: 'IMAGE_API'
    }
  });
});

promptToolsRoutes.post('/fission', rateLimit(40, 60_000), async c => {
  const user = c.get('user');
  const parsed = fissionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.imageBase64 && !parsed.data.imageUrl)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请上传图片或提供图片地址');
  }

  const imageApiKey = c.env.IMAGE_API_KEY;
  const chatApiKey = c.env.CHAT_API_KEY;
  if (!imageApiKey || !chatApiKey) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '裂变服务暂未配置（需 IMAGE_API_KEY + CHAT_API_KEY）');
  }

  const admin = createAdminClient(c.env);
  let profile = await syncMembershipCredits(admin, user.id);

  const count = parsed.data.count ?? 4;
  let imageUrl = parsed.data.imageUrl || '';
  if (parsed.data.imageBase64) {
    const raw = parsed.data.imageBase64.trim();
    imageUrl = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
  }

  const memberActive = isMembershipActive(profile);
  const fissionVisionModel = c.env.FISSION_VISION_MODEL || DEFAULT_FISSION_VISION_MODEL;
  const fissionChatModel = c.env.FISSION_CHAT_MODEL || DEFAULT_FISSION_CHAT_MODEL;
  const chatMessages = [
    { role: 'system' as const, content: FISSION_CHAT_SYSTEM },
    {
      role: 'user' as const,
      content: `美学 DNA：（分析完成后填入）\n\n请生成恰好 ${count} 条裂变变体提示词，JSON 数组输出。`
    }
  ];
  const estChat = estimateChatCost(
    FISSION_CHAT_PRICING_MODEL,
    false,
    chatMessages,
    profile.membership_tier,
    memberActive,
    2800
  );
  const estTotal = FISSION_VISION_CREDITS + estChat.final;
  const balance = spendableCredits(profile);
  if (balance < estTotal) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（裂变方案预估 ${estTotal}，当前 ${balance}）`
    );
  }

  const toolId = `fis_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let dna = '';
  const visionFallbacks = [fissionVisionModel, FISSION_VISION_FALLBACK].filter(
    (m, i, a) => a.indexOf(m) === i
  );
  let lastErr: unknown = null;
  for (const model of visionFallbacks) {
    try {
      dna = await submitVisionChat(imageApiKey, c.env.IMAGE_API_BASE_URL, {
        system: FISSION_VISION_SYSTEM,
        userText: '请提取这张图的美学 DNA，如实识别其最主要的呈现形式与风格特征。',
        imageUrl,
        model,
        imageDetail: 'high',
        maxTokens: 1024
      });
      break;
    } catch (e) {
      lastErr = e;
      if (model === visionFallbacks[visionFallbacks.length - 1]) throw e;
    }
  }
  if (!dna) throw lastErr;

  const styleTag = parsed.data.styleTag?.trim() || '';
  const styleNote = styleTag
    ? `\n\n画风锁定（每条变体必须在句首或句中明确体现，若与 DNA 冲突以画风为准）：${styleTag}`
    : '';

  chatMessages[1] = {
    role: 'user',
    content: `美学 DNA：\n${dna}\n\n请生成恰好 ${count} 条裂变变体提示词，JSON 数组输出。${styleNote}`
  };
  const chatResult = await submitChatCompletions(chatApiKey, c.env.CHAT_API_BASE_URL, {
    model: fissionChatModel,
    messages: chatMessages,
    thinking: false
  });
  const prompts = parseJsonPromptArray(chatResult.content, count);

  const inputTokens =
    chatResult.usage?.prompt_tokens ?? estimateTokensFromText(chatMessages.map(m => m.content).join('\n'));
  const outputTokens =
    chatResult.usage?.completion_tokens ?? estimateTokensFromText(chatResult.content);
  const chatCost = computeChatCostFromTokens(
    FISSION_CHAT_PRICING_MODEL,
    false,
    inputTokens,
    outputTokens,
    profile.membership_tier,
    memberActive
  );
  const creditsCharged = FISSION_VISION_CREDITS + chatCost.final;
  if (balance < creditsCharged) {
    throw new ApiError(
      402,
      'INSUFFICIENT_CREDITS',
      `积分不足（本次 ${creditsCharged}，当前 ${balance}）`
    );
  }

  const debited = await deductUserCredits(
    admin,
    user.id,
    creditsCharged,
    'prompt_fission',
    toolId,
    {
      vision: FISSION_VISION_CREDITS,
      chat: chatCost.final,
      count: prompts.length,
      visionModel: fissionVisionModel,
      chatModel: fissionChatModel
    }
  );
  profile = debited.profile;
  if (creditsCharged > 0) {
    await incrementLifetimeCreditsSpent(admin, user.id, creditsCharged);
    profile = await getOrCreateProfile(admin, user.id);
  }

  return c.json({
    ok: true,
    data: {
      dna,
      prompts,
      creditsCharged,
      creditsVision: FISSION_VISION_CREDITS,
      creditsChat: chatCost.final,
      creditsRemaining: spendableCredits(profile),
      visionModel: fissionVisionModel,
      visionModelLabel: 'Gemini 2.5 Flash Vision',
      chatModel: fissionChatModel,
      chatModelLabel: chatCost.modelLabel,
      upstream: 'IMAGE_API + CHAT_API'
    }
  });
});
