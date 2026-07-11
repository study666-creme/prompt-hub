import { describe, expect, it } from 'vitest';
import {
  applyMemberCreditDiscount,
  creditsFromYuan,
  formatCreditsDisplay,
  roundCredits
} from './credit-math';
import { computeImageGenerationCost } from './image-model-settings';

describe('credit math', () => {
  it('rounds to one decimal', () => {
    expect(roundCredits(9.55)).toBe(9.6);
    expect(formatCreditsDisplay(9.5)).toBe('9.5');
    expect(formatCreditsDisplay(10)).toBe('10');
  });

  it('applies member tiers distinctly on 10 credits', () => {
    expect(applyMemberCreditDiscount(10, 0.95)).toBe(9.5);
    expect(applyMemberCreditDiscount(10, 0.9)).toBe(9);
    expect(applyMemberCreditDiscount(10, 0.85)).toBe(8.5);
  });

  it('converts upstream CNY prices at exactly 100 credits per yuan', () => {
    expect(creditsFromYuan(1)).toBe(100);
    expect(creditsFromYuan(0.055)).toBe(5.5);
    expect(creditsFromYuan(0.016)).toBe(1.6);
    expect(creditsFromYuan(-1)).toBeNull();
  });
});

describe('generation cost', () => {
  const settings = { globalDiscountPercent: 100, models: {} };

  it('legacy gpt-image-2 resolves to the current realtime fallback price', () => {
    const r = computeImageGenerationCost(settings, 'gpt-image-2', '1k', null, false);
    expect(r.listPrice).toBe(5.5);
    expect(r.base).toBe(5.5);
    expect(r.final).toBe(5.5);
  });

  it('basic member no longer gets generation discount', () => {
    const r = computeImageGenerationCost(settings, 'gpt-image-2', '1k', 'basic', true);
    expect(r.listPrice).toBe(5.5);
    expect(r.final).toBe(5.5);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('standard member no longer gets generation discount', () => {
    const r = computeImageGenerationCost(settings, 'nano-banana-pro', '2k', 'standard', true);
    expect(r.listPrice).toBe(13);
    expect(r.final).toBe(13);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('legacy manual promo cannot override a realtime model', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'gpt-image-2': { creditsPerCall: 10, promoPrice: 8 }
        }
      },
      'gpt-image-2',
      '1k',
      'basic',
      true
    );
    expect(r.listPrice).toBe(5.5);
    expect(r.promoPrice).toBe(5.5);
    expect(r.final).toBe(5.5);
    expect(r.appliedDiscount).toBe('none');
  });

  it('no promo price when field omitted', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 80,
        models: {
          'gpt-image-2': { creditsPerCall: 6 }
        }
      },
      'gpt-image-2',
      '1k',
      null,
      false
    );
    expect(r.listPrice).toBe(5.5);
    expect(r.final).toBe(5.5);
    expect(r.appliedDiscount).toBe('none');
  });

  it('legacy quanneng2 maps to image2', () => {
    const r = computeImageGenerationCost(settings, 'quanneng2', '1k', null, false);
    expect(r.modelId).toBe('image2');
    expect(r.final).toBe(5.5);
  });

  it('legacy fixedPrice cannot revive a removed banana model', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'nano-banana-pro-vip': { creditsPerCall: 80, promoPrice: 60, fixedPrice: true }
        }
      },
      'nano-banana-pro-vip',
      '1k',
      'pro',
      true
    );
    expect(r.modelId).toBe('lingtu-pro');
    expect(r.final).toBe(13);
    expect(r.discountLabel).toBeNull();
  });

  it('memberDiscountCapPercent no longer applies member discount', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'gpt-image-2': { creditsPerCall: 100, memberDiscountCapPercent: 90 }
        }
      },
      'gpt-image-2',
      '1k',
      'pro',
      true
    );
    expect(r.listPrice).toBe(5.5);
    expect(r.final).toBe(5.5);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('removed apimart gpt-image-2 migrates to image2 realtime pricing', () => {
    const r1 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '1k', null, false);
    const r2 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '4k', null, false);
    expect(r1.modelId).toBe('image2');
    expect(r1.final).toBe(5.5);
    expect(r2.final).toBe(5.5);
    expect(r4.final).toBe(5.5);
  });

  it('legacy nano-banana-pro resolves to the current banana price', () => {
    const r1 = computeImageGenerationCost(settings, 'nano-banana-pro', '1k', null, false);
    const r2 = computeImageGenerationCost(settings, 'nano-banana-pro', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'nano-banana-pro', '4k', null, false);
    expect(r1.final).toBe(13);
    expect(r2.final).toBe(13);
    expect(r4.final).toBe(13);
  });

  it('legacy per-resolution overrides cannot change the current banana price', () => {
    const r2 = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'nano-banana-pro': {
            creditsByResolution: { '1k': 18, '2k': 24, '4k': 36 }
          }
        }
      },
      'nano-banana-pro',
      '2k',
      null,
      false
    );
    expect(r2.listPrice).toBe(13);
    expect(r2.final).toBe(13);
  });

  it('legacy resolution promos cannot change the current banana price', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'nano-banana-pro': {
            creditsByResolution: { '1k': 18, '2k': 24, '4k': 36 },
            promoByResolution: { '2k': 20 }
          }
        }
      },
      'nano-banana-pro',
      '2k',
      null,
      false
    );
    expect(r.listPrice).toBe(13);
    expect(r.final).toBe(13);
    expect(r.modelDiscountLabel).toBeNull();
  });

  it('removed apimart seedream migrates to image2 realtime pricing', () => {
    const r2 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '4k', null, false);
    expect(r2.modelId).toBe('image2');
    expect(r2.final).toBe(5.5);
    expect(r4.final).toBe(5.5);
  });

  it('newapi fallback prices preserve fractional credits', () => {
    const gpt1k = computeImageGenerationCost(settings, 'newapi-gpt-image-2', '1k', null, false);
    const gptExt = computeImageGenerationCost(settings, 'newapi-gpt-image-2-ext', '4k', null, false);
    const official = computeImageGenerationCost(
      settings,
      'newapi-gpt-image-2-official-budget',
      '2k',
      null,
      false
    );
    const banana = computeImageGenerationCost(settings, 'newapi-nano-banana-pro', '4k', null, false);
    expect(gpt1k.final).toBe(5.5);
    expect(gptExt.final).toBe(20);
    expect(official.final).toBe(5.5);
    expect(banana.final).toBe(13);
  });
});
