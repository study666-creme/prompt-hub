import { describe, expect, it } from 'vitest';
import {
  APIMART_IMAGE_MODEL_CATALOG,
  GRSAI_IMAGE_MODEL_CATALOG,
  ITHINK_IMAGE_MODEL_CATALOG,
  MOOKO_IMAGE_MODEL_CATALOG,
  IMAGE_MODEL_CATALOG,
  getCatalogEntry,
  normalizeImageModelId,
  providerLabel
} from './image-models-catalog';

describe('image model catalog', () => {
  it('lists grsai, apimart, ithink and mooko models separately', () => {
    expect(GRSAI_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'grsai')).toBe(true);
    expect(APIMART_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'apimart')).toBe(true);
    expect(ITHINK_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'ithink')).toBe(true);
    expect(MOOKO_IMAGE_MODEL_CATALOG.every((m) => m.provider === 'mooko')).toBe(true);
    expect(IMAGE_MODEL_CATALOG.length).toBe(
      GRSAI_IMAGE_MODEL_CATALOG.length
        + APIMART_IMAGE_MODEL_CATALOG.length
        + ITHINK_IMAGE_MODEL_CATALOG.length
        + MOOKO_IMAGE_MODEL_CATALOG.length
    );
  });

  it('apimart exposes core models plus wan and flux', () => {
    expect(APIMART_IMAGE_MODEL_CATALOG.length).toBeGreaterThanOrEqual(9);
    const budget = getCatalogEntry('apimart-gpt-image-2-official-budget');
    const gpt = getCatalogEntry('apimart-gpt-image-2');
    const jimeng = getCatalogEntry('apimart-seedream-5-lite');
    const wan = getCatalogEntry('apimart-wan2-7-image');
    const fluxPro = getCatalogEntry('apimart-flux-kontext-pro');
    expect(budget?.upstream).toBe('gpt-image-2-official');
    expect(budget?.fixedQualityLow).toBe(true);
    expect(gpt?.provider).toBe('apimart');
    expect(gpt?.pricingByResolution).toBe(true);
    expect(jimeng?.upstream).toBe('doubao-seedream-5-0-lite');
    expect(jimeng?.resolutions).toEqual(['2k', '4k']);
    expect(wan?.upstream).toBe('wan2.7-image');
    expect(wan?.upstreamPoints).toBeCloseTo(0.15, 2);
    expect(fluxPro?.upstream).toBe('flux-kontext-pro');
    expect(fluxPro?.upstreamPoints).toBeCloseTo(0.14, 2);
  });

  it('provider labels hide vendor names', () => {
    expect(providerLabel('grsai')).toBe('常规线路');
    expect(providerLabel('apimart')).toBe('备用线路');
    expect(providerLabel('ithink')).toBe('经济线路');
    expect(providerLabel('mooko')).toBe('慢速线路');
  });

  it('exposes mooko pro model only (2k/4k)', () => {
    const pro = getCatalogEntry('mooko-gpt-image-2-pro');
    expect(getCatalogEntry('mooko-gpt-image-2')).toBeFalsy();
    expect(pro?.provider).toBe('mooko');
    expect(pro?.upstream).toBe('gpt-image-2-pro');
    expect(pro?.resolutions).toEqual(['2k', '4k']);
  });

  it('exposes thinkai slow gpt-image-2 model (1k only)', () => {
    const slow = getCatalogEntry('ithink-gpt-image-2-slow');
    expect(slow?.provider).toBe('ithink');
    expect(slow?.upstream).toBe('gpt-image-2');
    expect(slow?.resolutions).toEqual(['1k']);
    expect(slow?.defaultCredits).toBe(2);
  });
});
