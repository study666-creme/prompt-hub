import { ApiError } from './errors';

export type TaskPollResult = {
  status: 'pending' | 'completed' | 'failed';
  imageUrl: string | null;
  imageUrls: string[];
  errorMessage: string | null;
  isViolation?: boolean;
};

type SubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  size?: string;
  refImageUrls?: string[];
};

function apiBase(envBase?: string): string {
  return (envBase || 'https://grsai.dakka.com.cn').replace(/\/$/, '');
}

const VIP_PIXEL_MAP: Record<string, Record<string, string>> = {
  '1k': {
    auto: '1024x1024',
    '1:1': '1024x1024',
    '16:9': '1536x864',
    '9:16': '864x1536',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '5:4': '1280x1024',
    '4:5': '1024x1280',
    '21:9': '2016x864',
    '9:21': '864x2016',
    '1:2': '1024x2048',
    '2:1': '2048x1024',
    '3:1': '1536x512',
    '1:3': '512x1536'
  },
  '2k': {
    auto: '2048x2048',
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
    '5:4': '2560x2048',
    '4:5': '2048x2560',
    '21:9': '2688x1152',
    '9:21': '1152x2688',
    '1:2': '1344x2688',
    '2:1': '2688x1344',
    '3:1': '3072x1024',
    '1:3': '1024x3072'
  },
  '4k': {
    auto: '2880x2880',
    '1:1': '2880x2880',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '3:2': '3520x2336',
    '2:3': '2336x3520',
    '5:4': '3216x2576',
    '4:5': '2576x3216',
    '21:9': '3840x1648',
    '9:21': '1648x3840',
    '1:2': '1920x3840',
    '2:1': '3840x1920',
    '3:1': '3840x1280',
    '1:3': '1280x3840'
  }
};

/** GrsAI 任务 ID 形如 9-679710cf-a1b2-... */
const TASK_ID_RE = /^\d+-[0-9a-f-]{8,}/i;

function normalizeGrsaiUpstreamModelId(value: string): string {
  return String(value || '').trim().toLowerCase();
}

/** Banana 系列必须 POST /v1/draw/nano-banana；GPT Image 用 /v1/draw/completions */
export function isNanoBananaUpstreamModel(upstreamModel: string): boolean {
  const model = normalizeGrsaiUpstreamModelId(upstreamModel);
  return model.includes('nano-banana');
}

export function resolveGrsaiSubmitPath(upstreamModel: string): '/v1/draw/nano-banana' | '/v1/draw/completions' {
  return isNanoBananaUpstreamModel(upstreamModel)
    ? '/v1/draw/nano-banana'
    : '/v1/draw/completions';
}

function mapResolutionToImageSize(resolution: string): '1K' | '2K' | '4K' {
  if (resolution === '4k') return '4K';
  if (resolution === '2k') return '2K';
  return '1K';
}

function mapAspectRatio(sizeLabel?: string): string {
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  return ratio === 'auto' ? 'auto' : ratio;
}

export function mapGrsaiDrawSize(
  upstreamModel: string,
  resolution: string,
  sizeLabel?: string
): string {
  const res = ['1k', '2k', '4k'].includes(resolution) ? resolution : '1k';
  const ratio = String(sizeLabel || '1:1').trim() || '1:1';
  const model = normalizeGrsaiUpstreamModelId(upstreamModel);
  const vipLike = model.includes('vip') || model.includes('-cl') || model.includes('nano-banana-pro');
  if (vipLike || model === 'gpt-image-2-vip') {
    return VIP_PIXEL_MAP[res]?.[ratio] || VIP_PIXEL_MAP[res]?.['1:1'] || '1024x1024';
  }
  if (model === 'gpt-image-2' || model === 'nano-banana-fast') {
    return ratio === 'auto' ? '1:1' : ratio;
  }
  return ratio === 'auto' ? '1:1' : ratio;
}

