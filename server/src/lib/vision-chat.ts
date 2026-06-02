import { ApiError } from './errors';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

function isGrsaiLikeBase(baseUrl?: string): boolean {
  return /grsai\.|dakka\.com\.cn/i.test(String(baseUrl || ''));
}

/** Gemini 视觉应走 Apimart/Chat，勿用 GrsAI 生图线路（会误打 gemini 且常失败） */
export function resolveVisionApiBindings(env: {
  APIMART_API_KEY?: string;
  APIMART_API_BASE_URL?: string;
  CHAT_API_KEY?: string;
  CHAT_API_BASE_URL?: string;
  IMAGE_API_KEY?: string;
  IMAGE_API_BASE_URL?: string;
}): { apiKey: string; baseUrl?: string; provider: 'apimart' | 'chat' | 'image' } {
  if (env.APIMART_API_KEY) {
    if (isGrsaiLikeBase(env.APIMART_API_BASE_URL)) {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'APIMART_API_BASE_URL 误填为 GrsAI 地址，会把 Gemini 反推/社区审核打到 GrsAI 生图账户。请改为 https://api.apimart.ai'
      );
    }
    return {
      apiKey: env.APIMART_API_KEY,
      baseUrl: env.APIMART_API_BASE_URL,
      provider: 'apimart'
    };
  }
  const chatBase = String(env.CHAT_API_BASE_URL || '').toLowerCase();
  if (env.CHAT_API_KEY && !/grsai\.|dakka\.com\.cn/.test(chatBase)) {
    return {
      apiKey: env.CHAT_API_KEY,
      baseUrl: env.CHAT_API_BASE_URL,
      provider: 'chat'
    };
  }
  const imageBase = String(env.IMAGE_API_BASE_URL || '').toLowerCase();
  if (env.IMAGE_API_KEY && !/grsai\.|dakka\.com\.cn/.test(imageBase)) {
    return {
      apiKey: env.IMAGE_API_KEY,
      baseUrl: env.IMAGE_API_BASE_URL,
      provider: 'image'
    };
  }
  throw new ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    '视觉读图服务未配置：请在 Worker 设置 APIMART_API_KEY（Gemini 反推/裂变用，与生图 GrsAI 密钥分离）'
  );
}

type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

type ContentPart = { type?: string; text?: string };

function extractTextContent(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as ContentPart;
          if (p.text) return String(p.text);
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) throw new ApiError(400, 'VALIDATION_ERROR', '图片格式无效，请换 JPG/PNG 重试');
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { bytes, mime, ext };
}

/** Apimart 建议先上传拿 URL，生图/多模态均不建议直传 base64 */
async function uploadApimartImage(
  apiKey: string,
  baseUrl: string | undefined,
  dataUrl: string
): Promise<string> {
  const { bytes, mime, ext } = parseDataUrl(dataUrl);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `reverse.${ext}`);

  const res = await fetch(`${apiBase(baseUrl)}/v1/uploads/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      err?.error?.message || `图片上传失败 (${res.status})`
    );
  }

  const url = json && typeof json === 'object' ? (json as { url?: string }).url : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '图片上传成功但未返回可用 URL');
  }
  return url;
}

async function ensureVisionImageUrl(
  apiKey: string,
  baseUrl: string | undefined,
  imageUrl: string
): Promise<string> {
  const trimmed = imageUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:')) {
    return uploadApimartImage(apiKey, baseUrl, trimmed);
  }
  throw new ApiError(400, 'VALIDATION_ERROR', '请提供有效的图片');
}

export async function submitVisionChat(
  apiKey: string,
  baseUrl: string | undefined,
  params: {
    system: string;
    userText: string;
    imageUrl: string;
    model?: string;
    maxTokens?: number;
    /** low=反推省成本；high=裂变等需读排版/边框/卡面细节 */
    imageDetail?: 'low' | 'high' | 'auto';
  }
): Promise<string> {
  if (isGrsaiLikeBase(baseUrl)) {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      '视觉服务不可走 GrsAI 生图线路（会误扣 GrsAI 账户 gemini 积分）。请配置 APIMART_API_BASE_URL=https://api.apimart.ai'
    );
  }

  const remoteImageUrl = await ensureVisionImageUrl(apiKey, baseUrl, params.imageUrl);
  const detail = params.imageDetail || 'low';

  const userContent: VisionContentPart[] = [
    { type: 'text', text: params.userText },
    { type: 'image_url', image_url: { url: remoteImageUrl, detail } }
  ];

  const model = params.model || 'gemini-2.5-flash-lite';
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: userContent }
    ],
    temperature: 0.4,
    max_tokens: params.maxTokens ?? 2048,
    stream: false
  };

  const res = await fetch(`${apiBase(baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const rawText = await res.text();
  let json: unknown = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    if (!res.ok) {
      throw new ApiError(502, 'UPSTREAM_ERROR', `视觉理解接口失败 (${res.status})`);
    }
    throw new ApiError(502, 'UPSTREAM_ERROR', '视觉接口返回格式异常，请稍后再试');
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      err?.error?.message || `视觉理解接口失败 (${res.status})`
    );
  }

  const payload = json as {
    choices?: Array<{
      message?: { content?: unknown; refusal?: string };
      finish_reason?: string;
    }>;
  };
  const choice = payload.choices?.[0];
  const content = extractTextContent(choice?.message?.content);
  if (content) return content;

  const refusal = choice?.message?.refusal?.trim();
  if (refusal) {
    throw new ApiError(502, 'UPSTREAM_ERROR', `视觉模型拒绝：${refusal.slice(0, 120)}`);
  }

  const reason = choice?.finish_reason || 'unknown';
  throw new ApiError(
    502,
    'UPSTREAM_ERROR',
    reason === 'length'
      ? '视觉接口输出被截断，请换一张较小的图片重试'
      : '视觉接口未返回内容，请换图或稍后再试'
  );
}
