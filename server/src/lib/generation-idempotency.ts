import type { SupabaseClient } from '@supabase/supabase-js';

const GENERATION_REQUEST_NAMESPACE = '9f53f07e-e366-4d87-8496-10d13dcaf45e';

export const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type GenerationRequestRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
  client_request_id?: string | null;
};

export type GenerationRequestLookup<T extends GenerationRequestRecord> = {
  row: T | null;
  error: unknown | null;
};

export type GenerationRequestInsert<T extends GenerationRequestRecord> =
  GenerationRequestLookup<T> & {
    replayed: boolean;
  };

function uuidBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid UUID namespace');
  return Uint8Array.from(hex.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 UUID v5 scoped to one authenticated user and one Canvas request key. */
export async function generationRequestId(userId: string, clientRequestId: string): Promise<string> {
  const namespace = uuidBytes(GENERATION_REQUEST_NAMESPACE);
  const name = new TextEncoder().encode(`${userId}\0${clientRequestId}`);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function isUniqueViolation(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && String((error as { code?: unknown }).code || '') === '23505';
}

export async function findOwnedGenerationRequest<T extends GenerationRequestRecord>(
  admin: SupabaseClient,
  userId: string,
  requestId: string | null,
  clientRequestId?: string
): Promise<GenerationRequestLookup<T>> {
  if (clientRequestId) {
    const { data, error } = await admin
      .from('generation_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (error || data) {
      return { row: (data as T | null) || null, error: error || null };
    }
  }

  if (!requestId) return { row: null, error: null };
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', requestId)
    .eq('user_id', userId)
    .maybeSingle();
  return { row: (data as T | null) || null, error: error || null };
}

/**
 * The deterministic primary key is the transaction boundary. A duplicate
 * insert reads the winner and tells the caller to return before billing or
 * invoking an upstream provider.
 */
export async function insertGenerationRequest<T extends GenerationRequestRecord>(
  admin: SupabaseClient,
  userId: string,
  requestId: string | null,
  values: Record<string, unknown>,
  clientRequestId?: string
): Promise<GenerationRequestInsert<T>> {
  const { data, error } = await admin
    .from('generation_requests')
    .insert({
      ...values,
      user_id: userId,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
      ...(requestId ? { id: requestId } : {})
    })
    .select('*')
    .single();

  if (!error && data) {
    return { row: data as T, error: null, replayed: false };
  }
  if ((!requestId && !clientRequestId) || !isUniqueViolation(error)) {
    return { row: null, error: error || null, replayed: false };
  }

  const existing = await findOwnedGenerationRequest<T>(
    admin,
    userId,
    requestId,
    clientRequestId
  );
  if (existing.error || !existing.row) {
    return { row: null, error: existing.error || error || null, replayed: false };
  }
  return { row: existing.row, error: null, replayed: true };
}
