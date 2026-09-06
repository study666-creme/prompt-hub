import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRow } from './generation-jobs';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  refundUserCredits: vi.fn(async (..._args: unknown[]) => undefined)
}));

vi.mock('./supabase', () => ({
  createAdminClient: mocks.createAdminClient
}));

vi.mock('./membership-credits', () => ({
  refundUserCredits: mocks.refundUserCredits
}));

import {
  FAST_PROVIDER_OUTCOME_SLA_MS,
  drainExpiredFastProviderOutcomes,
  fastProviderOutcomeIsExpired,
  finalizeExpiredFastProviderOutcome
} from './fast-provider-outcome';

type UpdateCall = {
  values: Record<string, unknown>;
  conditions: Array<[string, ...unknown[]]>;
};

function job(
  id: string,
  state: string,
  timestamp: string,
  status = 'processing',
  credits = 5
): JobRow {
  return {
    id,
    user_id: 'user-1',
    status,
    credits_charged: credits,
    result_image_url: null,
    error_message: null,
    meta: {
      provider: 'newapi',
      fastSubmitState: state,
      ...(state === 'outcome_unknown'
        ? { fastSubmitOutcomeUnknownAt: timestamp }
        : { fastSubmitStartedAt: timestamp }),
      debitSplit: { fromDaily: 2, fromPermanent: Math.max(0, credits - 2) },
      refunded: false
    },
    created_at: timestamp
  };
}

function adminForRows(rows: JobRow[], claim = true) {
  const updateCalls: UpdateCall[] = [];
  const listCalls: Array<[string, ...unknown[]]> = [];

  const admin = {
    from(table: string) {
      expect(table).toBe('generation_requests');
      return {
        select(...args: unknown[]) {
          listCalls.push(['select', ...args]);
          const conditions: Array<[string, ...unknown[]]> = [];
          const query = {
            in(...values: unknown[]) {
              listCalls.push(['in', ...values]);
              return query;
            },
            eq(...condition: unknown[]) {
              conditions.push(['eq', ...condition]);
              if (condition[0] === 'status') listCalls.push(['eq', ...condition]);
              return query;
            },
            filter(...condition: unknown[]) {
              conditions.push(['filter', ...condition]);
              listCalls.push(['filter', ...condition]);
              return query;
            },
            order(...values: unknown[]) {
              listCalls.push(['order', ...values]);
              return query;
            },
            limit: vi.fn(async (...values: unknown[]) => {
              listCalls.push(['limit', ...values]);
              const status = conditions.find((condition) => condition[1] === 'status')?.[2];
              const state = conditions.find(
                (condition) => condition[1] === 'meta->>fastSubmitState'
              )?.[3];
              return {
                data: rows.filter((row) => {
                  if (status && row.status !== status) return false;
                  if (state) {
                    return String((row.meta as Record<string, unknown>)?.fastSubmitState || '') === state;
                  }
                  return true;
                }),
                error: null
              };
            }),
            async maybeSingle() {
              const id = conditions.find((condition) => condition[1] === 'id')?.[2];
              return { data: rows.find((row) => row.id === id) || null, error: null };
            }
          };
          return query;
        },
        update(values: Record<string, unknown>) {
          const call: UpdateCall = { values, conditions: [] };
          updateCalls.push(call);
          const query = {
            eq(...condition: unknown[]) {
              call.conditions.push(['eq', ...condition]);
              return query;
            },
            filter(...condition: unknown[]) {
              call.conditions.push(['filter', ...condition]);
              return query;
            },
            select() {
              return query;
            },
            async maybeSingle() {
              const id = call.conditions.find((condition) => condition[1] === 'id')?.[2];
              const source = rows.find((row) => row.id === id);
              const isClaim = Object.prototype.hasOwnProperty.call(values, 'status');
              return {
                data: isClaim && claim && source ? { ...source, ...values } : null,
                error: null
              };
            },
            then(
              resolve: (value: { data: null; error: null }) => unknown,
              reject: (reason: unknown) => unknown
            ) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            }
          };
          return query;
        }
      };
    }
  };

  return {
    admin: admin as unknown as SupabaseClient,
    listCalls,
    updateCalls
  };
}

