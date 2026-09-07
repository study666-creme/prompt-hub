import type { Env } from '../env';
import { newApiVideoKey } from '../env';

const CANVAS_TOKEN_KV_PREFIX = 'canvas-video-token:';
const CATALOG_TOKEN_ENDPOINT = '/api/model-catalog/admin/ensure-canvas-token';
const CATALOG_TIMEOUT_MS = 5_000;

/**
 * 画布提交统一走平台管理员视频 key，API 站看到的所有任务都属于同一个账号。
 * 每个画布用户在 KV 中有一条 `canvas-video-token:<userId>` 映射（指向 New API
 * 专属 token，名称 `canvas-*`），提交与状态查询按用户挑选，使 API 站日志可以
 * 按令牌名称区分画布用户，同时保持 API 站与画布完全解耦。
 *
 * `ensureCanvasVideoKey` 是自愈路径：KV 未命中时通过目录服务
 * `ensure-canvas-token` 幂等接口创建/取回令牌并回写 KV，因此新画布用户首次
 * 提交即可自动获得专属令牌，无需人工参与。任何失败都回退到默认管理员 key，
 * 永不阻断生成，且整个流程对画布使用者不可见。
 */
export async function ensureCanvasVideoKey(
  env: Env,
  canvasUserId: string | number | null | undefined,
): Promise<string | undefined> {
  const fallback = newApiVideoKey(env);
  if (!fallback) return undefined;
  const value = String(canvasUserId ?? '').trim();
  if (!value) return fallback;
  const kv = env.PROMPT_HUB_METRICS;
  if (kv) {
    try {
      const cached = await kv.get(`${CANVAS_TOKEN_KV_PREFIX}${value}`);
      if (cached && cached.trim()) return cached.trim();
    } catch {
      // KV 不可用：直接尝试目录分配，仍失败时保留默认 key。
    }
  }
  const allocated = await ensureCanvasTokenViaCatalog(env, value);
  if (!allocated) return fallback;
  if (kv) {
    try {
      await kv.put(`${CANVAS_TOKEN_KV_PREFIX}${value}`, allocated);
    } catch {
      // 写回失败只影响下一请求（会再次调用目录分配），不影响本次请求。
    }
  }
  return allocated;
}

/** 只读路径：仅查 KV，未命中回退默认 key，不触发目录分配。 */
export async function resolveCanvasVideoKey(
  env: Env,
  canvasUserId: string | number | null | undefined,
): Promise<string | undefined> {
  const fallback = newApiVideoKey(env);
  if (!fallback) return undefined;
  const value = String(canvasUserId ?? '').trim();
  if (!value || !env.PROMPT_HUB_METRICS) return fallback;
  try {
    const token = await env.PROMPT_HUB_METRICS.get(`${CANVAS_TOKEN_KV_PREFIX}${value}`);
    if (token && token.trim()) return token.trim();
  } catch {
    // KV 不可用时保持默认 key，不能因身份映射中断生成。
  }
  return fallback;
}

async function ensureCanvasTokenViaCatalog(env: Env, userId: string): Promise<string | null> {
  const secret = env.NEWAPI_CATALOG_ADMIN_SECRET?.trim();
  if (!secret) return null;
  try {
    const base = String(env.NEWAPI_API_BASE_URL || 'https://newapi.prompt-hubs.com').replace(/\/+$/, '');
    const response = await fetch(new URL(CATALOG_TOKEN_ENDPOINT, base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalog-admin-secret': secret,
      },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as { key?: unknown } | null;
    return typeof payload?.key === 'string' && payload.key.trim() ? payload.key.trim() : null;
  } catch {
    return null;
  }
}
