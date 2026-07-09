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
    const ext1k = getCatalogEntry('newapi-gpt-image-2-ext-1k');
    const bananaPro = getCatalogEntry('newapi-nano-banana-pro');
    expect(IMAGE_MODEL_CATALOG[0]?.provider).toBe('newapi');
    expect(ext1k?.upstream).toBe('gpt-image-2-ext-1k');
    expect(ext1k?.defaultCredits).toBe(6);
    expect(bananaPro?.resolutions).toEqual(['1k', '2k', '4k']);
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
    expect(normalizeImageModelId('newapi-gpt-image-2-ext-1k')).toBe('newapi-gpt-image-2-ext-1k');
  });
});
