import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNewApiImageRequestBody,
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  fetchNewApiPricingRules,
  fetchNewApiTaskOnce,
  fetchTrustedNewApiPricingCatalog,
  imageCatalogForNewApiSnapshot,
  newApiKeyForRoute,
  newApiFixedCreditsForRequest,
  newApiHasActiveRoute,
  newApiTextCreditsForUsage,
  newApiCreditsForModel,
  newApiCatalogAgeMs,
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

function publicImageCatalogFixture(input: {
  id: string;
  label: string;
  tags: string;
  order: number;
  pricing: Record<string, unknown>;
  resolution?: { name: 'resolution' | 'quality'; fixed?: string; options?: string[] };
  quality?: { fixed?: string; options?: string[] };
}) {
  const parameters: Array<Record<string, unknown>> = [
    { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: input.id },
    { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true }
  ];
  if (input.resolution) {
    parameters.push({
      name: input.resolution.name,
      path: input.resolution.name,
      label: '分辨率',
      type: 'string',
      required: false,
      ...(input.resolution.fixed ? { fixed: input.resolution.fixed } : {}),
      ...(input.resolution.options ? { options: input.resolution.options } : {})
    });
  }
  if (input.quality) {
    parameters.push({
      name: 'quality',
      path: 'quality',
      label: '质量',
      type: 'string',
      required: false,
      ...(input.quality.fixed ? { fixed: input.quality.fixed } : {}),
      ...(input.quality.options ? { options: input.quality.options } : {})
    });
  }
  parameters.push(
    { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, options: ['auto', '1:1', '16:9'] },
    { name: 'n', path: 'n', label: '生成张数', type: 'integer', required: false, fixed: 1 }
  );
  return {
    id: input.id,
    label: input.label,
    description: `${input.label} 公开能力说明`,
    modality: 'image',
    operation: 'generate',
    order: input.order,
    selectable: true,
    tags: input.tags,
    public: {
      id: input.id,
      label: input.label,
      description: `${input.label} 公开能力说明`
    },
    parameters,
    pricing: input.pricing
  };
}

