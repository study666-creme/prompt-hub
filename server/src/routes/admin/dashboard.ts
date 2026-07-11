import { Hono } from 'hono';
import type { Env } from '../../env';
import { extractErrorMessage } from '../../lib/cors-headers';
import { formatBytes } from '../../lib/admin-helpers';
import { scanBucketUsage } from '../../lib/admin-storage';
import { summarizeRequestMetrics } from '../../lib/monitoring';
import { storagePolicySummary } from '../../lib/storage-quota';
import { createAdminClient, isMembershipActive, type Profile } from '../../lib/supabase';
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

type AdminClient = ReturnType<typeof createAdminClient>;

type GenerationMonitorRow = {
  id: string;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  credits_charged: number | string | null;
  meta: unknown;
  result_image_url: string | null;
};

type LedgerRow = {
  delta: number | string;
  reason: string | null;
  ref_id: string | null;
  user_id: string | null;
  created_at: string;
};

type RedemptionRow = {
  id: string;
  code: string;
  user_id: string;
  redeemed_at: string;
};

type PaymentEventRow = {
  event_id: string;
  event_type: string;
  user_id: string | null;
  processed_at: string;
};

function missingDataSource(error: unknown) {
  const msg = extractErrorMessage(error);
  return /does not exist|Could not find the table|schema cache|permission denied|JWT|Invalid API key|Unauthorized/i.test(
    msg
  );
}

function safeMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function shortId(id: string | null | undefined) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  return raw.length > 13 ? `${raw.slice(0, 8)}...${raw.slice(-4)}` : raw;
}

function shortMessage(message: unknown) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}

function statusLabel(status: string) {
  if (status === 'completed') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'processing') return '生成中';
  if (status === 'pending') return '排队中';
  return status || '未知';
}

function groupInc(record: Record<string, number>, key: string, amount = 1) {
  record[key] = (record[key] || 0) + amount;
}

function topRecord(record: Record<string, number>, limit = 8) {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function collectGenerationMonitor(admin: AdminClient, sinceIso: string) {
  try {
    const { data, error } = await admin
      .from('generation_requests')
      .select('id,status,error_message,created_at,completed_at,credits_charged,meta,result_image_url')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1200);
    if (error) throw error;

    const rows = (data ?? []) as GenerationMonitorRow[];
    const byStatus: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const byFailureReason: Record<string, number> = {};
    let totalCreditsCharged = 0;
    let completed = 0;
    let failed = 0;
    let processing = 0;
    let pending = 0;
    let withResultImage = 0;
    let missingResultImage = 0;
    let totalDurationMs = 0;
    let durationCount = 0;
    const stuckBefore = Date.now() - 30 * 60 * 1000;
    const recentFailures: Array<{
      id: string;
      jobId: string;
      status: string;
      model: string | null;
      provider: string | null;
      reason: string | null;
      message: string | null;
      createdAt: string;
    }> = [];

    for (const row of rows) {
      const status = String(row.status || 'unknown');
      const meta = safeMeta(row.meta);
      const model = textValue(meta.model) || textValue(meta.upstreamModel) || 'unknown';
      const provider = textValue(meta.provider) || 'unknown';
      const credits = Number(row.credits_charged) || 0;
      totalCreditsCharged += credits;
      groupInc(byStatus, status);
      groupInc(byModel, model);
      groupInc(byProvider, provider);

      if (status === 'completed') completed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'processing') processing += 1;
      else if (status === 'pending') pending += 1;

      if (row.result_image_url) withResultImage += 1;
      if (status === 'completed' && !row.result_image_url) missingResultImage += 1;

      if (row.completed_at) {
        const start = new Date(row.created_at).getTime();
        const end = new Date(row.completed_at).getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          totalDurationMs += end - start;
          durationCount += 1;
        }
      }

      if (status === 'failed') {
        const reason =
          textValue(meta.failReason)
          || textValue(meta.fastSubmitError)
          || textValue(meta.mookoSubmitError)
          || textValue(meta.ithinkSubmitError)
          || textValue(row.error_message)
          || 'unknown';
        groupInc(byFailureReason, reason);
        if (recentFailures.length < 20) {
          recentFailures.push({
            id: row.id,
            jobId: shortId(row.id) || row.id,
            status: statusLabel(status),
            model: model === 'unknown' ? null : model,
            provider: provider === 'unknown' ? null : provider,
            reason,
            message: shortMessage(row.error_message || reason),
            createdAt: row.created_at
          });
        }
      }
    }

    const stuckProcessing = rows.filter((row) => {
      const st = String(row.status || '');
      const created = new Date(row.created_at).getTime();
      return (st === 'processing' || st === 'pending') && Number.isFinite(created) && created < stuckBefore;
    }).length;
    const terminal = completed + failed;

    return {
      available: true,
      total: rows.length,
      completed,
      failed,
      processing,
      pending,
      stuckProcessing,
      withResultImage,
      missingResultImage,
      failureRate: terminal ? failed / terminal : 0,
      averageDurationSec: durationCount ? Math.round(totalDurationMs / durationCount / 1000) : null,
      totalCreditsCharged,
      byStatus,
      byModel: topRecord(byModel),
      byProvider: topRecord(byProvider),
      topFailureReasons: topRecord(byFailureReason),
      recentFailures
    };
  } catch (e) {
    return {
      available: false,
      error: missingDataSource(e) ? 'generation_requests 不可读或迁移未完成' : shortMessage(extractErrorMessage(e)),
      total: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      pending: 0,
      stuckProcessing: 0,
      withResultImage: 0,
      missingResultImage: 0,
      failureRate: 0,
      averageDurationSec: null,
      totalCreditsCharged: 0,
      byStatus: {},
      byModel: [],
      byProvider: [],
      topFailureReasons: [],
      recentFailures: []
    };
  }
}

