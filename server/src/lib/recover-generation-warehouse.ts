import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { archiveRemoteImage, generationStorageAssetId, isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';
import { readJobProvider } from './image-upstream';
import { cardImageExists, downloadFromR2 } from './r2-storage';
import {
  gridPathFromPrimary,
  materializeGridForPrimaryPath,
  sanitizeCardFileBase
} from './media-cdn';

const BUCKET = 'card-images';
const MIN_IMAGE_BYTES = 512;
const GRID_MIN_BYTES = 2048;

function stripGridSuffix(path: string): string {
  return path.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg');
}

function primaryPathFromImageRef(ref: string, userId: string, cardId: string): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && !out.includes(key)) out.push(key);
  };
  const fromRef = storagePathFromRef(ref);
  if (fromRef) add(stripGridSuffix(fromRef.replace(/^\//, '')));
  const base = sanitizeCardFileBase(cardId);
  add(`${userId}/${base}.jpg`);
  add(`${userId}/${base}.webp`);
  add(`${userId}/${base}.png`);
  add(`${userId}/${cardId}.jpg`);
  return out;
}

async function gridPathOk(
  admin: SupabaseClient,
  primaryPath: string,
  env?: Env
): Promise<boolean> {
  const grid = gridPathFromPrimary(primaryPath.replace(/^\//, ''));
  if (!grid) return false;
  const size = await storageBlobSize(admin, grid.replace(/^\//, ''), env);
  return size >= GRID_MIN_BYTES;
}

async function loadJobsByIds(
  admin: SupabaseClient,
  userId: string,
  rawIds: string[]
): Promise<JobRow[]> {
  const ids = [...new Set(rawIds.map((id) => String(id || '').replace(/#\d+$/, '')).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await admin
    .from('generation_requests')
    .select('id,prompt,status,result_image_url,meta,created_at,resolution')
    .eq('user_id', userId)
    .in('id', ids.slice(0, 80));
  if (error) {
    throw new ApiError(500, 'DB_ERROR', error.message || '读取生图记录失败');
  }
  return (data || []) as JobRow[];
}

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
  resolution?: string | null;
};

function generateCardId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function storageBlobSize(
  admin: SupabaseClient,
  path: string,
  env?: Env
): Promise<number> {
  const clean = path.replace(/^\//, '');
  if (!clean) return 0;
  if (env) {
    const blob = await downloadFromR2(env, clean);
    if (blob?.size) return blob.size;
  }
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(clean);
    if (!error && data?.size) return data.size;
  } catch { /* ignore */ }
  if (env && (await cardImageExists(env, clean, admin))) {
    const blob = await downloadFromR2(env, clean);
    return blob?.size || MIN_IMAGE_BYTES;
  }
  return 0;
}

async function storageBlobOk(
  admin: SupabaseClient,
  path: string,
  minBytes = MIN_IMAGE_BYTES,
  env?: Env
): Promise<boolean> {
  const size = await storageBlobSize(admin, path, env);
  return size >= Math.max(MIN_IMAGE_BYTES, minBytes);
}

function slotIndexFromJobId(jobId: string): number {
  const m = String(jobId || '').match(/#(\d+)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 1 ? n - 1 : 0;
}

function pickJobImageUrlForSlot(job: JobRow, slotIndex: number): string | null {
  const meta = (job.meta || {}) as Record<string, unknown>;
  const urls: string[] = [];
  if (Array.isArray(meta.mjGalleryUrls)) {
    for (const u of meta.mjGalleryUrls as unknown[]) {
      if (typeof u === 'string' && u.trim()) urls.push(u.trim());
    }
  }
  if (!urls.length) {
    const composite =
      typeof meta.mjCompositeUrl === 'string' && /^https:\/\//i.test(meta.mjCompositeUrl)
        ? meta.mjCompositeUrl.trim()
        : '';
    const tiles = Array.isArray(meta.mjGridUrls)
      ? (meta.mjGridUrls as string[]).filter((u) => typeof u === 'string' && u.trim())
      : [];
    if (composite) urls.push(composite, ...tiles);
    else urls.push(...tiles);
  }
  const pick = urls[slotIndex] || urls[0];
  if (pick && /^https:\/\//i.test(pick)) return pick;
  const raw = job.result_image_url;
  if (typeof raw === 'string' && /^https:\/\//i.test(raw)) return raw;
  const upstream =
    typeof meta.upstreamImageUrl === 'string' && /^https:\/\//i.test(meta.upstreamImageUrl)
      ? meta.upstreamImageUrl
      : null;
  return upstream;
}

export async function resolveImageRefForJob(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  job: JobRow,
  env?: Env
): Promise<string | null> {
  const assetKey = String(jobId).replace(/#/g, '-');
  const minBytes = expectedMinFullBytes(
    (job as { resolution?: string | null }).resolution
  );
  const genPaths = [
    `${userId}/generated/${assetKey}.png`,
    `${userId}/generated/${assetKey}.jpg`,
    `${userId}/generated/${assetKey}.webp`
  ];
  for (const genPath of genPaths) {
    if (await storageBlobOk(admin, genPath, minBytes, env)) {
      return toStorageRef(genPath);
    }
  }

  const raw = job.result_image_url as string | null;
  const slotIndex = slotIndexFromJobId(jobId);
  const rearchiveFrom = pickJobImageUrlForSlot(job, slotIndex);
  if (rearchiveFrom) {
    try {
      return await archiveRemoteImage(admin, userId, assetKey, rearchiveFrom, {
        maxAttempts: 3,
        env
      });
    } catch {
      /* fall through */
    }
  }

  for (const genPath of genPaths) {
    if (await storageBlobOk(admin, genPath, MIN_IMAGE_BYTES, env)) {
      return toStorageRef(genPath);
    }
  }

  if (raw && isStorageRef(raw)) {
    const path = storagePathFromRef(raw);
    if (path && (await storageBlobOk(admin, path, minBytes, env))) {
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
  totalCandidates?: number;
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
    settings?: Record<string, unknown>;
  };
  const cards = Array.isArray(payload.cards) ? [...payload.cards] : [];
  return { payload, cards };
}

function deletedGenJobTombstonesFromPayload(payload: {
  settings?: Record<string, unknown>;
}): Set<string> {
  const raw = payload.settings?.deletedGenerationJobTombstones;
  if (!raw || typeof raw !== 'object') return new Set();
  return new Set(Object.keys(raw as Record<string, unknown>));
}

function isGenJobTombstoned(jobId: string, tombstones: Set<string>): boolean {
  const key = String(jobId || '');
  if (!key) return false;
  if (tombstones.has(key)) return true;
  const base = key.replace(/#\d+$/, '');
  return base !== key && tombstones.has(base);
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

type RecoverWindowOpts = { days?: number; hours?: number };

function resolveRecoverSinceIso(
  opts: RecoverWindowOpts,
  fallback: { days?: number; hours?: number }
): string {
  if (opts.hours != null) {
    const h = Math.min(168, Math.max(1, opts.hours));
    return new Date(Date.now() - h * 3600 * 1000).toISOString();
  }
  const days = Math.min(365, Math.max(1, opts.days ?? fallback.days ?? 1));
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

async function loadCompletedJobs(
  admin: SupabaseClient,
  userId: string,
  windowOpts: RecoverWindowOpts,
  limit: number,
  fallback: { days?: number; hours?: number }
): Promise<JobRow[]> {
  const since = resolveRecoverSinceIso(windowOpts, fallback);
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

export type RecoverWarehouseOpts = {
  max?: number;
  days?: number;
  hours?: number;
  offset?: number;
  providerScope?: 'grs' | 'apimart' | 'all';
  env?: Env;
  deletedGenerationJobTombstones?: Record<string, number>;
  jobIds?: string[];
};

function mergeJobTombstones(
  payload: { settings?: Record<string, unknown> },
  clientTombstones?: Record<string, number>
): Set<string> {
  const fromPayload = deletedGenJobTombstonesFromPayload(payload);
  if (!clientTombstones || typeof clientTombstones !== 'object') return fromPayload;
  const merged = new Set(fromPayload);
  for (const key of Object.keys(clientTombstones)) {
    if (key) merged.add(key);
  }
  return merged;
}

function filterJobsByProvider(jobs: JobRow[], scope?: 'grs' | 'apimart' | 'all'): JobRow[] {
  if (!scope || scope === 'all') return jobs;
  return jobs.filter((job) => {
    const p = readJobProvider((job.meta || {}) as Record<string, unknown>);
    if (scope === 'apimart') return p === 'apimart';
    return p !== 'apimart';
  });
}

function resolveRecoverWindow(
  opts: RecoverWarehouseOpts,
  mode: 'import' | 'repair' | 'extras'
): { windowOpts: RecoverWindowOpts; fallback: { days?: number; hours?: number } } {
  const scope = opts.providerScope || 'all';
  if (scope === 'apimart') {
    const days = Math.min(365, Math.max(1, opts.days ?? (mode === 'import' ? 7 : 365)));
    return { windowOpts: { days }, fallback: { days: 7 } };
  }
  if (scope === 'grs' || opts.hours != null) {
    const hours = Math.min(168, Math.max(1, opts.hours ?? 2));
    return { windowOpts: { hours }, fallback: { hours: 2 } };
  }
  const days = Math.min(
    365,
    Math.max(1, opts.days ?? (mode === 'import' ? 1 : mode === 'extras' ? 365 : 365))
  );
  return { windowOpts: { days }, fallback: { days } };
}

/** 新建卡片：仅导入尚未有 genJobId 的任务 */
export async function recoverGenerationJobsToWarehouse(
  admin: SupabaseClient,
  userId: string,
  opts: RecoverWarehouseOpts = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(50, Math.max(1, opts.max ?? 20));
  const { windowOpts, fallback } = resolveRecoverWindow(opts, 'import');
  let jobs = await loadCompletedJobs(admin, userId, windowOpts, 120, fallback);
  jobs = filterJobsByProvider(jobs, opts.providerScope);
  const onlyIds = Array.isArray(opts.jobIds)
    ? new Set(opts.jobIds.map((id) => String(id).replace(/#\d+$/, '')).filter(Boolean))
    : null;
  if (onlyIds?.size) {
    jobs = jobs.filter((job) => onlyIds.has(String(job.id || '').replace(/#\d+$/, '')));
  }
  const { payload, cards: existing } = await loadUserPayload(admin, userId);
  const jobTombstones = mergeJobTombstones(payload, opts.deletedGenerationJobTombstones);
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
    if (isGenJobTombstoned(jobId, jobTombstones)) {
      skipped += 1;
      continue;
    }
    if (knownJobIds.has(jobId)) {
      skipped += 1;
      continue;
    }

    const imageRef = await resolveImageRefForJob(admin, userId, jobId, job, opts.env);
    if (!imageRef) {
      failures.push({ jobId, reason: 'no_image' });
      skipped += 1;
      continue;
    }

    const cardId = generateCardId();
    const jobTs = job.created_at ? Date.parse(String(job.created_at)) : NaN;
    const cardTs = Number.isFinite(jobTs) ? jobTs : now;
    newCards.push({
      id: cardId,
      title: String(job.prompt || '').slice(0, 48) || '生图恢复',
      prompt: job.prompt || '',
      image: imageRef,
      group: null,
      tags: ['图片生成', '自动恢复'],
      customFields: { recoveredFromJob: jobId },
      genJobId: jobId,
      createdAt: cardTs,
      updatedAt: cardTs,
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

/** 修复已有卡片：按 genJobId 重新归档图片到 Storage，并补齐 _grid 缩略图 */
export async function repairWarehouseCardImagesFromJobs(
  admin: SupabaseClient,
  userId: string,
  opts: RecoverWarehouseOpts = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(80, Math.max(1, opts.max ?? 30));
  const { payload, cards } = await loadUserPayload(admin, userId);

  type Candidate = { card: Record<string, unknown>; jobId: string; mode: 'grid' | 'full' };
  const candidates: Candidate[] = [];

  for (const card of cards) {
    const cardId = String(card.id || '');
    const jobId = String(card.genJobId || '');
    const imageRef = String(card.image || '');
    if (!imageRef || !cardId) continue;
    const resolution = String(card.resolution || '1k');
    const minBytes = jobId ? expectedMinFullBytes(resolution) : MIN_IMAGE_BYTES;
    const primaryCandidates = primaryPathFromImageRef(imageRef, userId, cardId);
    let primaryPath: string | null = null;
    let primarySize = 0;
    for (const p of primaryCandidates) {
      const sz = await storageBlobSize(admin, p, opts.env);
      if (sz > primarySize) {
        primarySize = sz;
        primaryPath = p;
      }
    }
    const primaryOk = primarySize >= minBytes;
    const gridOk = primaryPath ? await gridPathOk(admin, primaryPath, opts.env) : false;
    if (primaryOk && gridOk) continue;
    if (primaryOk && !gridOk) {
      candidates.push({ card, jobId, mode: 'grid' });
      continue;
    }
    if (!jobId) continue;
    candidates.push({ card, jobId, mode: 'full' });
  }

  const offset = Math.max(0, opts.offset ?? 0);
  const batch = candidates.slice(offset, offset + max);
  const jobMap = new Map(
    (await loadJobsByIds(
      admin,
      userId,
      batch.map((c) => c.jobId)
    )).map((j) => [String(j.id), j])
  );

  let repaired = 0;
  let skipped = 0;
  const failures: Array<{ jobId?: string; cardId?: string; reason: string }> = [];
  const cardIds: string[] = [];

  for (const { card, jobId, mode } of batch) {
    const cardId = String(card.id || '');
    const baseJobId = jobId.replace(/#\d+$/, '');

    if (mode === 'grid') {
      const primaryCandidates = primaryPathFromImageRef(String(card.image || ''), userId, cardId);
      let fixed = false;
      for (const p of primaryCandidates) {
        if (!(await storageBlobOk(admin, p, MIN_IMAGE_BYTES, opts.env))) continue;
        if (opts.env) {
          const gridClean = await materializeGridForPrimaryPath(opts.env, admin, p);
          if (gridClean) {
            fixed = true;
            break;
          }
        }
      }
      if (fixed) {
        repaired += 1;
        cardIds.push(cardId);
      } else {
        failures.push({ jobId, cardId, reason: 'grid_materialize_failed' });
        skipped += 1;
      }
      continue;
    }

    const job = jobMap.get(baseJobId);
    if (!job) {
      failures.push({ jobId, cardId, reason: 'job_not_found' });
      skipped += 1;
      continue;
    }

    const imageRef = await resolveImageRefForJob(admin, userId, jobId, job, opts.env);
    if (!imageRef) {
      failures.push({ jobId, cardId, reason: 'no_source' });
      skipped += 1;
      continue;
    }

    card.image = imageRef;
    repaired += 1;
    cardIds.push(cardId);

    if (opts.env) {
      const primaryPath = storagePathFromRef(imageRef);
      if (primaryPath) {
        await materializeGridForPrimaryPath(opts.env, admin, primaryPath).catch(() => {});
      }
    }
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
    totalCandidates: candidates.length,
    hint:
      repaired > 0
        ? '已尝试从生图记录重新写入 Storage 并生成缩略图；强刷后查看'
        : skipped > 0 && failures.some((f) => f.reason === 'job_not_found')
          ? '部分老任务记录已不存在，仅能从 R2/Supabase 已有文件恢复'
          : '上游仍无可用图片，请稍后再试'
  };
}

/** 导入任务 meta 里的额外图片（每张新卡，不占 genJobId 槽位） */
export async function importExtraJobImagesToWarehouse(
  admin: SupabaseClient,
  userId: string,
  opts: RecoverWarehouseOpts = {}
): Promise<RecoverWarehouseResult> {
  const max = Math.min(40, Math.max(1, opts.max ?? 15));
  const { windowOpts, fallback } = resolveRecoverWindow(opts, 'extras');
  let jobs = await loadCompletedJobs(admin, userId, windowOpts, 150, fallback);
  jobs = filterJobsByProvider(jobs, opts.providerScope);
  const { payload, cards: existing } = await loadUserPayload(admin, userId);
  const jobTombstones = mergeJobTombstones(payload, opts.deletedGenerationJobTombstones);
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
    if (!jobId || isGenJobTombstoned(jobId, jobTombstones)) {
      if (jobId) skipped += 1;
      continue;
    }
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
