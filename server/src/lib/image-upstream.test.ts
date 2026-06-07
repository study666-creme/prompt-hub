import { describe, expect, it } from 'vitest';
import {
  APIMART_IMAGE_MODEL_CATALOG,
  GRSAI_IMAGE_MODEL_CATALOG,
  ITHINK_IMAGE_MODEL_CATALOG,
  IMAGE_MODEL_CATALOG,
  getCatalogEntry,
  normalizeImageModelId,
  providerLabel
} from './image-models-catalog';

describe('image model catalog', () => {
  it('lists grsai, apimart and ithink models separately', () => {
    expect(GRSAI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'grsai')).toBe(true);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'apimart')).toBe(true);
    expect(ITHINK_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'ithink')).toBe(true);
    expect(IMAGE_MODEL_CATALOG.length).toBe(
      GRSAI_IMAGE_MODEL_CATALOG.length
        + APIMART_IMAGE_MODEL_CATALOG.length
        + ITHINK_IMAGE_MODEL_CATALOG.length
    );
  });

  it('apimart only exposes gpt-image-2 and seedream 5 lite', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG).toHaveLength(2);
    const gpt = getCatalogEntry('apimart-gpt-image-2');
    const jimeng = getCatalogEntry('apimart-seedream-5-lite');
    expect(gpt?.provider).toBe('apimart');
    expect(gpt?.pricingByResolution).toBe(true);
    expect(jimeng?.upstream).toBe('doubao-seedream-5-0-lite');
    expect(jimeng?.resolutions).toEqual(['2k', '4k']);
  });

  it('provider labels hide vendor names', () => {
    expect(providerLabel('grsai')).toBe('常规线路');
    expect(providerLabel('apimart')).toBe('备用线路');
    expect(providerLabel('ithink')).toBe('经济线路');
  });

  it('exposes thinkai slow gpt-image-2 model (1k only)', () => {
    const slow = getCatalogEntry('ithink-gpt-image-2-slow');
    expect(slow?.provider).toBe('ithink');
    expect(slow?.upstream).toBe('gpt-image-2');
    expect(slow?.resolutions).toEqual(['1k']);
    expect(slow?.defaultCredits).toBe(2);
  });
});
