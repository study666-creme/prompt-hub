import type { Context } from 'hono';
import { applyCorsHeaders } from './cors-headers';
import { containsPrivatePublicMetadata } from './public-model-projection';

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

const PRIVATE_ERROR_DETAIL_PATTERN = /(?:api[_\s-]?key|secret|supabase|memfire|redis|cloudflare|\br2\b|database|db[_\s-]?error|migration|service[_\s-]?role|table\s+\w+)/i;
const PUBLIC_ERROR_CODES = new Set([
  'ALREADY_CLAIMED',
  'ALREADY_MEMBER',
  'ALREADY_REDEEMED',
  'CARD_LIMIT',
  'CODE_EXHAUSTED',
  'CODE_EXPIRED',
  'CONFLICT',
  'CONTENT_REJECTED',
  'EMPTY_PACKAGE',
  'FORBIDDEN',
  'GACHA_LIMIT',
  'INSUFFICIENT_CREDITS',
  'INVALID_CODE',
  'INVALID_IMAGE',
  'INVALID_SIGNATURE',
  'LITE_DAILY_ONLY',
  'MODEL_UNAVAILABLE',
  'NOT_FOUND',
  'NOT_MEMBER',
  'NOT_READY',
  'ORDER_NOT_FOUND',
  'ORDER_PROCESSING',
  'PAYMENT_AMOUNT_MISMATCH',
  'PAYMENT_INCOMPLETE',
  'PAYMENT_METHOD_MISMATCH',
  'PAYMENT_REQUIRED',
  'PHONE_REQUIRED',
  'PRODUCT_NOT_FOUND',
  'RATE_LIMITED',
  'SELF_INVITE',
  'SELF_LIKE',
  'SERVICE_UNAVAILABLE',
  'STORAGE_QUOTA',
  'TRIAL_USED',
  'UNAUTHORIZED',
  'UNKNOWN_TASK',
  'VALIDATION_ERROR'
]);

function publicErrorFallbackCode(status: number): string {
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 402) return 'PAYMENT_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'SERVICE_UNAVAILABLE';
}

function publicErrorCode(status: number, code: string): string {
  const normalized = String(code || '').trim().toUpperCase().slice(0, 80);
  return PUBLIC_ERROR_CODES.has(normalized) ? normalized : publicErrorFallbackCode(status);
}

function isReviewedPublicErrorCode(code: string): boolean {
  return PUBLIC_ERROR_CODES.has(String(code || '').trim().toUpperCase().slice(0, 80));
}

function publicErrorFallback(status: number): string {
  if (status === 400) return '请求参数无效';
  if (status === 401) return '请先登录';
  if (status === 402) return '积分不足或当前余额不可用';
  if (status === 403) return '当前操作不可用';
  if (status === 404) return '未找到相关内容';
  if (status === 409) return '当前状态已变化，请刷新后重试';
  if (status === 429) return '请求过于频繁，请稍后重试';
  return '服务暂时不可用，请稍后重试';
}

function publicErrorMessage(status: number, message: string): string {
  const text = String(message || '').trim();
  if (!text || containsPrivatePublicMetadata(text) || PRIVATE_ERROR_DETAIL_PATTERN.test(text)) {
    return publicErrorFallback(status);
  }
  return text.slice(0, 240);
}

export function jsonError(c: Context, err: unknown) {
  applyCorsHeaders(c);
  const isAdmin = c.req.path.startsWith('/api/admin');
  if (err instanceof ApiError) {
    const publicCode = publicErrorCode(err.status, err.code);
    return c.json(
      {
        ok: false,
        error: {
          code: isAdmin ? err.code : publicCode,
          message: isAdmin
            ? err.message
            : isReviewedPublicErrorCode(err.code)
              ? publicErrorMessage(err.status, err.message)
              : publicErrorFallback(err.status),
          details: isAdmin ? err.details ?? undefined : undefined
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
            ? 'Worker 的 SUPABASE_URL 指向不可访问的旧 RDS 或裸 IP。生产请改为当前 MemFire API URL 后重新部署（见 docs/OVERSEAS-FIRST.md）'
            : undefined;
  return c.json(
    {
      ok: false,
      error: {
        code: isAdmin ? 'INTERNAL_ERROR' : 'SERVICE_UNAVAILABLE',
        message: isAdmin ? (configHint || '服务器内部错误') : '服务暂时不可用，请稍后重试',
        details: isAdmin && !configHint ? msg.slice(0, 200) : undefined
      }
    },
    500
  );
}
