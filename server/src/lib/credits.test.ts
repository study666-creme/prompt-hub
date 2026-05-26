import { describe, expect, it } from 'vitest';
import { baseResolutionCost, computeGenerationCost } from './pricing';

describe('generation cost', () => {
  it('quanneng2 resolution costs', () => {
    expect(baseResolutionCost('1k')).toBe(10);
    expect(baseResolutionCost('4k')).toBe(40);
  });

  it('quanneng2 member discount', () => {
    const r = computeGenerationCost('quanneng2', '2k', 'standard', true);
    expect(r.base).toBe(20);
    expect(r.final).toBe(16);
    expect(r.discountLabel).toBe('8折');
  });

  it('jimeng fixed price with member discount', () => {
    const r = computeGenerationCost('jimeng', '4k', 'pro', true);
    expect(r.base).toBe(40);
    expect(r.final).toBe(28);
    expect(r.discountLabel).toBe('7折');
  });

  it('no tier', () => {
    const r = computeGenerationCost('quanneng2', '1k', null, false);
    expect(r.final).toBe(10);
  });
});
