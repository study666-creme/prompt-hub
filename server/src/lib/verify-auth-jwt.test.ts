import { describe, expect, it } from 'vitest';
import { verifySupabaseAccessToken } from './verify-auth-jwt';

describe('verifySupabaseAccessToken', () => {
  it('rejects malformed token', async () => {
    const user = await verifySupabaseAccessToken(
      { SUPABASE_URL: 'https://example.supabase.co' } as never,
      'not-a-jwt'
    );
    expect(user).toBeNull();
  });

  it('rejects expired token payload', async () => {
    const header = btoa(JSON.stringify({ alg: 'ES256', kid: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ sub: 'user-1', exp: 1 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const user = await verifySupabaseAccessToken(
      { SUPABASE_URL: 'https://example.supabase.co' } as never,
      `${header}.${payload}.sig`
    );
    expect(user).toBeNull();
  });
});
