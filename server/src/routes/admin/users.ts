import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  countCardsInUserData,
  formatBytes,
  storageQuotaForProfile,
  tierLabel
} from '../../lib/admin-helpers';
import { deleteUserStorageFiles } from '../../lib/admin-storage';
import { createAdminClient, isMembershipActive, type Profile } from '../../lib/supabase';
import { roundCredits } from '../../lib/credit-math';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminUserRoutes = new Hono<{ Bindings: Env }>();

adminUserRoutes.use('*', requireAdminSecret);
adminUserRoutes.use('*', rateLimit(40, 60_000));

const creditAmountSchema = z
  .number()
  .min(0)
  .max(100_000_000)
  .transform(v => roundCredits(v));

const patchUserSchema = z.object({
  credits: creditAmountSchema.optional(),
  dailyCredits: creditAmountSchema.optional(),
  membershipTier: z.enum(['lite', 'basic', 'standard', 'pro']).nullable().optional(),
  membershipUntil: z.string().datetime().nullable().optional(),
  clearMembership: z.boolean().optional(),
  clearQueuedMembership: z.boolean().optional()
});

async function enrichProfileRow(
  admin: ReturnType<typeof createAdminClient>,
  profile: Profile,
  withEmail: boolean
) {
  let email: string | null = null;
  if (withEmail) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(profile.user_id);
      email = authUser?.user?.email ?? null;
    } catch {
      email = null;
    }
  }

  const storage = storageQuotaForProfile(profile);
  const memberActive = isMembershipActive(profile);

  return {
    userId: profile.user_id,
    email,
    displayName: profile.display_name || null,
    creditsPermanent: profile.credits ?? 0,
    dailyCredits: profile.daily_credits ?? 0,
    creditGrantMode: profile.credit_grant_mode,
    membershipTier: profile.membership_tier,
    membershipTierLabel: tierLabel(profile.membership_tier),
    membershipActive: memberActive,
    membershipUntil: profile.membership_until,
    membershipQueuedTier: profile.membership_queued_tier,
    membershipQueuedUntil: profile.membership_queued_until,
    storageBytes: profile.storage_bytes ?? 0,
    storageLabel: formatBytes(profile.storage_bytes ?? 0),
    storageQuota: storage,
    cardLimit: null,
    lifetimeCreditsSpent: profile.lifetime_credits_spent ?? 0
  };
}

