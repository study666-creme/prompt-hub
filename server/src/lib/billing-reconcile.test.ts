import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  deductUserCredits: vi.fn(),
  refundUserCredits: vi.fn(),
  syncMembershipCredits: vi.fn()
}));

vi.mock('./supabase', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('./membership-credits', async importOriginal => ({
  ...await importOriginal<typeof import('./membership-credits')>(),
  deductUserCredits: mocks.deductUserCredits,
  syncMembershipCredits: mocks.syncMembershipCredits
}));

import { drainUnderchargedGenerationWork } from './billing-reconcile';

type Row = {
  id: string;
  user_id: string;
  status: string;
  credits_charged: number;
  created_at: string;
  meta: Record<string, unknown> | null;
};

function table(rows: Row[]) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    then: undefined
  };
}

function env(): never {
  return {} as never;
}

function isoAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('billing reconcile drain', () => {
  afterEach(() => vi.clearAllMocks());

  it('skips rows whose wallet debit is already checkpointed', async () => {
    const query = table([
      { id: 'a', user_id: 'u1', status: 'completed', credits_charged: 12.5, created_at: isoAgo(120), meta: { debitSplit: { fromDaily: 12.5 } } }
    ]);
    const ledgerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    // The first .from call lists generation_requests; any later one reads the ledger.
    let calls = 0;
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1;
        return calls === 1 ? { ...query, then: undefined } : ledgerQuery;
      })
    });

    const result = await drainUnderchargedGenerationWork(env(), { maxReconcile: 10 });
    expect(mocks.deductUserCredits).not.toHaveBeenCalled();
    expect(result.debited).toBe(0);
  });

  it('re-debits a completed video row with no ledger entry (undercharge recovery)', async () => {
    const row: Row = {
      id: 'b', user_id: 'u2', status: 'completed', credits_charged: 195,
      created_at: isoAgo(60), meta: { mediaType: 'video', credits: 195 }
    };
    const listQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null })
    };
    const ledgerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    const flagQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null })
    };
    let calls = 0;
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1;
        return calls === 1 ? listQuery : calls === 2 ? ledgerQuery : flagQuery;
      })
    });
    mocks.deductUserCredits.mockResolvedValue({ profile: {}, split: { fromDaily: 195, fromPermanent: 0 } });

    const result = await drainUnderchargedGenerationWork(env(), { maxReconcile: 10 });
    expect(mocks.deductUserCredits).toHaveBeenCalledWith(
      expect.anything(),
      'u2',
      195,
      'video_generation',
      'b',
      expect.objectContaining({ reconciled: true })
    );
    expect(result.debited).toBe(1);
  });

  it('does not double-debit when the ledger already has the charge', async () => {
    const row: Row = {
      id: 'c', user_id: 'u3', status: 'completed', credits_charged: 13,
      created_at: isoAgo(60), meta: { mediaType: 'video' }
    };
    const listQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null })
    };
    const ledgerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'ledger-1' }], error: null })
    };
    let calls = 0;
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1;
        return calls === 1 ? listQuery : ledgerQuery;
      })
    });

    const result = await drainUnderchargedGenerationWork(env(), { maxReconcile: 10 });
    expect(mocks.deductUserCredits).not.toHaveBeenCalled();
    expect(result.debited).toBe(0);
  });

  it('respects the processing grace period and flags failed recovery', async () => {
    const fresh: Row = {
      id: 'd', user_id: 'u4', status: 'processing', credits_charged: 50,
      created_at: isoAgo(5), meta: { mediaType: 'video' }
    };
    const stale: Row = {
      id: 'e', user_id: 'u5', status: 'processing', credits_charged: 50,
      created_at: isoAgo(40), meta: { mediaType: 'video' }
    };
    const listQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [fresh, stale], error: null })
    };
    const ledgerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    const flagQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null })
    };
    let calls = 0;
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1;
        if (calls === 1) return listQuery;
        return calls === 2 ? ledgerQuery : flagQuery;
      })
    });
    // Insufficient balance on the stale row: it must be flagged, never dropped.
    mocks.deductUserCredits.mockRejectedValue(new Error('insufficient_credits'));

    const result = await drainUnderchargedGenerationWork(env(), { maxReconcile: 10 });
    expect(mocks.deductUserCredits).toHaveBeenCalledTimes(1);
    expect(mocks.deductUserCredits).toHaveBeenCalledWith(expect.anything(), 'u5', 50, 'video_generation', 'e', expect.anything());
    expect(result.flagged).toBe(1);
    expect(result.debited).toBe(0);
  });
});
