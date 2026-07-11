import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { archiveRemoteImage, generationStorageAssetId, isStorageRef, storagePathFromRef, toStorageRef } from './image-archive';
import { readJobProvider } from './image-upstream';
import { cardImageExists, hasR2, mediaStorageMode, r2ObjectSize, uploadToR2 } from './r2-storage';
import {
  gridPathFromPrimary,
  materializeGridForPrimaryPath,
  sanitizeCardFileBase
} from './media-cdn';

const BUCKET = 'card-images';
const MIN_IMAGE_BYTES = 512;
const GRID_MIN_BYTES = 2048;
const MAX_GALLERY_IMAGES = 5;

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

async function supabaseListedSize(admin: SupabaseClient, clean: string): Promise<number> {
  try {
    const slash = clean.lastIndexOf('/');
    const dir = slash >= 0 ? clean.slice(0, slash) : '';
    const name = slash >= 0 ? clean.slice(slash + 1) : clean;
    const { data, error } = await admin.storage.from(BUCKET).list(dir, { limit: 200 });
    if (error || !data?.length) return 0;
    const item = data.find((row) => row.name === name);
    if (!item) return 0;
    const meta = item.metadata as { size?: number } | undefined;
    const listed = Number(meta?.size) || Number((item as { size?: number }).size) || 0;
    return listed > 0 ? listed : MIN_IMAGE_BYTES;
  } catch {
    return 0;
  }
}