async function findProfilesByEmailQuery(
  admin: ReturnType<typeof createAdminClient>,
  emailQuery: string,
  limit: number,
  offset: number
) {
  const needle = emailQuery.toLowerCase();
  const matchedIds: string[] = [];
  let page = 1;
  const perPage = 200;

  while (matchedIds.length < offset + limit && page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    if (!users.length) break;
    for (const u of users) {
      const email = (u.email || '').toLowerCase();
      if (email.includes(needle)) matchedIds.push(u.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  const slice = matchedIds.slice(offset, offset + limit);
  if (!slice.length) {
    return { items: [] as Profile[], total: matchedIds.length };
  }

  const { data: rows, error: profErr } = await admin
    .from('profiles')
    .select(
      'user_id, display_name, credits, daily_credits, daily_credits_date, membership_tier, membership_until, membership_queued_tier, membership_queued_until, storage_bytes, credit_grant_mode, lifetime_credits_spent'
    )
    .in('user_id', slice);

  if (profErr) throw profErr;

  const byId = new Map((rows ?? []).map(r => [r.user_id, r as Profile]));
  const ordered = slice.map(id => byId.get(id)).filter(Boolean) as Profile[];
  return { items: ordered, total: matchedIds.length };
}

adminUserRoutes.get('/', async c => {
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const q = (c.req.query('q') || '').trim();
  const withEmail = c.req.query('withEmail') !== '0';

  const admin = createAdminClient(c.env);
  let profiles: Profile[] = [];
  let total = 0;

  if (q.includes('@')) {
    const found = await findProfilesByEmailQuery(admin, q, limit, offset);
    profiles = found.items;
    total = found.total;
  } else {
    let query = admin
      .from('profiles')
      .select(
        'user_id, display_name, credits, daily_credits, daily_credits_date, membership_tier, membership_until, membership_queued_tier, membership_queued_until, storage_bytes, credit_grant_mode, lifetime_credits_spent',
        { count: 'exact' }
      )
      .order('credits', { ascending: false });

    if (q) {
      const safe = q.replace(/[%_\\]/g, '');
      query = query.or(`display_name.ilike.%${safe}%`);
    }

    const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    profiles = (rows ?? []) as Profile[];
    total = count ?? profiles.length;
  }

  const enriched = await Promise.all(
    profiles.map(p => enrichProfileRow(admin, p, withEmail))
  );

  return c.json({
    ok: true,
    data: {
      items: enriched,
      total,
      limit,
      offset
    }
  });
});

adminUserRoutes.get('/:userId', async c => {
  const userId = c.req.param('userId');
  const admin = createAdminClient(c.env);

  const { data: profile, error } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) throw new ApiError(404, 'NOT_FOUND', '用户不存在');

  const p = profile as Profile;
  let email: string | null = null;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    email = authUser?.user?.email ?? null;
  } catch {
    email = null;
  }

  const { data: ud } = await admin
    .from('user_data')
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  const cardCount = countCardsInUserData(ud?.data);
  const storageQuota = storageQuotaForProfile(p);

  const { data: redemptions } = await admin
    .from('code_redemptions')
    .select('code, redeemed_at')
    .eq('user_id', userId)
    .order('redeemed_at', { ascending: false })
    .limit(20);

  return c.json({
    ok: true,
    data: {
      userId,
      email,
      displayName: p.display_name,
      creditsPermanent: p.credits,
      dailyCredits: p.daily_credits,
      dailyCreditsDate: p.daily_credits_date,
      creditGrantMode: p.credit_grant_mode,
      membershipTier: p.membership_tier,
      membershipTierLabel: tierLabel(p.membership_tier),
      membershipActive: isMembershipActive(p),
      membershipUntil: p.membership_until,
      membershipQueuedTier: p.membership_queued_tier,
      membershipQueuedUntil: p.membership_queued_until,
      storageBytes: p.storage_bytes ?? 0,
      storageLabel: formatBytes(p.storage_bytes ?? 0),
      storageQuota,
      cardCount,
      cardLimit: null,
      cardsRemaining: null,
      cloudUpdatedAt: ud?.updated_at ?? null,
      lifetimeCreditsSpent: p.lifetime_credits_spent ?? 0,
      recentRedemptions: redemptions ?? []
    }
  });
});

adminUserRoutes.patch('/:userId', async c => {
  const userId = c.req.param('userId');
  const parsed = patchUserSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_BODY', parsed.error.issues[0]?.message || '参数无效');
  }
  const body = parsed.data;
  const admin = createAdminClient(c.env);

  const { data: existing, error: loadErr } = await admin
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!existing) throw new ApiError(404, 'NOT_FOUND', '用户不存在');

  const updates: Record<string, unknown> = {};
  if (body.credits !== undefined) updates.credits = body.credits;
  if (body.dailyCredits !== undefined) updates.daily_credits = body.dailyCredits;
  if (body.membershipTier !== undefined) updates.membership_tier = body.membershipTier;
  if (body.membershipUntil !== undefined) updates.membership_until = body.membershipUntil;
  if (body.clearMembership) {
    updates.membership_tier = null;
    updates.membership_until = null;
  }
  if (body.clearQueuedMembership) {
    updates.membership_queued_tier = null;
    updates.membership_queued_until = null;
  }

  if (!Object.keys(updates).length) {
    throw new ApiError(400, 'INVALID_BODY', '没有可更新的字段');
  }

  const { data: updated, error } = await admin
    .from('profiles')
    .update(updates)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;

  return c.json({
    ok: true,
    data: {
      userId,
      creditsPermanent: updated.credits,
      dailyCredits: updated.daily_credits,
      membershipTier: updated.membership_tier,
      membershipUntil: updated.membership_until,
      membershipQueuedTier: updated.membership_queued_tier,
      membershipQueuedUntil: updated.membership_queued_until,
      membershipActive: isMembershipActive(updated as Profile)
    }
  });
});

adminUserRoutes.delete('/:userId', async c => {
  const userId = c.req.param('userId');
  const admin = createAdminClient(c.env);

  const { data: existing, error: loadErr } = await admin
    .from('profiles')
    .select('user_id, display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!existing) throw new ApiError(404, 'NOT_FOUND', '用户不存在');

  let email: string | null = null;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    email = authUser?.user?.email ?? null;
  } catch {
    email = null;
  }

  let storageFilesRemoved = 0;
  let r2FilesRemoved = 0;
  let memfireFilesRemoved = 0;
  try {
    const removed = await deleteUserStorageFiles(admin, c.env, userId);
    storageFilesRemoved = removed.totalRemoved;
    r2FilesRemoved = removed.r2Removed;
    memfireFilesRemoved = removed.memfireRemoved;
  } catch {
    /* 存储清理失败不阻断账号删除 */
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    throw new ApiError(500, 'DELETE_FAILED', delErr.message || '删除用户失败');
  }

  return c.json({
    ok: true,
    data: {
      userId,
      email,
      displayName: existing.display_name,
      storageFilesRemoved,
      r2FilesRemoved,
      memfireFilesRemoved
    }
  });
});
