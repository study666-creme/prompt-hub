import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNewApiImageRequestBody,
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  fetchNewApiPricingRules,
  fetchNewApiTaskOnce,
  imageCatalogForNewApiSnapshot,
  newApiKeyForRoute,
  newApiFixedCreditsForRequest,
  newApiTextCreditsForUsage,
  newApiCreditsForModel,
  publicNewApiCatalogModels,
  publicNewApiRoutedCatalogModels,
  resolveNewApiCatalogModel,
  resolveNewApiRoutedCatalogModel,
  submitNewApiImageJob
} from './newapi';
import type { NewApiAdminRouteSnapshot, NewApiCatalogSnapshot } from './newapi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('newapi image upstream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits long enough for the live model catalog before declaring it unavailable', async () => {
    const timeout = vi.fn(() => new AbortController().signal);
    vi.stubGlobal('AbortSignal', { timeout });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-timeout',
      pricing_version: 'pricing-timeout',
      models: []
    })));

    await fetchNewApiModelCatalog('https://catalog-timeout.test', { force: true });

    expect(timeout).toHaveBeenCalledWith(15_000);
  });

  it('loads reviewed image capabilities and preserves fractional credits', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-1',
      pricing_version: 'pricing-1',
      models: [
        {
          id: 'gpt-image-2',
          label: 'GPT Image 2',
          public: { id: 'image2', label: 'Image2', description: '标准生图模型，固定 1K。' },
          modality: 'image',
          family: 'gim2',
          selectable: true,
          order: 20,
          tags: 'image',
          integrations: { prompt_hub: { id: 'newapi-gpt-image-2', fixed_quality_low: false } },
          parameters: [
            { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'gpt-image-2' },
            { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, fixed: '1k' },
            { name: 'size', path: 'size', label: '比例', type: 'string', required: false, options: ['1:1', '16:9'] }
          ],
          pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 999 }
        },
        {
          id: 'gpt-image-2-ext',
          label: 'GPT Image 2 Ext',
          public: { id: 'image2-pro', label: 'Image2 Pro', description: '高质量生图模型。' },
          modality: 'image',
          family: 'gim2',
          selectable: true,
          order: 21,
          tags: 'image',
          integrations: { prompt_hub: { id: 'newapi-gpt-image-2-ext', fixed_quality_low: false } },
          parameters: [
            { name: 'quality', path: 'quality', label: '分辨率', type: 'string', required: false, options: ['1k', '2k', '4k'] },
            { name: 'size', path: 'size', label: '比例', type: 'string', required: false, options: ['1:1', '16:9'] }
          ],
          pricing: {
            mode: 'tiered',
            unit: 'image',
            yuan: 0.0695,
            credits: 6.95,
            tiers: [
              { when: { quality: '1k' }, yuan: 0.0695, credits: 6.95 },
              { when: { quality: '2k' }, yuan: 0.15, credits: 15 },
              { when: { quality: '4k' }, yuan: 0.2, credits: 20 }
            ]
          }
        },
        {
          id: 'gpt-image-2-chat',
          label: 'GPT Image 2 Special',
          public: { id: 'image2-special', label: 'Image2 Special', description: '特价生图。' },
          modality: 'image',
          family: 'gim2-chat',
          operation: 'chat',
          selectable: true,
          parameters: [],
          pricing: { mode: 'fixed', unit: 'request', yuan: 0.025, credits: 999 }
        },
        {
          id: 'flux-preview',
          label: 'Flux Preview',
          public: { id: 'flux-public', label: 'Flux Preview', description: '未接入图片族。' },
          modality: 'image',
          family: 'flux',
          operation: 'generate',
          selectable: true,
          parameters: [
            { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, fixed: '1k' }
          ],
          pricing: { mode: 'fixed', unit: 'image', yuan: 0.01, credits: 999 }
        },
        {
          id: 'image2k4k',
          label: 'Image 2K/4K Low',
          public: { id: 'image2-hd', label: 'Image2 HD', description: '高分辨率经济模型。' },
          modality: 'image',
          family: 'gim2',
          selectable: true,
          order: 22,
          tags: 'image',
          integrations: { prompt_hub: { id: 'newapi-gpt-image-2-official-budget', fixed_quality_low: true } },
          parameters: [
            { name: 'quality', path: 'quality', label: '分辨率', type: 'string', required: false, options: ['2k', '4k'] },
            { name: 'size', path: 'size', label: '比例', type: 'string', required: false, options: ['16:9', '9:16'] }
          ],
          pricing: {
            mode: 'tiered',
            unit: 'image',
            yuan: 0.055,
            credits: 5.5,
            tiers: [
              { when: { quality: '2k' }, yuan: 0.055, credits: 5.5 },
              { when: { quality: '4k' }, yuan: 0.09, credits: 9 }
            ]
          }
        },
        {
          id: 'chat-only',
          label: 'Chat only',
          public: { id: 'chat-public', label: '文字模型', description: '按次计费文字模型。' },
          modality: 'text',
          operation: 'chat',
          selectable: true,
          parameters: [],
          pricing: { mode: 'fixed', unit: 'request', yuan: 0.01, credits: 1 }
        },
        {
          id: 'grok-video',
          label: 'Grok Video',
          public: { id: 'motion-video', label: '动态影像', description: '按秒计费的视频模型。' },
          modality: 'video',
          operation: 'generate',
          selectable: true,
          parameters: [
            { name: 'duration', path: 'duration', label: '时长', type: 'integer', min: 5, max: 15 },
            { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', options: ['480p', '720p'] }
          ],
          pricing: { mode: 'fixed', unit: 'second', yuan: 0.016, credits: 999 }
        },
        {
          id: 'gpt-5.5',
          label: 'GPT-5.5',
          public: { id: 'creative-5-5', label: '创作 5.5', description: '通用创作模型。' },
          modality: 'text',
          operation: 'chat',
          selectable: true,
          parameters: [],
          pricing: {
            mode: 'token',
            unit: 'token',
            input_multiplier: 0.05,
            output_multiplier: 0.3,
            input_credits_per_million: 10,
            output_credits_per_million: 60
          }
        }
      ]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const rules = await fetchNewApiPricingRules('https://pricing-unit.test/v1', { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pricingCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(pricingCall[0])).toBe('https://pricing-unit.test/api/model-catalog?refresh=1');
    expect(newApiCreditsForModel(rules, 'gpt-image-2-chat')).toBe(2.5);
    expect(newApiCreditsForModel(rules, 'gpt-image-2')).toBe(5.5);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext', '1k')).toBe(7);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext', '2k')).toBe(15);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext', '4k')).toBe(20);
    expect(newApiCreditsForModel(rules, 'image2k4k', '2k')).toBe(5.5);
    expect(newApiCreditsForModel(rules, 'image2k4k', '4k')).toBe(9);
    expect(newApiCreditsForModel(rules, 'chat-only')).toBeNull();

    const snapshot = await fetchNewApiModelCatalog('https://pricing-unit.test/v1');
    expect(snapshot.imageCatalogEntries.map(model => model.id)).toEqual(['image2', 'image2-pro', 'image2-economy', 'image2-hd']);
    expect(snapshot.imageCatalogEntries.map(model => model.label)).toEqual([
      '全能模型2 · 1K',
      '全能模型2 · 高质量 1K/2K/4K',
      '全能模型2 · 特价 1K',
      '全能模型2 · 经济 2K/4K'
    ]);
    expect(snapshot.imageCatalogEntries[3].fixedQualityLow).toBe(true);
    expect(resolveNewApiCatalogModel(snapshot, 'image2-economy', 'image')?.upstreamModel).toBe('gpt-image-2-chat');
    expect(resolveNewApiCatalogModel(snapshot, 'image2', 'image')?.upstreamModel).toBe('gpt-image-2');
    expect(resolveNewApiCatalogModel(snapshot, 'gpt-image-2', 'image')?.id).toBe('image2');
    expect(publicNewApiCatalogModels(snapshot)).toContainEqual(expect.objectContaining({
      id: 'chat-public',
      label: '文字模型',
      modality: 'text'
    }));
    expect(publicNewApiCatalogModels(snapshot).some(model => 'upstreamModel' in model)).toBe(false);
    expect(publicNewApiCatalogModels(snapshot).some(model => model.id === 'image2-economy')).toBe(true);
    expect(publicNewApiCatalogModels(snapshot).some(model => model.id === 'flux-public')).toBe(false);
    expect(resolveNewApiCatalogModel(snapshot, 'image2-economy', 'image')?.upstreamModel).toBe('gpt-image-2-chat');
    expect(resolveNewApiCatalogModel(snapshot, 'flux-public', 'image')).toBeNull();
    const video = resolveNewApiCatalogModel(snapshot, 'motion-video', 'video');
    expect(video && newApiFixedCreditsForRequest(video, { duration: 10, resolution: '720p' })).toBe(16);
    const textModel = resolveNewApiCatalogModel(snapshot, 'creative-5-5', 'text');
    expect(textModel && newApiTextCreditsForUsage(textModel, 100_000, 10_000)).toBe(1.6);
  });

  it('retains reviewed image models without the legacy family field and prices quality tiers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-familyless-1',
      pricing_version: 'pricing-familyless-1',
      models: [
        {
          id: 'image2-A',
          label: '全能模型2-A',
          description: '支持多档分辨率和质量。',
          modality: 'image',
          selectable: true,
          tags: 'image,image2,per-image,1k,2k,4k,quality',
          endpoint: { method: 'POST', path: '/v1/images/generations', content_type: 'application/json' },
          parameters: [
            { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'image2-A' },
            { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
            { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', default: '1k', options: ['1k', '2k', '4k'] },
            { name: 'quality', path: 'quality', label: '质量', type: 'string', default: 'standard', options: ['low', 'standard', 'high'] },
            { name: 'n', path: 'n', label: '张数', type: 'integer', fixed: 1 }
          ],
          pricing: {
            mode: 'tiered',
            unit: 'image',
            yuan: 0.04,
            tiers: [
              { when: { resolution: '1k' }, yuan: 0.04 },
              { when: { resolution: '2k' }, yuan: 0.05 },
              { when: { resolution: '4k' }, yuan: 0.06 },
              { when: { resolution: '1k', quality: 'high' }, yuan: 0.06 },
              { when: { resolution: '2k', quality: 'high' }, yuan: 0.07 },
              { when: { resolution: '4k', quality: 'high' }, yuan: 0.08 }
            ]
          }
        },
        {
          id: 'nano-banana-2',
          label: '香蕉 2',
          modality: 'image',
          selectable: true,
          tags: 'image,banana,1k',
          endpoint: { method: 'POST', path: '/v1/images/generations', content_type: 'application/json' },
          parameters: [{ name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', fixed: '1k' }],
          pricing: { mode: 'fixed', unit: 'image', yuan: 0.03 }
        },
        {
          id: 'mj-v7',
          label: 'Midjourney 7',
          modality: 'image',
          selectable: true,
          tags: 'image,midjourney',
          endpoint: { method: 'POST', path: '/v1/midjourney/generations', content_type: 'application/json' },
          parameters: [],
          pricing: { mode: 'fixed', unit: 'request', yuan: 0.4 }
        },
        {
          id: 'flux-preview',
          label: 'Flux Preview',
          modality: 'image',
          selectable: true,
          tags: 'image,flux,1k',
          endpoint: { method: 'POST', path: '/v1/images/generations', content_type: 'application/json' },
          parameters: [{ name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', fixed: '1k' }],
          pricing: { mode: 'fixed', unit: 'image', yuan: 0.01 }
        }
      ]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://familyless-catalog.test', { force: true });

    expect(snapshot.imageCatalogEntries.map(model => [model.id, model.uiFamily])).toEqual([
      ['image2-A', 'gim2'],
      ['lingtu-2', 'banana'],
      ['mj-v7', 'midjourney']
    ]);
    expect(snapshot.imageCatalogEntries.find(model => model.id === 'image2-A')?.label).toBe('全能模型2-A');
    expect(resolveNewApiCatalogModel(snapshot, 'image2-a', 'image')?.id).toBe('image2-A');
    expect(newApiCreditsForModel(snapshot.rules, 'image2-A', '1k', 'standard')).toBe(4);
    expect(newApiCreditsForModel(snapshot.rules, 'image2-A', '1k', 'high')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'image2-A', '2k', 'high')).toBe(7);
    expect(newApiCreditsForModel(snapshot.rules, 'image2-A', '4k', 'standard')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'image2-A', '4k', 'high')).toBe(8);
    expect(publicNewApiCatalogModels(snapshot).some(model => model.id === 'flux-preview')).toBe(false);
  });

  it('routes the three published MJ models through APIMart at 40 credits per request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-mj-1',
      pricing_version: 'pricing-mj-1',
      models: [{
        id: 'mj-v81',
        label: 'Midjourney 8.1',
        public: {
          id: 'mj-v81',
          label: 'Midjourney 8.1',
          description: '固定 Relax，一次提交返回 5 张图。'
        },
        modality: 'image',
        operation: 'generate',
        selectable: true,
        order: 50,
        endpoint: {
          method: 'POST',
          path: '/v1/midjourney/generations',
          content_type: 'application/json'
        },
        parameters: [
          { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'mj-v81' },
          { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
          { name: 'quality', path: 'quality', label: '质量', type: 'string', default: '1', options: ['0.25', '0.5', '1', '2'] },
          { name: 'speed', path: 'speed', label: '速度', type: 'string', fixed: 'relax' },
          { name: 'n', path: 'n', label: '提交次数', type: 'integer', fixed: 1 }
        ],
        pricing: {
          mode: 'fixed',
          unit: 'request',
          currency: 'CNY',
          yuan: 0.4,
          credits: 40
        }
      }]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchNewApiModelCatalog('https://midjourney-catalog.test', { force: true });
    expect(snapshot.rules).toEqual([]);
    expect(snapshot.imageCatalogEntries).toEqual([
      expect.objectContaining({
        id: 'mj-v81',
        upstream: 'mj-v81',
        provider: 'apimart',
        uiFamily: 'midjourney',
        defaultCredits: 40,
        pricingByResolution: false
      })
    ]);
    expect(publicNewApiCatalogModels(snapshot)).toContainEqual(expect.objectContaining({
      id: 'mj-v81',
      endpoint: { method: 'POST', path: '/api/v1/generate', contentType: 'application/json' },
      pricing: expect.objectContaining({ unit: 'request', credits: 40 })
    }));

    const merged = imageCatalogForNewApiSnapshot(snapshot);
    expect(merged.filter(model => model.id === 'mj-v81')).toHaveLength(1);
    expect(merged.filter(model => model.uiFamily === 'midjourney' && !model.legacyOnly).map(model => model.id)).toEqual([
      'mj-v81',
      'mj-v7',
      'mj-niji7'
    ]);
    expect(merged.some(model => model.id.startsWith('apimart-mj-'))).toBe(false);
  });

  it('submits image2-A once as a durable native image task', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect((init as RequestInit | undefined)?.method).toBe('POST');
      expect(body).toEqual({
        model: 'image2-A',
        prompt: 'a clean product photograph',
        resolution: '4k',
        quality: 'high',
        n: 1
      });
      return jsonResponse({
        id: 'task_image2a_4k_high',
        task_id: 'task_image2a_4k_high',
        status: 'queued',
        progress: '0%'
      }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'image2-A',
      prompt: 'a clean product photograph',
      resolution: '4k',
      quality: 'high',
      count: 1,
      idempotencyKey: 'image2-a-4k-high-job',
      catalogParameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'image2-A' },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, default: '1k', options: ['1k', '2k', '4k'] },
        { name: 'quality', path: 'quality', label: '质量', type: 'string', required: false, default: 'standard', options: ['low', 'standard', 'high'] },
        { name: 'n', path: 'n', label: '张数', type: 'integer', required: false, fixed: 1 }
      ]
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://newapi-unit.test/v1/images/generations');
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Idempotency-Key'))
      .toBe('image2-a-4k-high-job');
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Prefer'))
      .toBe('respond-async');
    expect(result.taskId).toBe('task_image2a_4k_high');
    expect(result.imageUrl).toBeNull();
    expect(fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method || 'GET'} ${new URL(String(url)).pathname}`))
      .toEqual(['POST /v1/images/generations']);
  });

  it('surfaces a safe native image stream error without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response([
      'event: error',
      'data: {"type":"error","error":{"code":"request_rejected","message":"reference image format is not supported"}}',
      '',
      'data: [DONE]',
      ''
    ].join('\n'), {
      headers: { 'content-type': 'text/event-stream' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'image2-A',
      prompt: 'product photo',
      resolution: '4k',
      quality: 'high'
    })).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
      message: 'HTTP 502 [request_rejected]: reference image format is not supported'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a required fresh catalog cannot be loaded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        version: 'fresh-1',
        pricing_version: 'pricing-1',
        models: []
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 502));
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewApiModelCatalog('https://fresh-required.test', { force: true });
    await expect(fetchNewApiModelCatalog('https://fresh-required.test', {
      force: true,
      requireFresh: true
    })).rejects.toThrow('model catalog 502');
  });

  it('prefers the exact standard image price over a resolution-suffixed special model', () => {
    expect(newApiCreditsForModel([
      { model: 'gpt-image-2-1k', credits: 2, description: null, tags: '', label: 'special', modality: 'image', parameters: [] },
      { model: 'gpt-image-2', credits: 5.5, description: null, tags: '', label: 'standard', modality: 'image', parameters: [] }
    ], 'gpt-image-2', '1k')).toBe(5.5);
  });

  it('keeps fixed 4K models whose resolution is encoded in the model id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-fixed-4k',
      pricing_version: 'pricing-fixed-4k',
      models: [{
        id: 'gpt-image-2-4k-fast',
        public: { id: 'image2-4k-fast', label: 'GPT Image 2 Fast 4K' },
        modality: 'image',
        family: 'gim2',
        selectable: true,
        order: 24,
        parameters: [
          { name: 'model', path: 'model', type: 'string', required: true, fixed: 'gpt-image-2-4k-fast' },
          { name: 'quality', path: 'quality', type: 'string', required: false, fixed: 'standard' },
          { name: 'size', path: 'size', type: 'string', required: false, options: ['1:1', '16:9'] }
        ],
        pricing: { mode: 'fixed', unit: 'image', yuan: 0.065 }
      }]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://fixed-4k.test', { force: true });
    expect(snapshot.imageCatalogEntries).toContainEqual(expect.objectContaining({
      id: 'image2-4k-fast',
      upstream: 'gpt-image-2-4k-fast',
      resolutions: ['4k'],
      defaultCredits: 6.5
    }));
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-4k-fast', '4k')).toBe(6.5);
    expect(publicNewApiCatalogModels(snapshot)).toContainEqual(expect.objectContaining({
      id: 'image2-4k-fast',
      modality: 'image'
    }));
  });

  it('does not retry a transient excessive-load image response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'excessive system load' } }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2',
      prompt: 'apple',
      resolution: '1k',
      quality: 'standard'
    })).rejects.toThrow('excessive system load');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the HTTP status and safe error code for queued image failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: {
        code: 'insufficient_user_quota',
        message: '请求被拒绝'
      }
    }, 403)));

    await expect(submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'image2-A',
      prompt: 'product photo',
      resolution: '2k',
      quality: 'standard'
    })).rejects.toMatchObject({
      status: 403,
      code: 'UPSTREAM_ERROR',
      message: 'HTTP 403 [insufficient_user_quota]: 请求被拒绝'
    });
  });

  it('extracts an immediate image response from compatible generation API', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect(body.model).toBe('image2k4k');
      expect(body.prompt).toBe('apple');
      expect(body.resolution).toBe('4k');
      expect(body.quality).toBe('4k');
      expect(body.images).toEqual(['https://ref.test/a.png']);
      return jsonResponse({ data: [{ url: 'https://image.test/out.png' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'standard',
      fixedQualityLow: true,
      idempotencyKey: 'job-unit-123',
      refImageUrls: ['https://ref.test/a.png']
    });

    const submitCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(submitCall[0])).toBe('https://newapi-unit.test/v1/images/generations');
    expect((submitCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer unit-key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'job-unit-123'
    });
    expect(result.taskId).toMatch(/^newapi-/);
    expect(result.imageUrl).toBe('https://image.test/out.png');
  });

  it('submits the economical image model through chat completions', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect(body).toEqual({
        model: 'gpt-image-2-chat',
        messages: [{ role: 'user', content: 'apple' }],
        stream: false
      });
      return jsonResponse({
        choices: [{ message: { content: '![result](https://image.test/chat.png)' } }]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2-chat',
      prompt: 'apple',
      resolution: '1k',
      quality: 'standard'
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://newapi-unit.test/v1/chat/completions');
    expect(result.taskId).toMatch(/^newapi-/);
    expect(result.imageUrl).toBe('https://image.test/chat.png');
  });

  it('parses economical image outputs returned beside chat content', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{
        message: {
          content: null,
          images: [{ type: 'image_url', image_url: { url: 'https://image.test/chat-images.png' } }]
        }
      }]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2-chat',
      prompt: 'apple',
      resolution: '1k',
      quality: 'medium'
    });

    expect(result.imageUrl).toBe('https://image.test/chat-images.png');
  });

  it('parses economical image outputs from root data and plain chat links', async () => {
    const responses = [
      { data: [{ url: 'https://image.test/chat-data.png' }] },
      { choices: [{ message: { content: 'Generated image: https://image.test/chat-plain.png' } }] }
    ];
    const fetchMock = vi.fn(async () => jsonResponse(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    const first = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2-chat',
      prompt: 'apple',
      resolution: '1k',
      quality: 'medium'
    });
    const second = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2-chat',
      prompt: 'pear',
      resolution: '1k',
      quality: 'medium'
    });

    expect(first.imageUrl).toBe('https://image.test/chat-data.png');
    expect(second.imageUrl).toBe('https://image.test/chat-plain.png');
  });

  it('submits economical image references through chat completions', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect(body).toEqual({
        model: 'gpt-image-2-chat',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'turn it into a product shot' },
            { type: 'image_url', image_url: { url: 'https://ref.test/a.png' } },
            { type: 'image_url', image_url: { url: 'https://ref.test/b.png' } },
            { type: 'image_url', image_url: { url: 'https://ref.test/c.png' } },
            { type: 'image_url', image_url: { url: 'https://ref.test/d.png' } }
          ]
        }],
        stream: false
      });
      return jsonResponse({
        choices: [{ message: { content: '![result](https://image.test/chat-ref.png)' } }]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2-chat',
      prompt: 'turn it into a product shot',
      resolution: '1k',
      quality: 'standard',
      refImageUrls: [
        'https://ref.test/a.png',
        'https://ref.test/b.png',
        'https://ref.test/c.png',
        'https://ref.test/d.png',
        'https://ref.test/e.png'
      ]
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://newapi-unit.test/v1/chat/completions');
    expect(result.taskId).toMatch(/^newapi-/);
    expect(result.imageUrl).toBe('https://image.test/chat-ref.png');
  });

  it('builds image requests only from the selected model parameter contract', () => {
    const shared = [
      { name: 'model', path: 'model', label: '模型', type: 'string' as const, required: true, fixed: 'image2k4k' },
      { name: 'prompt', path: 'prompt', label: '提示词', type: 'string' as const, required: true },
      { name: 'quality', path: 'quality', label: '分辨率', type: 'string' as const, required: false, default: '2k', options: ['2k', '4k'] },
      { name: 'size', path: 'size', label: '比例', type: 'string' as const, required: false, default: '3:1', options: ['3:1', '16:9'] },
      { name: 'images', path: 'images', label: '参考图', type: 'array' as const, required: false, max_items: 2 },
      { name: 'n', path: 'n', label: '张数', type: 'integer' as const, required: false, default: 1, min: 1, max: 4 }
    ];
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'ultra',
      size: '1:1',
      count: 4,
      refImageUrls: ['a', 'b', 'c'],
      catalogParameters: shared
    });

    expect(body).toEqual({
      model: 'image2k4k',
      prompt: 'apple',
      quality: '4k',
      size: '3:1',
      images: ['a', 'b'],
      n: 4
    });
    expect(body).not.toHaveProperty('resolution');
  });

  it('requests an inline result for the fixed 1K model whose upstream URLs are not durable', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'gpt-image-2-1k',
      prompt: 'white ceramic cup',
      resolution: '1k',
      quality: 'medium',
      size: '1:1',
      count: 1,
      catalogParameters: [
        { name: 'model', path: 'model', label: 'model', type: 'string', required: true, fixed: 'gpt-image-2-1k' },
        { name: 'prompt', path: 'prompt', label: 'prompt', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: 'resolution', type: 'string', required: false, fixed: '1k' },
        { name: 'quality', path: 'quality', label: 'quality', type: 'string', required: false, default: 'medium' },
        { name: 'size', path: 'size', label: 'size', type: 'string', required: false, default: 'auto' },
        { name: 'n', path: 'n', label: 'count', type: 'integer', required: false, fixed: 1 }
      ]
    });

    expect(body).toEqual({
      model: 'gpt-image-2-1k',
      prompt: 'white ceramic cup',
      resolution: '1k',
      quality: 'medium',
      size: '1:1',
      n: 1,
      response_format: 'b64_json'
    });
  });

  it('normalizes completed task polling responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: {
        status: 'succeeded',
        images: [{ url: 'https://image.test/task.png' }]
      }
    })));

    const result = await fetchNewApiTaskOnce('unit-key', 'https://newapi-unit.test', 'task-1');

    expect(result.status).toBe('completed');
    expect(result.imageUrl).toBe('https://image.test/task.png');
    expect(result.imageUrls).toEqual(['https://image.test/task.png']);
  });

  it('loads the protected admin route catalog without exposing unknown fields', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://route-catalog.test/api/model-catalog/admin/routes?refresh=1');
      expect(new Headers(init?.headers).get('X-Catalog-Admin-Secret')).toBe('route-secret');
      return jsonResponse({
        success: true,
        fetched_at: '2026-07-12T00:00:00.000Z',
        routes: {
          'gpt-image-2': [{
            channel_id: 9,
            channel_name: 'GRS Image 1K',
            status: 'active',
            enabled: true,
            groups: ['default', '生图'],
            actual_model: 'gpt-image-2',
            priority: 10,
            weight: 1,
            upstream_host: 'api.grsai.test',
            key: 'must-not-be-retained'
          }]
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchNewApiAdminRoutes(
      'https://route-catalog.test/v1',
      'route-secret',
      { force: true }
    );

    expect(snapshot.available).toBe(true);
    expect(snapshot.routes['gpt-image-2'][0]).toEqual({
      channelId: 9,
      channelName: 'GRS Image 1K',
      status: 'active',
      enabled: true,
      groups: ['default', '生图'],
      actualModel: 'gpt-image-2',
      priority: 10,
      weight: 1,
      upstreamHost: 'api.grsai.test'
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-be-retained');
  });

  it('does not request admin routes when the dedicated secret is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchNewApiAdminRoutes('https://route-catalog-missing.test', '');

    expect(snapshot.available).toBe(false);
    expect(snapshot.error).toContain('未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps every active route for the same Grok model selectable and routable', async () => {
    const snapshot: NewApiCatalogSnapshot = {
      available: true,
      stale: false,
      version: 'catalog-routes',
      pricingVersion: 'pricing-routes',
      rules: [],
      imageCatalogEntries: [],
      models: [{
        id: 'grok-4.5',
        upstreamModel: 'grok-4.5',
        label: 'Grok 4.5',
        description: '',
        modality: 'text',
        operation: 'chat',
        order: 1,
        endpoint: { method: 'POST', path: '/api/v1/chat', contentType: 'application/json' },
        parameters: [{ name: 'model', path: 'model', label: 'Model', type: 'string', required: true, fixed: 'grok-4.5' }],
        pricing: {
          mode: 'token',
          unit: 'token',
          inputMultiplier: 0.009,
          outputMultiplier: 0.027,
          inputCreditsPerMillion: 1.8,
          outputCreditsPerMillion: 5.4,
          groups: [
            { id: 'route-a', inputMultiplier: 0.009, outputMultiplier: 0.027 },
            { id: 'route-b', inputMultiplier: 0.013, outputMultiplier: 0.039 },
            { id: 'route-c', inputMultiplier: 0.02, outputMultiplier: 0.06 }
          ]
        }
      }]
    };
    const routes: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: '2026-07-19T00:00:00.000Z',
      error: null,
      routes: {
        'grok-4.5': [
          { channelId: 11, channelName: 'private-a', status: 'active', enabled: true, groups: ['route-a'], actualModel: 'grok-4.5', priority: 3, weight: 1, upstreamHost: 'a.private' },
          { channelId: 22, channelName: 'private-b', status: 'active', enabled: true, groups: ['route-b'], actualModel: 'grok-4.5', priority: 2, weight: 1, upstreamHost: 'b.private' },
          { channelId: 33, channelName: 'private-c', status: 'active', enabled: true, groups: ['route-c'], actualModel: 'grok-4.5', priority: 1, weight: 1, upstreamHost: 'c.private' }
        ]
      }
    };

    const models = await publicNewApiRoutedCatalogModels(snapshot, routes);

    expect(models).toHaveLength(3);
    expect(new Set(models.map(model => model.id)).size).toBe(3);
    expect(models.map(model => model.label)).toEqual([
      'Grok 4.5 · 线路 1',
      'Grok 4.5 · 线路 2',
      'Grok 4.5 · 线路 3'
    ]);
    expect(models.map(model => model.pricing.inputCreditsPerMillion)).toEqual([1.8, 2.6, 4]);
    expect(JSON.stringify(models)).not.toContain('private-a');
    expect(JSON.stringify(models)).not.toContain('channelId');

    const resolved = await Promise.all(models.map(model => resolveNewApiRoutedCatalogModel(snapshot, routes, model.id, 'text')));
    expect(resolved.map(item => item?.route?.channelId)).toEqual([11, 22, 33]);
    expect(newApiKeyForRoute('sk-secret', resolved[1]?.route)).toBe('sk-secret-22');
  });

  it('resolves every published canvas video id without requiring an admin route snapshot', async () => {
    const videoIds = [
      'minimax_h3',
      'S-2.0满血-933',
      'S-2.0-720p-稳定',
      'S-2.0mini-官转',
      'S-2.0fast-官转',
      'S-videos-t-431-pro-720-5',
      'S-videos-t-431-fast-720-5',
      'runway-gen4.5',
      'kling-o3',
      'kling-o3-pro-v2v-reference',
      'kling-v3',
      'kling-v3-omni-v2v-create',
      'veo-3.1',
      'veo-3.1-fast',
      'veo-3.1-lite',
      'S-videos-f-933-pro-3',
      'S-videos-f-933-fast-3'
    ];
    const snapshot: NewApiCatalogSnapshot = {
      available: true,
      stale: false,
      version: 'canvas-video-models',
      pricingVersion: 'canvas-video-pricing',
      rules: [],
      imageCatalogEntries: [],
      models: videoIds.map((id, order) => ({
        id,
        upstreamModel: id,
        label: id,
        description: '',
        modality: 'video' as const,
        operation: 'generate' as const,
        order,
        endpoint: { method: 'POST' as const, path: '/api/v1/video', contentType: 'application/json' as const },
        parameters: [{ name: 'model', path: 'model', label: 'Model', type: 'string' as const, required: true, fixed: id }],
        pricing: { mode: 'fixed' as const, unit: 'request' as const, yuan: 0.01, credits: 1, quantityParameter: null }
      }))
    };
    const unavailableRoutes: NewApiAdminRouteSnapshot = {
      available: false,
      fetchedAt: '',
      routes: {},
      error: 'not configured'
    };

    const resolved = await Promise.all(videoIds.map(id => resolveNewApiRoutedCatalogModel(snapshot, unavailableRoutes, id, 'video')));

    expect(resolved.map(item => item?.requestedModelId)).toEqual(videoIds);
    expect(resolved.every(item => item?.route == null)).toBe(true);
  });

  it('prices native video models with a seconds quantity parameter', () => {
    const model: NewApiCatalogSnapshot['models'][number] = {
      id: 'kling-v3',
      upstreamModel: 'kling-v3',
      label: 'Kling V3',
      description: '',
      modality: 'video',
      operation: 'generate',
      order: 1,
      endpoint: { method: 'POST', path: '/api/v1/video', contentType: 'application/json' },
      parameters: [],
      pricing: { mode: 'fixed', unit: 'second', yuan: 0.1, credits: 10, quantityParameter: 'seconds' }
    };

    expect(newApiFixedCreditsForRequest(model, { duration: 8, seconds: 8 })).toBe(80);
  });
});
