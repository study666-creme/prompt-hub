import { Hono } from 'hono';
import type { Env } from '../../env';
import { formatBytes } from '../../lib/admin-helpers';
import { scanBucketUsage } from '../../lib/admin-storage';
import { createAdminClient, isMembershipActive } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminDashboardRoutes = new Hono<{ Bindings: Env }>();

adminDashboardRoutes.use('*', requireAdminSecret);
adminDashboardRoutes.use('*', rateLimit(60, 60_000));

function quotaMb(env: Env, key: 'SUPABASE_STORAGE_QUOTA_MB' | 'SUPABASE_DB_QUOTA_MB', fallback: number) {
  const raw = env[key]?.trim();
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

adminDashboardRoutes.get('/', async c => {
  const admin = createAdminClient(c.env);

  const [
    profilesRes,
    codesActiveRes,
    codesUsedRes,
    redemptionsRes
  ] = await Promise.all([
    admin.from('profiles').select('user_id, membership_tier, membership_until, credits, storage_bytes'),
    admin.from('activation_codes').select('code', { count: 'exact', head: true }).eq('active', true),
    admin
      .from('activation_codes')
      .select('code', { count: 'exact', head: true })
      .gt('used_count', 0),
    admin
      .from('code_redemptions')
      .select('id', { count: 'exact', head: true })
  ]);

  if (profilesRes.error) throw profilesRes.error;

  const profiles = profilesRes.data ?? [];
  let members = 0;
  const byTier: Record<string, number> = {
    lite: 0,
    basic: 0,
    standard: 0,
    pro: 0
  };
  let totalCredits = 0;
  let totalStorageBytes = 0;

  for (const p of profiles) {
    totalCredits += Number(p.credits) || 0;
    totalStorageBytes += Number(p.storage_bytes) || 0;
    if (isMembershipActive(p as { membership_tier: typeof p.membership_tier; membership_until: string | null })) {
      members += 1;
      const t = p.membership_tier || 'basic';
      if (t in byTier) byTier[t] += 1;
    }
  }

  return c.json({
    ok: true,
    data: {
      usersTotal: profiles.length,
      membersActive: members,
      membersByTier: byTier,
      totalPermanentCredits: totalCredits,
      totalStorageBytes,
      codesActive: codesActiveRes.count ?? 0,
      codesPartiallyUsed: codesUsedRes.count ?? 0,
      redemptionsTotal: redemptionsRes.count ?? 0
    }
  });
});

/** 扫描 Storage 桶用量（较慢，单独请求） */
adminDashboardRoutes.get('/storage', async c => {
  const admin = createAdminClient(c.env);
  const storageQuotaMb = quotaMb(c.env, 'SUPABASE_STORAGE_QUOTA_MB', 1024);
  const dbQuotaMb = quotaMb(c.env, 'SUPABASE_DB_QUOTA_MB', 500);

  const [bucketUsage, profilesRes] = await Promise.all([
    scanBucketUsage(admin),
    admin.from('profiles').select('storage_bytes')
  ]);

  if (profilesRes.error) throw profilesRes.error;

  let registeredBytes = 0;
  for (const row of profilesRes.data ?? []) {
    registeredBytes += Number(row.storage_bytes) || 0;
  }

  const storageQuotaBytes = storageQuotaMb * 1024 * 1024;
  const dbQuotaBytes = dbQuotaMb * 1024 * 1024;
  const bucketBytes = bucketUsage.bytes;

  return c.json({
    ok: true,
    data: {
      bucketBytes,
      bucketLabel: formatBytes(bucketBytes),
      bucketFileCount: bucketUsage.fileCount,
      bucketScanTruncated: bucketUsage.truncated,
      registeredBytes,
      registeredLabel: formatBytes(registeredBytes),
      storageQuotaMb,
      storageQuotaBytes,
      storageQuotaLabel: formatBytes(storageQuotaBytes),
      storageRemainingBytes: Math.max(0, storageQuotaBytes - bucketBytes),
      storageRemainingLabel: formatBytes(Math.max(0, storageQuotaBytes - bucketBytes)),
      storageUsedPercent: storageQuotaBytes
        ? Math.min(100, Math.round((bucketBytes / storageQuotaBytes) * 1000) / 10)
        : 0,
      dbQuotaMb,
      dbQuotaBytes,
      dbQuotaLabel: formatBytes(dbQuotaBytes),
      dbNote:
        '数据库实际占用需在 Supabase 控制台 → Project Settings → Usage 查看；此处登记用量为 profiles.storage_bytes 合计'
    }
  });
});
