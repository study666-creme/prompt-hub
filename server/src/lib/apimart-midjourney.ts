import { ApiError } from './errors';
import { extractTaskId } from './apimart';
import {
  type MjActionKind,
  type MjButtonPublic,
  type MjImagineBody,
  MJ_ACTION_PATH,
  buildImagineBody,
  isMidjourneyUpstream,
  localizeMjButtonLabel,
  mjVersionFromUpstream,
  parseMjActionFromCustomId
} from './midjourney-models';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

function readUpstreamError(json: unknown, status: number): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const err = o.error;
    if (err && typeof err === 'object') {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
  }
  return status === 402 ? 'insufficient balance' : `upstream_http_${status}`;
}

async function postMj(
  apiKey: string,
  baseUrl: string | undefined,
  pathSuffix: string,
  body: Record<string, unknown>
): Promise<string> {
  const url = pathSuffix
    ? `${apiBase(baseUrl)}/v1/midjourney/generations/${pathSuffix}`
    : `${apiBase(baseUrl)}/v1/midjourney/generations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new ApiError(502, 'UPSTREAM_ERROR', readUpstreamError(json, res.status));
  }
  const taskId = extractTaskId(json);
  if (!taskId) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '上游未返回 task_id');
  }
  return taskId;
}

export type SubmitMidjourneyParams = {
  upstreamModel: string;
  prompt: string;
  size?: string;
  refImageUrls?: string[];
  mjParams?: Record<string, unknown>;
};

/** 独立混图：2～5 张参考图，无需父任务 */
export async function submitMidjourneyBlend(
  apiKey: string,
  baseUrl: string | undefined,
  imageUrls: string[]
): Promise<string> {
  const urls = imageUrls.filter(Boolean);
  if (urls.length < 2 || urls.length > 5) {
    throw new ApiError(400, 'VALIDATION_ERROR', '混图需要 2～5 张参考图');
  }
  return postMj(apiKey, baseUrl, MJ_ACTION_PATH.blend, { image_urls: urls });
}

export async function submitMidjourneyImagine(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitMidjourneyParams
): Promise<string> {
  const spec = mjVersionFromUpstream(params.upstreamModel);
  if (!spec) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的 Midjourney 模型配置');
  }
  const body = buildImagineBody(spec, params.prompt, {
    size: params.size,
    refImageUrls: params.refImageUrls,
    mj: params.mjParams
  });
  return postMj(apiKey, baseUrl, '', body as unknown as Record<string, unknown>);
}

export type SubmitMjActionParams = {
  action: MjActionKind;
  parentTaskId: string;
  index?: number;
  customId?: string;
  prompt?: string;
  zoom?: number;
  direction?: string;
  imageUrls?: string[];
  maskUrl?: string;
};

export async function submitMidjourneyAction(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitMjActionParams
): Promise<string> {
  const path = MJ_ACTION_PATH[params.action];
  const body: Record<string, unknown> = {
    task_id: params.parentTaskId
  };
  if (params.customId) {
    body.custom_id = params.customId;
  } else if (params.index != null) {
    body.index = params.index;
  }
  if (params.prompt) body.prompt = params.prompt;
  if (params.zoom != null) body.zoom = params.zoom;
  if (params.direction) body.direction = params.direction;
  if (params.imageUrls?.length) body.image_urls = params.imageUrls;
  if (params.maskUrl) body.mask_url = params.maskUrl;
  return postMj(apiKey, baseUrl, path, body);
}

type RawMjButton = {
  label?: string;
  custom_id?: string;
  customId?: string;
  action?: string;
  index?: number;
};

function normalizeButtons(raw: unknown): MjButtonPublic[] {
  if (!Array.isArray(raw)) return [];
  const out: MjButtonPublic[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as RawMjButton;
    const customId = String(b.custom_id || b.customId || '').trim();
    const labelRaw = String(b.label || '').trim();
    const index = typeof b.index === 'number' ? b.index : undefined;
    const action = parseMjActionFromCustomId(customId || labelRaw || String(b.action || ''));
    const label = localizeMjButtonLabel(labelRaw, action === 'custom' ? b.action : action, index);
    const key = `${action}:${customId || label}:${index ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      action,
      label,
      ...(index != null ? { index } : {}),
      ...(customId ? { customId } : {})
    });
  }
  return out;
}

/** 查询 MJ 任务详情（含可操作按钮） */
export async function fetchMidjourneyTaskButtons(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<MjButtonPublic[]> {
  const res = await fetch(`${apiBase(baseUrl)}/v1/midjourney/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) return [];
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    return [];
  }
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.buttons)) return normalizeButtons(d.buttons);
  const result = d.result;
  if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).buttons)) {
    return normalizeButtons((result as Record<string, unknown>).buttons);
  }
  return [];
}

/** imagine 四宫格默认操作（上游按钮未返回时的兜底） */
export function defaultGridMjButtons(): MjButtonPublic[] {
  const out: MjButtonPublic[] = [];
  for (let i = 1; i <= 4; i += 1) {
    out.push({ action: 'upscale', label: `放大 ${i}`, index: i });
  }
  for (let i = 1; i <= 4; i += 1) {
    out.push({ action: 'variation', label: `变体 ${i}`, index: i });
  }
  out.push({ action: 'reroll', label: '重新生成' });
  return out;
}

export function isMjUpstreamModel(upstream: string): boolean {
  return isMidjourneyUpstream(upstream);
}
