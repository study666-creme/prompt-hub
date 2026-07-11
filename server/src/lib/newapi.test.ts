import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNewApiImageRequestBody,
  fetchNewApiModelCatalog,
  fetchNewApiPricingRules,
  fetchNewApiTaskOnce,
  newApiFixedCreditsForRequest,
  newApiTextCreditsForUsage,
  newApiCreditsForModel,
  publicNewApiCatalogModels,
  resolveNewApiCatalogModel,
  submitNewApiImageJob
} from './newapi';

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
            { name: 'quality', path: 'quality', label: '分辨率', type: 'string', required: false, options: ['2k', '4k'] },
            { name: 'size', path: 'size', label: '比例', type: 'string', required: false, options: ['1:1', '16:9'] }
          ],
          pricing: {
            mode: 'tiered',
            unit: 'image',
            yuan: 0.15,
            credits: 15,
            tiers: [
              { when: { quality: '2k' }, yuan: 0.15, credits: 15 },
              { when: { quality: '4k' }, yuan: 0.2, credits: 20 }
            ]
          }
        },
        {
          id: 'gpt-image-2-chat',
          label: 'GPT Image 2 Chat',
          public: { id: 'image2-chat', label: 'Image2 Chat', description: '聊天生图。' },
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
    expect(newApiCreditsForModel(rules, 'gpt-image-2')).toBe(5.5);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext', '2k')).toBe(15);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext', '4k')).toBe(20);
    expect(newApiCreditsForModel(rules, 'image2k4k', '2k')).toBe(5.5);
    expect(newApiCreditsForModel(rules, 'image2k4k', '4k')).toBe(9);
    expect(newApiCreditsForModel(rules, 'chat-only')).toBeNull();

    const snapshot = await fetchNewApiModelCatalog('https://pricing-unit.test/v1');
    expect(snapshot.imageCatalogEntries.map(model => model.id)).toEqual(['image2', 'image2-pro', 'image2-hd']);
    expect(snapshot.imageCatalogEntries.map(model => model.label)).toEqual([
      '全能模型2 · 1K',
      '全能模型2 · 高质量 2K/4K',
      '全能模型2 · 经济 2K/4K'
    ]);
    expect(snapshot.imageCatalogEntries[2].fixedQualityLow).toBe(true);
    expect(resolveNewApiCatalogModel(snapshot, 'image2', 'image')?.upstreamModel).toBe('gpt-image-2');
    expect(resolveNewApiCatalogModel(snapshot, 'gpt-image-2', 'image')?.id).toBe('image2');
    expect(publicNewApiCatalogModels(snapshot)).toContainEqual(expect.objectContaining({
      id: 'chat-public',
      label: '文字模型',
      modality: 'text'
    }));
    expect(publicNewApiCatalogModels(snapshot).some(model => 'upstreamModel' in model)).toBe(false);
    expect(publicNewApiCatalogModels(snapshot).some(model => model.id === 'image2-chat')).toBe(false);
    expect(publicNewApiCatalogModels(snapshot).some(model => model.id === 'flux-public')).toBe(false);
    expect(resolveNewApiCatalogModel(snapshot, 'image2-chat', 'image')).toBeNull();
    expect(resolveNewApiCatalogModel(snapshot, 'flux-public', 'image')).toBeNull();
    const video = resolveNewApiCatalogModel(snapshot, 'motion-video', 'video');
    expect(video && newApiFixedCreditsForRequest(video, { duration: 10, resolution: '720p' })).toBe(16);
    const textModel = resolveNewApiCatalogModel(snapshot, 'creative-5-5', 'text');
    expect(textModel && newApiTextCreditsForUsage(textModel, 100_000, 10_000)).toBe(1.6);
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
      refImageUrls: ['https://ref.test/a.png']
    });

    const submitCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(submitCall[0])).toBe('https://newapi-unit.test/v1/images/generations');
    expect((submitCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer unit-key',
      'Content-Type': 'application/json'
    });
    expect(result.taskId).toMatch(/^newapi-/);
    expect(result.imageUrl).toBe('https://image.test/out.png');
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
});
