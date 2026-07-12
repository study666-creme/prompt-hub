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

describe('image model catalog', () => {
  it('lists only current newapi and Midjourney models', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'apimart')).toBe(true);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.uiFamily === 'midjourney')).toBe(true);
    expect(NEWAPI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'newapi')).toBe(true);
    expect(IMAGE_MODEL_CATALOG.length).toBe(
      NEWAPI_IMAGE_MODEL_CATALOG.length + APIMART_IMAGE_MODEL_CATALOG.length
    );
    expect(IMAGE_MODEL_CATALOG).toHaveLength(12);
  });

  it('newapi exposes price-backed image models first', () => {
    const base1k = getCatalogEntry('newapi-gpt-image-2');
    const ext = getCatalogEntry('newapi-gpt-image-2-ext');
    const officialBudget = getCatalogEntry('newapi-gpt-image-2-official-budget');
    const bananaPro = getCatalogEntry('newapi-nano-banana-pro');
    const banana = getCatalogEntry('newapi-nano-banana');
    expect(IMAGE_MODEL_CATALOG[0]?.provider).toBe('newapi');
    expect(getCatalogEntry('gpt-image-2-chat')?.defaultCredits).toBe(2.5);
    expect(base1k?.defaultCredits).toBe(5.5);
    expect(ext?.upstream).toBe('gpt-image-2-ext');
    expect(ext?.resolutions).toEqual(['2k', '4k']);
    expect(ext?.defaultCreditsByResolution).toEqual({ '2k': 15, '4k': 20 });
    expect(officialBudget?.provider).toBe('newapi');
    expect(officialBudget?.upstream).toBe('image2k4k');
    expect(officialBudget?.fixedQualityLow).toBe(true);
    expect(officialBudget?.pricingByResolution).toBe(true);
    expect(officialBudget?.resolutions).toEqual(['2k', '4k']);
    expect(officialBudget?.defaultCreditsByResolution).toEqual({ '2k': 5.5, '4k': 9 });
    expect(bananaPro?.resolutions).toEqual(['1k', '2k', '4k']);
    expect(banana?.upstream).toBe('nano-banana');
    expect(banana?.defaultCredits).toBe(11);
  });

  it('apimart catalog keeps only MJ', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG).toHaveLength(4);
    expect(APIMART_IMAGE_MODEL_CATALOG.map((model) => model.id)).toEqual([
      'apimart-mj-v81',
      'apimart-mj-v7',
      'apimart-mj-v61',
      'apimart-mj-niji7'
    ]);
  });

  it('provider labels hide vendor names', () => {
    expect(providerLabel('apimart')).toBe('');
    expect(providerLabel('newapi')).toBe('');
  });

  it('retains only New API image2/banana models plus MJ', () => {
    const retained = IMAGE_MODEL_CATALOG.filter(isRetainedPublicImageEntry);
    expect(retained.every((model) => (
      (model.provider === 'newapi' && ['gim2', 'banana'].includes(model.uiFamily))
      || (model.provider === 'apimart' && model.uiFamily === 'midjourney')
    ))).toBe(true);
    expect(retained.filter((model) => model.provider === 'newapi')).toHaveLength(8);
    expect(retained.filter((model) => model.uiFamily === 'midjourney')).toHaveLength(4);
  });

  it('normalizes legacy ids', () => {
    expect(normalizeImageModelId('quanneng2')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2-chat')).toBe('image2-economy');
    expect(normalizeImageModelId('nano-banana-pro')).toBe('lingtu-pro');
    expect(normalizeImageModelId('newapi-gpt-image-2-ext-1k')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2-ext-2k')).toBe('image2-pro');
    expect(normalizeImageModelId('gpt-image-2-official-4k')).toBe('image2-hd');
    expect(normalizeImageModelId('apimart-gpt-image-2')).toBe('image2');
    expect(normalizeImageModelId('mooko-gpt-image-2-pro')).toBe('image2-pro');
  });
});
