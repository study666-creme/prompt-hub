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

/** 可选鉴权：带有效 token 时识别身份，否则匿名放行（公告等公开读接口用）。 */
export const optionalAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    await next();
    return;
  }
  try {
    const verified = await verifySupabaseAccessToken(c.env, token);
    const user = verified || readCachedAuthUser(token);
    if (user) {
      c.set('user', user);
      await next();
      return;
    }
    const fallback = await fetchAuthUserFromSupabase(c.env, token);
    if (fallback) c.set('user', fallback);
  } catch {
    // 无效/过期 token 按匿名放行，公开读接口不应因坏 token 整体失败
  }
  await next();
});

async function fetchAuthUserFromSupabase(env: Env, token: string): Promise<AuthUser | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchSupabaseAuthWithTimeout }
  });
  const { data, error } = await getUserWithRetry(supabase, token);
  if (error || !data.user) return null;
  const user: AuthUser = {
    id: data.user.id,
    email: data.user.email,
    phone: data.user.phone ?? undefined,
    phoneVerified: !!data.user.phone_confirmed_at
  };
  writeCachedAuthUser(token, user);
  return user;
}

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
