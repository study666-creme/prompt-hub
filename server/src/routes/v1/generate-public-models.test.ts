import { describe, expect, it } from 'vitest';
import { mergeImageModelSettings } from '../../lib/image-model-settings';
import { NEWAPI_IMAGE_MODEL_CATALOG } from '../../lib/image-models-catalog';
import type { NewApiAdminRouteSnapshot } from '../../lib/newapi';
import { publicModelPayload } from './generate';

describe('public image model projection', () => {
  it('uses neutral MJ ids and omits private routing fields', () => {
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: true,
          stale: false,
          version: 'midjourney-public-catalog',
          pricingVersion: '',
          models: [],
          rules: [],
          imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG.filter((model) => model.uiFamily === 'midjourney')
        }
      }
    );
    const mjModels = models.filter((model) => model.uiFamily === 'midjourney');

    expect(models).toHaveLength(3);
    expect(mjModels.map((model) => model.id)).toEqual([
      'mj-v81',
      'mj-v7',
      'mj-niji7'
    ]);
    expect(mjModels.every((model) => model.creditsPerCall === 40)).toBe(true);
    expect(mjModels[0]?.parameters).toContainEqual(expect.objectContaining({
      name: 'resolution',
      label: '清晰度',
      options: ['1k']
    }));
    expect(mjModels[0]?.parameters).toContainEqual(expect.objectContaining({
      name: 'speed',
      fixed: 'relax'
    }));
    for (const model of models) {
      expect(model).not.toHaveProperty('provider');
      expect(model).not.toHaveProperty('upstream');
      expect(model).not.toHaveProperty('upstreamPoints');
    }
    const publicKeys = new Set<string>();
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        publicKeys.add(key.toLowerCase());
        visit(child);
      }
    };
    visit(models);
    for (const privateKey of [
      'upstreammodel', 'provider', 'channelid', 'channelname', 'routes',
      'priority', 'weight', 'yuan', 'base', 'listprice', 'promoprice',
      'applieddiscount', 'discountlabel', 'modeldiscountpercent',
      'modeldiscountlabel', 'catalogversion', 'pricingversion'
    ]) {
      expect(publicKeys.has(privateKey), `private public key: ${privateKey}`).toBe(false);
    }
    const publicJson = JSON.stringify(models).toLowerCase();
    for (const privateIdentity of [
      'apimart',
      'grsai',
      'thinkai',
      'ithink',
      'mooko',
      'adobe',
      'upstreamhost',
      'channelid',
      'channelname'
    ]) {
      expect(publicJson).not.toContain(privateIdentity);
    }
  });

  it('ignores unreviewed model labels and private parameter metadata', () => {
    const settings = mergeImageModelSettings({
      globalDiscountPercent: 100,
      models: {
        image2: {
          displayName: 'Private Provider · internal route 7',
          status: 'maintenance'
        }
      }
    });
    const models = publicModelPayload(settings, null, false, {
      newApiCatalog: {
        available: true,
        stale: false,
        version: 'internal-catalog-version',
        pricingVersion: 'internal-pricing-version',
        models: [],
        rules: [{
          model: 'gpt-image-2',
          credits: 5.5,
          description: 'private upstream price',
          tags: 'provider,route',
          label: 'Private Provider',
          modality: 'image',
          parameters: [
            { name: 'model', path: 'model', label: 'Upstream model', type: 'string', required: true, fixed: 'private-model-id' },
            { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
            { name: 'channel_id', path: 'channel_id', label: 'Route', type: 'integer', required: false, default: 7 }
          ]
        }],
        imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG
      }
    });
    const image2 = models.find(model => model.id === 'image2');
    expect(image2).toBeTruthy();
    expect(image2?.label).toBe('全能模型2 · 1K');
    expect(image2?.parameters.some(parameter => parameter.name === 'channel_id')).toBe(false);
    expect(image2?.parameters.find(parameter => parameter.name === 'model')?.fixed).toBe('image2');
    expect(JSON.stringify(image2).toLowerCase()).not.toMatch(/private provider|upstream price|internal route|private-model-id/);
  });

  it('does not refill models omitted by a partial live catalog', () => {
    const settings = mergeImageModelSettings({
      globalDiscountPercent: 100,
      models: {
        'newapi-gpt-image-2-ext-1k': { status: 'maintenance', sortOrder: 1 },
        'nano-banana': { creditsPerCall: 13, sortOrder: 2 }
      }
    });
    const liveIds = new Set([
      'image2-pro',
      'lingtu',
      'image2-economy',
      'image2-free',
      'image2-4k-fast',
      'lingtu-lite',
      'image2'
    ]);
    const models = publicModelPayload(settings, null, false, {
      newApiCatalog: {
        available: true,
        stale: false,
        version: 'partial-production-shape',
        pricingVersion: '',
        models: [],
        rules: [
          {
            model: 'gpt-image-2-ext',
            credits: 8,
            creditsByResolution: { '2k': 15, '4k': 20 },
            description: null,
            tags: '',
            label: '全能模型2 · 高质量 1K/2K/4K',
            modality: 'image',
            parameters: []
          },
          {
            model: 'nano-banana',
            credits: 6,
            description: null,
            tags: '',
            label: '香蕉 · Standard 1K',
            modality: 'image',
            parameters: []
          }
        ],
        imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG.filter((entry) => liveIds.has(entry.id))
      }
    });

    expect(models).toHaveLength(6);
    expect(models.some((model) => model.id === 'image2-economy')).toBe(true);
    expect(models.some((model) => model.id === 'image2-free')).toBe(false);
    expect(models.every((model) => model.status === 'active' && model.selectable === true)).toBe(true);
    expect(models.filter((model) => [
      'lingtu-fast',
      'lingtu-pro',
      'lingtu-2'
    ].includes(model.id))).toEqual([]);
    expect(models.find((model) => model.id === 'image2-pro')).toMatchObject({
      status: 'active',
      selectable: true
    });
    expect(models.find((model) => model.id === 'lingtu')).toMatchObject({
      creditsPerCall: 6,
      creditsFinal: 6,
      cost: { credits: 6 }
    });
  });

  it('keeps quality tiers separate from resolution-shaped upstream parameters', () => {
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: true,
          stale: false,
          version: 'resolution-quality-shape',
          pricingVersion: '',
          models: [],
          rules: [
            {
              model: 'nano-banana',
              credits: 6,
              description: null,
              tags: '',
              label: '香蕉 · Standard 1K/2K/4K',
              modality: 'image',
              parameters: [
                { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'nano-banana' },
                { name: 'quality', path: 'quality', label: '分辨率', type: 'string', required: false, fixed: '1k' }
              ]
            },
            {
              model: 'gpt-image-2-ext',
              credits: 8,
              description: null,
              tags: '',
              label: '全能模型2 · 高质量 1K/2K/4K',
              modality: 'image',
              parameters: [
                { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'gpt-image-2-ext' },
                { name: 'quality', path: 'quality', label: '分辨率', type: 'string', required: false, default: '2k', options: ['2k', '4k'] }
              ]
            }
          ],
          imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG
        }
      }
    );
    const standardBanana = models.find((model) => model.id === 'lingtu');
    const image2Pro = models.find((model) => model.id === 'image2-pro');

    expect(standardBanana).toMatchObject({
      label: '香蕉 · Standard 1K',
      resolutions: ['1k']
    });
    expect(standardBanana?.parameters).toContainEqual(expect.objectContaining({
      name: 'resolution',
      path: 'resolution',
      label: '分辨率',
      fixed: '1k'
    }));
    expect(standardBanana?.parameters.some((parameter) => parameter.name === 'quality')).toBe(false);
    expect(standardBanana?.parameters).toContainEqual(expect.objectContaining({
      name: 'images',
      path: 'images',
      max_items: 14
    }));
    expect(image2Pro?.parameters).toContainEqual(expect.objectContaining({
      name: 'resolution',
      path: 'resolution',
      label: '分辨率',
      options: ['2k', '4k']
    }));
    expect(image2Pro?.parameters.some((parameter) => parameter.name === 'quality')).toBe(false);
  });

  it('keeps the live 4K parameter contract when the upstream id is an alias', () => {
    const aliasedCatalog = NEWAPI_IMAGE_MODEL_CATALOG.map((entry) => (
      entry.id === 'image2-4k-fast'
        ? { ...entry, upstream: 'gpt-image-2-4k-Adobe' }
        : entry
    ));
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: true,
          stale: false,
          version: '4k-alias-contract',
          pricingVersion: '',
          models: [],
          rules: [{
            model: 'image2-4k-fast',
            credits: 6,
            description: null,
            tags: 'image,4k',
            label: '全能模型2 · 4K',
            modality: 'image',
            parameters: [
              { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'image2-4k-fast' },
              { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
              { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, fixed: '4k' },
              { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, default: 'auto', options: ['auto', '1:1'] },
              { name: 'quality', path: 'quality', label: '质量', type: 'string', required: false, fixed: 'standard' },
              { name: 'images', path: 'images', label: '多张参考图', type: 'array', required: false, max_items: 14 },
              { name: 'n', path: 'n', label: '生成张数', type: 'integer', required: false, fixed: 1 }
            ]
          }],
          imageCatalogEntries: aliasedCatalog
        }
      }
    );
    const model = models.find((entry) => entry.id === 'image2-4k-fast');
    expect(model?.parameters).toContainEqual(expect.objectContaining({
      name: 'quality',
      path: 'quality',
      fixed: 'standard'
    }));
    expect(model?.parameters).toContainEqual(expect.objectContaining({
      name: 'resolution',
      path: 'resolution',
      fixed: '4k'
    }));
    expect(model?.parameters.some((parameter) => parameter.name === 'images')).toBe(true);
  });

  it('keeps only NewAPI models with an active admin route', () => {
    const newApiRoutes: NewApiAdminRouteSnapshot = {
      available: true,
      fetchedAt: '2026-07-22T00:00:00.000Z',
      error: null,
      routes: {
        'gpt-image-2-free': [{
          channelId: 101,
          channelName: 'image-free',
          status: 'active',
          enabled: true,
          groups: ['default'],
          actualModel: 'gpt-image-2-free',
          priority: 1,
          weight: 1,
          upstreamHost: 'newapi.example.test'
        }],
        'gpt-image-2': [{
          channelId: 102,
          channelName: 'image-standard-disabled',
          status: 'disabled',
          enabled: false,
          groups: ['default'],
          actualModel: 'gpt-image-2',
          priority: 1,
          weight: 1,
          upstreamHost: 'newapi.example.test'
        }],
        'gpt-image-2-chat': [{
          channelId: 103,
          channelName: 'retired-image-route',
          status: 'active',
          enabled: true,
          groups: ['default'],
          actualModel: 'gpt-image-2-chat',
          priority: 1,
          weight: 1,
          upstreamHost: 'newapi.example.test'
        }]
      }
    };
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: true,
          stale: false,
          version: 'reviewed-public-catalog',
          pricingVersion: '',
          models: [],
          rules: [],
          imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG
        },
        newApiRoutes
      }
    );
    const newApiIds = new Set(NEWAPI_IMAGE_MODEL_CATALOG.map((model) => model.id));

    expect(models.filter((model) => newApiIds.has(model.id)).map((model) => model.id)).toEqual(['image2-economy']);
    expect(models.filter((model) => !newApiIds.has(model.id))).toEqual([]);
  });

  it('keeps the last-known-good image choices visible while a catalog refresh is stale', () => {
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: true,
          stale: true,
          version: 'stale-last-known-good',
          pricingVersion: 'stale-pricing',
          models: [],
          rules: [],
          imageCatalogEntries: NEWAPI_IMAGE_MODEL_CATALOG
        }
      }
    );

    expect(models.some((model) => model.id === 'image2')).toBe(true);
    expect(models.some((model) => model.id === 'lingtu')).toBe(true);
  });

  it('never treats an admin route snapshot as a public catalog fallback', () => {
    const models = publicModelPayload(
      { globalDiscountPercent: 100, models: {} },
      null,
      false,
      {
        newApiCatalog: {
          available: false,
          stale: true,
          version: '',
          pricingVersion: '',
          models: [],
          rules: [],
          imageCatalogEntries: []
        },
        newApiRoutes: {
          available: true,
          fetchedAt: '2026-07-22T00:00:00.000Z',
          error: null,
          routes: {
            'gpt-image-2-chat': [{
              channelId: 103,
              channelName: 'retired-image-route',
              status: 'active',
              enabled: true,
              groups: ['default'],
              actualModel: 'gpt-image-2-chat',
              priority: 1,
              weight: 1,
              upstreamHost: 'newapi.example.test'
            }]
          }
        }
      }
    );

    expect(models).toEqual([]);
  });
});
