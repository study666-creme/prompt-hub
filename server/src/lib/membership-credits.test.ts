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
    !!p?.membership_until && new Date(p.membership_until).getTime() > Date.now(),
  resolveMembershipRollover: async (_admin: unknown, p: any) => p
}));

function profileFixture(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: 'user-1',
    credits: 100,
    membership_tier: 'pro',
    membership_until: new Date(Date.now() + 86_400_000).toISOString(),
    membership_queued_tier: null,
    membership_queued_until: null,
    first_sub_offer_used: false,
    storage_bytes: 0,
    credit_grant_mode: 'daily',
    daily_credits: 0,
    daily_credits_date: null,
    bundle_granted_until: null,
    trial_free_used: false,
    ...overrides
  } as Profile;
}

type LedgerRow = {
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref_id: string;
  meta: Record<string, unknown>;
};

/**
 * 最小 supabase 链 mock。RPC 合并方案下：
 * - grant/refresh/claim/consume/refund 走 rpc()，mock 按 DB 语义模拟并返回 { data, error }
 * - credit_ledger.insert 仅捕获 Worker 侧发放/过期留痕（writeDailyGrantLedger）
 */
function makeAdmin(opts: { failLedgerInsert?: boolean } = {}) {
  const ledgerInserts: LedgerRow[] = [];
  const rpcCalls: { name: string; args: Record<string, any> }[] = [];

  const admin = {
    from(table: string) {
      if (table === 'credit_ledger') {
        return {
          insert(row: LedgerRow) {
            if (!opts.failLedgerInsert) ledgerInserts.push(row);
            return { error: opts.failLedgerInsert ? { message: 'boom' } : null };
          }
        };
      }
      throw new Error('unexpected table: ' + table);
    },
    rpc: async (name: string, args: Record<string, any>) => {
      rpcCalls.push({ name, args });
      const prev = holder.profile;
      switch (name) {
        case 'grant_user_daily_credits':
        case 'refresh_user_daily_credits': {
          const sameDay = prev.daily_credits_date === chinaDateKey();
          const prevUsable = sameDay ? Number(prev.daily_credits) || 0 : 0;
          const next = sameDay ? Math.max(prevUsable, Number(args.p_amount)) : Number(args.p_amount);
          holder.profile = { ...prev, daily_credits: next, daily_credits_date: chinaDateKey() };
          return { data: holder.profile, error: null };
        }
        case 'consume_user_credits': {
          const amount = Number(args.p_amount);
          const sameDay = prev.daily_credits_date === chinaDateKey();
          const dailyAvail = sameDay ? Number(prev.daily_credits) || 0 : 0;
          const fromDaily = Math.min(dailyAvail, amount);
          const fromPermanent = amount - fromDaily;
          holder.profile = {
            ...prev,
            daily_credits: dailyAvail - fromDaily,
            credits: Number(prev.credits) - fromPermanent
          };
          return {
            data: { profile: holder.profile, split: { fromDaily, fromPermanent }, replayed: false },
            error: null
          };
        }
        case 'refund_user_credits': {
          holder.profile = {
            ...prev,
            daily_credits: Number(prev.daily_credits) + Number(args.p_from_daily || 0),
            credits: Number(prev.credits) + Number(args.p_from_permanent || 0)
          };
          return { data: { profile: holder.profile }, error: null };
        }
        case 'apply_credit_delta': {
          holder.profile = { ...prev, credits: Number(prev.credits) + Number(args.p_delta) };
          return { error: null };
        }
        default:
          return { error: null };
      }
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
  });

  it('does not grant bundle lump for memberships under 30 days', () => {
    expect(bundleCreditsForMembershipDays('basic', 7)).toBe(0);
  });
});

describe('deductUserCredits delegates to the locked RPC', () => {
  it('daily-covered debit goes through consume_user_credits and returns its split', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 64, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    const result = await deductUserCredits(admin, 'user-1', 5, 'image_generation', 'job-1');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: 'consume_user_credits', args: { p_amount: 5, p_ref_id: 'job-1' } });
    expect(result.split).toEqual({ fromDaily: 5, fromPermanent: 0 });
    // 每日记账由 consume_user_credits RPC 负责：Worker 侧不重复写扣费流水
    expect(ledgerInserts).toHaveLength(0);
  });

  it('mixed debit returns the RPC split and updates both pools once', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 2, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    const result = await deductUserCredits(admin, 'user-1', 5, 'video_generation', 'job-2');

    expect(rpcCalls[0].args).toMatchObject({ p_amount: 5 });
    expect(result.split).toEqual({ fromDaily: 2, fromPermanent: 3 });
    expect(holder.profile.credits).toBe(97);
    expect(holder.profile.daily_credits).toBe(0);
    expect(ledgerInserts).toHaveLength(0);
  });
});

describe('refundUserCredits delegates to the locked RPC', () => {
  it('daily refund is routed through refund_user_credits with the split', async () => {
    holder.profile = profileFixture({ credits: 100, daily_credits: 10, daily_credits_date: chinaDateKey() });
    const { admin, ledgerInserts, rpcCalls } = makeAdmin();

    await refundUserCredits(admin, 'user-1', 3, 'image_generation_refund', 'job-5', {
      fromDaily: 3,
      fromPermanent: 0
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: 'refund_user_credits' });
    expect(holder.profile.daily_credits).toBe(13);
    expect(ledgerInserts).toHaveLength(0);
  });
});

describe('daily grant ledger rows (worker-side trail on top of RPCs)', () => {
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
      meta: expect.objectContaining({ tier: 'pro' })
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

    const updated = await grantUniversalDailyBonus(admin, 'user-1', 5, holder.profile);

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