async function collectBusinessMonitor(admin: AdminClient, sinceIso: string) {
  const out = {
    ledgerAvailable: true,
    redemptionsAvailable: true,
    paymentsAvailable: true,
    creditsSpent: 0,
    creditsRefunded: 0,
    creditsGranted: 0,
    ledgerRows: 0,
    redemptions: 0,
    payments: 0,
    recentRedemptions: [] as Array<{
      id: string;
      code: string;
      userId: string;
      redeemedAt: string;
    }>,
    recentPayments: [] as Array<{
      eventId: string;
      eventType: string;
      userId: string | null;
      processedAt: string;
    }>,
    errors: [] as string[]
  };

  try {
    const { data, error } = await admin
      .from('credit_ledger')
      .select('delta,reason,ref_id,user_id,created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    const rows = (data ?? []) as LedgerRow[];
    out.ledgerRows = rows.length;
    for (const row of rows) {
      const delta = Number(row.delta) || 0;
      const reason = String(row.reason || '');
      if (delta < 0) out.creditsSpent += Math.abs(delta);
      else if (/refund/i.test(reason)) out.creditsRefunded += delta;
      else out.creditsGranted += delta;
    }
  } catch (e) {
    out.ledgerAvailable = false;
    out.errors.push(missingDataSource(e) ? 'credit_ledger 不可读' : shortMessage(extractErrorMessage(e)) || 'credit_ledger 读取失败');
  }

  try {
    const { data, error } = await admin
      .from('code_redemptions')
      .select('id,code,user_id,redeemed_at')
      .gte('redeemed_at', sinceIso)
      .order('redeemed_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const rows = (data ?? []) as RedemptionRow[];
    out.redemptions = rows.length;
    out.recentRedemptions = rows.map((r) => ({
      id: r.id,
      code: r.code,
      userId: shortId(r.user_id) || r.user_id,
      redeemedAt: r.redeemed_at
    }));
  } catch (e) {
    out.redemptionsAvailable = false;
    out.errors.push(missingDataSource(e) ? 'code_redemptions 不可读' : shortMessage(extractErrorMessage(e)) || 'code_redemptions 读取失败');
  }

  try {
    const { data, error } = await admin
      .from('payment_webhook_events')
      .select('event_id,event_type,user_id,processed_at')
      .gte('processed_at', sinceIso)
      .order('processed_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const rows = (data ?? []) as PaymentEventRow[];
    out.payments = rows.length;
    out.recentPayments = rows.map((r) => ({
      eventId: shortId(r.event_id) || r.event_id,
      eventType: r.event_type,
      userId: r.user_id ? shortId(r.user_id) : null,
      processedAt: r.processed_at
    }));
  } catch (e) {
    out.paymentsAvailable = false;
    out.errors.push(missingDataSource(e) ? 'payment_webhook_events 不可读' : shortMessage(extractErrorMessage(e)) || 'payment_webhook_events 读取失败');
  }

  return out;
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
    if (isMembershipActive(p as unknown as Profile)) {
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
      pagesHint: c.env.PUBLIC_SITE_URL?.trim() || 'https://prompt-hubs.com',
      databaseProjectHost: supabaseHost,
      databaseServiceKeyConfigured: hasServiceKey,
      databaseServiceKeyLooksValid: serviceKeyOk,
      databasePing: dbPing,
      newApiConfigured: !!(c.env.NEWAPI_API_KEY?.trim()),
      midjourneyApiConfigured: !!(c.env.APIMART_API_KEY?.trim()),
      chatApiConfigured: !!(c.env.CHAT_API_KEY?.trim()),
      mediaStorageMode: c.env.MEDIA_STORAGE_MODE || 'supabase',
      storageQuotaMbEnv: quotaMb(c.env, 'SUPABASE_STORAGE_QUOTA_MB', 1024),
      dbQuotaMbEnv: quotaMb(c.env, 'SUPABASE_DB_QUOTA_MB', 500),
      storageUsedMbEnv: optionalUsedMb(c.env, 'SUPABASE_STORAGE_USED_MB'),
      dbUsedMbEnv: optionalUsedMb(c.env, 'SUPABASE_DB_USED_MB'),
      userStoragePolicy: storagePolicySummary(),
      notes: [
        '生产图片主存储为 R2，r2-first 模式同时写入 MemFire Storage 作为回源副本',
        '用户配额按 profiles.storage_bytes 登记；后台存储扫描按当前 MEDIA_STORAGE_MODE 选择主存储',
        'MemFire Database 与 Storage 用量分开统计；可用 SUPABASE_DB_USED_MB / SUPABASE_STORAGE_USED_MB 同步控制台读数',
        'Cloudflare Workers 用量在 Cloudflare 控制台 → Workers & Pages',
        '本接口不返回任何密钥'
      ]
    }
  });
});

