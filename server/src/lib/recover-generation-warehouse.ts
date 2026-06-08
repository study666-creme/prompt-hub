import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { archiveRemoteImage, isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';

const BUCKET = 'card-images';
const MIN_IMAGE_BYTES = 512;

function expectedMinFullBytes(resolution?: string | null): number {
  const r = String(resolution || '1k').toLowerCase();
  if (r === '4k') return Math.floor(1.1 * 1024 * 1024);
  if (r === '2k') return Math.floor(400 * 1024);
  return Math.floor(80 * 1024);
}

type JobRow = {
  id: string;
  prompt?: string | null;
  status?: string | null;
  result_image_url?: string | null;
  meta?: Record<string, unknown> | null;
  created_at?: string | null;
};

function generateCardId(): string {
  return `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function storageBlobSize(
  admin: SupabaseClient,
  path: string
): Promise<number> {
  const clean = path.replace(/^\//, '');
  if (!clean) return 0;
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(clean);
    if (error || !data) return 0;
    return data.size || 0;
  } catch {
    return 0;
  }
}

async function storageBlobOk(
  admin: SupabaseClient,
  path: string,
  minBytes = MIN_IMAGE_BYTES
): Promise<boolean> {
  const size = await storageBlobSize(admin, path);
  return size >= Math.max(MIN_IMAGE_BYTES, minBytes);
}

async function resolveImageRefForJob(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  job: JobRow
): Promise<string | null> {
  const genPath = `${userId}/generated/${jobId}.jpg`;
  const minBytes = expectedMinFullBytes(
    (job as { resolution?: string | null }).resolution
  );

  if (await storageBlobOk(admin, genPath, minBytes)) {
    return toStorageRef(genPath);
  }

  const raw = job.result_image_url as string | null;
  const meta = (job.meta || {}) as Record<string, unknown>;
  const upstream =
    typeof meta.upstreamImageUrl === 'string' && /^https:\/\//i.test(meta.upstreamImageUrl)
      ? meta.upstreamImageUrl
      : null;
  const rearchiveFrom = upstream || (raw && /^https:\/\//i.test(raw) ? raw : null);
  if (rearchiveFrom) {
    try {
      return await archiveRemoteImage(admin, userId, jobId, rearchiveFrom, { maxAttempts: 3 });
    } catch {
      /* fall through */
    }
  }

  if (await storageBlobOk(admin, genPath, MIN_IMAGE_BYTES)) {
    return toStorageRef(genPath);
  }

  if (raw && isStorageRef(raw)) {
    const path = storagePathFromRef(raw);
    if (path && (await storageBlobOk(admin, path, minBytes))) {
      return raw.startsWith('storage://') ? raw : toStorageRef(path);
    }
  }
  return null;
}

export type RecoverWarehouseResult = {
  imported: number;
  skipped: number;
  repaired?: number;
  failures: Array<{ jobId?: string; cardId?: string; reason: string }>;
  cardIds: string[];
  hint?: string;
};

async function loadUserPayload(admin: SupabaseClient, userId: string) {
  const { data: row, error: pullErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (pullErr) {
    throw new ApiError(500, 'DB_ERROR', pullErr.message || '读取卡片库失败');
  }
  const payload = (row?.data || {}) as {
    cards?: Array<Record<string, unknown>>;
    schemaVersion?: number;
  };
  const cards = Array.isArray(payload.cards) ? [...payload.cards] : [];
  return { payload, cards };
}

async function saveUserCards(
  admin: SupabaseClient,
  userId: string,
  payload: { cards?: Array<Record<string, unknown>>; schemaVersion?: number },
  cards: Array<Record<string, unknown>>
) {
  const nextPayload = {
    ...payload,
    cards,
    schemaVersion: payload.schemaVersion || 2
  };
  const { error: upsertErr } = await admin.from('user_data').upsert(
    {
      user_id: userId,
      data: nextPayload,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (upsertErr) {
    throw new ApiError(500, 'DB_ERROR', upsertErr.message || '写入卡片库失败');
  }
}

async function loadCompletedJobs(
  admin: SupabaseClient,
  userId: string,
  days: number,
  limit: number
): Promise<JobRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data: jobs, error: jobsErr } = await admin
    .from('generation_requests')
    .select('id,prompt,status,result_image_url,meta,created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (jobsErr) {
    throw new ApiError(500, 'DB_ERROR', jobsErr.message || '读取生图记录失败');
  }
  return (jobs || []) as JobRow[];
}

/** 新建卡片：仅导入尚未有 genJobId 的任务 */
export async function recoverGenerationJobsToWarehouse(
  admin: SupabaseClient,
  userId: string,
  opts: { max?: number; days?: number } = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(50, Math.max(1, opts.max ?? 20));
  const days = Math.min(365, Math.max(1, opts.days ?? 90));
  const jobs = await loadCompletedJobs(admin, userId, days, 120);
  const { payload, cards: existing } = await loadUserPayload(admin, userId);
  const knownJobIds = new Set(
    existing.map((c) => String(c.genJobId || '')).filter(Boolean)
  );

  const failures: Array<{ jobId: string; reason: string }> = [];
  const newCards: Array<Record<string, unknown>> = [];
  const cardIds: string[] = [];
  let imported = 0;
  let skipped = 0;
  const now = Date.now();

  for (const job of jobs) {
    if (imported >= max) break;
    const jobId = String(job.id || '');
    if (!jobId) continue;
    if (knownJobIds.has(jobId)) {
      skipped += 1;
      continue;
    }

    const imageRef = await resolveImageRefForJob(admin, userId, jobId, job);
    if (!imageRef) {
      failures.push({ jobId, reason: 'no_image' });
      skipped += 1;
      continue;
    }

    const cardId = generateCardId();
    newCards.push({
      id: cardId,
      title: String(job.prompt || '').slice(0, 48) || '生图恢复',
      prompt: job.prompt || '',
      image: imageRef,
      group: null,
      tags: ['图片生成', '自动恢复'],
      customFields: { recoveredFromJob: jobId },
      genJobId: jobId,
      createdAt: now,
      updatedAt: now,
      publishedToCommunity: false,
      communityPostId: null
    });
    knownJobIds.add(jobId);
    cardIds.push(cardId);
    imported += 1;
  }

  if (newCards.length) {
    await saveUserCards(admin, userId, payload, [...newCards, ...existing]);
  }

  const hint =
    skipped > 0 && imported === 0
      ? '这些生图任务已在卡片库中（有 genJobId）。请用 mode:"repair" 修复灰图，或 mode:"extras" 导入多图。'
      : undefined;

  return {
    imported,
    skipped,
    failures: failures.slice(0, 30),
    cardIds,
    hint
  };
}

/** 修复已有卡片：按 genJobId 重新归档图片到 Storage */
export async function repairWarehouseCardImagesFromJobs(
  admin: SupabaseClient,
  userId: string,
  opts: { max?: number; days?: number } = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(80, Math.max(1, opts.max ?? 30));
  const days = Math.min(365, Math.max(1, opts.days ?? 365));
  const jobs = await loadCompletedJobs(admin, userId, days, 200);
  const jobMap = new Map(jobs.map((j) => [String(j.id), j]));
  const { payload, cards } = await loadUserPayload(admin, userId);

  let repaired = 0;
  let skipped = 0;
  const failures: Array<{ jobId?: string; cardId?: string; reason: string }> = [];
  const cardIds: string[] = [];
  const now = Date.now();

  for (const card of cards) {
    if (repaired >= max) break;
    const jobId = String(card.genJobId || '');
    if (!jobId) {
      skipped += 1;
      continue;
    }
    const job = jobMap.get(jobId);
    if (!job) {
      failures.push({ jobId, cardId: String(card.id), reason: 'job_not_found' });
      skipped += 1;
      continue;
    }

    const genPath = `${userId}/generated/${jobId}.jpg`;
    const minBytes = expectedMinFullBytes(
      String(job.resolution || card.resolution || '1k')
    );
    const currentPath = storagePathFromRef(String(card.image || ''));
    const currentSize = currentPath ? await storageBlobSize(admin, currentPath) : 0;
    const canonicalSize = await storageBlobSize(admin, genPath);
    const currentOk = currentSize >= minBytes;
    const canonicalOk = canonicalSize >= minBytes;
    if (currentOk && canonicalOk && currentPath === genPath) {
      skipped += 1;
      continue;
    }
    if (currentOk && currentPath && currentPath !== genPath && canonicalSize < minBytes) {
      skipped += 1;
      continue;
    }

    const imageRef = await resolveImageRefForJob(admin, userId, jobId, job);
    if (!imageRef) {
      failures.push({ jobId, cardId: String(card.id), reason: 'no_source' });
      skipped += 1;
      continue;
    }

    card.image = imageRef;
    card.updatedAt = now;
    repaired += 1;
    cardIds.push(String(card.id));
  }

  if (repaired > 0) {
    await saveUserCards(admin, userId, payload, cards);
  }

  return {
    imported: 0,
    repaired,
    skipped,
    failures: failures.slice(0, 40),
    cardIds,
    hint: '已尝试从生图记录重新写入 Storage；强刷后查看缩略图'
  };
}

/** 导入任务 meta 里的额外图片（每张新卡，不占 genJobId 槽位） */
export async function importExtraJobImagesToWarehouse(
  admin: SupabaseClient,
  userId: string,
  opts: { max?: number; days?: number } = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(40, Math.max(1, opts.max ?? 15));
  const days = Math.min(365, Math.max(1, opts.days ?? 365));
  const jobs = await loadCompletedJobs(admin, userId, days, 150);
  const { payload, cards: existing } = await loadUserPayload(admin, userId);
  const knownSourceIds = new Set(
    existing.map((c) => String(c.genSourceId || '')).filter(Boolean)
  );

  const failures: Array<{ jobId: string; reason: string }> = [];
  const newCards: Array<Record<string, unknown>> = [];
  const cardIds: string[] = [];
  let imported = 0;
  let skipped = 0;
  const now = Date.now();

  for (const job of jobs) {
    if (imported >= max) break;
    const jobId = String(job.id || '');
    const meta = (job.meta || {}) as Record<string, unknown>;
    const extras = Array.isArray(meta.extraImageUrls)
      ? (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u)
      : [];
    for (let i = 0; i < extras.length; i += 1) {
      if (imported >= max) break;
      const sourceId = `${jobId}:ex:${i}`;
      if (knownSourceIds.has(sourceId)) {
        skipped += 1;
        continue;
      }
      const url = extras[i];
      const archiveId = `${jobId}_ex_${i}`;
      try {
        const imageRef = await archiveRemoteImage(admin, userId, archiveId, url, {
          maxAttempts: 2
        });
        if (!imageRef) {
          failures.push({ jobId, reason: 'extra_archive_failed' });
          skipped += 1;
          continue;
        }
        const cardId = generateCardId();
        newCards.push({
          id: cardId,
          title: String(job.prompt || '').slice(0, 44) || '生图恢复',
          prompt: job.prompt || '',
          image: imageRef,
          group: null,
          tags: ['图片生成', '自动恢复', '多图'],
          customFields: { recoveredFromJob: jobId, extraIndex: i },
          genSourceId: sourceId,
          genJobId: null,
          createdAt: now,
          updatedAt: now,
          publishedToCommunity: false,
          communityPostId: null
        });
        knownSourceIds.add(sourceId);
        cardIds.push(cardId);
        imported += 1;
      } catch {
        failures.push({ jobId, reason: 'extra_failed' });
        skipped += 1;
      }
    }
  }

  if (newCards.length) {
    await saveUserCards(admin, userId, payload, [...newCards, ...existing]);
  }

  return {
    imported,
    skipped,
    failures: failures.slice(0, 30),
    cardIds,
    hint: imported ? '已导入额外生图变体' : '没有可导入的多图，或 Apimart 链接已过期'
  };
}
