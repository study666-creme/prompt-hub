import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

const createBodySchema = z.object({
  count: z.number().int().min(1).max(200).default(1),
  credits: z.number().int().min(0).max(10_000_000).default(0),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  note: z.string().max(200).optional(),
  membershipTier: z.enum(['lite', 'basic', 'standard', 'pro']).optional(),
  membershipDays: z.number().int().min(0).max(3650).optional(),
  prefix: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, '前缀仅允许字母数字与连字符')
    .default('PH'),
  expiresAt: z.string().datetime().optional()
});

const patchBodySchema = z.object({
  active: z.boolean().optional(),
  note: z.string().max(200).optional()
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

/** 激活码列表 */
adminCodeRoutes.get('/', async c => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 30));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const active = c.req.query('active');
  const search = (c.req.query('q') || '').trim().toUpperCase();

  const admin = createAdminClient(c.env);
  let query = admin
    .from('activation_codes')
    .select(
      'code, credits, membership_tier, membership_days, max_uses, used_count, active, note, expires_at, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (active === 'true') query = query.eq('active', true);
  if (active === 'false') query = query.eq('active', false);
  if (search) query = query.ilike('code', `%${search}%`);

  const { data, error, count } = await query;
  if (error) throw error;

  return c.json({
    ok: true,
    data: {
      items: data ?? [],
      total: count ?? 0,
      limit,
      offset
    }
  });
});

/** 启用 / 停用激活码 */
adminCodeRoutes.patch('/:code', async c => {
  const code = c.req.param('code').trim().toUpperCase();
  const parsed = patchBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请求参数无效');
  }
  const patch: Record<string, unknown> = {};
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;
  if (!Object.keys(patch).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无有效更新字段');
  }

  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('activation_codes')
    .update(patch)
    .eq('code', code)
    .select('code, active, note')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ApiError(404, 'NOT_FOUND', '激活码不存在');

  return c.json({ ok: true, data });
});

/** 批量生成激活码（淘宝发卡 / 运营备货） */
adminCodeRoutes.post('/', async c => {
  const parsed = createBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请求参数无效');
  }

  const { count, credits, maxUses, note, prefix, expiresAt, membershipTier, membershipDays } =
    parsed.data;
  if (credits <= 0 && !membershipTier && !(membershipDays && membershipDays > 0)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '至少填写积分或会员天数');
  }
  const admin = createAdminClient(c.env);
  const rows: {
    code: string;
    credits: number;
    max_uses: number;
    active: boolean;
    note: string | null;
    membership_tier?: string | null;
    membership_days?: number | null;
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
      membership_tier: membershipTier ?? null,
      membership_days: membershipDays && membershipDays > 0 ? membershipDays : null,
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
