import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAllImageUrls } from './apimart';
import { fetchMidjourneyTaskGallery } from './apimart-midjourney';
import {
  IMAGE_MODEL_CATALOG,
  isRetainedPublicImageEntry
} from './image-models-catalog';
import {
  submitImageJobForProvider,
  type ImageUpstreamBindings
} from './image-upstream';
import { parseMjImagineUrls } from './midjourney-models';
import {
  NEWAPI_TASK_QUERY_TIMEOUT_MS,
  fetchNewApiTaskOnce,
  submitNewApiImageJob,
  type NewApiCatalogParameter
} from './newapi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

const upstream: ImageUpstreamBindings = {
  newapiKey: 'newapi-key',
  newapiBase: 'https://newapi-unit.test',
  apimartKey: 'apimart-key',
  apimartBase: 'https://apimart-unit.test'
};

/** New API `/v1/tasks/:taskId` 的 MJ 成功响应：四宫格封面 + 4 张单图。 */
const mjSuccessPayload = {
  data: {
    status: 'completed',
    grid_image_url: 'https://cdn.test/grid.png',
    image_urls: [
      'https://cdn.test/t0.png',
      'https://cdn.test/t1.png',
      'https://cdn.test/t2.png',
      'https://cdn.test/t3.png'
    ]
  }
};

/** 与实时目录一致的 MJ 目录参数契约（New API 能力层为固定 relax 档）。 */
const mjCatalogParameters: NewApiCatalogParameter[] = [
  { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'mj-v81' },
  { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
  { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, default: '1:1' },
  { name: 'speed', path: 'speed', label: '速度', type: 'string', required: false, fixed: 'relax' },
  { name: 'image_urls', path: 'image_urls', label: '参考图', type: 'array', required: false, max_items: 4 }
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Midjourney catalog contract', () => {
  it('exposes exactly three public New API MJ models with one ownership', () => {
    const publicMj = IMAGE_MODEL_CATALOG.filter(
      (model) => model.uiFamily === 'midjourney' && isRetainedPublicImageEntry(model)
    );
    expect(publicMj.map((model) => model.id)).toEqual(['mj-v81', 'mj-v7', 'mj-niji7']);
    for (const model of publicMj) {
      expect(model.provider).toBe('newapi');
      expect(model.upstream).toBe(model.id);
      expect(model.defaultCredits).toBe(40);
      expect(model.resolutions).toEqual(['1k']);
    }
  });

  it('keeps historical apimart MJ models out of the public picker', () => {
    const historicalMj = IMAGE_MODEL_CATALOG.filter(
      (model) => model.uiFamily === 'midjourney' && model.provider === 'apimart'
    );
    expect(historicalMj.length).toBeGreaterThan(0);
    expect(historicalMj.every((model) => !isRetainedPublicImageEntry(model))).toBe(true);
  });

  it('does not expose a v8.2 ghost model with no executable submit path', () => {
    expect(IMAGE_MODEL_CATALOG.some((model) => model.id === 'mj-v82')).toBe(false);
    expect(IMAGE_MODEL_CATALOG.some((model) => model.upstream === 'mj-v8.2')).toBe(false);
  });
});

describe('Midjourney new-task submit contract (single ownership: New API)', () => {
  it('submits a new MJ imagine to New API /v1/midjourney/generations with relax speed and the upstream model', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        });
        return jsonResponse({ data: { task_id: 'task-newapi-mj' } });
      })
    );

    const result = await submitImageJobForProvider(upstream, 'newapi', {
      upstreamModel: 'mj-v81',
      prompt: 'a cat in a hat',
      resolution: '1k',
      quality: 'standard',
      size: '1:1',
      mjParams: { speed: 'relax' },
      clientRequestId: 'client-request-1',
      catalogParameters: mjCatalogParameters
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://newapi-unit.test/v1/midjourney/generations');
    expect(calls[0].url).not.toContain('apimart');
    expect(calls[0].body).toMatchObject({
      model: 'mj-v81',
      prompt: 'a cat in a hat',
      size: '1:1',
      speed: 'relax'
    });
    expect(result).toMatchObject({ provider: 'newapi', taskId: 'task-newapi-mj' });
  });

  it('does not route a MJ submit through the dedicated APIMart imagine endpoint', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        return jsonResponse({ data: { task_id: 'legacy-apimart-mj' } });
      })
    );

    const result = await submitImageJobForProvider(upstream, 'apimart', {
      upstreamModel: 'mj-v81',
      prompt: 'a cat',
      resolution: '1k',
      quality: 'standard'
    });

    expect(result).toMatchObject({ provider: 'apimart', taskId: 'legacy-apimart-mj' });
    expect(calls.some((url) => url.includes('/v1/midjourney/generations'))).toBe(false);
  });

  it('keeps a stable idempotency key on the paid MJ submit', async () => {
    const captured: { headers: Headers | null } = { headers: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured.headers = new Headers(init?.headers);
        return jsonResponse({ data: { task_id: 'task-mj' } });
      })
    );

    await submitNewApiImageJob('newapi-key', 'https://newapi-unit.test', {
      upstreamModel: 'mj-v81',
      prompt: 'a cat',
      resolution: '1k',
      quality: 'standard',
      clientRequestId: 'client-request-1',
      mjParams: { speed: 'relax' }
    });

    expect(captured.headers?.get('Idempotency-Key')).toBe('client-request-1');
    expect(captured.headers?.get('X-Client-Request-Id')).toBe('client-request-1');
  });
});

