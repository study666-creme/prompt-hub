import { createMiddleware } from 'hono/factory';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../lib/errors';
import { verifySupabaseAccessToken } from '../lib/verify-auth-jwt';
import type { Env } from '../env';

const AUTH_USER_CACHE_TTL_MS = 15_000;
const AUTH_USER_FETCH_TIMEOUT_MS = 8_000;
const AUTH_USER_CACHE_MAX_ENTRIES = 1_000;
const authUserCache = new Map<string, { user: AuthUser; expiresAt: number }>();

export type AuthUser = {
  id: string;
  email?: string;
  phone?: string;
  phoneVerified: boolean;
};

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    envBindings: Env;
  }
}

export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return next();
  }
  const env = c.env;
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHORIZED', '请先登录');
  }
  const token = header.slice(7).trim();
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', '无效的登录凭证');

  const verified = await verifySupabaseAccessToken(env, token);
  if (verified) {
    c.set('user', verified);
    await next();
    return;
  }

  const cached = readCachedAuthUser(token);
  if (cached) {
    c.set('user', cached);
    await next();
    return;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchSupabaseAuthWithTimeout }
  });

  const { data, error } = await getUserWithRetry(supabase, token);
  if (error || !data.user) {
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
  }

  const user: AuthUser = {
    id: data.user.id,
    email: data.user.email,
    phone: data.user.phone ?? undefined,
    phoneVerified: !!data.user.phone_confirmed_at
  };
  writeCachedAuthUser(token, user);
  c.set('user', user);
  await next();
});

function readCachedAuthUser(token: string): AuthUser | null {
  const entry = authUserCache.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    authUserCache.delete(token);
    return null;
  }
  return entry.user;
}

function writeCachedAuthUser(token: string, user: AuthUser): void {
  if (authUserCache.size >= AUTH_USER_CACHE_MAX_ENTRIES) {
    const oldest = authUserCache.keys().next().value;
    if (oldest) authUserCache.delete(oldest);
  }
  authUserCache.set(token, { user, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
}

async function fetchSupabaseAuthWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_USER_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getUserWithRetry(
  supabase: SupabaseClient,
  token: string
) {
  let result = await supabase.auth.getUser(token);
  if (!result.error || !isRetryableAuthError(result.error)) return result;
  await new Promise(resolve => setTimeout(resolve, 150));
  result = await supabase.auth.getUser(token);
  return result;
}

function isRetryableAuthError(error: { status?: number; name?: string }): boolean {
  return (typeof error.status === 'number' && error.status >= 500)
    || error.name === 'AuthRetryableFetchError';
}
