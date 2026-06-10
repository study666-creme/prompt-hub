import { describe, expect, it } from 'vitest';
import { bundleCreditsForMembershipDays, TIER_LUMP_CREDITS } from './membership-credits';

describe('bundleCreditsForMembershipDays', () => {
  it('grants full month bundle for 30+ days', () => {
    expect(bundleCreditsForMembershipDays('pro', 30)).toBe(TIER_LUMP_CREDITS.pro);
    expect(bundleCreditsForMembershipDays('basic', 60)).toBe(TIER_LUMP_CREDITS.basic);
  });

  it('does not grant bundle lump for memberships under 30 days', () => {
    expect(bundleCreditsForMembershipDays('pro', 1)).toBe(0);
    expect(bundleCreditsForMembershipDays('pro', 29)).toBe(0);
    expect(bundleCreditsForMembershipDays('basic', 14)).toBe(0);
  });
});