/** 运营监控：Worker 请求量、API 错误、图片 404、生图失败率与轻量业务流水 */
adminDashboardRoutes.get('/monitoring', async c => {
  const hoursRaw = Number(c.req.query('hours') || 24);
  const hours = Math.min(72, Math.max(1, Number.isFinite(hoursRaw) ? Math.floor(hoursRaw) : 24));
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient(c.env);
  const [requests, generation, business] = await Promise.all([
    summarizeRequestMetrics(c.env, hours),
    collectGenerationMonitor(admin, sinceIso),
    collectBusinessMonitor(admin, sinceIso)
  ]);

  const alerts: Array<{ level: 'warn' | 'critical'; title: string; detail: string }> = [];
  if (!requests.available) {
    alerts.push({
      level: 'warn',
      title: 'Worker 自计数未启用',
      detail: '请绑定 PROMPT_HUB_METRICS KV 后重新部署；Cloudflare 官方请求量仍以控制台 Analytics 为准。'
    });
  }
  if (requests.api5xx > 0) {
    alerts.push({
      level: 'critical',
      title: 'API 5xx',
      detail: `近 ${hours} 小时出现 ${requests.api5xx} 次 Worker/API 5xx。`
    });
  }
  if (requests.image404 > 0) {
    alerts.push({
      level: 'warn',
      title: '图片 404',
      detail: `近 ${hours} 小时出现 ${requests.image404} 次图片代理 404，优先看最近 404 路径。`
    });
  }
  if (generation.available && generation.failed > 0 && generation.failureRate >= 0.15) {
    alerts.push({
      level: 'warn',
      title: '生图失败率偏高',
      detail: `近 ${hours} 小时失败率约 ${(generation.failureRate * 100).toFixed(1)}%。`
    });
  }
  if (generation.available && generation.stuckProcessing > 0) {
    alerts.push({
      level: 'warn',
      title: '存在卡住的生图任务',
      detail: `${generation.stuckProcessing} 个任务已排队/生成超过 30 分钟。`
    });
  }

  return c.json({
    ok: true,
    data: {
      generatedAt: new Date().toISOString(),
      hours,
      windowStart: sinceIso,
      requests,
      generation,
      business,
      alerts
    }
  });
});