/** 轻量读大小：R2 HEAD → Supabase list，避免 repair 扫描时整文件 download 导致 Worker 超时 */
async function storageBlobSize(
  admin: SupabaseClient,
  path: string,
  env?: Env
): Promise<number> {
  const clean = path.replace(/^\//, '');
  if (!clean) return 0;
  if (env && hasR2(env)) {
    const r2Size = await r2ObjectSize(env, clean);
    if (r2Size > 0) return r2Size;
  }
  const listed = await supabaseListedSize(admin, clean);
  if (listed > 0) return listed;
  if (env && (await cardImageExists(env, clean, admin))) {
    const r2Size = hasR2(env) ? await r2ObjectSize(env, clean) : 0;
    return r2Size > 0 ? r2Size : MIN_IMAGE_BYTES;
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

function slotJobId(baseJobId: string, slotIndex: number): string {
  const base = String(baseJobId || '').replace(/#\d+$/, '');
  if (!Number.isFinite(slotIndex) || slotIndex <= 0) return base;
  return `${base}#${slotIndex + 1}`;
}

function stringList(raw: unknown, max = MAX_GALLERY_IMAGES): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

function mjGalleryRefsFromJob(job: JobRow): string[] {
  const meta = (job.meta || {}) as Record<string, unknown>;
  const gallery = stringList(meta.mjGalleryUrls);
  if (gallery.length) return gallery;
  const composite = typeof meta.mjCompositeUrl === 'string' ? meta.mjCompositeUrl.trim() : '';
  const tiles = stringList(meta.mjGridUrls, 4);
  if (composite) return [composite, ...tiles.filter((u) => u !== composite)].slice(0, MAX_GALLERY_IMAGES);
  if (tiles.length) return tiles.slice(0, MAX_GALLERY_IMAGES);
  const raw = typeof job.result_image_url === 'string' ? job.result_image_url.trim() : '';
  return raw ? [raw] : [];
}

function pickJobImageUrlForSlot(job: JobRow, slotIndex: number): string | null {
  const meta = (job.meta || {}) as Record<string, unknown>;
  const urls = mjGalleryRefsFromJob(job);
  const pick = urls[slotIndex] || (slotIndex <= 0 ? urls[0] : '');
  if (pick && (/^https:\/\//i.test(pick) || isStorageRef(pick))) return pick;
  const raw = job.result_image_url;
  if (slotIndex <= 0 && typeof raw === 'string' && (/^https:\/\//i.test(raw) || isStorageRef(raw))) return raw;
  const upstream =
    slotIndex <= 0 && typeof meta.upstreamImageUrl === 'string' && /^https:\/\//i.test(meta.upstreamImageUrl)
      ? meta.upstreamImageUrl
      : null;
  return upstream;
}

function cardGalleryRefs(card: Record<string, unknown>): string[] {
  let imgs = stringList(card.cardImages);
  if (!imgs.length) imgs = stringList(card.mjGridUrls);
  if (!imgs.length && typeof card.image === 'string' && card.image.trim()) imgs = [card.image.trim()];
  if (card.isMidjourney === true && typeof card.mjCompositeUrl === 'string' && card.mjCompositeUrl.trim()) {
    const composite = card.mjCompositeUrl.trim();
    const tiles = stringList(card.mjGridUrls, 4);
    imgs = [composite, ...(tiles.length ? tiles : imgs.slice(1)).filter((u) => u !== composite)]
      .slice(0, MAX_GALLERY_IMAGES);
  }
  return imgs.slice(0, MAX_GALLERY_IMAGES);
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function cardNeedsGalleryRepair(card: Record<string, unknown>): boolean {
  const jobId = String(card.genJobId || '').replace(/#\d+$/, '');
  if (!jobId) return false;
  const gallery = cardGalleryRefs(card);
  const hasUnstableRef = gallery.some((ref) => ref && !isStorageRef(ref));
  if (hasUnstableRef) return true;
  return card.isMidjourney === true && gallery.length > 0 && gallery.length < MAX_GALLERY_IMAGES;
}

export async function resolveImageRefForJob(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  job: JobRow,
  env?: Env,
  opts: { forceRearchive?: boolean } = {}
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
  if (!opts.forceRearchive) {
    for (const genPath of genPaths) {
      if (await storageBlobOk(admin, genPath, minBytes, env)) {
        return toStorageRef(genPath);
      }
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

async function materializeGridForImageRef(
  admin: SupabaseClient,
  env: Env | undefined,
  imageRef: string | null
): Promise<void> {
  if (!env || !imageRef) return;
  const primaryPath = storagePathFromRef(imageRef);
  if (!primaryPath) return;
  await materializeGridForPrimaryPath(env, admin, primaryPath).catch(() => {});
}

async function repairCardGalleryFromJob(
  admin: SupabaseClient,
  userId: string,
  card: Record<string, unknown>,
  job: JobRow,
  env?: Env
): Promise<{ changed: boolean; recovered: number }> {
  const baseJobId = String(card.genJobId || '').replace(/#\d+$/, '');
  if (!baseJobId) return { changed: false, recovered: 0 };

  const current = cardGalleryRefs(card);
  const jobGallery = mjGalleryRefsFromJob(job);
  const targetCount = Math.min(
    MAX_GALLERY_IMAGES,
    Math.max(current.length, jobGallery.length, card.isMidjourney === true ? 1 : 0)
  );
  if (targetCount <= 0) return { changed: false, recovered: 0 };

  const next: string[] = [];
  let recovered = 0;
  for (let i = 0; i < targetCount; i += 1) {
    const existing = current[i] || '';
    const hasJobSource = !!jobGallery[i];
    let ref = await resolveImageRefForJob(
      admin,
      userId,
      slotJobId(baseJobId, i),
      job,
      env,
      { forceRearchive: i > 0 && hasJobSource }
    );
    if (!ref && existing && /^https:\/\//i.test(existing) && !isStorageRef(existing)) {
      try {
        ref = await archiveRemoteImage(admin, userId, generationStorageAssetId(slotJobId(baseJobId, i)), existing, {
          maxAttempts: 2,
          env
        });
      } catch {
        ref = null;
      }
    }
    if (ref) {
      next.push(ref);
      if (ref !== existing) recovered += 1;
      await materializeGridForImageRef(admin, env, ref);
      continue;
    }
    if (existing) next.push(existing);
  }

  if (!next.length || sameStringList(current, next)) {
    return { changed: false, recovered };
  }

  card.cardImages = next;
  if (card.isMidjourney === true) {
    card.mjCompositeUrl = next[0] || null;
    card.mjGridUrls = next.slice(1, MAX_GALLERY_IMAGES);
    card.image = next[1] || next[0] || card.image || null;
  } else {
    card.image = next[0] || card.image || null;
  }
  card.updatedAt = Date.now();
  return { changed: true, recovered };
}

export type RecoverWarehouseResult = {
  imported: number;
  skipped: number;
  repaired?: number;
  failures: Array<{ jobId?: string; cardId?: string; reason: string }>;
  cardIds: string[];
  totalCandidates?: number;
  totalCards?: number;
  nextOffset?: number | null;
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
  providerScope?: 'grs' | 'apimart' | 'newapi' | 'all';
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

function filterJobsByProvider(jobs: JobRow[], scope?: 'grs' | 'apimart' | 'newapi' | 'all'): JobRow[] {
  if (!scope || scope === 'all') return jobs;
  return jobs.filter((job) => {
    const p = readJobProvider((job.meta || {}) as Record<string, unknown>);
    if (scope === 'apimart') return p === 'apimart';
    if (scope === 'newapi') return p === 'newapi';
    return p !== 'apimart' && p !== 'newapi';
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
  if (scope === 'newapi') {
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
  /** 浏览器批量 repair 须小批，否则 Worker CPU 超时 → 边缘 503（浏览器误报 CORS） */
  const scanMax = Math.min(20, Math.max(1, opts.max ?? 12));
  const repairMax = Math.min(8, scanMax);
  const { payload, cards } = await loadUserPayload(admin, userId);
  const cardOffset = Math.max(0, opts.offset ?? 0);
  const cardsSlice = cards.slice(cardOffset, cardOffset + scanMax);
  const nextOffset = cardOffset + scanMax < cards.length ? cardOffset + scanMax : null;
  const storageMode = opts.env ? mediaStorageMode(opts.env) : 'supabase';
  const r2Enabled = !!(opts.env && hasR2(opts.env));

  type Candidate = { card: Record<string, unknown>; jobId: string; mode: 'grid' | 'full' | 'r2_backfill' | 'gallery' };
  const candidates: Candidate[] = [];

  for (const card of cardsSlice) {
    const cardId = String(card.id || '');
    const jobId = String(card.genJobId || '');
    const imageRef = String(card.image || '');
    if (!cardId) continue;
    if (!imageRef && !jobId) continue;
    if (cardNeedsGalleryRepair(card)) {
      candidates.push({ card, jobId, mode: 'gallery' });
      continue;
    }
    if (!imageRef && jobId) {
      candidates.push({ card, jobId, mode: 'full' });
      continue;
    }
    const resolution = String(card.resolution || '1k');
    const minBytes = jobId ? expectedMinFullBytes(resolution) : MIN_IMAGE_BYTES;
    const primaryCandidates = primaryPathFromImageRef(imageRef, userId, cardId).slice(0, 2);
    let primaryPath: string | null = null;
    let r2PrimarySize = 0;
    let supabasePrimarySize = 0;
    for (const p of primaryCandidates) {
      const clean = p.replace(/^\//, '');
      if (r2Enabled) {
        r2PrimarySize = Math.max(r2PrimarySize, await r2ObjectSize(opts.env!, clean));
      }
      if (!r2Enabled || r2PrimarySize < minBytes) {
        supabasePrimarySize = Math.max(supabasePrimarySize, await supabaseListedSize(admin, clean));
      }
      if (!primaryPath && (r2PrimarySize >= minBytes || supabasePrimarySize >= minBytes)) {
        primaryPath = p;
      }
    }
    let primaryOk = storageMode === 'r2-first'
      ? r2PrimarySize >= minBytes
      : Math.max(r2PrimarySize, supabasePrimarySize) >= minBytes;
    if (storageMode === 'r2-first' && r2PrimarySize < minBytes && supabasePrimarySize >= minBytes) {
      primaryOk = false;
    }
    const primarySize = Math.max(r2PrimarySize, supabasePrimarySize);
    const gridOk = primaryOk && primaryPath
      ? await gridPathOk(admin, primaryPath, opts.env)
      : false;
    if (primaryOk && gridOk) continue;
    if (primaryOk && !gridOk) {
      candidates.push({ card, jobId, mode: 'grid' });
      continue;
    }
    if (!primaryOk && primarySize >= minBytes && r2Enabled) {
      candidates.push({ card, jobId, mode: 'r2_backfill' });
      continue;
    }
    if (!jobId) continue;
    candidates.push({ card, jobId, mode: 'full' });
  }

  const batch = candidates.slice(0, repairMax);
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

    if (mode === 'r2_backfill') {
      const primaryCandidates = primaryPathFromImageRef(String(card.image || ''), userId, cardId);
      let fixed = false;
      for (const p of primaryCandidates) {
        const clean = p.replace(/^\//, '');
        try {
          const { data, error } = await admin.storage.from(BUCKET).download(clean);
          if (error || !data || (data.size || 0) < MIN_IMAGE_BYTES) continue;
          const ct = clean.endsWith('.webp') ? 'image/webp' : clean.endsWith('.png') ? 'image/png' : 'image/jpeg';
          if (!(await uploadToR2(opts.env!, clean, data, ct))) {
            failures.push({ jobId, cardId, reason: 'r2_upload_failed' });
            continue;
          }
          await materializeGridForPrimaryPath(opts.env!, admin, clean).catch(() => {});
          fixed = true;
          break;
        } catch {
          failures.push({ jobId, cardId, reason: 'r2_backfill_failed' });
        }
      }
      if (fixed) {
        repaired += 1;
        cardIds.push(cardId);
      } else {
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

    if (mode === 'gallery') {
      const fixedGallery = await repairCardGalleryFromJob(admin, userId, card, job, opts.env);
      if (fixedGallery.changed) {
        repaired += 1;
        cardIds.push(cardId);
      } else {
        failures.push({ jobId, cardId, reason: 'gallery_repair_failed' });
        skipped += 1;
      }
      continue;
    }

    const imageRef = await resolveImageRefForJob(admin, userId, jobId, job, opts.env);
    if (!imageRef) {
      failures.push({ jobId, cardId, reason: 'no_source' });
      skipped += 1;
      continue;
    }

    card.image = imageRef;
    await repairCardGalleryFromJob(admin, userId, card, job, opts.env);
    repaired += 1;
    cardIds.push(cardId);

    await materializeGridForImageRef(admin, opts.env, imageRef);
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
    totalCards: cards.length,
    nextOffset,
    hint:
      repaired > 0
        ? '已尝试从生图记录重新写入 Storage 并生成缩略图；强刷后查看'
        : nextOffset != null
          ? `本批扫描 ${cardsSlice.length} 张（${cardOffset + 1}～${cardOffset + cardsSlice.length}/${cards.length}），请继续下一批`
          : skipped > 0 && failures.some((f) => f.reason === 'job_not_found')
            ? '部分老任务记录已不存在，仅能从 R2/Supabase 已有文件恢复'
            : '生成服务仍无可用图片，请稍后再试'
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
