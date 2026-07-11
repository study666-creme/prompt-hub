import { describe, expect, it } from 'vitest';
import { applyMemberCreditDiscount, formatCreditsDisplay, roundCredits } from './credit-math';
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
});

describe('generation cost', () => {
  const settings = { globalDiscountPercent: 100, models: {} };

  it('gpt-image-2 default credits', () => {
    const r = computeImageGenerationCost(settings, 'gpt-image-2', '1k', null, false);
    expect(r.listPrice).toBe(10);
    expect(r.base).toBe(10);
    expect(r.final).toBe(10);
  });

  it('basic member no longer gets generation discount', () => {
    const r = computeImageGenerationCost(settings, 'gpt-image-2', '1k', 'basic', true);
    expect(r.listPrice).toBe(10);
    expect(r.final).toBe(10);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('standard member no longer gets generation discount', () => {
    const r = computeImageGenerationCost(settings, 'nano-banana-pro', '2k', 'standard', true);
    expect(r.listPrice).toBe(18);
    expect(r.final).toBe(18);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('explicit promo price applies as activity price', () => {
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
    expect(r.listPrice).toBe(10);
    expect(r.promoPrice).toBe(8);
    expect(r.final).toBe(8);
    expect(r.appliedDiscount).toBe('model');
    expect(r.modelDiscountLabel).toBe('活动价');
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
    expect(r.listPrice).toBe(6);
    expect(r.final).toBe(6);
    expect(r.appliedDiscount).toBe('none');
  });

  it('legacy quanneng2 maps to gpt-image-2', () => {
    const r = computeImageGenerationCost(settings, 'quanneng2', '1k', null, false);
    expect(r.modelId).toBe('gpt-image-2');
    expect(r.final).toBe(10);
  });

  it('fixedPrice ignores promo price', () => {
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
    expect(r.final).toBe(80);
    expect(r.discountLabel).toBe('固定价');
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
    expect(r.listPrice).toBe(100);
    expect(r.final).toBe(100);
    expect(r.appliedDiscount).toBe('none');
    expect(r.discountLabel).toBeNull();
  });

  it('apimart gpt-image-2 prices by resolution', () => {
    const r1 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '1k', null, false);
    const r2 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '4k', null, false);
    expect(r1.final).toBe(10);
    expect(r2.final).toBe(20);
    expect(r4.final).toBe(40);
  });

  it('grsai nano-banana-pro prices by resolution', () => {
    const r1 = computeImageGenerationCost(settings, 'nano-banana-pro', '1k', null, false);
    const r2 = computeImageGenerationCost(settings, 'nano-banana-pro', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'nano-banana-pro', '4k', null, false);
    expect(r1.final).toBe(18);
    expect(r2.final).toBe(18);
    expect(r4.final).toBe(18);
  });

  it('grsai nano-banana-pro per-resolution override', () => {
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
    expect(r2.listPrice).toBe(24);
    expect(r2.final).toBe(24);
  });

  it('promo by resolution', () => {
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
    expect(r.listPrice).toBe(24);
    expect(r.final).toBe(20);
    expect(r.modelDiscountLabel).toBe('活动价');
  });

  it('apimart seedream 5 lite prices by resolution', () => {
    const r2 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '4k', null, false);
    expect(r2.final).toBe(14);
    expect(r4.final).toBe(28);
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