/** 按当前 MEDIA_STORAGE_MODE 扫描主图片存储（较慢，前端按需请求）。 */
adminDashboardRoutes.get('/storage', async c => {
  const admin = createAdminClient(c.env);
  const storageQuotaMb = quotaMb(c.env, 'SUPABASE_STORAGE_QUOTA_MB', 1024);
  const dbQuotaMb = quotaMb(c.env, 'SUPABASE_DB_QUOTA_MB', 500);
  const storageUsedMbEnv = optionalUsedMb(c.env, 'SUPABASE_STORAGE_USED_MB');
  const dbUsedMbEnv = optionalUsedMb(c.env, 'SUPABASE_DB_USED_MB');

  const [bucketUsage, profilesRes] = await Promise.all([
    scanBucketUsage(admin, c.env),
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
  const bucketScanPercent = bucketUsage.source !== 'r2' && storageQuotaBytes
    ? Math.min(100, Math.round((bucketBytes / storageQuotaBytes) * 1000) / 10)
    : null;

  const primaryIsR2 = bucketUsage.source === 'r2';
  const projectStorageUsedBytes = !primaryIsR2 && storageUsedMbEnv != null
    ? storageUsedMbEnv * 1024 * 1024
    : bucketBytes;
  const projectStorageSource = primaryIsR2
    ? 'r2'
    : storageUsedMbEnv != null
      ? 'env'
      : 'memfire';
  const projectStoragePercent = !primaryIsR2 && storageQuotaBytes
    ? Math.min(100, Math.round((projectStorageUsedBytes / storageQuotaBytes) * 1000) / 10)
    : null;
  const projectStorageStatus =
    primaryIsR2
      ? ('unknown' as const)
      : storageUsedMbEnv != null
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
  if (!primaryIsR2 && storageUsedMbEnv != null && projectStorageUsedBytes > storageQuotaBytes) {
    alerts.push({
      level: 'critical',
      title: '项目文件存储超过参考配额',
      detail: `${formatBytes(projectStorageUsedBytes)} / ${formatBytes(storageQuotaBytes)}（MemFire Usage 同步值）`
    });
  } else if (!primaryIsR2 && storageUsedMbEnv != null && projectStoragePercent != null && projectStoragePercent >= 80) {
    alerts.push({
      level: 'warn',
      title: '项目文件存储用量偏高',
      detail: `${projectStoragePercent}% · ${formatBytes(projectStorageUsedBytes)} / ${formatBytes(storageQuotaBytes)}`
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
      bucketSource: bucketUsage.source,
      topUsersByBucket,
      registeredBytes,
      registeredLabel: formatBytes(registeredBytes),
      projectStorage: {
        usedBytes: projectStorageUsedBytes,
        usedLabel: formatBytes(projectStorageUsedBytes),
        quotaMb: primaryIsR2 ? null : storageQuotaMb,
        quotaBytes: primaryIsR2 ? null : storageQuotaBytes,
        quotaLabel: primaryIsR2 ? '按量计费' : formatBytes(storageQuotaBytes),
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
      storageRemainingBytes: primaryIsR2 ? null : Math.max(0, storageQuotaBytes - projectStorageUsedBytes),
      storageRemainingLabel: primaryIsR2
        ? null
        : formatBytes(Math.max(0, storageQuotaBytes - projectStorageUsedBytes)),
      storageUsedPercent: projectStoragePercent,
      dbQuotaMb,
      dbQuotaBytes,
      dbQuotaLabel: formatBytes(dbQuotaBytes),
      dbNote:
        primaryIsR2
          ? '图片主存储来自 Cloudflare R2 对象扫描；MemFire Database 用量可通过 SUPABASE_DB_USED_MB 同步控制台读数。'
          : '图片主存储来自 MemFire Storage；Database 与 Storage 用量需分别查看。'
    }
  });
});
