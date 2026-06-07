import type { Context } from 'hono';
import { applyCorsHeaders } from './cors-headers';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(c: Context, err: unknown) {
  applyCorsHeaders(c);
  if (err instanceof ApiError) {
    return c.json(
      {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? undefined
        }
      },
      err.status as 400
    );
  }
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  const configHint = msg.includes('SITE_SETTINGS_TABLE_MISSING')
    ? '请先在 Supabase 执行 site_settings 建表 SQL（见 supabase/migrations/20260602160000_*.sql）'
    : msg.includes('SITE_SETTINGS_PERMISSION')
      ? '请执行 supabase/migrations/20260602200000_site_settings_grants.sql 授予 service_role 权限'
      : msg.includes('SITE_SETTINGS_SAVE_VERIFY_FAILED')
        ? '保存后读不到数据：请确认 Worker 的 SUPABASE_URL 与你在 SQL 编辑器里用的是同一个 Supabase 项目'
        : msg.includes('sb_secret_') || msg.includes('Publishable')
          ? '请在 server 执行 npm run secret-service-role 并粘贴 sb_secret_ 密钥后 npm run deploy'
          : /ICP Filing|aliyun_icp|备案|cloudflare_ssrf_1003|Supabase admin credentials/i.test(msg)
            ? 'Worker 的 SUPABASE_URL 仍指向阿里云 RDS 或裸 IP。prompt-hubs.com 请改为境外 https://xxxxx.supabase.co 后 redeploy（见 docs/OVERSEAS-FIRST.md）'
            : undefined;
  return c.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: configHint || '服务器内部错误',
        details: configHint ? undefined : msg.slice(0, 200)
      }
    },
    500
  );
}