describe('newapi image upstream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads reviewed image capabilities and preserves fractional credits', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0]) => jsonResponse({
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
            quantity_parameter: 'quality',
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
    const publicPro = snapshot.models.find(model => model.id === 'image2-pro');
    expect(publicPro?.pricing.quantityParameter).toBe('resolution');
    expect(publicPro?.pricing.tiers?.map(tier => tier.when)).toEqual([
      { resolution: '1k' },
      { resolution: '2k' },
      { resolution: '4k' }
    ]);
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
    const stalePublicModels = publicNewApiCatalogModels({ ...snapshot, stale: true });
    expect(stalePublicModels.some(model => model.modality === 'image')).toBe(false);
    expect(stalePublicModels.some(model => model.id === 'chat-public')).toBe(true);
    expect(resolveNewApiCatalogModel(snapshot, 'image2-economy', 'image')?.upstreamModel).toBe('gpt-image-2-chat');
    expect(resolveNewApiCatalogModel(snapshot, 'flux-public', 'image')).toBeNull();
    const video = resolveNewApiCatalogModel(snapshot, 'motion-video', 'video');
    expect(video && newApiFixedCreditsForRequest(video, { duration: 10, resolution: '720p' })).toBe(16);
    const textModel = resolveNewApiCatalogModel(snapshot, 'creative-5-5', 'text');
    expect(textModel && newApiTextCreditsForUsage(textModel, 100_000, 10_000)).toBe(1.6);
  });

  it('keeps image2-A resolution and quality prices independent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'image2-a-quality-pricing',
      models: [{
        ...publicImageCatalogFixture({
        id: 'gpt-image-2',
        label: 'Image2 A',
        tags: 'image,image2,1k,2k,4k,quality',
        order: 20,
        resolution: { name: 'resolution', options: ['1k', '2k', '4k'] },
        quality: { options: ['low', 'standard', 'high'] },
        pricing: {
          mode: 'tiered',
          unit: 'image',
          currency: 'CNY',
          yuan: 0.04,
          credits: 4,
          tiers: [
            { when: { resolution: '1k' }, yuan: 0.04, credits: 4 },
            { when: { resolution: '2k' }, yuan: 0.05, credits: 5 },
            { when: { resolution: '4k' }, yuan: 0.06, credits: 6 },
            { when: { resolution: '1k', quality: 'high' }, yuan: 0.06, credits: 6 },
            { when: { resolution: '2k', quality: 'high' }, yuan: 0.07, credits: 7 },
            { when: { resolution: '4k', quality: 'high' }, yuan: 0.08, credits: 8 }
          ]
        }
        }),
        public: {
          id: 'image2-A',
          label: 'Image2 A',
          description: 'Public image generation model'
        }
      }]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://image2-a-pricing.test', { force: true });
    const rule = snapshot.rules.find(candidate => candidate.model === 'gpt-image-2');

    expect(rule?.creditsByResolution).toEqual({ '1k': 4, '2k': 5, '4k': 6 });
    expect(rule?.creditsByResolutionAndQuality).toEqual({
      '1k': { high: 6 },
      '2k': { high: 7 },
      '4k': { high: 8 }
    });
    expect(snapshot.imageCatalogEntries[0]?.id).toBe('image2');
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2', '4k', 'low')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2', '4k', 'standard')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2', '4k', 'high')).toBe(8);
  });

  it('builds all ten live image entries and prices from the production public catalog shape', async () => {
    const models = [
      publicImageCatalogFixture({
        id: 'gpt-image-2-1k',
        label: '全能模型2 · 特价 1K',
        tags: 'image,openai,image2,special,per-image,1k,quality',
        order: 20,
        resolution: { name: 'resolution', fixed: '1k' },
        quality: { options: ['low', 'medium', 'high'] },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.022, credits: 2.2 }
      }),
      publicImageCatalogFixture({
        id: 'gpt-image-2',
        label: '全能模型2 · 标准 1K',
        tags: 'image,openai,image2,1k',
        order: 21,
        resolution: { name: 'resolution', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.055, credits: 5.5 }
      }),
      publicImageCatalogFixture({
        id: 'gpt-image-2-ext',
        label: '全能模型2 · 高质量 2K/4K',
        tags: 'image,openai,image2,1k,2k,4k',
        order: 22,
        resolution: { name: 'quality', options: ['2k', '4k'] },
        pricing: {
          mode: 'tiered',
          unit: 'image',
          currency: 'CNY',
          yuan: 0.08,
          credits: 8,
          tiers: [
            { when: { quality: '2k' }, yuan: 0.15, credits: 15 },
            { when: { quality: '4k' }, yuan: 0.2, credits: 20 }
          ]
        }
      }),
      publicImageCatalogFixture({
        id: 'gpt-image-2-free',
        label: '全能模型2 · 免费 1K',
        tags: 'image,openai,image2,per-image,1k',
        order: 22,
        resolution: { name: 'resolution', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0, credits: 0 }
      }),
      publicImageCatalogFixture({
        id: 'gpt-image-2-4k-Adobe',
        label: '全能模型2 · 4K Adobe',
        tags: 'image,openai,image2,fast,per-image,4k,standard-quality',
        order: 24,
        quality: { fixed: 'standard' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.06, credits: 6 }
      }),
      publicImageCatalogFixture({
        id: 'nano-banana',
        label: '香蕉 · 标准 1K',
        tags: 'image,banana,nano-banana,1k',
        order: 40,
        resolution: { name: 'quality', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.06, credits: 6 }
      }),
      publicImageCatalogFixture({
        id: 'nano-banana-fast',
        label: '香蕉 · 极速 1K',
        tags: 'image,banana,nano-banana,fast,1k',
        order: 41,
        resolution: { name: 'quality', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.042, credits: 4.2 }
      }),
      publicImageCatalogFixture({
        id: 'nano-banana-2-lite',
        label: '香蕉 · Lite 1K',
        tags: 'image,banana,nano-banana,lite,1k',
        order: 42,
        resolution: { name: 'quality', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.042, credits: 4.2 }
      }),
      publicImageCatalogFixture({
        id: 'nano-banana-pro',
        label: '香蕉 · 专业 1K/2K/4K',
        tags: 'image,banana,nano-banana,pro,1k,2k,4k',
        order: 43,
        resolution: { name: 'quality', options: ['1k', '2k', '4k'] },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.06, credits: 6 }
      }),
      publicImageCatalogFixture({
        id: 'nano-banana-2',
        label: '香蕉 · 2代 1K/2K/4K',
        tags: 'image,banana,nano-banana,2,1k,2k,4k',
        order: 44,
        resolution: { name: 'quality', options: ['1k', '2k', '4k'] },
        pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.06, credits: 6 }
      })
    ];
    expect(models.every(model => !('family' in model) && !('integrations' in model))).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'production-public-shape',
      pricing_version: '',
      models
    })));

    const snapshot = await fetchNewApiModelCatalog('https://production-public-shape.test', { force: true });
    expect(snapshot.pricingVersion).toBe('');
    expect(snapshot.rules).toHaveLength(10);
    expect(snapshot.imageCatalogEntries).toHaveLength(10);
    expect(new Set(snapshot.imageCatalogEntries.map(model => model.id))).toEqual(new Set([
      'image2-economy',
      'image2',
      'image2-pro',
      'image2-free',
      'image2-4k-fast',
      'lingtu',
      'lingtu-fast',
      'lingtu-lite',
      'lingtu-pro',
      'lingtu-2'
    ]));
    expect(snapshot.imageCatalogEntries.map(model => model.uiFamily).filter(family => family === 'gim2')).toHaveLength(5);
    expect(snapshot.imageCatalogEntries.map(model => model.uiFamily).filter(family => family === 'banana')).toHaveLength(5);
    expect(snapshot.imageCatalogEntries.find(model => model.id === 'image2-4k-fast')?.label).toBe('全能模型2 · 4K');
    expect(JSON.stringify(snapshot.imageCatalogEntries.map(model => ({
      id: model.id,
      label: model.label,
      description: model.description
    })))).not.toContain('Adobe');
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-1k', '1k')).toBe(2.2);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2', '1k')).toBe(5.5);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-ext', '1k')).toBe(8);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-ext', '2k')).toBe(15);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-ext', '4k')).toBe(20);
    expect(snapshot.rules.find(rule => rule.model === 'gpt-image-2-ext')?.parameters.find(parameter => parameter.name === 'resolution')?.options)
      .toEqual(['1k', '2k', '4k']);
    expect(snapshot.rules.find(rule => rule.model === 'gpt-image-2-ext')?.parameters.some(parameter => parameter.name === 'quality'))
      .toBe(false);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-free', '1k')).toBe(0);
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-4k-Adobe', '4k')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'nano-banana', '1k')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'nano-banana-fast', '1k')).toBe(4.2);
    expect(newApiCreditsForModel(snapshot.rules, 'nano-banana-2-lite', '1k')).toBe(4.2);
    expect(newApiCreditsForModel(snapshot.rules, 'nano-banana-pro', '4k')).toBe(6);
    expect(newApiCreditsForModel(snapshot.rules, 'nano-banana-2', '4k')).toBe(6);
    for (const rule of snapshot.rules.filter(rule => rule.model.startsWith('nano-banana'))) {
      expect(rule.parameters).toContainEqual(expect.objectContaining({
        name: 'images',
        path: 'images',
        max_items: 14
      }));
    }
  });

  it('infers fixed low quality from public parameters without integration metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'public-fixed-low',
      models: [publicImageCatalogFixture({
        id: 'gpt-image-2-low',
        label: '全能模型2 · Low 1K',
        tags: 'image,image2,1k',
        order: 20,
        resolution: { name: 'resolution', fixed: '1k' },
        quality: { fixed: 'low' },
        pricing: { mode: 'fixed', unit: 'image', yuan: 0.01, credits: 1 }
      })]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://public-fixed-low.test', { force: true });
    expect(snapshot.imageCatalogEntries).toContainEqual(expect.objectContaining({
      upstream: 'gpt-image-2-low',
      fixedQualityLow: true
    }));
  });

  it('uses only a recent exact cache when a required refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const cachedModel = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: '全能模型2 · 标准 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        version: 'fresh-1',
        pricing_version: 'pricing-1',
        models: [cachedModel]
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 502));
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewApiModelCatalog('https://fresh-required.test', { force: true });
    vi.setSystemTime(new Date('2026-07-22T00:04:00.000Z'));
    const cached = await fetchNewApiModelCatalog('https://fresh-required.test', {
      force: true,
      requireFresh: true
    });
    expect(cached.stale).toBe(true);
    expect(newApiCreditsForModel(cached.rules, 'gpt-image-2', '1k')).toBe(5.5);

    vi.setSystemTime(new Date('2026-07-22T00:06:00.000Z'));
    await expect(fetchNewApiModelCatalog('https://fresh-required.test', {
      force: true,
      requireFresh: true
    })).rejects.toThrow('model catalog 502');
  });

  it('uses the normal catalog endpoint and shares one trusted pricing read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:05:00.000Z'));
    const image2 = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: '全能模型2 · 标准 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0]) => jsonResponse({
      success: true,
      stale: true,
      fetched_at: '2026-07-22T00:02:00.000Z',
      version: 'trusted-lkg',
      pricing_version: 'trusted-lkg-price',
      models: [image2]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      fetchTrustedNewApiPricingCatalog('https://trusted-pricing.test'),
      fetchTrustedNewApiPricingCatalog('https://trusted-pricing.test')
    ]);

    expect(first.version).toBe('trusted-lkg');
    expect(second.version).toBe('trusted-lkg');
    expect(newApiCatalogAgeMs(first)).toBe(3 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('refresh=1');
  });

  it('falls back to a recent exact LKG when a normal pricing read fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const image2 = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: '全能模型2 · 标准 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        stale: true,
        fetched_at: '2026-07-22T00:00:00.000Z',
        version: 'recent-exact-lkg',
        pricing_version: 'recent-exact-price',
        models: [image2]
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'cold worker' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTrustedNewApiPricingCatalog('https://trusted-lkg.test');
    vi.setSystemTime(new Date('2026-07-22T00:00:06.000Z'));
    const fallback = await fetchTrustedNewApiPricingCatalog('https://trusted-lkg.test');

    expect(fallback.stale).toBe(true);
    expect(fallback.version).toBe('recent-exact-lkg');
    expect(newApiCreditsForModel(fallback.rules, 'gpt-image-2', '1k')).toBe(5.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => !String(call[0]).includes('refresh=1'))).toBe(true);
  });

  it('rejects an upstream LKG older than the pricing trust window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:10:00.000Z'));
    const image2 = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: '全能模型2 · 标准 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({
      success: true,
      stale: true,
      fetched_at: '2026-07-22T00:04:59.999Z',
      version: 'expired-lkg',
      pricing_version: 'expired-price',
      models: [image2]
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTrustedNewApiPricingCatalog('https://expired-pricing.test'))
      .rejects.toThrow('image pricing catalog is too old');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('refresh=1');
  });

  it('revalidates a stale catalog snapshot promptly instead of retaining it for the normal cache window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const image2 = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: 'Image2 standard 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        stale: true,
        version: 'catalog-stale',
        pricing_version: 'pricing-stale',
        models: [image2]
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        version: 'catalog-fresh',
        pricing_version: 'pricing-fresh',
        models: [image2]
      }));
    vi.stubGlobal('fetch', fetchMock);

    const stale = await fetchNewApiModelCatalog('https://stale-revalidate.test', { force: true });
    expect(stale.stale).toBe(true);

    const cached = await fetchNewApiModelCatalog('https://stale-revalidate.test');
    expect(cached.stale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-07-22T00:00:05.001Z'));
    const fresh = await fetchNewApiModelCatalog('https://stale-revalidate.test');
    expect(fresh.stale).toBe(false);
    expect(fresh.version).toBe('catalog-fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replace a complete image pricing cache with a partial successful response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const image2 = publicImageCatalogFixture({
      id: 'gpt-image-2',
      label: '全能模型2 · 标准 1K',
      tags: 'image,image2,1k',
      order: 1,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.055, credits: 5.5 }
    });
    const lingtu = publicImageCatalogFixture({
      id: 'nano-banana',
      label: '香蕉 · Standard 1K',
      tags: 'image,banana,1k',
      order: 2,
      resolution: { name: 'resolution', fixed: '1k' },
      pricing: { mode: 'fixed', unit: 'image', yuan: 0.06, credits: 6 }
    });
    const partialResponse = {
      success: true,
      version: 'catalog-partial',
      pricing_version: 'pricing-partial',
      models: [image2]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        version: 'catalog-complete',
        pricing_version: 'pricing-complete',
        models: [image2, lingtu]
      }))
      .mockResolvedValueOnce(jsonResponse(partialResponse))
      .mockResolvedValueOnce(jsonResponse(partialResponse));
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewApiModelCatalog('https://partial-refresh.test', { force: true });
    vi.setSystemTime(new Date('2026-07-22T00:04:00.000Z'));
    const fallback = await fetchNewApiModelCatalog('https://partial-refresh.test', {
      force: true,
      requireFresh: true
    });

    expect(fallback.version).toBe('catalog-complete');
    expect(fallback.pricingVersion).toBe('pricing-complete');
    expect(fallback.stale).toBe(true);
    expect(newApiCreditsForModel(fallback.rules, 'nano-banana', '1k')).toBe(6);

    const stillCached = await fetchNewApiModelCatalog('https://partial-refresh.test');
    expect(stillCached.version).toBe('catalog-complete');
    expect(stillCached.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-07-22T00:06:00.000Z'));
    await expect(fetchNewApiModelCatalog('https://partial-refresh.test', {
      force: true,
      requireFresh: true
    })).rejects.toThrow('model catalog image pricing coverage regressed');
  });

  it('shares concurrent forced catalog refreshes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      version: 'single-flight',
      pricing_version: 'single-flight-price',
      models: []
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      fetchNewApiModelCatalog('https://single-flight.test', { force: true }),
      fetchNewApiModelCatalog('https://single-flight.test', { force: true })
    ]);

    expect(first.version).toBe('single-flight');
    expect(second.version).toBe('single-flight');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps advertised free-route pricing internal after the route is retired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-free-image',
      pricing_version: 'pricing-free-image',
      models: [],
      unclassified_models: [{
        id: 'gpt-image-2-free',
        tags: 'image,openai,image2,per-image,1k,ratios',
        reason: 'missing_capability_definition'
      }]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://free-image.test', { force: true });
    expect(snapshot.imageCatalogEntries).toContainEqual(expect.objectContaining({
      id: 'image2-free',
      upstream: 'gpt-image-2-free',
      label: '全能模型2 · 免费 1K',
      resolutions: ['1k'],
      defaultCredits: 0
    }));
    expect(newApiCreditsForModel(snapshot.rules, 'gpt-image-2-free', '1k')).toBe(0);
    expect(resolveNewApiCatalogModel(snapshot, 'image2-free', 'image')).toBeNull();
    const publicModels = publicNewApiCatalogModels(snapshot);
    expect(publicModels).not.toContainEqual(expect.objectContaining({ id: 'image2-free' }));
    const noActiveRoutes: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: 'now',
      routes: {
        'gpt-image-2-free': [{
          channelId: 1,
          channelName: 'disabled',
          status: 'disabled',
          enabled: false,
          groups: ['auto'],
          actualModel: 'gpt-image-2-free',
          priority: 1,
          weight: 1,
          upstreamHost: 'example.test'
        }]
      },
      error: null
    };
    expect(await publicNewApiRoutedCatalogModels(snapshot, noActiveRoutes)).not.toContainEqual(
      expect.objectContaining({ id: 'image2-free' })
    );
    const activeRoutes: NewApiAdminRouteSnapshot = {
      ...noActiveRoutes,
      routes: {
        'gpt-image-2-free': [{
          ...noActiveRoutes.routes['gpt-image-2-free'][0],
          status: 'active',
          enabled: true
        }]
      }
    };
    expect(await publicNewApiRoutedCatalogModels(snapshot, activeRoutes)).not.toContainEqual(
      expect.objectContaining({ id: 'image2-free' })
    );
  });

  it('does not resurrect reviewed API image models when the live catalog explicitly returns none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-empty',
      pricing_version: 'pricing-empty',
      models: [],
      unclassified_models: [
        { reason: 'missing_capability_definition', count: 14 },
        { reason: 'missing_retail_price', count: 49 }
      ]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://empty-live-catalog.test', { force: true });
    const entries = imageCatalogForNewApiSnapshot(snapshot);
    const newApiIds = entries
      .filter((entry) => entry.provider === 'newapi')
      .map((entry) => entry.id);

    expect(newApiIds).toEqual([]);
  });

  it('does not refill models omitted by a partial live image catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-partial',
      models: [publicImageCatalogFixture({
        id: 'gpt-image-2',
        label: '全能模型2 · 实时 1K',
        tags: 'image,image2,1k',
        order: 21,
        resolution: { name: 'resolution', fixed: '1k' },
        pricing: { mode: 'fixed', unit: 'image', yuan: 0.057, credits: 5.7 }
      })]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://partial-live-catalog.test', { force: true });
    const newApiEntries = imageCatalogForNewApiSnapshot(snapshot)
      .filter((entry) => entry.provider === 'newapi');

    expect(newApiEntries).toEqual([expect.objectContaining({
      id: 'image2',
      label: '全能模型2 · 1K',
      defaultCredits: 5.7
    })]);
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

  it('keeps the public fixed 4K image model visible when catalog and route IDs use legacy aliases', async () => {
    const model = publicImageCatalogFixture({
      id: 'image2-4k-fast',
      label: 'GPT Image 2 Fast 4K',
      tags: 'image,image2,fast,4k',
      order: 24,
      quality: { fixed: 'standard' },
      pricing: { mode: 'fixed', unit: 'image', currency: 'CNY', yuan: 0.06, credits: 6 }
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-fixed-4k-casing',
      models: [model]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://fixed-4k-casing.test', { force: true });
    const routes: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: 'now',
      error: null,
      routes: {
        'gpt-image-2-4K-Adobe': [{
          channelId: 1,
          channelName: 'active',
          status: 'active',
          enabled: true,
          groups: [],
          actualModel: 'gpt-image-2-4k-adobe',
          priority: 1,
          weight: 1,
          upstreamHost: 'example.test'
        }]
      }
    };

    expect(newApiHasActiveRoute(routes, 'image2-4k-fast')).toBe(true);
    expect(await publicNewApiRoutedCatalogModels(snapshot, routes)).toContainEqual(
      expect.objectContaining({ id: 'image2-4k-fast', modality: 'image' })
    );
  });

  it('never retries a paid image request after an explicit failure', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'excessive system load' } }, 400)
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2', prompt: 'apple', resolution: '1k', quality: 'standard'
    })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks a transport interruption as unknown without retrying', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection closed');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2', prompt: 'apple', resolution: '1k', quality: 'standard'
    })).rejects.toMatchObject({ code: 'UPSTREAM_OUTCOME_UNKNOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('extracts an immediate image response from compatible generation API', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect(body.model).toBe('image2k4k');
      expect(body.prompt).toBe('apple');
      expect(body.resolution).toBe('4k');
      expect(body.quality).toBe('low');
      expect(body.images).toEqual(['https://ref.test/a.png']);
      return jsonResponse({ data: [{ url: 'https://image.test/out.png' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const observedRequestIds: string[] = [];
    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'standard',
      fixedQualityLow: true,
      refImageUrls: ['https://ref.test/a.png'],
      clientRequestId: 'job-correlation-1',
      onRequestId: (requestId) => { observedRequestIds.push(requestId); }
    });

    const submitCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(submitCall[0])).toBe('https://newapi-unit.test/v1/images/generations');
    expect((submitCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer unit-key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'job-correlation-1',
      'X-Client-Request-Id': 'job-correlation-1'
    });
    expect(observedRequestIds).toEqual([]);
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

  it('normalizes only exact legacy resolution-valued quality parameters', () => {
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
      resolution: '4k',
      quality: 'low',
      size: '3:1',
      images: ['a', 'b'],
      n: 4
    });
  });

  it('keeps current quality and resolution fields independent', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'high',
      fixedQualityLow: true,
      catalogParameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'image2k4k' },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, options: ['2k', '4k'] },
        { name: 'quality', path: 'quality', label: '质量', type: 'string', required: false, fixed: 'low' }
      ]
    });

    expect(body).toEqual({
      model: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'low'
    });
  });

  it('omits quality for the extended Image2 model and keeps its default image quality', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'gpt-image-2-ext',
      prompt: 'apple',
      resolution: '4k',
      quality: 'high'
    });

    expect(body).toMatchObject({
      model: 'gpt-image-2-ext',
      prompt: 'apple',
      resolution: '4k'
    });
    expect(body).not.toHaveProperty('quality');
  });

  it('enforces fixed Image2 qualities when the catalog omits them', () => {
    const shared = [
      { name: 'model', path: 'model', label: '模型', type: 'string' as const, required: true },
      { name: 'prompt', path: 'prompt', label: '提示词', type: 'string' as const, required: true },
      { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string' as const, required: false }
    ];
    const economical = buildNewApiImageRequestBody({
      upstreamModel: 'image2k4k',
      prompt: 'apple',
      resolution: '4k',
      quality: 'high',
      catalogParameters: shared
    });
    const fixed4k = buildNewApiImageRequestBody({
      upstreamModel: 'gpt-image-2-4K-Adobe',
      prompt: 'apple',
      resolution: '4k',
      quality: 'low',
      catalogParameters: shared
    });

    expect(economical.quality).toBe('low');
    expect(fixed4k.quality).toBe('standard');
  });

  it('publishes selectable banana quality separately from resolution', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'nano-banana-pro',
      prompt: 'apple',
      resolution: '4k',
      quality: 'high',
      catalogParameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false }
      ]
    });

    expect(body).toMatchObject({ resolution: '4k', quality: 'high' });
  });

  it('keeps all banana references even when an old catalog omits image capability', () => {
    const refs = Array.from({ length: 16 }, (_, index) => `https://ref.test/${index}.png`);
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'nano-banana-pro',
      prompt: 'product shot',
      resolution: '4k',
      quality: 'medium',
      refImageUrls: refs,
      catalogParameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'nano-banana-pro' },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, options: ['1k', '2k', '4k'] },
        { name: 'quality', path: 'quality', label: '质量', type: 'string', required: false, options: ['low', 'medium', 'high'] }
      ]
    });

    expect(body).toMatchObject({
      model: 'nano-banana-pro',
      prompt: 'product shot',
      resolution: '4k',
      quality: 'medium',
      images: refs.slice(0, 14)
    });
  });

  it('submits text-only 4K requests with the fixed official parameters', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'image2-4k-fast',
      prompt: 'a clean product photo',
      resolution: '4k',
      quality: 'high',
      size: '16:9',
      count: 1,
      catalogParameters: [
        { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'image2-4k-fast' },
        { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
        { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, fixed: '4k' },
        { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, default: 'auto', options: ['auto', '16:9'] },
        { name: 'quality', path: 'quality', label: '质量', type: 'string', required: false, fixed: 'standard' },
        { name: 'n', path: 'n', label: '生成张数', type: 'integer', required: false, fixed: 1 }
      ]
    });
    expect(body).toEqual({
      model: 'image2-4k-fast',
      prompt: 'a clean product photo',
      resolution: '4k',
      size: '16:9',
      quality: 'standard',
      n: 1
    });
    expect(body).not.toHaveProperty('images');
  });

  it('writes output quantity through a catalog count parameter alias', () => {
    const body = buildNewApiImageRequestBody({
      upstreamModel: 'count-model',
      prompt: 'three variations',
      resolution: '1k',
      quality: 'standard',
      count: 3,
      catalogParameters: [
        { name: 'model', path: 'model', label: 'Model', type: 'string', required: true },
        { name: 'prompt', path: 'prompt', label: 'Prompt', type: 'string', required: true },
        { name: 'count', path: 'count', label: 'Count', type: 'integer', required: false, min: 1, max: 4 }
      ]
    });

    expect(body).toEqual({
      model: 'count-model',
      prompt: 'three variations',
      count: 3
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

  it('keeps the last confirmed route state when a route refresh temporarily fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        fetched_at: '2026-07-22T00:00:00.000Z',
        routes: {
          'gpt-image-2-free': [{
            channel_id: 11,
            channel_name: 'free-active',
            status: 'active',
            enabled: true,
            groups: ['default'],
            actual_model: 'gpt-image-2-free',
            priority: 1,
            weight: 1,
            upstream_host: 'active.example.test'
          }],
          'gpt-image-2-chat': [{
            channel_id: 12,
            channel_name: 'economy-disabled',
            status: 'disabled',
            enabled: false,
            groups: ['default'],
            actual_model: 'gpt-image-2-chat',
            priority: 1,
            weight: 1,
            upstream_host: 'disabled.example.test'
          }]
        }
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary outage' }, 502));
    vi.stubGlobal('fetch', fetchMock);

    await fetchNewApiAdminRoutes('https://route-stale-cache.test', 'route-secret', { force: true });
    const fallback = await fetchNewApiAdminRoutes('https://route-stale-cache.test', 'route-secret', { force: true });

    expect(fallback.available).toBe(true);
    expect(fallback.error).toBe('route catalog 502');
    expect(newApiHasActiveRoute(fallback, 'gpt-image-2-free')).toBe(true);
    expect(newApiHasActiveRoute(fallback, 'gpt-image-2-chat')).toBe(false);
  });

  it('does not request admin routes when the dedicated secret is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchNewApiAdminRoutes('https://route-catalog-missing.test', '');

    expect(snapshot.available).toBe(false);
    expect(snapshot.error).toContain('未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides video models without an active route and restores them with one', async () => {
    const snapshot: NewApiCatalogSnapshot = {
      available: true,
      stale: false,
      version: 'catalog-video-routes',
      pricingVersion: 'pricing-video-routes',
      rules: [],
      imageCatalogEntries: [],
      models: [{
        id: 'veo-fast',
        upstreamModel: 'veo-3.1-fast-flex',
        label: 'Veo Fast',
        description: '',
        modality: 'video',
        operation: 'generate',
        order: 1,
        endpoint: { method: 'POST', path: '/v1/videos', contentType: 'application/json' },
        parameters: [],
        pricing: { mode: 'fixed', unit: 'request', credits: 35 }
      }]
    };
    const unavailable: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: '2026-07-28T00:00:00.000Z',
      error: null,
      routes: {}
    };

    expect(await publicNewApiRoutedCatalogModels(snapshot, unavailable)).toEqual([]);
    const available: NewApiAdminRouteSnapshot = {
      ...unavailable,
      routes: {
        'veo-3.1-fast-flex': [{
          channelId: 85,
          channelName: 'video-relay',
          status: 'active',
          enabled: true,
          groups: ['default'],
          actualModel: 'veo-3.1-fast-flex',
          priority: 10,
          weight: 1,
          upstreamHost: 'video.example.test'
        }]
      }
    };
    expect(await publicNewApiRoutedCatalogModels(snapshot, available)).toEqual([
      expect.objectContaining({ id: 'veo-fast', modality: 'video' })
    ]);
  });

  it('projects one public model without exposing route count, order, or route pricing', async () => {
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

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'grok-4.5',
      label: 'Grok 4.5',
      pricing: {
        mode: 'token',
        unit: 'token',
        inputCreditsPerMillion: 1.8,
        outputCreditsPerMillion: 5.4
      }
    });
    const serialized = JSON.stringify(models).toLowerCase();
    for (const privateValue of [
      'private-a', 'private-b', 'private-c', 'channelid', 'route-a',
      'priority', 'weight', 'inputmultiplier', 'outputmultiplier', '线路'
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    const resolved = await resolveNewApiRoutedCatalogModel(snapshot, routes, models[0].id, 'text');
    expect(resolved?.route).toBeNull();
    expect(newApiKeyForRoute('sk-secret', resolved?.route)).toBe('sk-secret');
  });
});