describe('Midjourney task query contract', () => {
  it('queries a new MJ task only via New API /v1/tasks/:taskId', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        expect(url).toBe('https://newapi-unit.test/v1/tasks/task-mj');
        return jsonResponse({ data: { status: 'running' } });
      })
    );

    const result = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    expect(result.status).toBe('pending');
    expect(calls).toHaveLength(1);
  });

  it('keeps the historical apimart MJ gallery query distinct at /v1/midjourney/:taskId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('https://apimart-unit.test/v1/midjourney/legacy-task');
        return jsonResponse({
          data: {
            grid_image_url: 'https://cdn.test/grid.png',
            image_urls: [
              'https://cdn.test/t0.png',
              'https://cdn.test/t1.png',
              'https://cdn.test/t2.png',
              'https://cdn.test/t3.png'
            ],
            buttons: []
          }
        });
      })
    );

    const detail = await fetchMidjourneyTaskGallery(
      'apimart-key',
      'https://apimart-unit.test',
      'legacy-task'
    );
    expect(detail?.composite).toBe('https://cdn.test/grid.png');
    expect(detail?.tiles).toHaveLength(4);
  });
});

describe('Midjourney status mapping', () => {
  it.each([
    ['queued', { data: { status: 'queued' } }, 200, 'pending', 0],
    ['running', { data: { status: 'running' } }, 200, 'pending', 0],
    ['success with grid + four tiles', mjSuccessPayload, 200, 'completed', 5],
    ['definitive failure', { data: { status: 'failed', error_message: 'upstream_rejected' } }, 200, 'failed', 0],
    ['transient 5xx', { error: 'boom' }, 503, 'pending', 0],
    ['unknown status', { data: { status: 'mystery-state' } }, 200, 'pending', 0]
  ])('maps a %s task response to %s', async (_label, body, http, expected, urlCount) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, http)));
    const result = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    expect(result.status).toBe(expected);
    expect(result.imageUrls).toHaveLength(urlCount);
  });

  it('keeps a transient query timeout pending instead of refunding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abortError();
      })
    );
    const started = Date.now();
    const result = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    expect(result.status).toBe('pending');
    expect(result.errorMessage).toBeNull();
    expect(Date.now() - started).toBeLessThan(NEWAPI_TASK_QUERY_TIMEOUT_MS + 2000);
  });

  it('maps a definitive upstream failure to a refundable failure signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { status: 'failed', error_message: 'upstream_rejected' } }))
    );
    const result = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('upstream_rejected');
  });
});

describe('Midjourney result parsing', () => {
  it('parses the five-output success response into a composite and four tiles', () => {
    const urls = extractAllImageUrls({
      data: {
        grid_image_url: 'https://cdn.test/grid.png',
        image_urls: [
          'https://cdn.test/t0.png',
          'https://cdn.test/t1.png',
          'https://cdn.test/t2.png',
          'https://cdn.test/t3.png'
        ]
      }
    });
    expect(urls).toHaveLength(5);
    const parsed = parseMjImagineUrls(urls);
    expect(parsed.composite).toBe('https://cdn.test/grid.png');
    expect(parsed.tiles).toEqual([
      'https://cdn.test/t0.png',
      'https://cdn.test/t1.png',
      'https://cdn.test/t2.png',
      'https://cdn.test/t3.png'
    ]);
    expect(parsed.gallery).toEqual(urls);
    expect(parsed.primary).toBe('https://cdn.test/grid.png');
  });

  it('returns a deterministic result on repeated queries so completion settles once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(mjSuccessPayload)));
    const first = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    const second = await fetchNewApiTaskOnce('newapi-key', 'https://newapi-unit.test', 'task-mj');
    expect(first).toEqual(second);
    expect(first.status).toBe('completed');
    expect(first.imageUrls).toHaveLength(5);
  });
});
