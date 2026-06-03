import { Hono } from 'hono';
import type { Env } from '../../env';
import { formatBytes } from '../../lib/admin-helpers';
import { scanBucketUsage } from '../../lib/admin-storage';
import { storagePolicySummary } from '../../lib/storage-quota';
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

function optionalUsedMb(env: Env, key: 'SUPABASE_STORAGE_USED_MB' | 'SUPABASE_DB_USED_MB') {
  const raw = env[key]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function usageStatus(usedBytes: number, quotaBytes: number) {
  if (!quotaBytes) return 'unknown' as const;
  const pct = (usedBytes / quotaBytes) * 100;
  if (pct >= 95) return 'critical' as const;
  if (pct >= 80) return 'warn' as const;
  return 'ok' as const;
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
      redemptionsTotal: redemptionsRes.count ?? 0,
      storagePolicy: storagePolicySummary()
    }
  });
});

/** 运行环境与配额配置（只读，不含密钥） */
adminDashboardRoutes.get('/infra', async c => {
  const url = new URL(c.req.url);
  const supabaseHost = (() => {
    try {
      return c.env.SUPABASE_URL ? new URL(c.env.SUPABASE_URL).host : null;
    } catch {
      return null;
    }
  })();
  const hasServiceKey = !!(c.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const serviceKeyOk =
    hasServiceKey && !c.env.SUPABASE_SERVICE_ROLE_KEY!.trim().startsWith('sb_publishable_');
  let dbPing: 'ok' | 'error' | 'misconfigured' = 'ok';
  if (!serviceKeyOk) dbPing = 'misconfigured';
  else {
    try {
      const admin = createAdminClient(c.env);
      const { error } = await admin.from('profiles').select('user_id').limit(1);
      if (error) dbPing = 'error';
    } catch {
      dbPing = 'error';
    }
  }
  return c.json({
    ok: true,
    data: {
      apiOrigin: url.origin,
      environment: c.env.ENVIRONMENT || 'unknown',
      workerService: 'prompt-hub-api',
      pagesHint: 'https://prompt-hub.cn',
      supabaseProjectHost: supabaseHost,
      supabaseServiceKeyConfigured: hasServiceKey,
      supabaseServiceKeyLooksValid: serviceKeyOk,
      supabaseDbPing: dbPing,
      imageApiConfigured: !!(c.env.IMAGE_API_KEY?.trim()),
      chatApiConfigured: !!(c.env.CHAT_API_KEY?.trim()),
      storageQuotaMbEnv: quotaMb(c.env, 'SUPABASE_STORAGE_QUOTA_MB', 1024),
      dbQuotaMbEnv: quotaMb(c.env, 'SUPABASE_DB_QUOTA_MB', 500),
      storageUsedMbEnv: optionalUsedMb(c.env, 'SUPABASE_STORAGE_USED_MB'),
      dbUsedMbEnv: optionalUsedMb(c.env, 'SUPABASE_DB_USED_MB'),
      userStoragePolicy: storagePolicySummary(),
      notes: [
        '用户云存储按 profiles.storage_bytes 登记；单文件上限见 Supabase 桶 card-images（建议 50MB）',
        'Supabase 控制台 → Project Settings → Usage：Database 与 File Storage 分开统计，勿混为一谈',
        '可在 Worker 环境变量填 SUPABASE_DB_USED_MB / SUPABASE_STORAGE_USED_MB（从 Usage 页读数）以显示真实占比',
        'Cloudflare Workers 用量在 Cloudflare 控制台 → Workers & Pages',
        '本接口不返回任何密钥'
      ]
    }
  });
});

/** 扫描 Storage 桶用量（较慢，单独请求） */
adminDashboardRoutes.get('/storage', async c => {
  const admin = createAdminClient(c.env);
  const storageQuotaMb = quotaMb(c.env, 'SUPABASE_STORAGE_QUOTA_MB', 1024);
  const dbQuotaMb = quotaMb(c.env, 'SUPABASE_DB_QUOTA_MB', 500);
  const storageUsedMbEnv = optionalUsedMb(c.env, 'SUPABASE_STORAGE_USED_MB');
  const dbUsedMbEnv = optionalUsedMb(c.env, 'SUPABASE_DB_USED_MB');

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
  const bucketScanPercent = storageQuotaBytes
    ? Math.min(100, Math.round((bucketBytes / storageQuotaBytes) * 1000) / 10)
    : 0;

  const projectStorageUsedBytes = storageUsedMbEnv != null
    ? storageUsedMbEnv * 1024 * 1024
    : bucketBytes;
  const projectStorageSource = storageUsedMbEnv != null ? 'env' : 'bucket_scan';
  const projectStoragePercent = storageQuotaBytes
    ? Math.min(100, Math.round((projectStorageUsedBytes / storageQuotaBytes) * 1000) / 10)
    : 0;
  const projectStorageStatus =
    storageUsedMbEnv != null
      ? usageStatus(projectStorageUsedBytes, storageQuotaBytes)
      : bucketBytes > storageQuotaBytes
        ? ('warn' as const)
        : ('unknown' as const);

  const dbUsedBytes = dbUsedMbEnv != null ? dbUsedMbEnv * 1024 * 1024 : null;
  const dbPercent = dbUsedBytes != null && dbQuotaBytes
    ? Math.min(100, Math.round((dbUsedBytes / dbQuotaBytes) * 1000) / 10)
    : null;

  const alerts: Array<{ level: string; title: string; detail: string }> = [];
  if (dbUsedBytes != null && dbQuotaBytes && dbUsedBytes > dbQuotaBytes) {
    alerts.push({
      level: 'critical',
      title: '数据库用量超过参考配额',
      detail: `${formatBytes(dbUsedBytes)} / ${formatBytes(dbQuotaBytes)}（来自 SUPABASE_DB_USED_MB）`
    });
  } else if (dbUsedBytes != null && dbPercent != null && dbPercent >= 80) {
    alerts.push({
      level: 'warn',
      title: '数据库用量偏高',
      detail: `${dbPercent}% · ${formatBytes(dbUsedBytes)} / ${formatBytes(dbQuotaBytes)}`
    });
  }
  if (storageUsedMbEnv != null && projectStorageUsedBytes > storageQuotaBytes) {
    alerts.push({
      level: 'critical',
      title: '项目文件存储超过参考配额',
      detail: `${formatBytes(projectStorageUsedBytes)} / ${formatBytes(storageQuotaBytes)}（Supabase Usage 同步值）`
    });
  } else if (storageUsedMbEnv != null && projectStoragePercent >= 80) {
    alerts.push({
      level: 'warn',
      title: '项目文件存储用量偏高',
      detail: `${projectStoragePercent}% · ${formatBytes(projectStorageUsedBytes)} / ${formatBytes(storageQuotaBytes)}`
    });
  } else if (storageUsedMbEnv == null && bucketBytes > storageQuotaBytes) {
    alerts.push({
      level: 'warn',
      title: '桶扫描估算偏高，请以 Supabase Usage 为准',
      detail: `扫描合计 ${formatBytes(bucketBytes)}，Supabase 账单 Storage Size 通常更低。请填 SUPABASE_STORAGE_USED_MB=754（或 Usage 页当前读数）。`
    });
  } else if (storageUsedMbEnv == null && bucketScanPercent >= 85) {
    alerts.push({
      level: 'warn',
      title: '桶扫描估算偏高',
      detail: `扫描 ${formatBytes(bucketBytes)} / 配额 ${formatBytes(storageQuotaBytes)}。未填 Usage 读数前勿据此判断超限。`
    });
  }
  if (registeredBytes > projectStorageUsedBytes * 1.5 && registeredBytes > 50 * 1024 * 1024) {
    alerts.push({
      level: 'warn',
      title: '用户登记存储明显高于桶扫描',
      detail: `登记 ${formatBytes(registeredBytes)} · 桶扫描 ${formatBytes(bucketBytes)}（可能有未删文件或登记偏差）`
    });
  } else if (
    bucketBytes > registeredBytes * 2 &&
    bucketBytes > 100 * 1024 * 1024 &&
    registeredBytes < bucketBytes * 0.5
  ) {
    alerts.push({
      level: 'warn',
      title: '用户登记存储明显低于桶内实际',
      detail: `桶内约 ${formatBytes(bucketBytes)}，登记合计仅 ${formatBytes(registeredBytes)}。历史图片上传时未上报 storage_bytes，可在下方「回填登记」修正。`
    });
  }

  const topUsersByBucket = (bucketUsage.byUser ?? []).slice(0, 8).map((u) => ({
    userId: u.userId,
    bytes: u.bytes,
    label: formatBytes(u.bytes),
    fileCount: u.fileCount
  }));

  return c.json({
    ok: true,
    data: {
      bucketBytes,
      bucketLabel: formatBytes(bucketBytes),
      bucketFileCount: bucketUsage.fileCount,
      bucketScanTruncated: bucketUsage.truncated,
      bucketScanPercent,
      topUsersByBucket,
      registeredBytes,
      registeredLabel: formatBytes(registeredBytes),
      projectStorage: {
        usedBytes: projectStorageUsedBytes,
        usedLabel: formatBytes(projectStorageUsedBytes),
        quotaMb: storageQuotaMb,
        quotaBytes: storageQuotaBytes,
        quotaLabel: formatBytes(storageQuotaBytes),
        percentUsed: projectStoragePercent,
        source: projectStorageSource,
        status: projectStorageStatus
      },
      database: {
        usedMb: dbUsedMbEnv,
        usedBytes: dbUsedBytes,
        usedLabel: dbUsedBytes != null ? formatBytes(dbUsedBytes) : null,
        quotaMb: dbQuotaMb,
        quotaBytes: dbQuotaBytes,
        quotaLabel: formatBytes(dbQuotaBytes),
        percentUsed: dbPercent,
        configured: dbUsedMbEnv != null,
        status: dbUsedBytes != null ? usageStatus(dbUsedBytes, dbQuotaBytes) : 'unknown'
      },
      alerts,
      storageQuotaMb,
      storageQuotaBytes,
      storageQuotaLabel: formatBytes(storageQuotaBytes),
      storageRemainingBytes: Math.max(0, storageQuotaBytes - projectStorageUsedBytes),
      storageRemainingLabel: formatBytes(Math.max(0, storageQuotaBytes - projectStorageUsedBytes)),
      storageUsedPercent: projectStoragePercent,
      dbQuotaMb,
      dbQuotaBytes,
      dbQuotaLabel: formatBytes(dbQuotaBytes),
      dbNote:
        'Database 与 File Storage 在 Supabase Usage 中分开统计。请填 Worker 变量 SUPABASE_DB_USED_MB / SUPABASE_STORAGE_USED_MB 同步控制台读数；未填时文件存储用桶扫描估算。'
    }
  });
});

/** 按桶内路径前缀回填 profiles.storage_bytes（历史未上报时修正登记账本） */
adminDashboardRoutes.post('/storage/reconcile', async c => {
  const admin = createAdminClient(c.env);
  const bucketUsage = await scanBucketUsage(admin);
  const byUser = bucketUsage.byUser ?? [];
  if (!byUser.length) {
    return c.json({ ok: true, data: { updated: 0, users: [] } });
  }

  const userIds = byUser.map((u) => u.userId);
  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('user_id, storage_bytes')
    .in('user_id', userIds);
  if (profErr) throw profErr;

  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, Number(p.storage_bytes) || 0]));
  const updates: Array<{ userId: string; before: number; after: number; fileCount: number }> = [];

  for (const row of byUser) {
    const before = profileMap.get(row.userId) ?? 0;
    if (before === row.bytes) continue;
    const { error } = await admin
      .from('profiles')
      .update({ storage_bytes: row.bytes })
      .eq('user_id', row.userId);
    if (error) throw error;
    updates.push({ userId: row.userId, before, after: row.bytes, fileCount: row.fileCount });
  }

  return c.json({
    ok: true,
    data: {
      updated: updates.length,
      bucketBytes: bucketUsage.bytes,
      bucketLabel: formatBytes(bucketUsage.bytes),
      users: updates.map((u) => ({
        ...u,
        beforeLabel: formatBytes(u.before),
        afterLabel: formatBytes(u.after)
      }))
    }
  });
});
