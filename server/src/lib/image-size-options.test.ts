import { describe, expect, it } from 'vitest';
import {
  aspectRatiosForModel,
  APIMART_OFFICIAL_BUDGET_RATIOS,
  MOOKO_PRO_ASPECT_RATIOS,
  mapGptImage2PixelSize
} from './image-size-options';

describe('aspectRatiosForModel', () => {
  it('budget line only exposes priced ratios without 1:1', () => {
    expect(APIMART_OFFICIAL_BUDGET_RATIOS).toEqual([
      '3:1', '1:3', '21:9', '9:21', '2:1', '1:2', '16:9', '9:16'
    ]);
    expect(aspectRatiosForModel('apimart-gpt-image-2-official-budget')).toEqual([
      ...APIMART_OFFICIAL_BUDGET_RATIOS
    ]);
    expect(aspectRatiosForModel('newapi-gpt-image-2-official-budget')).toEqual([
      ...APIMART_OFFICIAL_BUDGET_RATIOS
    ]);
  });

  it('mooko exposes doc ratios including 1:1', () => {
    expect(aspectRatiosForModel('mooko-gpt-image-2-pro')).toEqual([...MOOKO_PRO_ASPECT_RATIOS]);
  });

  it('grsai vip and apimart backup use full gim2 ratio list', () => {
    expect(aspectRatiosForModel('gpt-image-2-vip').length).toBeGreaterThan(10);
    expect(aspectRatiosForModel('apimart-gpt-image-2').length).toBeGreaterThan(10);
  });

  it('grsai base gpt-image-2 uses full gim2 list', () => {
    expect(aspectRatiosForModel('gpt-image-2').length).toBeGreaterThan(10);
  });
});

describe('mapGptImage2PixelSize', () => {
  it('maps 2k 16:9', () => {
    expect(mapGptImage2PixelSize('2k', '16:9')).toBe('2048x1152');
  });

  it('maps 4k 3:1', () => {
    expect(mapGptImage2PixelSize('4k', '3:1')).toBe('3840x1280');
  });

  it('falls back to 1:1', () => {
    expect(mapGptImage2PixelSize('2k', 'unknown')).toBe('2048x2048');
  });
});
