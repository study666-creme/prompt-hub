import { describe, expect, it } from 'vitest';
import {
  APIMART_IMAGE_MODEL_CATALOG,
  IMAGE_MODEL_CATALOG,
  NEWAPI_IMAGE_MODEL_CATALOG,
  getCatalogEntry,
  isRetainedPublicImageEntry,
  normalizeImageModelId,
  providerLabel
} from './image-models-catalog';
import { mergeImageModelSettings } from './image-model-settings';

describe('image model catalog', () => {
  it('lists only current newapi and Midjourney models', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'apimart')).toBe(true);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.uiFamily === 'midjourney')).toBe(true);
    expect(NEWAPI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'newapi')).toBe(true);
    expect(IMAGE_MODEL_CATALOG.length).toBe(
      NEWAPI_IMAGE_MODEL_CATALOG.length + APIMART_IMAGE_MODEL_CATALOG.length
    );
    expect(IMAGE_MODEL_CATALOG).toHaveLength(20);
  });

  it('newapi exposes price-backed image models first', () => {
    const base1k = getCatalogEntry('newapi-gpt-image-2');
    const ext = getCatalogEntry('newapi-gpt-image-2-ext');
    const bananaLite = getCatalogEntry('nano-banana-2-lite');
    const bananaPro = getCatalogEntry('newapi-nano-banana-pro');
    const banana = getCatalogEntry('newapi-nano-banana');
    expect(NEWAPI_IMAGE_MODEL_CATALOG.map((model) => model.id)).toEqual([
      'image2-free',
      'image2-economy',
      'image2',
      'image2-4k-fast',
      'image2-pro',
      'lingtu-lite',
      'lingtu-fast',
      'lingtu-2',
      'lingtu-pro',
      'lingtu',
      'seedream-5.0',
      'sensenova-1.5-一秒出图',
      'mj-v81',
      'mj-v7',
      'mj-niji7'
    ]);
    expect(IMAGE_MODEL_CATALOG[0]?.provider).toBe('newapi');
    expect(getCatalogEntry('gpt-image-2-free')).toMatchObject({
      id: 'image2-free',
      resolutions: ['1k'],
      defaultCredits: 0
    });
    expect(getCatalogEntry('gpt-image-2-1k')?.defaultCredits).toBe(2.2);
    expect(base1k?.defaultCredits).toBe(5.5);
    expect(getCatalogEntry('gpt-image-2-4k-fast')).toMatchObject({
      id: 'image2-4k-fast',
      resolutions: ['4k'],
      defaultCredits: 6
    });
    expect(ext?.upstream).toBe('gpt-image-2-ext');
    expect(ext?.resolutions).toEqual(['1k', '2k', '4k']);
    expect(ext?.defaultCreditsByResolution).toEqual({ '1k': 8, '2k': 15, '4k': 20 });
    expect(bananaLite).toMatchObject({
      id: 'lingtu-lite',
      resolutions: ['1k'],
      defaultCredits: 4.2
    });
    expect(bananaPro?.resolutions).toEqual(['1k', '2k', '4k']);
    expect(bananaPro?.defaultCredits).toBe(6);
    expect(banana?.upstream).toBe('nano-banana');
    expect(banana?.label).toBe('香蕉 · Standard 1K');
    expect(banana?.resolutions).toEqual(['1k']);
    expect(banana?.defaultCredits).toBe(6);
  });

  it('apimart catalog keeps only MJ', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG).toHaveLength(5);
    expect(APIMART_IMAGE_MODEL_CATALOG.map((model) => model.id)).toEqual([
      'mj-v82',
      'mj-v81',
      'mj-v7',
      'mj-v61',
      'mj-niji7'
    ]);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((model) => !model.id.includes('apimart'))).toBe(true);
  });

  it('provider labels hide vendor names', () => {
    expect(providerLabel('apimart')).toBe('');
    expect(providerLabel('newapi')).toBe('');
  });

  it('publishes only New API image2, banana, jimeng, and current MJ models', () => {
    const retained = IMAGE_MODEL_CATALOG.filter(isRetainedPublicImageEntry);
    expect(retained.every((model) => (
      model.provider === 'newapi'
      && ['gim2', 'banana', 'midjourney', 'jimeng'].includes(model.uiFamily)
    ))).toBe(true);
    expect(retained).toHaveLength(14);
    expect(retained.some((model) => model.id === 'image2-economy')).toBe(true);
    expect(retained.some((model) => model.id === 'image2-free')).toBe(false);
    expect(retained.some((model) => model.id === 'seedream-5.0')).toBe(true);
    expect(retained.some((model) => model.id === 'sensenova-1.5-一秒出图')).toBe(true);
    expect(retained.filter((model) => model.uiFamily === 'midjourney')).toEqual([
      expect.objectContaining({ id: 'mj-v81', provider: 'newapi', upstream: 'mj-v81', defaultCredits: 40 }),
      expect.objectContaining({ id: 'mj-v7', provider: 'newapi', defaultCredits: 40 }),
      expect.objectContaining({ id: 'mj-niji7', provider: 'newapi', defaultCredits: 40 })
    ]);
    expect(retained.some((model) => model.id === 'mj-v61')).toBe(false);
  });

  it('normalizes legacy ids', () => {
    expect(normalizeImageModelId('quanneng2')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2-4k-fast')).toBe('image2-4k-fast');
    expect(normalizeImageModelId('gpt-image-2-chat')).toBe('image2-economy');
    expect(normalizeImageModelId('gpt-image-2-ext')).toBe('image2-pro');
    expect(normalizeImageModelId('nano-banana-pro')).toBe('lingtu-pro');
    expect(normalizeImageModelId('newapi-gpt-image-2-ext-1k')).toBe('image2-pro');
    expect(normalizeImageModelId('gpt-image-2-ext-2k')).toBe('image2-pro');
    expect(normalizeImageModelId('gpt-image-2-official-4k')).toBe('image2-hd');
    expect(normalizeImageModelId('apimart-gpt-image-2')).toBe('image2');
    expect(normalizeImageModelId('mooko-gpt-image-2-pro')).toBe('image2-pro');
    expect(normalizeImageModelId('apimart-mj-v81')).toBe('mj-v81');
    expect(normalizeImageModelId('apimart-mj-v7')).toBe('mj-v7');
    expect(normalizeImageModelId('apimart-mj-v61')).toBe('mj-v61');
    expect(normalizeImageModelId('apimart-mj-niji7')).toBe('mj-niji7');
    expect(getCatalogEntry('apimart-mj-v81')?.id).toBe('mj-v81');
  });

  it('migrates legacy MJ pricing keys to public ids', () => {
    const settings = mergeImageModelSettings({
      globalDiscountPercent: 100,
      models: {
        'apimart-mj-v81': {
          creditsBySpeed: { relax: 35, fast: 45, turbo: 90 }
        }
      }
    });

    expect(settings.models['apimart-mj-v81']).toBeUndefined();
    expect(settings.models['mj-v81']?.creditsBySpeed).toEqual({
      relax: 35,
      fast: 45,
      turbo: 90
    });
  });

  it('does not reactivate stale legacy New API settings', () => {
    const settings = mergeImageModelSettings({
      globalDiscountPercent: 100,
      models: {
        'newapi-gpt-image-2-ext-1k': { status: 'maintenance', sortOrder: 1 },
        'nano-banana': { creditsPerCall: 13, sortOrder: 2 },
        'image2-pro': { refundOnViolation: false }
      }
    });

    expect(settings.models['image2-pro']).toEqual(expect.objectContaining({
      refundOnViolation: false
    }));
    expect(settings.models['image2-pro']?.status).toBeUndefined();
    expect(settings.models.lingtu).toBeUndefined();
  });
});