/** GPT Image：POST /v1/draw/completions */
function buildCompletionsRequestBody(params: SubmitParams): Record<string, unknown> {
  const model = normalizeGrsaiUpstreamModelId(params.upstreamModel);
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  const drawSize = mapGrsaiDrawSize(model, params.resolution, params.size);
  const ratio =
    drawSize.includes('x') && !drawSize.includes(':')
      ? undefined
      : drawSize === 'auto'
        ? '1:1'
        : drawSize;
  return {
    model,
    prompt: params.prompt,
    size: drawSize,
    webHook: '-1',
    shutProgress: false,
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...(refs ? { image: refs, urls: refs } : {})
  };
}

/** Nano Banana：POST /v1/draw/nano-banana（官方文档，勿走 completions） */
function buildNanoBananaRequestBody(params: SubmitParams): Record<string, unknown> {
  const model = normalizeGrsaiUpstreamModelId(params.upstreamModel);
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  return {
    model,
    prompt: params.prompt,
    imageSize: mapResolutionToImageSize(params.resolution),
    aspectRatio: mapAspectRatio(params.size),
    webHook: '-1',
    shutProgress: false,
    ...(refs ? { urls: refs } : {})
  };
}

export function buildGrsaiSubmitRequest(params: SubmitParams): {
  path: '/v1/draw/nano-banana' | '/v1/draw/completions';
  body: Record<string, unknown>;
} {
  const path = resolveGrsaiSubmitPath(params.upstreamModel);
  return {
    path,
    body:
      path === '/v1/draw/nano-banana'
        ? buildNanoBananaRequestBody(params)
        : buildCompletionsRequestBody(params)
  };
}

function isGrsaiOkCode(code: number): boolean {
  return code === 0 || code === 200;
}

function readIdValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (TASK_ID_RE.test(trimmed)) return trimmed;
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value);
  }
  return null;
}

/** 深度搜索响应体中的 GrsAI 任务 ID（兼容多种嵌套与 SSE JSON） */
export function extractTaskId(payload: unknown): string | null {
  const seen = new Set<object>();

  function walk(node: unknown, depth: number): string | null {
    if (depth > 8 || node == null) return null;

    const direct = readIdValue(node);
    if (direct) return direct;

    if (typeof node !== 'object') return null;
    if (seen.has(node as object)) return null;
    seen.add(node as object);

    const record = node as Record<string, unknown>;
    for (const key of ['id', 'task_id', 'taskId'] as const) {
      const hit = readIdValue(record[key]);
      if (hit) return hit;
    }

    if (typeof record.data === 'string') {
      const hit = readIdValue(record.data);
      if (hit) return hit;
    }

    for (const value of Object.values(record)) {
      const hit = walk(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  return walk(payload, 0);
}

function grsaiBusinessError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  if (root.code === undefined || root.code === null) return null;
  const code = Number(root.code);
  if (!Number.isFinite(code) || isGrsaiOkCode(code)) return null;
  if (extractTaskId(payload)) return null;
  const msg = root.msg ?? root.message ?? root.error;
  return String(msg || `GrsAI 业务错误 (code=${code})`);
}

/** 兼容 { code, data: {...} } 与扁平 { id, status, results } */
function unwrapGrsaiBody(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  if (root.data && typeof root.data === 'object') {
    return root.data as Record<string, unknown>;
  }
  if (grsaiBusinessError(payload)) {
    if (root.status || root.results || root.result_data || root.resultData) return root;
    return null;
  }
  return root;
}

function looksLikeImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(url)) return true;
  return /\/(image|img|photo|media|cdn|storage|upload|file)\//i.test(url)
    || /[?&](format|ext)=(png|jpe?g|webp)/i.test(url);
}

function deepScanHttpUrls(node: unknown, depth: number, seen: Set<string>, out: string[]): void {
  if (depth > 12 || node == null) return;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (looksLikeImageUrl(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        deepScanHttpUrls(JSON.parse(trimmed), depth + 1, seen, out);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) deepScanHttpUrls(item, depth + 1, seen, out);
    return;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      deepScanHttpUrls(value, depth + 1, seen, out);
    }
  }
}

