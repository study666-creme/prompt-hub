import { describe, expect, it, vi, beforeAll } from 'vitest';
import {
  bundleCreditsForMembershipDays,
  chinaDateKey,
  claimMemberDailyCredits,
  deductUserCredits,
  grantUniversalDailyBonus,
  refundUserCredits,
  TIER_LUMP_CREDITS
} from './membership-credits';
import type { Profile } from './supabase';

const holder = vi.hoisted(() => ({ profile: null as any }));

vi.mock('./supabase', () => ({
  getOrCreateProfile: async () => holder.profile,
  isMembershipActive: (p: any) =>
    !!p?.membership_until && new Date(p.membership_until).getTime() > Date.now()
}));

function profileFixture(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: 'user-1',
    credits: 100,
    daily_credits: 0,
    daily_credits_date: null,
    membership_tier: 'pro',
    membership_until: new Date(Date.now() + 86400000).toISOString(),
    membership_queued_tier: null,
    membership_queued_until: null,
    credit_grant_mode: 'daily',
    storage_bytes: 0,
    ...overrides
  } as Profile;
}

type LedgerRow = Record<string, any>;

/** 最小 supabase 链 mock：profiles.update（带/不带 select().single()）、credit_ledger.insert、rpc */
function makeAdmin(opts: { failLedgerInsert?: boolean } = {}) {
  const ledgerInserts: LedgerRow[] = [];
  const rpcCalls: { name: string; args: Record<string, any> }[] = [];
  const state = {
    get profile() {
      return holder.profile;
    },
    set profile(value: any) {
      holder.profile = value;
    }
  };

  const admin = {
    from(table: string) {
      if (table === 'profiles') {
        return {
          update(patch: Record<string, any>) {
            const apply = async () => {
              holder.profile = { ...holder.profile, ...patch };
              return { data: holder.profile, error: null };
            };
            return {
              eq(_col: string) {
                return {
                  select() {
                    return { single: apply };
                  },
                  then(
                    resolve?: (value: any) => any,
                    reject?: (reason: any) => any
                  ) {
                    return apply().then(resolve, reject);
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'credit_ledger') {
        return {
          insert: async (row: LedgerRow) => {
            ledgerInserts.push(row);
            return { error: opts.failLedgerInsert ? new Error('boom') : null };
          }
        };
      }
      throw new Error('unexpected table: ' + table);
    },
    rpc: async (name: string, args: Record<string, any>) => {
      rpcCalls.push({ name, args });
      holder.profile = {
        ...holder.profile,
        credits: Number(holder.profile.credits) + Number(args.p_delta)
      };
      return { error: null };
    }
  };

  return { admin: admin as any, ledgerInserts, rpcCalls };
}

beforeAll(() => {
  holder.profile = profileFixture();
});

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

describe('deductUserCredits ledger rows', () => {
  it('daily-only debit still writes a credit_ledger row', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 64, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    const result = await deductUserCredits(admin, 'user-1', 5, 'image_generation', 'job-1');

    expect(result.split).toEqual({ fromDaily: 5, fromPermanent: 0 });
    expect(rpcCalls).toHaveLength(0);
    expect(ledgerInserts).toHaveLength(1);
    const row = ledgerInserts[0];
    expect(row).toMatchObject({
      user_id: 'user-1',
      delta: -5,
      reason: 'image_generation',
      ref_id: 'job-1:daily',
      balance_after: 159, // 永久 100 + 当日剩余 59
      meta: expect.objectContaining({ pool: 'daily', dailyAfter: 59, permanentAfter: 100 })
    });
  });

  it('mixed debit writes the daily ledger row and debits permanent via rpc', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 2, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    const result = await deductUserCredits(admin, 'user-1', 5, 'video_generation', 'job-2');

    expect(result.split).toEqual({ fromDaily: 2, fromPermanent: 3 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_delta: -3, p_ref_id: 'job-2' });
    expect(ledgerInserts).toHaveLength(1);
    expect(ledgerInserts[0]).toMatchObject({
      delta: -2,
      ref_id: 'job-2:daily',
      reason: 'video_generation',
      balance_after: 97 // rpc 后永久 97 + 当日剩余 0
    });
  });

  it('permanent-only debit writes no direct ledger row (rpc owns it)', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 0 });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    await deductUserCredits(admin, 'user-1', 4, 'image_generation', 'job-3');

    expect(rpcCalls).toHaveLength(1);
    expect(ledgerInserts).toHaveLength(0);
  });

  it('a failed daily ledger insert never fails the debit itself', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 64, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts } = makeAdmin({ failLedgerInsert: true });

    const result = await deductUserCredits(admin, 'user-1', 5, 'image_generation', 'job-4');

    expect(result.split.fromDaily).toBe(5);
    expect(holder.profile.daily_credits).toBe(59);
    expect(ledgerInserts).toHaveLength(1);
  });
});

describe('refundUserCredits daily ledger rows', () => {
  it('daily refund writes a symmetric ledger row', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 10, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts } = makeAdmin();

    await refundUserCredits(admin, 'user-1', 3, 'image_generation_refund', 'job-5', {
      fromDaily: 3,
      fromPermanent: 0
    });

    expect(holder.profile.daily_credits).toBe(13);
    expect(ledgerInserts).toHaveLength(1);
    expect(ledgerInserts[0]).toMatchObject({
      delta: 3,
      reason: 'image_generation_refund',
      ref_id: 'job-5:daily-refund',
      balance_after: 113, // 100 + 13
      meta: expect.objectContaining({ pool: 'daily', refund: true })
    });
  });

  it('permanent refund stays inside rpc (no direct insert)', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 10 });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    await refundUserCredits(admin, 'user-1', 2, 'image_generation_refund', 'job-6', {
      fromDaily: 0,
      fromPermanent: 2
    });

    expect(rpcCalls).toHaveLength(1);
    expect(ledgerInserts).toHaveLength(0);
  });
});

describe('daily grant ledger rows', () => {
  it('member daily claim on a new day writes expire + grant rows', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 9, daily_credits_date: '2000-01-01' });
    const { admin, ledgerInserts } = makeAdmin();

    const updated = await claimMemberDailyCredits(admin, holder.profile);

    expect(updated.daily_credits).toBe(64); // pro
    expect(ledgerInserts).toHaveLength(2);
    expect(ledgerInserts[0]).toMatchObject({
      delta: -9,
      reason: 'daily_expire'
    });
    expect(ledgerInserts[1]).toMatchObject({
      delta: 64,
      reason: 'daily_grant',
      balance_after: 164, // 100 + 64
      meta: expect.objectContaining({ pool: 'daily', tier: 'pro' })
    });
  });

  it('same-day repeated claim grants nothing and writes no rows', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 64, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts } = makeAdmin();

    const updated = await claimMemberDailyCredits(admin, holder.profile);

    expect(updated.daily_credits).toBe(64);
    expect(ledgerInserts).toHaveLength(0);
  });

  it('universal daily bonus on a new day writes expire + grant rows', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 7, daily_credits_date: '2000-01-01' });
    const { admin, ledgerInserts } = makeAdmin();

    const updated = await grantUniversalDailyBonus(admin, 'user-1', 5);

    expect(updated.daily_credits).toBe(5);
    expect(ledgerInserts).toHaveLength(2);
    expect(ledgerInserts[0]).toMatchObject({ delta: -7, reason: 'daily_expire' });
    expect(ledgerInserts[1]).toMatchObject({
      delta: 5,
      reason: 'daily_checkin',
      balance_after: 105,
      ref_id: expect.stringContaining('daily-bonus:user-1:')
    });
  });
});
