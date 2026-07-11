import type { SupabaseClient } from '@supabase/supabase-js';
import { isStorageRef, storagePathFromRef } from './image-archive';
import { submitVisionChat } from './vision-chat';

const BUCKET = 'card-images';

const PROMPT_BLOCK_PATTERNS: RegExp[] = [
  /儿童色情|幼女|萝莉控|恋童|未成年.{0,6}(裸|裸体|性交)/i,
  /强奸|轮奸|乱伦|兽交/i,
  /制毒|贩毒|吸毒|冰毒|海洛因|可卡因/i,
  /恐怖袭击|爆炸物制作|枪支改装教程/i,
  /纳粹|希特勒|法西斯宣传/i
];

const MODERATION_SYSTEM = `你是公开社区内容安全审核员，需符合中国大陆网络内容管理要求。
判断配图是否适合在公开社区展示。

必须拒绝：色情裸露、性器官特写、明显性暗示、未成年人色情或不当内容、极端暴力血腥、毒品、赌博、仇恨符号、恐怖主义、明显违法内容。
允许：正常插画、写真（非色情且衣着完整）、风景、产品、二次元角色（非色情）、艺术向内容。

只输出一行 JSON，不要 markdown：
{"safe":true}
或
{"safe":false,"reason":"不超过40字的中文原因"}`;

function extractJsonObject(raw: string): { safe?: boolean; reason?: string } | null {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as { safe?: boolean; reason?: string };
  } catch {
    return null;
  }
}

export function moderateCommunityPrompt(prompt: string): { safe: boolean; reason?: string } {
  const text = String(prompt || '').trim();
  if (!text) return { safe: false, reason: '提示词不能为空' };
  for (const re of PROMPT_BLOCK_PATTERNS) {
    if (re.test(text)) return { safe: false, reason: '提示词含违规或违法内容' };
  }
  return { safe: true };
}

/** 默认关闭 Gemini 配图审核；Worker 环境变量 COMMUNITY_GEMINI_MODERATION=1 可重新开启 */
export function isCommunityGeminiModerationEnabled(raw?: string): boolean {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function resolveImageUrlForModeration(
  admin: SupabaseClient,
  imageRef: string | null | undefined
): Promise<string | null> {
  const ref = String(imageRef || '').trim();
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.startsWith('data:image/')) return ref;
  if (isStorageRef(ref)) {
    const path = storagePathFromRef(ref)?.replace(/^\//, '');
    if (!path) return null;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }
  return null;
}

export async function moderateCommunityContent(params: {
  admin: SupabaseClient;
  prompt: string;
  imageRef?: string | null;
  /** Apimart/Chat 视觉密钥。 */
  visionApiKey?: string;
  visionApiBaseUrl?: string;
  /** 未配置 Apimart 时仅做文本审核，不调 Gemini。 */
  skipVision?: boolean;
}): Promise<{ safe: boolean; reason?: string }> {
  const promptResult = moderateCommunityPrompt(params.prompt);
  if (!promptResult.safe) return promptResult;

  const imageRef = params.imageRef;
  if (!imageRef || !String(imageRef).trim()) {
    return { safe: false, reason: '发布到社区需要配图' };
  }

  if (params.skipVision) {
    return { safe: true };
  }

  const apiKey = params.visionApiKey?.trim();
  if (!apiKey) {
    return { safe: true };
  }

  const imageUrl = await resolveImageUrlForModeration(params.admin, imageRef);
  if (!imageUrl) {
    return { safe: false, reason: '配图无法审核，请重新上传后再发布' };
  }

  try {
    const raw = await submitVisionChat(apiKey, params.visionApiBaseUrl, {
      system: MODERATION_SYSTEM,
      userText: '请审核这张即将发布到公开社区的作品配图。',
      imageUrl,
      maxTokens: 180,
      imageDetail: 'low'
    });
    const parsed = extractJsonObject(raw);
    if (parsed && parsed.safe === true) return { safe: true };
    if (parsed && parsed.safe === false) {
      return {
        safe: false,
        reason: String(parsed.reason || '配图不符合社区规范').slice(0, 80)
      };
    }
    const lower = raw.toLowerCase();
    if (/["']safe["']\s*:\s*false/.test(lower) || /unsafe|违规|色情|裸露/.test(raw)) {
      return { safe: false, reason: '配图不符合社区规范' };
    }
    return { safe: true };
  } catch (e) {
    console.warn('[community-moderation] vision failed', e);
    return { safe: false, reason: '图片审核服务暂不可用，请稍后再试' };
  }
}
