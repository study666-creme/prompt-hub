import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

const bodySchema = z.object({
  count: z.number().int().min(1).max(200).default(1),
  credits: z.number().int().min(1).max(10_000_000),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  note: z.string().max(200).optional(),
  prefix: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, '前缀仅允许字母数字与连字符')
    .default('PH'),
  expiresAt: z.string().datetime().optional()
});

function randomSuffix(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i]! % chars.length];
  return out;
}

function buildCode(prefix: string): string {
  return `${prefix.toUpperCase()}-${randomSuffix(12)}`;
}

export const adminCodeRoutes = new Hono<{ Bindings: Env }>();

adminCodeRoutes.use('*', requireAdminSecret);
adminCodeRoutes.use('*', rateLimit(30, 60_000));

/** 批量生成激活码（淘宝发卡 / 运营备货） */
adminCodeRoutes.post('/', async c => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请求参数无效');
  }

  const { count, credits, maxUses, note, prefix, expiresAt } = parsed.data;
  const admin = createAdminClient(c.env);
  const rows: {
    code: string;
    credits: number;
    max_uses: number;
    active: boolean;
    note: string | null;
    expires_at?: string;
  }[] = [];
  const seen = new Set<string>();

  while (rows.length < count) {
    const code = buildCode(prefix);
    if (seen.has(code)) continue;
    seen.add(code);
    rows.push({
      code,
      credits,
      max_uses: maxUses,
      active: true,
      note: note ?? null,
      ...(expiresAt ? { expires_at: expiresAt } : {})
    });
  }

  const { data, error } = await admin
    .from('activation_codes')
    .insert(rows)
    .select('code, credits, max_uses, note, created_at');

  if (error) {
    if (String(error.message).includes('duplicate')) {
      throw new ApiError(409, 'DUPLICATE_CODE', '码冲突，请重试');
    }
    throw error;
  }

  return c.json({
    ok: true,
    data: {
      created: data?.length ?? rows.length,
      creditsPerCode: credits,
      codes: (data ?? rows).map(r => r.code)
    }
  });
});
