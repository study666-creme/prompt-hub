import { describe, expect, it } from 'vitest';
import {
  GRSAI_RECHARGE_CNY,
  GRSAI_RECHARGE_POINTS,
  grsaiCostReferenceRows,
  grsaiPointsToRmb
} from './grsai-upstream-cost';

describe('grsai-upstream-cost', () => {
  it('uses 49 CNY per 750k points baseline', () => {
    expect(GRSAI_RECHARGE_CNY).toBe(49);
    expect(GRSAI_RECHARGE_POINTS).toBe(750_000);
  });

  it('converts gpt-image-2 upstream points to RMB', () => {
    expect(grsaiPointsToRmb(600)).toBeCloseTo(0.039, 3);
  });

  it('includes all catalog grsai models in reference rows', () => {
    const rows = grsaiCostReferenceRows();
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.some((r) => r.id === 'gpt-image-2')).toBe(true);
    expect(rows.some((r) => r.id === 'nano-banana-fast')).toBe(true);
  });
});