function collectResultUrls(data: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: unknown) => {
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  const results = data.results;
  if (Array.isArray(results)) {
    for (const item of results) {
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        push(row.url);
        push(row.image_url);
        push(row.imageUrl);
        push(row.image);
        push(row.file);
      }
    }
  }
  push(data.url);
  push(data.image_url);
  push(data.imageUrl);
  if (typeof data.image === 'string') push(data.image);
  for (const key of ['images', 'imageUrls', 'content'] as const) {
    const val = data[key];
    if (Array.isArray(val)) val.forEach(push);
    else if (typeof val === 'string') push(val);
  }
  for (const key of ['result_data', 'resultData', 'result', 'output'] as const) {
    const raw = data[key];
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        collectResultUrls(JSON.parse(raw) as Record<string, unknown>).forEach(push);
      } catch {
        /* ignore malformed json */
      }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      collectResultUrls(raw as Record<string, unknown>).forEach(push);
    } else if (typeof raw === 'string' && looksLikeImageUrl(raw.trim())) {
      push(raw.trim());
    }
  }
  if (!out.length) {
    deepScanHttpUrls(data, 0, seen, out);
  }
  return out;
}

export function parseGrsaiResponseBody(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) return {};

  if (trimmed.includes('data:')) {
    const lines = trimmed.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line.startsWith('data:')) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === '[DONE]') continue;
      try {
        return JSON.parse(chunk);
      } catch {
        /* try earlier chunk */
      }
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return { _raw: trimmed.slice(0, 400) };
  }
}

/** 流式/同步直接返回图片时，无需轮询 */
export function parseImmediatePollResult(json: unknown): TaskPollResult | null {
  const body = unwrapGrsaiBody(json) || (json && typeof json === 'object' ? (json as Record<string, unknown>) : null);
  if (!body) return null;
  const status = String(body.status || '').toLowerCase();
  if (!status || status === 'running' || status === 'pending' || status === 'processing') {
    return null;
  }
  return parseGrsaiTaskPoll(json);
}

