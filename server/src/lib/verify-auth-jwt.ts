import type { Env } from '../env';

export type VerifiedAuthUser = {
  id: string;
  email?: string;
  phone?: string;
  phoneVerified: boolean;
};

type JwtHeader = { alg?: string; kid?: string; typ?: string };
type JwtPayload = {
  sub?: string;
  email?: string;
  phone?: string;
  phone_confirmed_at?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  role?: string;
};

type JwksCacheEntry = { keys: JsonWebKey[]; expiresAt: number };

const JWKS_CACHE = new Map<string, JwksCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function decodeJwtPart<T>(part: string): T | null {
  try {
    const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return JSON.parse(atob(b64)) as T;
  } catch {
    return null;
  }
}

function base64UrlToBytes(part: string): Uint8Array | null {
  try {
    const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function issuerAuthBase(payload: JwtPayload, env: Env): string | null {
  const iss = String(payload.iss || '').trim().replace(/\/$/, '');
  if (iss.endsWith('/auth/v1')) return iss;
  const envBase = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  if (envBase) return `${envBase}/auth/v1`;
  return iss || null;
}

async function fetchJwks(authBase: string): Promise<JsonWebKey[]> {
  const url = `${authBase.replace(/\/$/, '')}/.well-known/jwks.json`;
  const cached = JWKS_CACHE.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } as RequestInit['cf'] });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const json = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = Array.isArray(json.keys) ? json.keys : [];
  JWKS_CACHE.set(url, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

async function verifyEs256(
  signingInput: string,
  signature: Uint8Array,
  jwk: JsonWebKey
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature,
    new TextEncoder().encode(signingInput)
  );
}

async function verifyHs256(
  signingInput: string,
  signature: Uint8Array,
  secret: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(signingInput));
}

function payloadToUser(payload: JwtPayload): VerifiedAuthUser | null {
  const id = String(payload.sub || '').trim();
  if (!id) return null;
  if (payload.role === 'anon') return null;
  return {
    id,
    email: payload.email,
    phone: payload.phone,
    phoneVerified: !!payload.phone_confirmed_at
  };
}

function isPayloadFresh(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp != null && payload.exp <= now) return false;
  if (payload.nbf != null && payload.nbf > now + 30) return false;
  return true;
}

/** 本地校验 Supabase 会话 JWT（JWKS / JWT secret），避免 getUser 与 SUPABASE_URL 不一致时全站 401 */
export async function verifySupabaseAccessToken(
  env: Env,
  token: string
): Promise<VerifiedAuthUser | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const header = decodeJwtPart<JwtHeader>(parts[0]);
  const payload = decodeJwtPart<JwtPayload>(parts[1]);
  if (!header || !payload || !isPayloadFresh(payload)) return null;

  const signature = base64UrlToBytes(parts[2]);
  if (!signature) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const alg = String(header.alg || '').toUpperCase();

  if (alg === 'HS256') {
    const secret = env.SUPABASE_JWT_SECRET?.trim();
    if (!secret) return null;
    const ok = await verifyHs256(signingInput, signature, secret);
    return ok ? payloadToUser(payload) : null;
  }

  if (alg === 'ES256') {
    const authBase = issuerAuthBase(payload, env);
    if (!authBase) return null;
    const keys = await fetchJwks(authBase);
    const jwk =
      keys.find((k) => (k as JsonWebKey & { kid?: string }).kid === header.kid) || keys[0];
    if (!jwk) return null;
    const ok = await verifyEs256(signingInput, signature, jwk);
    return ok ? payloadToUser(payload) : null;
  }

  return null;
}
