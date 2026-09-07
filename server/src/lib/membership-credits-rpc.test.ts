import { describe, expect, it, vi } from 'vitest';
import {
  claimMemberDailyCredits,
  claimTrialMembership,
  deductUserCredits,
  grantBundleForActiveMembership,
  grantUniversalDailyBonus,
  refreshDailyCredits,
  refundUserCredits,
  setMembershipCreditMode
} from './membership-credits';

const profile = {
  user_id: '00000000-0000-0000-0000-000000000001',
  credits: 20,
  daily_credits: 3,
  daily_credits_date: '2026-07-22',
  credit_grant_mode: 'daily',
  membership_tier: null,
  membership_until: null,
  membership_queued_tier: null,
  membership_queued_until: null,
  first_sub_offer_used: false,
  storage_bytes: 0,
  bundle_granted_until: null,
  trial_free_used: false
} as any;

function adminWithRpc(response: unknown, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data: response, error }))
  } as never;
}

describe('atomic credit operation contracts', () => {
  it('delegates the complete debit to the database RPC and preserves its split', async () => {
    const admin = adminWithRpc({
      profile,
      split: { fromDaily: 3, fromPermanent: 4 },
      replayed: false
    });

    const result = await deductUserCredits(
      admin,
      profile.user_id,
      7,
      'image_generation',
      'job-1',
      { count: 2 }
    );

    expect((admin as any).rpc).toHaveBeenCalledWith('consume_user_credits', {
      p_user_id: profile.user_id,
      p_amount: 7,
      p_reason: 'image_generation',
      p_ref_id: 'job-1',
      p_meta: { count: 2 }
    });
    expect(result).toMatchObject({
      profile,
      split: { fromDaily: 3, fromPermanent: 4 },
      replayed: false
    });
  });

  it('returns replayed debit state without doing a second client-side mutation', async () => {
    const admin = adminWithRpc({
      profile,
      split: { fromDaily: 7, fromPermanent: 0 },
      replayed: true
    });

    await expect(
      deductUserCredits(admin, profile.user_id, 7, 'image_generation', 'job-1')
    ).resolves.toMatchObject({
      split: { fromDaily: 7, fromPermanent: 0 },
      replayed: true
    });
    expect((admin as any).rpc).toHaveBeenCalledTimes(1);
  });

  it('passes both refund buckets to the idempotent refund RPC', async () => {
    const admin = adminWithRpc({ profile, replayed: false });

    await refundUserCredits(
      admin,
      profile.user_id,
      8,
      'image_generation_refund',
      'job-1',
      { fromDaily: 3, fromPermanent: 5 },
      { phase: 'upstream_failed' }
    );

    expect((admin as any).rpc).toHaveBeenCalledWith('refund_user_credits', {
      p_user_id: profile.user_id,
      p_amount: 8,
      p_reason: 'image_generation_refund',
      p_ref_id: 'job-1',
      p_from_daily: 3,
      p_from_permanent: 5,
      p_meta: { phase: 'upstream_failed' }
    });
  });

  it('clips a partial refund split to the smaller refund amount', async () => {
    const admin = adminWithRpc({ profile, replayed: false });

    await refundUserCredits(
      admin,
      profile.user_id,
      38.6,
      'video_generation_refund',
      'video-job-1:duration-adjustment',
      { fromDaily: 2, fromPermanent: 191.3 },
      { phase: 'duration_adjustment' }
    );

    expect((admin as any).rpc).toHaveBeenCalledWith('refund_user_credits', {
      p_user_id: profile.user_id,
      p_amount: 38.6,
      p_reason: 'video_generation_refund',
      p_ref_id: 'video-job-1:duration-adjustment',
      p_from_daily: 2,
      p_from_permanent: 36.6,
      p_meta: { phase: 'duration_adjustment' }
    });
  });

  it('uses only the daily bucket when it covers the partial refund', async () => {
    const admin = adminWithRpc({ profile, replayed: false });

    await refundUserCredits(
      admin,
      profile.user_id,
      1.5,
      'video_generation_refund',
      'video-job-2:duration-adjustment',
      { fromDaily: 2, fromPermanent: 191.3 }
    );

    expect((admin as any).rpc).toHaveBeenCalledWith('refund_user_credits', expect.objectContaining({
      p_amount: 1.5,
      p_from_daily: 1.5,
      p_from_permanent: 0
    }));
  });

  it('does not turn an invalid refund amount into a minimum charge', async () => {
    const admin = adminWithRpc({ profile, replayed: false });
    for (const amount of [Number.NaN, 0, -1]) {
      await refundUserCredits(
        admin,
        profile.user_id,
        amount,
        'image_generation_refund',
        'job-1',
        { fromDaily: 0, fromPermanent: 0 }
      );
    }
    expect((admin as any).rpc).not.toHaveBeenCalled();
  });

  it('uses the locked daily-credit RPC for universal rewards', async () => {
    const admin = adminWithRpc(profile);

    await expect(grantUniversalDailyBonus(admin, profile.user_id, 5, profile)).resolves.toEqual(profile);
    expect((admin as any).rpc).toHaveBeenCalledWith('grant_user_daily_credits', {
      p_user_id: profile.user_id,
      p_amount: 5,
      p_mode: 'universal'
    });
  });

  it('uses the locked refresh and member-claim RPCs', async () => {
    const memberProfile = {
      ...profile,
      membership_tier: 'basic',
      membership_until: new Date(Date.now() + 86_400_000).toISOString(),
      credit_grant_mode: 'daily',
      daily_credits_date: '2026-07-21'
    } as any;
    const admin = adminWithRpc(memberProfile);

    await refreshDailyCredits(admin, memberProfile);
    await claimMemberDailyCredits(admin, memberProfile);

    expect((admin as any).rpc).toHaveBeenNthCalledWith(1, 'refresh_user_daily_credits', {
      p_user_id: memberProfile.user_id,
      p_amount: 13
    });
    expect((admin as any).rpc).toHaveBeenNthCalledWith(2, 'grant_user_daily_credits', {
      p_user_id: memberProfile.user_id,
      p_amount: 13,
      p_mode: 'member'
    });
  });

  it('grants a bundle and marks its period in the same RPC', async () => {
    const memberProfile = {
      ...profile,
      membership_tier: 'basic',
      membership_until: new Date(Date.now() + 86_400_000).toISOString(),
      credit_grant_mode: 'bundle',
      bundle_granted_until: null
    } as any;
    const admin = adminWithRpc(memberProfile);

    await grantBundleForActiveMembership(admin, memberProfile, { membershipDays: 30 });

    expect((admin as any).rpc).toHaveBeenCalledWith('grant_membership_bundle', expect.objectContaining({
      p_user_id: memberProfile.user_id,
      p_amount: 130,
      p_reason: 'subscription_grant',
      p_ref_id: expect.stringContaining('bundle:'),
      p_period_until: memberProfile.membership_until
    }));
  });

  it('serializes trial activation with the daily wallet initialization', async () => {
    const admin = adminWithRpc(profile);
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();

    await claimTrialMembership(admin, profile.user_id, until, 13);

    expect((admin as any).rpc).toHaveBeenCalledWith('claim_trial_membership', {
      p_user_id: profile.user_id,
      p_membership_until: until,
      p_daily_amount: 13
    });
  });

  it('serializes membership credit-mode changes with wallet mutations', async () => {
    const admin = adminWithRpc(profile);

    await setMembershipCreditMode(admin, profile.user_id, 'bundle');

    expect((admin as any).rpc).toHaveBeenCalledWith('set_membership_credit_mode', {
      p_user_id: profile.user_id,
      p_mode: 'bundle'
    });
  });
});
