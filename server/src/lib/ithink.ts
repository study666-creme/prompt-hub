import { ApiError } from './errors';
import { mapQualityForGptImage } from './pricing';

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

const SIZE_MAP: Record<string, Record<string, string>> = {
  '1k': {
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
  },
  '2k': {
    auto: '2048x2048',
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
    '5:4': '2240x1792',
    '4:5': '1792x2240',
    '21:9': '2912x1248',
    '9:21': '1248x2912'
  },
  '4k': {
    auto: '2048x2048',
    '1:1': '2048x2048',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3264x2448',
    '3:4': '2448x3264',
    '3:2': '3504x2336',
    '2:3': '2336x3504',
    '5:4': '3200x2560',
    '4:5': '2560x3200',
    '21:9': '3840x1648',
    '9:21': '1648x3840'
  }
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://token.ithinkai.cn').replace(/\/$/, '');
}

function mapIthinkPixelSize(resolution: string, sizeLabel?: string): string {
  const res = ['1k', '2k', '4k'].includes(resolution) ? resolution : '1k';
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  return SIZE_MAP[res]?.[ratio] || SIZE_MAP[res]?.['1:1'] || '1024x1024';
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
  const body: Record<string, unknown> = {
    model: params.upstreamModel.trim(),
    prompt: params.prompt,
    size: mapIthinkPixelSize(params.resolution, params.size),
    quality: mapQualityForGptImage(params.quality),
    response_format: 'url'
  };
  const refs = params.refImageUrls?.filter((u) => /^https?:\/\//i.test(u));
  if (refs?.length) {
    body.image = refs.slice(0, 8);
  }

  const res = await fetch(`${apiBase(baseUrl)}/v1/images/generations`, {
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
    const errObj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    const msg =
      (errObj?.error && typeof errObj.error === 'object'
        ? String((errObj.error as Record<string, unknown>).message || '')
        : '') ||
      String(errObj?.message || errObj?.msg || text || `HTTP ${res.status}`);
    throw new ApiError(502, 'UPSTREAM_FAILED', msg.slice(0, 400) || 'ithink_upstream_failed');
  }

  const imageUrl = pickImageUrl(json);
  const taskId = `ithink-${crypto.randomUUID()}`;
  return { taskId, imageUrl };
}