export async function submitGrsaiImageJob(
  apiKey: string,
  baseUrl: string | undefined,
  params: SubmitParams
): Promise<string> {
  const { path, body } = buildGrsaiSubmitRequest(params);
  const res = await fetch(`${apiBase(baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const rawText = await res.text();
  const json = parseGrsaiResponseBody(rawText);

  const taskIdEarly = extractTaskId(json);
  const bizErr = grsaiBusinessError(json);
  if (bizErr) {
    if (taskIdEarly) return taskIdEarly;
    throw new ApiError(502, 'UPSTREAM_ERROR', bizErr);
  }

  if (!res.ok) {
    if (taskIdEarly) return taskIdEarly;
    const err = json as { error?: { message?: string }; msg?: string; message?: string };
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      err?.error?.message || err?.msg || err?.message || `GrsAI 提交失败 (${res.status})`
    );
  }

  const taskId = extractTaskId(json);
  if (!taskId) {
    let hint = '';
    try {
      hint = `：${JSON.stringify(json).slice(0, 200)}`;
    } catch {
      hint = rawText ? `：${rawText.slice(0, 200)}` : '';
    }
    throw new ApiError(502, 'UPSTREAM_ERROR', `GrsAI 未返回任务 ID${hint}`);
  }
  return taskId;
}

function normalizeUpstreamStatus(body: Record<string, unknown>): string {
  const raw = String(body.status ?? body.result_type ?? body.resultType ?? '').trim();
  const resultType = String(
    body.result_type ?? body.resultType ?? body['结果类型'] ?? ''
  ).trim();
  if (resultType === '违规' || /^violation$/i.test(resultType)) {
    return 'violation';
  }
  const billing = String(body.credits ?? body.points ?? body.cost ?? body['积分'] ?? '');
  if (/积分已返还|refunded|refund/i.test(billing)) {
    if (/违规|violation/i.test(`${raw} ${resultType}`)) return 'violation';
    if (/失败|fail|error/i.test(`${raw} ${resultType}`)) return 'failed';
  }
  if (!raw) return '';
  if (raw === '成功' || /^success(ed)?$/i.test(raw) || /^completed$/i.test(raw)) {
    return 'succeeded';
  }
  if (raw === '失败' || /^failed?(?:ed)?$/i.test(raw) || raw === 'error') {
    return 'failed';
  }
  if (raw === '进行中' || raw === '排队中' || /^running$/i.test(raw) || /^pending$/i.test(raw) || /^processing$/i.test(raw)) {
    return 'running';
  }
  if (raw === '违规' || /^violation$/i.test(raw) || /^violated$/i.test(raw)) {
    return 'violation';
  }
  const errHint = String(body.error ?? body.failure_reason ?? body.msg ?? '');
  if (/违规|violation|content.?policy|moderation/i.test(errHint) && !/refund|返还/i.test(errHint)) {
    return 'violation';
  }
  return raw.toLowerCase();
}

export function parseGrsaiTaskPoll(json: unknown): TaskPollResult {
  const body = unwrapGrsaiBody(json);
  if (!body) {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }

  const status = normalizeUpstreamStatus(body);
  let imageUrls = collectResultUrls(body);
  if (!imageUrls.length && json && typeof json === 'object') {
    imageUrls = collectResultUrls(json as Record<string, unknown>);
  }

  if (status === 'violation') {
    return {
      status: 'failed',
      imageUrl: null,
      imageUrls: [],
      errorMessage: 'upstream_content_violation',
      isViolation: true
    };
  }

  if (status === 'succeeded' || status === 'success' || status === 'completed') {
    if (!imageUrls.length) {
      return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
    }
    return {
      status: 'completed',
      imageUrl: imageUrls[0],
      imageUrls,
      errorMessage: null
    };
  }

  if (status === 'failed' || status === 'error') {
    if (imageUrls.length) {
      return {
        status: 'completed',
        imageUrl: imageUrls[0],
        imageUrls,
        errorMessage: null
      };
    }
    return {
      status: 'failed',
      imageUrl: null,
      imageUrls: [],
      errorMessage: String(body.error || body.failure_reason || 'upstream_failed')
    };
  }

  if (status === 'running' || status === 'pending' || status === 'processing') {
    return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
  }

  if (imageUrls.length) {
    return {
      status: 'completed',
      imageUrl: imageUrls[0],
      imageUrls,
      errorMessage: null
    };
  }

  return { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}

async function requestGrsaiResult(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  mode: 'draw-post' | 'api-get'
): Promise<TaskPollResult | null> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const url =
    mode === 'api-get'
      ? `${apiBase(baseUrl)}/v1/api/result?id=${encodeURIComponent(taskId)}`
      : `${apiBase(baseUrl)}/v1/draw/result`;

  const res = await fetch(url, {
    method: mode === 'api-get' ? 'GET' : 'POST',
    headers:
      mode === 'api-get'
        ? headers
        : { ...headers, 'Content-Type': 'application/json' },
    body: mode === 'api-get' ? undefined : JSON.stringify({ id: taskId })
  });

  const rawText = await res.text();
  const json = parseGrsaiResponseBody(rawText);

  if (!res.ok) return null;
  if (grsaiBusinessError(json)) return null;
  return parseGrsaiTaskPoll(json);
}

export async function fetchGrsaiTaskOnce(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string
): Promise<TaskPollResult> {
  const post = await requestGrsaiResult(apiKey, baseUrl, taskId, 'draw-post');
  if (post && post.status !== 'pending') return post;
  const get = await requestGrsaiResult(apiKey, baseUrl, taskId, 'api-get');
  if (get) return get;
  return post || { status: 'pending', imageUrl: null, imageUrls: [], errorMessage: null };
}

export async function confirmGrsaiTaskOutcome(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<TaskPollResult> {
  const attempts = Math.max(1, opts?.attempts ?? 6);
  const intervalMs = Math.max(2000, opts?.intervalMs ?? 10000);
  let last: TaskPollResult = {
    status: 'pending',
    imageUrl: null,
    imageUrls: [],
    errorMessage: null
  };
  for (let i = 0; i < attempts; i += 1) {
    last = await fetchGrsaiTaskOnce(apiKey, baseUrl, taskId);
    if (last.status === 'completed' && last.imageUrl) return last;
    if (last.status === 'failed') {
      if (i < attempts - 1 && !last.isViolation) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      return last;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
