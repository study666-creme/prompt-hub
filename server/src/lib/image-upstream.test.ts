import { describe, expect, it } from 'vitest';
import {
  APIMART_IMAGE_MODEL_CATALOG,
  GRSAI_IMAGE_MODEL_CATALOG,
  IMAGE_MODEL_CATALOG,
  NEWAPI_IMAGE_MODEL_CATALOG,
  getCatalogEntry,
  normalizeImageModelId,
  providerLabel
} from './image-models-catalog';

describe('image model catalog', () => {
  it('lists grsai, apimart, and newapi models', () => {
    expect(GRSAI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'grsai')).toBe(true);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'apimart')).toBe(true);
    expect(NEWAPI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'newapi')).toBe(true);
    expect(IMAGE_MODEL_CATALOG.length).toBe(
      NEWAPI_IMAGE_MODEL_CATALOG.length + GRSAI_IMAGE_MODEL_CATALOG.length + APIMART_IMAGE_MODEL_CATALOG.length
    );
    expect(IMAGE_MODEL_CATALOG.every((m) => (
      m.provider === 'grsai' || m.provider === 'apimart' || m.provider === 'newapi'
    ))).toBe(true);
  });

  it('newapi exposes price-backed image models first', () => {
    const base1k = getCatalogEntry('newapi-gpt-image-2');
    const ext = getCatalogEntry('newapi-gpt-image-2-ext');
    const officialBudget = getCatalogEntry('newapi-gpt-image-2-official-budget');
    const bananaPro = getCatalogEntry('newapi-nano-banana-pro');
    const banana = getCatalogEntry('newapi-nano-banana');
    expect(IMAGE_MODEL_CATALOG[0]?.provider).toBe('newapi');
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

  it('apimart exposes core models without wan or flux', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG.length).toBeGreaterThanOrEqual(9);
    const budget = getCatalogEntry('apimart-gpt-image-2-official-budget');
    const gpt = getCatalogEntry('apimart-gpt-image-2');
    const jimeng = getCatalogEntry('apimart-seedream-5-lite');
    expect(budget?.upstream).toBe('gpt-image-2-official');
    expect(budget?.fixedQualityLow).toBe(true);
    expect(gpt?.provider).toBe('apimart');
    expect(gpt?.pricingByResolution).toBe(true);
    expect(jimeng?.upstream).toBe('doubao-seedream-5-0-lite');
    expect(jimeng?.resolutions).toEqual(['2k', '4k']);
    expect(getCatalogEntry('apimart-wan2-7-image')).toBeFalsy();
    expect(getCatalogEntry('apimart-flux-kontext-pro')).toBeFalsy();
    expect(getCatalogEntry('ithink-gpt-image-2-slow')).toBeFalsy();
    expect(getCatalogEntry('mooko-gpt-image-2-pro')).toBeFalsy();
  });

  it('provider labels hide vendor names', () => {
    expect(providerLabel('grsai')).toBe('');
    expect(providerLabel('apimart')).toBe('');
    expect(providerLabel('newapi')).toBe('');
  });

  it('normalizes legacy ids', () => {
    expect(normalizeImageModelId('quanneng2')).toBe('gpt-image-2');
    expect(normalizeImageModelId('apimart-gpt-image-2')).toBe('apimart-gpt-image-2');
    expect(normalizeImageModelId('newapi-gpt-image-2-ext-1k')).toBe('image2');
    expect(normalizeImageModelId('gpt-image-2-ext-2k')).toBe('image2-pro');
    expect(normalizeImageModelId('gpt-image-2-official-4k')).toBe('image2-hd');
  });
});
