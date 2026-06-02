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

  it('basic member 95% on 10 credits', () => {
    const r = computeImageGenerationCost(settings, 'gpt-image-2', '1k', 'basic', true);
    expect(r.listPrice).toBe(10);
    expect(r.final).toBe(9.5);
    expect(r.appliedDiscount).toBe('member');
    expect(r.discountLabel).toBe('95折');
  });

  it('standard member 90% on nano-banana-pro 2k', () => {
    const r = computeImageGenerationCost(settings, 'nano-banana-pro', '2k', 'standard', true);
    expect(r.listPrice).toBe(18);
    expect(r.final).toBe(16.2);
    expect(r.appliedDiscount).toBe('member');
    expect(r.discountLabel).toBe('9折');
  });

  it('global discount applies as promo (not stacked with member)', () => {
    const r = computeImageGenerationCost(
      { globalDiscountPercent: 80, models: {} },
      'gpt-image-2',
      '1k',
      'basic',
      true
    );
    expect(r.listPrice).toBe(10);
    expect(r.promoPrice).toBe(8);
    expect(r.final).toBe(8);
    expect(r.appliedDiscount).toBe('model');
  });

  it('model promo beats member when lower', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'gpt-image-2': { creditsPerCall: 6, discountPercent: 92 }
        }
      },
      'gpt-image-2',
      '1k',
      'basic',
      true
    );
    expect(r.listPrice).toBe(6);
    expect(r.promoPrice).toBe(5.5);
    expect(r.final).toBe(5.5);
    expect(r.appliedDiscount).toBe('model');
    expect(r.modelDiscountLabel).toBe('92折');
    expect(r.discountLabel).toBeNull();
  });

  it('legacy quanneng2 maps to gpt-image-2', () => {
    const r = computeImageGenerationCost(settings, 'quanneng2', '1k', null, false);
    expect(r.modelId).toBe('gpt-image-2');
    expect(r.final).toBe(10);
  });

  it('fixedPrice ignores member discount', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'nano-banana-pro-vip': { creditsPerCall: 80, fixedPrice: true }
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

  it('memberDiscountCapPercent limits pro discount', () => {
    const r = computeImageGenerationCost(
      {
        globalDiscountPercent: 100,
        models: {
          'nano-banana-pro': { creditsPerCall: 100, memberDiscountCapPercent: 90 }
        }
      },
      'nano-banana-pro',
      '1k',
      'pro',
      true
    );
    expect(r.listPrice).toBe(100);
    expect(r.final).toBe(90);
    expect(r.appliedDiscount).toBe('member');
    expect(r.discountLabel).toBe('会员≥90%');
  });

  it('apimart gpt-image-2 prices by resolution', () => {
    const r1 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '1k', null, false);
    const r2 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-gpt-image-2', '4k', null, false);
    expect(r1.final).toBe(10);
    expect(r2.final).toBe(20);
    expect(r4.final).toBe(40);
  });

  it('apimart seedream 5 lite prices by resolution', () => {
    const r2 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '2k', null, false);
    const r4 = computeImageGenerationCost(settings, 'apimart-seedream-5-lite', '4k', null, false);
    expect(r2.final).toBe(14);
    expect(r4.final).toBe(28);
  });
});