describe('fast provider unknown-outcome convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expires running and outcome-unknown jobs at the 60 minute boundary', () => {
    const now = Date.parse('2026-07-22T02:00:00.000Z');
    const justFresh = job(
      'fresh',
      'outcome_unknown',
      new Date(now - FAST_PROVIDER_OUTCOME_SLA_MS + 1).toISOString()
    );
    const expired = job(
      'expired',
      'outcome_unknown',
      new Date(now - FAST_PROVIDER_OUTCOME_SLA_MS).toISOString()
    );
    const staleRunning = job(
      'running',
      'running',
      new Date(now - FAST_PROVIDER_OUTCOME_SLA_MS).toISOString()
    );

    expect(fastProviderOutcomeIsExpired(justFresh, now)).toBe(false);
    expect(fastProviderOutcomeIsExpired(expired, now)).toBe(true);
    expect(fastProviderOutcomeIsExpired(staleRunning, now)).toBe(true);
  });

  it('uses a guarded terminal claim and a stable refund idempotency key', async () => {
    const now = Date.parse('2026-07-22T02:00:00.000Z');
    const expired = job('job-1', 'outcome_unknown', '2026-07-22T00:00:00.000Z');
    const { admin, updateCalls } = adminForRows([expired]);

    await expect(finalizeExpiredFastProviderOutcome(admin, expired, now)).resolves.toBe(true);

    expect(updateCalls[0]).toMatchObject({
      values: {
        status: 'failed',
        error_message: 'upstream_timeout',
        meta: {
          fastSubmitState: 'outcome_unknown_refund_pending',
          fastSubmitError: 'upstream_outcome_unknown_timeout'
        }
      }
    });
    expect(updateCalls[0].conditions).toContainEqual(['eq', 'status', 'processing']);
    expect(updateCalls[0].conditions).toContainEqual([
      'filter',
      'meta->>fastSubmitState',
      'eq',
      'outcome_unknown'
    ]);
    expect(mocks.refundUserCredits).toHaveBeenCalledWith(
      admin,
      'user-1',
      5,
      'image_generation_refund',
      'job-1',
      { fromDaily: 2, fromPermanent: 3 },
      { reason: 'upstream_timeout' }
    );
    expect(updateCalls[1]).toMatchObject({
      values: {
        meta: {
          fastSubmitState: 'failed',
          refunded: true
        }
      }
    });
  });

  it('does not refund when the guarded terminal claim loses a race', async () => {
    const now = Date.parse('2026-07-22T02:00:00.000Z');
    const expired = job('job-race', 'running', '2026-07-22T00:00:00.000Z');
    const { admin } = adminForRows([expired], false);

    await expect(finalizeExpiredFastProviderOutcome(admin, expired, now)).resolves.toBe(false);
    expect(mocks.refundUserCredits).not.toHaveBeenCalled();
  });

  it('drains only expired work and resumes an interrupted refund without submitting again', async () => {
    const now = Date.parse('2026-07-22T02:00:00.000Z');
    const rows = [
      job('unknown-old', 'outcome_unknown', '2026-07-22T00:00:00.000Z', 'processing', 7),
      job('unknown-fresh', 'outcome_unknown', '2026-07-22T01:30:00.000Z', 'processing', 8),
      job('running-old', 'running', '2026-07-22T00:30:00.000Z', 'processing', 9),
      job('refund-retry', 'outcome_unknown_refund_pending', '2026-07-22T00:00:00.000Z', 'failed', 10)
    ];
    const { admin, listCalls, updateCalls } = adminForRows(rows);
    mocks.createAdminClient.mockReturnValue(admin);

    await expect(drainExpiredFastProviderOutcomes(
      {} as Env,
      { now, maxFinalize: 12 }
    )).resolves.toEqual({ finalized: 3, eligible: 3 });

    expect(listCalls.filter((call) => call[0] !== 'select')).toEqual([
      ['eq', 'status', 'processing'],
      ['in', 'meta->>fastSubmitState', [
        'running',
        'outcome_unknown'
      ]],
      ['order', 'created_at', { ascending: true }],
      ['limit', 80],
      ['eq', 'status', 'failed'],
      ['filter', 'meta->>fastSubmitState', 'eq', 'outcome_unknown_refund_pending'],
      ['order', 'created_at', { ascending: true }],
      ['limit', 80]
    ]);
    expect(mocks.refundUserCredits).toHaveBeenCalledTimes(3);
    expect(mocks.refundUserCredits.mock.calls.map((call) => call[4])).toEqual(
      expect.arrayContaining(['unknown-old', 'running-old', 'refund-retry'])
    );
    expect(updateCalls.some((call) =>
      call.conditions.some((condition) => condition[1] === 'id' && condition[2] === 'unknown-fresh')
    )).toBe(false);
  });
});
