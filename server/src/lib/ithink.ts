import { ApiError } from './errors';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

/** ThinkAI 慢速线仅 1K；常用比例像素尺寸（官方文档） */
const SIZE_MAP_1K: Record<string, string> = {
  auto: '1024x1024',
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1120x896',
  '4:5': '896x1120',
  '21:9': '1456x624',
  '9:21': '624x1456'
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://token.ithinkai.cn').replace(/\/$/, '');
}

function mapIthinkPixelSize(sizeLabel?: string): string {
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  return SIZE_MAP_1K[ratio] || SIZE_MAP_1K['1:1'];
}

/** 经济慢速线强制 low，避免 high 需 3–5 分钟导致 Worker 子请求超时 */
function mapIthinkQuality(_quality: string): string {
  return 'low';
}

function pickImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = p.data;
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === 'object') {
        const url = (row as Record<string, unknown>).url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
        const b64 = (row as Record<string, unknown>).b64_json;
        if (typeof b64 === 'string' && b64.length > 40) {
          return `data:image/png;base64,${b64}`;
        }
      }
    }
  }
  return null;
}

function extractUpstreamError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const p = payload as Record<string, unknown>;
  const err = p.error;
  if (err && typeof err === 'object') {
    const msg = String((err as Record<string, unknown>).message || '').trim();
    if (msg) return msg;
    const code = String((err as Record<string, unknown>).code || '').trim();
    if (code) return code;
  }
  return String(p.message || p.msg || fallback).slice(0, 400);
}

export type IthinkSubmitResult = {
  taskId: string;
  imageUrl: string | null;
};

/** ThinkAI / iThinkAPI：OpenAI 兼容 POST /v1/images/generations（同步返回 URL） */
export async function submitIthinkImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<IthinkSubmitResult> {
  const model = params.upstreamModel.trim() || 'gpt-image-2';
  const body: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    size: mapIthinkPixelSize(params.size),
    quality: mapIthinkQuality(params.quality),
    response_format: 'url',
    n: 1
  };
  const refs = params.refImageUrls?.filter((u) => /^https?:\/\//i.test(u));
  if (refs?.length) {
    body.image = refs.slice(0, 8);
  }

  const url = `${apiBase(baseUrl)}/v1/images/generations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = extractUpstreamError(json, text || `HTTP ${res.status}`);
    const hint = /model|不存在|not found|invalid/i.test(msg)
      ? `（模型「${model}」可能不对，请在 ThinkAI 模型广场核对 ID，或设置 ITHINK_UPSTREAM_MODEL）`
      : '';
    throw new ApiError(502, 'UPSTREAM_FAILED', `${msg}${hint}`.slice(0, 480));
  }

  const imageUrl = pickImageUrl(json);
  const taskId = `ithink-${crypto.randomUUID()}`;
  return { taskId, imageUrl };
}
