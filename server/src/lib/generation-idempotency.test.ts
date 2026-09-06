import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  findOwnedGenerationRequest,
  generationRequestId,
  insertGenerationRequest,
  type GenerationRequestRecord
} from './generation-idempotency';

type QueryResult = { data: unknown; error: unknown };

function fakeAdmin(insertResult: QueryResult, lookupResult: QueryResult | QueryResult[]) {
  const lookupResults = Array.isArray(lookupResult) ? lookupResult : [lookupResult];
  const state = {
    inserted: null as Record<string, unknown> | null,
    lookupCount: 0,
    filters: [] as Array<[string, unknown]>
  };
  const admin = {
    from(table: string) {
      expect(table).toBe('generation_requests');
      return {
        insert(values: Record<string, unknown>) {
          state.inserted = values;
          return {
            select() {
              return { single: async () => insertResult };
            }
          };
        },
        select() {
          state.lookupCount += 1;
          const query = {
            eq(column: string, value: unknown) {
              state.filters.push([column, value]);
              return query;
            },
            maybeSingle: async () => lookupResults[Math.min(state.lookupCount - 1, lookupResults.length - 1)]
          };
          return query;
        }
      };
    }
  };
  return { admin: admin as unknown as SupabaseClient, state };
}

describe('generation request idempotency', () => {
  it('creates a stable user-scoped UUID v5', async () => {
    const first = await generationRequestId('7efef3bb-f338-4619-97a6-55d6857efd21', 'canvas:image:request-001');
    const replay = await generationRequestId('7efef3bb-f338-4619-97a6-55d6857efd21', 'canvas:image:request-001');
    const otherUser = await generationRequestId('bd1d5ab9-8eb7-4341-86e8-7a6119c370ca', 'canvas:image:request-001');
    const otherKey = await generationRequestId('7efef3bb-f338-4619-97a6-55d6857efd21', 'canvas:image:request-002');

    expect(first).toBe(replay);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(otherUser).not.toBe(first);
    expect(otherKey).not.toBe(first);
  });

  it('returns the newly inserted deterministic request', async () => {
    const requestId = await generationRequestId('user-a', 'canvas:image:request-001');
    const row = { id: requestId, user_id: 'user-a', status: 'processing' };
    const { admin, state } = fakeAdmin(
      { data: row, error: null },
      { data: null, error: null }
    );

    const result = await insertGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      requestId,
      { prompt: 'first request' },
      'canvas:image:request-001'
    );

    expect(result).toEqual({ row, error: null, replayed: false });
    expect(state.inserted).toMatchObject({
      id: requestId,
      user_id: 'user-a',
      client_request_id: 'canvas:image:request-001',
      prompt: 'first request'
    });
    expect(state.lookupCount).toBe(0);
  });

  it('finds a deployed random-id job by the raw client request id first', async () => {
    const requestId = await generationRequestId('user-a', 'canvas:image:request-001');
    const deployed = {
      id: 'b6d6e991-0291-4ace-acaa-fb93b10a4d20',
      user_id: 'user-a',
      client_request_id: 'canvas:image:request-001',
      status: 'processing'
    };
    const { admin, state } = fakeAdmin(
      { data: null, error: null },
      { data: deployed, error: null }
    );

    await expect(findOwnedGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      requestId,
      'canvas:image:request-001'
    )).resolves.toEqual({ row: deployed, error: null });
    expect(state.lookupCount).toBe(1);
    expect(state.filters).toEqual([
      ['user_id', 'user-a'],
      ['client_request_id', 'canvas:image:request-001']
    ]);
  });

  it('falls back to the deterministic id for pre-column jobs', async () => {
    const requestId = await generationRequestId('user-a', 'canvas:image:request-001');
    const existing = { id: requestId, user_id: 'user-a', status: 'processing' };
    const { admin, state } = fakeAdmin(
      { data: null, error: null },
      [
        { data: null, error: null },
        { data: existing, error: null }
      ]
    );

    await expect(findOwnedGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      requestId,
      'canvas:image:request-001'
    )).resolves.toEqual({ row: existing, error: null });
    expect(state.lookupCount).toBe(2);
    expect(state.filters).toEqual([
      ['user_id', 'user-a'],
      ['client_request_id', 'canvas:image:request-001'],
      ['id', requestId],
      ['user_id', 'user-a']
    ]);
  });

  it('recovers the deployed winner after a raw-key unique-index race', async () => {
    const requestId = await generationRequestId('user-a', 'canvas:image:request-001');
    const deployed = {
      id: 'decc39f4-2153-4ced-844c-7c170908a5da',
      user_id: 'user-a',
      client_request_id: 'canvas:image:request-001',
      status: 'processing'
    };
    const { admin, state } = fakeAdmin(
      { data: null, error: { code: '23505', message: 'duplicate client request key' } },
      { data: deployed, error: null }
    );

    const result = await insertGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      requestId,
      { prompt: 'racing request' },
      'canvas:image:request-001'
    );

    expect(result).toEqual({ row: deployed, error: null, replayed: true });
    expect(state.lookupCount).toBe(1);
    expect(state.filters).toEqual([
      ['user_id', 'user-a'],
      ['client_request_id', 'canvas:image:request-001']
    ]);
  });

  it('reads and returns the winning row after a primary-key race', async () => {
    const requestId = await generationRequestId('user-a', 'canvas:video:request-001');
    const existing = { id: requestId, user_id: 'user-a', status: 'processing' };
    const { admin, state } = fakeAdmin(
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: existing, error: null }
    );

    const result = await insertGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      requestId,
      { prompt: 'racing request' }
    );

    expect(result).toEqual({ row: existing, error: null, replayed: true });
    expect(state.lookupCount).toBe(1);
    expect(state.filters).toEqual([
      ['id', requestId],
      ['user_id', 'user-a']
    ]);
  });

  it('does not treat unrelated insert failures as replays', async () => {
    const error = { code: '22001', message: 'value too long' };
    const { admin, state } = fakeAdmin(
      { data: null, error },
      { data: null, error: null }
    );

    const result = await insertGenerationRequest<GenerationRequestRecord>(
      admin,
      'user-a',
      'ff18b78f-f852-58c7-8293-384f72fe157c',
      { prompt: 'invalid request' }
    );

    expect(result).toEqual({ row: null, error, replayed: false });
    expect(state.lookupCount).toBe(0);
  });
});
