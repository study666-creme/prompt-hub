import { createMiddleware } from 'hono/factory';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../lib/errors';
import { verifySupabaseAccessToken } from '../lib/verify-auth-jwt';
import type { Env } from '../env';

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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
  }

  c.set('user', {
    id: data.user.id,
    email: data.user.email,
    phone: data.user.phone ?? undefined,
    phoneVerified: !!data.user.phone_confirmed_at
  });
  await next();
});
