import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrCreateProfile: vi.fn(),
  isMembershipActive: vi.fn(),
  createAdminClientResult: {}
}));

vi.mock('./supabase', async importOriginal => {
  const actual = await importOriginal<typeof import('./supabase')>();
  return {
    ...actual,
    getOrCreateProfile: mocks.getOrCreateProfile,
    isMembershipActive: mocks.isMembershipActive
  };
});

import { deductUserCredits } from './membership-credits';

describe('zero-amount debit guard', () => {
  afterEach(() => vi.clearAllMocks());

  it('rejects a zero-amount debit instead of silently succeeding', async () => {
    await expect(
      deductUserCredits(mocks.createAdminClientResult as never, 'u1', 0, 'video_generation', 'job-1', {})
    ).rejects.toThrow('amount_must_be_positive');
    expect(mocks.getOrCreateProfile).not.toHaveBeenCalled();
  });

  it('rejects a negative-amount debit', async () => {
    await expect(
      deductUserCredits(mocks.createAdminClientResult as never, 'u1', -5, 'image_generation', 'job-2', {})
    ).rejects.toThrow('amount_invalid');
  });

  it('still allows the legacy free image model replay path', async () => {
    mocks.getOrCreateProfile.mockResolvedValue({ credits: 0, daily_credits: 0 });
    await expect(
      deductUserCredits(mocks.createAdminClientResult as never, 'u1', 0, 'image_generation', 'job-3', { model: 'image2-free' })
    ).resolves.toEqual({ profile: { credits: 0, daily_credits: 0 }, split: { fromDaily: 0, fromPermanent: 0 } });
  });
});
