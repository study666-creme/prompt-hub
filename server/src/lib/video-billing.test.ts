import { describe, expect, it } from 'vitest';
import { billableVideoSeconds, calculateVideoBillingAdjustment } from './video-billing';

describe('video billing adjustment', () => {
  it('refunds only a provider-reported shortfall at the quoted unit price', () => {
    expect(calculateVideoBillingAdjustment({
      requestedDuration: 6,
      reportedDurationSeconds: 5,
      quotedCredits: 46.3,
      unitCredits: 7.7166666667
    })).toMatchObject({
      actualBillableDuration: 5,
      actualCredits: 38.6,
      refundCredits: 7.7
    });
  });

  it('rounds media duration up but ignores a full-length result', () => {
    expect(billableVideoSeconds(4.01)).toBe(4);
    expect(billableVideoSeconds(4.08)).toBe(5);
    expect(calculateVideoBillingAdjustment({
      requestedDuration: 5,
      reportedDurationSeconds: 5,
      quotedCredits: 10,
      unitCredits: 2
    })).toBeNull();
  });
});
