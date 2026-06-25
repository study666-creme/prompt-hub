import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { CARD_IMAGES_BUCKET } from './admin-storage';
import {
  communityImagePathCandidates,
  encodeStoragePath,
  resolveStoragePath,
  sanitizeCardFileBase
} from './media-cdn';
import { restoreCommunityPostToUserLibrary } from './community-feed';
import { deleteFromR2, hasR2, mediaStorageMode, scanAllR2Objects } from './r2-storage';

const MAX_BUCKET_SCAN = 15_000;

function normalizePath(p: string): string {
  return String(p || '').replace(/^\//, '').trim();
}

function gridSiblingPath(primary: string): string | null {
  const p = normalizePath(primary);
  if (!p || /_grid\./i.test(p)) return null;
  return p.replace(/\.(jpe?g|png|webp)$/i, '_grid.jpg');
}

function addReferencedPath(refs: Set<string>, raw: string | null | undefined) {
  const path = resolveStoragePath(raw) || normalizePath(String(raw || ''));
  if (!path || !path.includes('/')) return;
  refs.add(path);
  const grid = gridSiblingPath(path);
  if (grid) refs.add(grid);
}

function addCardPathCandidates(refs: Set<string>, userId: string, cardId: string) {
  const uid = String(userId || '').trim();
  const cid = String(cardId || '').trim();
  if (!uid || !cid) return;
  const base = sanitizeCardFileBase(cid);
  for (const ext of ['jpg', 'webp', 'png']) {
    addReferencedPath(refs, `${uid}/${base}.${ext}`);
    addReferencedPath(refs, `${uid}/${cid}.${ext}`);
    addReferencedPath(refs, `${uid}/generated/${base}.${ext}`);
    addReferencedPath(refs, `${uid}/generated/${cid}.${ext}`);
    addReferencedPath(refs, `${uid}/${base}_grid.jpg`);
    addReferencedPath(refs, `${uid}/${cid}_grid.jpg`);
    addReferencedPath(refs, `${uid}/generated/${base}_grid.jpg`);
    addReferencedPath(refs, `${uid}/generated/${cid}_grid.jpg`);
  }
}

function extractUuidStemsFromText(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const text = String(raw || '');
  const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[0].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function addGeneratedStemPaths(refs: Set<string>, userId: string, stem: string) {
  const uid = String(userId || '').trim();
  const s = String(stem || '').trim();
  if (!uid || !s) return;
  for (const ext of ['jpg', 'jpeg', 'webp', 'png']) {
    addReferencedPath(refs, `${uid}/generated/${s}.${ext}`);
    addReferencedPath(refs, `${uid}/${s}.${ext}`);
    addReferencedPath(refs, `${uid}/imagegen/${s}.${ext}`);
  }
  addReferencedPath(refs, `${uid}/generated/${s}_grid.jpg`);
  addReferencedPath(refs, `${uid}/${s}_grid.jpg`);
}

function addLibraryCardReferences(
  refs: Set<string>,
  userId: string,
  card: { id?: string; image?: string; genJobId?: string }
) {
  const cardId = card && typeof card === 'object' ? String(card.id || '').trim() : '';
  addReferencedPath(refs, card?.image);
  if (userId && cardId) {
    addCardPathCandidates(refs, userId, cardId);
    const stripped = cardId.replace(/^wh_/, '');
    if (stripped !== cardId) addCardPathCandidates(refs, userId, stripped);
    for (const p of communityImagePathCandidates(String(card.image || ''), userId, cardId, {
      preferGrid: false
    })) {
      addReferencedPath(refs, p);
    }
  }
  const jobId = card && typeof card === 'object' ? String(card.genJobId || '').replace(/#\d+$/, '') : '';
  if (userId && jobId) addGeneratedStemPaths(refs, userId, jobId);
  for (const uuid of extractUuidStemsFromText(card?.image)) {
    addGeneratedStemPaths(refs, userId, uuid);
  }
  for (const uuid of extractUuidStemsFromText(card?.genJobId)) {
    addGeneratedStemPaths(refs, userId, uuid);
  }
}

function stemKeyFromPath(path: string): string | null {
  const parsed = stemFromStoragePath(path);
  return parsed ? `${parsed.userId}:${parsed.stem}` : null;
}

/** 收集仍被卡片库 / 社区帖 / 生图任务引用的 Storage 路径 */
export async function collectReferencedStoragePaths(
  admin: SupabaseClient
): Promise<Set<string>> {
  const { referenced } = await buildLibraryMediaIndex(admin);
  return referenced;
}

async function buildLibraryMediaIndex(
  admin: SupabaseClient,
  opts?: { excludeUserCard?: { userId: string; cardId: string } }
): Promise<{
  referenced: Set<string>;
  stemIndex: CardStemIndex;
}> {
  const referenced = new Set<string>();
  const protectedStems = new Set<string>();
  const cardsByUser = new Map<string, Map<string, { id: string; imagePath: string | null }>>();

  let offset = 0;
  const pageSize = 500;
  while (true) {
    const { data, error } = await admin
      .from('user_data')
      .select('user_id, data')
      .order('user_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const userId = String((row as { user_id?: string }).user_id || '').trim();
      const cards = (row as { data?: { cards?: { id?: string; image?: string; genJobId?: string }[] } })
        .data?.cards;
      if (!Array.isArray(cards)) continue;
      const byId = cardsByUser.get(userId) || new Map();
      for (const card of cards) {
        const id = String(card?.id || '').trim();
        const ex = opts?.excludeUserCard;
        if (ex && userId === ex.userId && id === ex.cardId) continue;
        addLibraryCardReferences(referenced, userId, card);
        if (!userId || !id) continue;
        const imagePath = resolveStoragePath(card?.image) || null;
        byId.set(id, { id, imagePath });
        protectedStems.add(`${userId}:${sanitizeCardFileBase(id)}`);
        protectedStems.add(`${userId}:${id}`);
        const stripped = id.replace(/^wh_/, '');
        if (stripped !== id) {
          protectedStems.add(`${userId}:${stripped}`);
          protectedStems.add(`${userId}:${sanitizeCardFileBase(stripped)}`);
        }
        const imgKey = imagePath ? stemKeyFromPath(imagePath) : null;
        if (imgKey) protectedStems.add(imgKey);
        const jobId = String(card?.genJobId || '').replace(/#\d+$/, '');
        if (jobId) protectedStems.add(`${userId}:${jobId}`);
      }
      if (byId.size) cardsByUser.set(userId, byId);
    }
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  let postOffset = 0;
  while (true) {
    const { data, error } = await admin
      .from('community_posts')
      .select('author_id, source_card_id, image')
      .order('id', { ascending: true })
      .range(postOffset, postOffset + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const authorId = String((row as { author_id?: string }).author_id || '').trim();
      const sourceCardId = String((row as { source_card_id?: string }).source_card_id || '').trim();
      const ex = opts?.excludeUserCard;
      if (ex && authorId === ex.userId && sourceCardId === ex.cardId) continue;
      addReferencedPath(referenced, (row as { image?: string }).image);
    }
    postOffset += pageSize;
    if (data.length < pageSize) break;
  }

  let jobOffset = 0;
  while (true) {
    const { data, error } = await admin
      .from('generation_requests')
      .select('user_id, id, result_image_url, meta')
      .order('id', { ascending: true })
      .range(jobOffset, jobOffset + pageSize - 1);
    if (error) {
      if (String(error.message || '').includes('generation_requests')) break;
      throw error;
    }
    if (!data?.length) break;
    for (const row of data) {
      const userId = String((row as { user_id?: string }).user_id || '').trim();
      const jobId = String((row as { id?: string }).id || '').trim();
      const meta = ((row as { meta?: Record<string, unknown> }).meta || {}) as Record<string, unknown>;
      addReferencedPath(referenced, (row as { result_image_url?: string }).result_image_url);
      addReferencedPath(referenced, typeof meta.syncImageUrl === 'string' ? meta.syncImageUrl : null);
      if (Array.isArray(meta.extraImageUrls)) {
        for (const u of meta.extraImageUrls) addReferencedPath(referenced, String(u || ''));
      }
      if (Array.isArray(meta.mookoSubmitImageUrls)) {
        for (const u of meta.mookoSubmitImageUrls) addReferencedPath(referenced, String(u || ''));
      }
      if (userId && jobId) {
        addGeneratedStemPaths(referenced, userId, jobId);
        protectedStems.add(`${userId}:${jobId}`);
      }
    }
    jobOffset += pageSize;
    if (data.length < pageSize) break;
  }

  return { referenced, stemIndex: { protectedStems, cardsByUser } };
}

type CardStemIndex = {
  /** userId:stem → 卡片库仍有此 id/base 的卡片 */
  protectedStems: Set<string>;
  /** userId → cardId → card row */
  cardsByUser: Map<string, Map<string, { id: string; imagePath: string | null }>>;
};

function stemFromStoragePath(path: string): { userId: string; stem: string } | null {
  const p = normalizePath(path);
  const parts = p.split('/');
  if (parts.length < 2) return null;
  const userId = parts[0];
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const file = parts[parts.length - 1] || '';
  const stem = file
    .replace(/_grid\.jpe?g$/i, '')
    .replace(/\.(jpe?g|png|webp)$/i, '');
  if (!stem) return null;
  return { userId, stem };
}

async function buildCardStemIndex(admin: SupabaseClient): Promise<CardStemIndex> {
  const { stemIndex } = await buildLibraryMediaIndex(admin);
  return stemIndex;
}

function isPathProtectedByLibrary(path: string, stemIndex: CardStemIndex): boolean {
  const parsed = stemFromStoragePath(path);
  if (!parsed) return false;
  return stemIndex.protectedStems.has(`${parsed.userId}:${parsed.stem}`);
}

function toStorageRef(path: string): string {
  return `storage://${CARD_IMAGES_BUCKET}/${normalizePath(path)}`;
}

export type OrphanRisk = 'safe' | 'recoverable' | 'relink';

export type BucketOrphanItem = {
  id: string;
  path: string;
  paths: string[];
  fileCount: number;
  variantHint: string;
  bytes: number;
  thumbUrl: string;
  thumbFallbackUrl: string;
  risk: OrphanRisk;
  riskLabel: string;
  recoverHint: string;
  recoverPostId: string | null;
  recoverCardId: string | null;
  recoverUserId: string | null;
};

export type BucketOrphanListResult = {
  items: BucketOrphanItem[];
  total: number;
  rawOrphanFiles: number;
  referencedCount: number;
  scannedCount: number;
  truncated: boolean;
  scanSource: 'r2' | 'supabase';
  safeCount: number;
  recoverableCount: number;
  relinkCount: number;
  scannedAt?: string;
  fromCache?: boolean;
  scanStatus?: 'ready' | 'scanning' | 'error';
  scanError?: string | null;
};

type RecoverEntry = {
  postId: string;
  cardId: string;
  userId: string;
};

/** 社区帖仍在、作者卡片库缺卡 → 可按 stem 写回 */
async function buildCommunityRecoverIndex(
  admin: SupabaseClient,
  stemIndex: CardStemIndex
): Promise<Map<string, RecoverEntry>> {
  const map = new Map<string, RecoverEntry>();
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('community_posts')
      .select('id, author_id, source_card_id, image')
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const userId = String((row as { author_id?: string }).author_id || '').trim();
      const postId = String((row as { id?: string }).id || '').trim();
      const sourceCardId = String((row as { source_card_id?: string }).source_card_id || '').trim();
      if (!userId || !postId) continue;
      const cardId =
        sourceCardId || `card_restored_${postId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      if (stemIndex.cardsByUser.get(userId)?.has(cardId)) continue;
      const entry: RecoverEntry = { postId, cardId, userId };
      if (sourceCardId) {
        map.set(`${userId}:${sourceCardId}`, entry);
        map.set(`${userId}:${sanitizeCardFileBase(sourceCardId)}`, entry);
      }
      const imgPath = resolveStoragePath((row as { image?: string }).image);
      if (imgPath) {
        const parsed = stemFromStoragePath(imgPath);
        if (parsed) map.set(`${parsed.userId}:${parsed.stem}`, entry);
      }
    }
    offset += 500;
    if (data.length < 500) break;
  }
  return map;
}

function classifyOrphanGroup(
  primaryPath: string,
  stemIndex: CardStemIndex,
  recoverIndex: Map<string, RecoverEntry>
): {
  risk: OrphanRisk;
  riskLabel: string;
  recoverHint: string;
  recoverPostId: string | null;
  recoverCardId: string | null;
  recoverUserId: string | null;
} {
  const parsed = stemFromStoragePath(primaryPath);
  if (!parsed) {
    return {
      risk: 'safe',
      riskLabel: '高置信孤儿',
      recoverHint: '未识别用户目录，请人工核对缩略图后再删',
      recoverPostId: null,
      recoverCardId: null,
      recoverUserId: null
    };
  }
  const key = `${parsed.userId}:${parsed.stem}`;
  const recover = recoverIndex.get(key);
  if (recover) {
    return {
      risk: 'recoverable',
      riskLabel: '可写回卡片库',
      recoverHint: '社区仍有帖、作者卡片库缺卡，可写回（不删图）',
      recoverPostId: recover.postId,
      recoverCardId: recover.cardId,
      recoverUserId: recover.userId
    };
  }

  const userCards = stemIndex.cardsByUser.get(parsed.userId);
  if (userCards) {
    for (const [cid, card] of userCards) {
      if (cid !== parsed.stem && sanitizeCardFileBase(cid) !== parsed.stem) continue;
      const imgPath = card.imagePath;
      if (!imgPath || normalizePath(imgPath) !== normalizePath(primaryPath)) {
        return {
          risk: 'relink',
          riskLabel: '可重新关联',
          recoverHint: '卡片库有卡但 image 未指向此文件，可修复关联（不删图）',
          recoverPostId: null,
          recoverCardId: cid,
          recoverUserId: parsed.userId
        };
      }
    }
  }

  const normPath = normalizePath(primaryPath);
  if (/\/(generated|imagegen)\//i.test(normPath)) {
    return {
      risk: 'relink',
      riskLabel: '生图目录·需核对',
      recoverHint: '位于 generated/ 或 imagegen/，可能是卡片库正在使用的生图；请勿批量删除，请逐条核对缩略图',
      recoverPostId: null,
      recoverCardId: null,
      recoverUserId: parsed.userId
    };
  }

  return {
    risk: 'safe',
    riskLabel: '高置信孤儿',
    recoverHint: '无卡片库/社区/生图引用；多为已删卡遗留或历史副本，删前核对缩略图',
    recoverPostId: null,
    recoverCardId: null,
    recoverUserId: parsed.userId
  };
}

function orphanStemKey(path: string): string {
  const p = normalizePath(path);
  const parts = p.split('/');
  const file = parts.pop() || p;
  const uid = parts[0] || '';
  const stem = file
    .replace(/_grid\.jpe?g$/i, '')
    .replace(/\.(jpe?g|png|webp)$/i, '');
  return `${uid}:${stem}`;
}

function orphanVariantHint(paths: string[]): string {
  if (paths.length <= 1) return '单文件';
  const hints: string[] = [`${paths.length} 个副本`];
  if (paths.some((p) => /_grid\./i.test(p))) hints.push('含 _grid 缩略图');
  if (paths.some((p) => /\/generated\//i.test(p))) hints.push('含 generated/');
  if (paths.some((p) => /\/imagegen\//i.test(p))) hints.push('含 imagegen/');
  return hints.join(' · ');
}

function groupOrphanFiles(orphans: { path: string; bytes: number }[]) {
  const byKey = new Map<string, { path: string; bytes: number }[]>();
  for (const o of orphans) {
    const key = orphanStemKey(o.path);
    const list = byKey.get(key) || [];
    list.push(o);
    byKey.set(key, list);
  }
  const groups: { id: string; paths: string[]; bytes: number; primaryPath: string }[] = [];
  for (const [id, list] of byKey) {
    list.sort((a, b) => b.bytes - a.bytes);
    const paths = list.map((x) => x.path);
    const bytes = list.reduce((s, x) => s + x.bytes, 0);
    const primaryPath =
      list.find((x) => !/_grid\./i.test(x.path))?.path ||
      list[0]?.path ||
      paths[0] ||
      id;
    groups.push({ id, paths, bytes, primaryPath });
  }
  groups.sort((a, b) => b.bytes - a.bytes);
  return groups;
}

const ORPHAN_SCAN_CACHE_URL = 'https://prompt-hub.internal/orphan-scan/v4';
const SCAN_CACHE_SEC = 600;

type ClassifiedOrphanGroup = {
  id: string;
  paths: string[];
  bytes: number;
  primaryPath: string;
  risk: OrphanRisk;
  riskLabel: string;
  recoverHint: string;
  recoverPostId: string | null;
  recoverCardId: string | null;
  recoverUserId: string | null;
};

type OrphanScanSnapshot = {
  version: 4;
  status: 'ready' | 'scanning' | 'error';
  scanError?: string | null;
  scanStartedAt?: string;
  scannedAt?: string;
  rawOrphanFiles: number;
  referencedCount: number;
  scannedCount: number;
  truncated: boolean;
  classified: ClassifiedOrphanGroup[];
};

async function readOrphanScanCache(): Promise<OrphanScanSnapshot | null> {
  try {
    const res = await caches.default.match(ORPHAN_SCAN_CACHE_URL);
    if (!res) return null;
    const data = (await res.json()) as OrphanScanSnapshot;
    return data?.version === 4 && Array.isArray(data.classified) ? data : null;
  } catch {
    return null;
  }
}

async function writeOrphanScanCache(snapshot: OrphanScanSnapshot): Promise<void> {
  await caches.default.put(
    ORPHAN_SCAN_CACHE_URL,
    new Response(JSON.stringify(snapshot), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${SCAN_CACHE_SEC}`
      }
    })
  );
}

export async function invalidateOrphanScanCache(): Promise<void> {
  try {
    await caches.default.delete(ORPHAN_SCAN_CACHE_URL);
  } catch {
    /* ignore */
  }
}

function scanIsStale(snapshot: OrphanScanSnapshot): boolean {
  if (snapshot.status !== 'scanning') return false;
  const started = snapshot.scanStartedAt ? Date.parse(snapshot.scanStartedAt) : 0;
  return !started || Date.now() - started > 4 * 60_000;
}

async function ensureOrphanScanSnapshot(
  admin: SupabaseClient,
  env: Env,
  refresh: boolean,
  executionCtx?: ExecutionContext
): Promise<OrphanScanSnapshot> {
  if (!refresh) {
    const cached = await readOrphanScanCache();
    if (cached?.status === 'ready') return cached;
    if (cached?.status === 'error') return cached;
    if (cached?.status === 'scanning' && !scanIsStale(cached)) return cached;
  } else {
    await invalidateOrphanScanCache();
  }

  const scanning: OrphanScanSnapshot = {
    version: 4,
    status: 'scanning',
    scanStartedAt: new Date().toISOString(),
    rawOrphanFiles: 0,
    referencedCount: 0,
    scannedCount: 0,
    truncated: false,
    classified: []
  };
  await writeOrphanScanCache(scanning);

  const runScan = async () => {
    try {
      const ready = await performOrphanScan(admin, env);
      await writeOrphanScanCache(ready);
    } catch (e) {
      const failed: OrphanScanSnapshot = {
        version: 4,
        status: 'error',
        scanError: String((e as Error)?.message || e || '扫描失败'),
        scanStartedAt: scanning.scanStartedAt,
        rawOrphanFiles: 0,
        referencedCount: 0,
        scannedCount: 0,
        truncated: false,
        classified: []
      };
      await writeOrphanScanCache(failed);
    }
  };

  if (executionCtx) {
    executionCtx.waitUntil(runScan());
    return scanning;
  }

  await runScan();
  return (await readOrphanScanCache()) || scanning;
}

async function performOrphanScan(admin: SupabaseClient, env: Env): Promise<OrphanScanSnapshot> {
  const [{ referenced, stemIndex }, r2Scan] = await Promise.all([
    buildLibraryMediaIndex(admin),
    scanAllR2Objects(env, MAX_BUCKET_SCAN)
  ]);
  const recoverIndex = await buildCommunityRecoverIndex(admin, stemIndex);

  const orphans: { path: string; bytes: number }[] = [];
  for (const obj of r2Scan.objects) {
    const path = normalizePath(obj.key);
    if (referenced.has(path)) continue;
    if (isPathProtectedByLibrary(path, stemIndex)) continue;
    orphans.push({ path, bytes: obj.size });
  }

  const grouped = groupOrphanFiles(orphans);
  const classified: ClassifiedOrphanGroup[] = grouped.map((g) => {
    const ctx = classifyOrphanGroup(g.primaryPath, stemIndex, recoverIndex);
    return { ...g, ...ctx };
  });

  return {
    version: 4,
    status: 'ready',
    scannedAt: new Date().toISOString(),
    rawOrphanFiles: orphans.length,
    referencedCount: referenced.size,
    scannedCount: r2Scan.objects.length,
    truncated: r2Scan.truncated,
    classified
  };
}

export async function listBucketOrphanFiles(
  admin: SupabaseClient,
  env: Env,
  apiOrigin: string,
  opts: {
    limit: number;
    offset: number;
    risk?: OrphanRisk | 'all';
    refresh?: boolean;
    executionCtx?: ExecutionContext;
  }
): Promise<BucketOrphanListResult> {
  if (!hasR2(env)) {
    throw new Error('R2 桶未绑定（CARD_IMAGES_R2），无法扫描孤儿文件');
  }

  const hadCache = !!(await readOrphanScanCache());
  const snapshot = await ensureOrphanScanSnapshot(admin, env, !!opts.refresh, opts.executionCtx);
  const fromCache = hadCache && !opts.refresh && snapshot.status === 'ready';

  if (snapshot.status === 'scanning') {
    return {
      items: [],
      total: 0,
      rawOrphanFiles: 0,
      referencedCount: snapshot.referencedCount,
      scannedCount: snapshot.scannedCount,
      truncated: false,
      scanSource: 'r2',
      safeCount: 0,
      recoverableCount: 0,
      relinkCount: 0,
      scannedAt: snapshot.scanStartedAt,
      fromCache: false,
      scanStatus: 'scanning',
      scanError: null
    };
  }

  if (snapshot.status === 'error') {
    return {
      items: [],
      total: 0,
      rawOrphanFiles: 0,
      referencedCount: 0,
      scannedCount: 0,
      truncated: false,
      scanSource: 'r2',
      safeCount: 0,
      recoverableCount: 0,
      relinkCount: 0,
      scannedAt: snapshot.scanStartedAt,
      fromCache: false,
      scanStatus: 'error',
      scanError: snapshot.scanError || '扫描失败'
    };
  }

  const classified = snapshot.classified;
  const safeCount = classified.filter((x) => x.risk === 'safe').length;
  const recoverableCount = classified.filter((x) => x.risk === 'recoverable').length;
  const relinkCount = classified.filter((x) => x.risk === 'relink').length;

  const riskFilter = opts.risk && opts.risk !== 'all' ? opts.risk : null;
  const filtered = riskFilter ? classified.filter((x) => x.risk === riskFilter) : classified;

  const limit = Math.min(100, Math.max(1, opts.limit));
  const offset = Math.max(0, opts.offset);
  const slice = filtered.slice(offset, offset + limit);
  const origin = apiOrigin.replace(/\/$/, '');

  const items: BucketOrphanItem[] = slice.map((g) => {
    const grid = gridSiblingPath(g.primaryPath);
    const thumbPath = grid || g.primaryPath;
    return {
      id: g.id,
      path: g.primaryPath,
      paths: g.paths,
      fileCount: g.paths.length,
      variantHint: orphanVariantHint(g.paths),
      bytes: g.bytes,
      thumbUrl: `${origin}/api/v1/media/c/${encodeStoragePath(thumbPath)}`,
      thumbFallbackUrl: `${origin}/api/v1/media/c/${encodeStoragePath(g.primaryPath)}`,
      risk: g.risk,
      riskLabel: g.riskLabel,
      recoverHint: g.recoverHint,
      recoverPostId: g.recoverPostId,
      recoverCardId: g.recoverCardId,
      recoverUserId: g.recoverUserId
    };
  });

  return {
    items,
    total: filtered.length,
    rawOrphanFiles: snapshot.rawOrphanFiles,
    referencedCount: snapshot.referencedCount,
    scannedCount: snapshot.scannedCount,
    truncated: snapshot.truncated,
    scanSource: 'r2',
    safeCount,
    recoverableCount,
    relinkCount,
    scannedAt: snapshot.scannedAt,
    fromCache,
    scanStatus: 'ready',
    scanError: null
  };
}

type UserDataPayload = {
  cards?: { id?: string; image?: string; updatedAt?: number }[];
  schemaVersion?: number;
  [key: string]: unknown;
};

async function relinkUserCardImage(
  admin: SupabaseClient,
  userId: string,
  cardId: string,
  primaryPath: string
): Promise<void> {
  const { data: ud, error: udErr } = await admin
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (udErr) throw udErr;
  const payload = ((ud?.data || {}) as UserDataPayload) || {};
  const cards = Array.isArray(payload.cards) ? [...payload.cards] : [];
  const idx = cards.findIndex((c) => String(c?.id || '') === cardId);
  if (idx < 0) throw new Error('卡片库无此卡，无法重新关联');
  const now = Date.now();
  cards[idx] = {
    ...cards[idx],
    image: toStorageRef(primaryPath),
    updatedAt: now
  };
  const { error: upsertErr } = await admin.from('user_data').upsert(
    {
      user_id: userId,
      data: { ...payload, cards, schemaVersion: payload.schemaVersion || 2 },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (upsertErr) throw upsertErr;
}

/** 从 R2 孤儿组写回卡片库或修复 image 关联（不删图） */
export async function restoreCardFromOrphanGroup(
  admin: SupabaseClient,
  opts: {
    primaryPath: string;
    risk: OrphanRisk;
    recoverPostId?: string | null;
    recoverCardId?: string | null;
    recoverUserId?: string | null;
  }
): Promise<{ action: 'restore-post' | 'relink'; cardId: string; userId: string; alreadyExists?: boolean }> {
  const primaryPath = normalizePath(opts.primaryPath);
  if (!primaryPath) throw new Error('缺少文件路径');

  if (opts.risk === 'recoverable') {
    const postId = String(opts.recoverPostId || '').trim();
    if (!postId) throw new Error('缺少社区帖 ID');
    const r = await restoreCommunityPostToUserLibrary(admin, postId);
    if (!r.alreadyExists) {
      await relinkUserCardImage(admin, r.userId, r.cardId, primaryPath);
    }
    const { data: post } = await admin
      .from('community_posts')
      .select('image')
      .eq('id', postId)
      .maybeSingle();
    const current = resolveStoragePath((post as { image?: string } | null)?.image);
    if (current !== primaryPath) {
      await admin
        .from('community_posts')
        .update({ image: toStorageRef(primaryPath) })
        .eq('id', postId);
    }
    return { action: 'restore-post', cardId: r.cardId, userId: r.userId, alreadyExists: r.alreadyExists };
  }

  if (opts.risk === 'relink') {
    const userId = String(opts.recoverUserId || '').trim();
    const cardId = String(opts.recoverCardId || '').trim();
    if (!userId || !cardId) throw new Error('缺少用户或卡片 ID');
    await relinkUserCardImage(admin, userId, cardId, primaryPath);
    return { action: 'relink', cardId, userId };
  }

  throw new Error('该组为高置信孤儿，不支持写回；若确认无用请删除');
}

export async function deleteOwnedCardImageIfUnreferenced(
  admin: SupabaseClient,
  env: Env,
  userId: string,
  imageRef: string | null | undefined,
  opts?: { excludeCardId?: string; allowGenerated?: boolean; force?: boolean; genJobId?: string }
): Promise<{ removed: number; skipped: number; paths: string[] }> {
  const uid = String(userId || '').trim();
  const path = resolveStoragePath(imageRef);
  if (!path && !opts?.force) return { removed: 0, skipped: 0, paths: [] };

  const pathsToDelete = new Set<string>();
  if (path) {
    const norm = normalizePath(path);
    if (norm && !norm.startsWith(`${uid}/`)) {
      throw new Error('无权删除该图片');
    }
    if (norm) {
      if (opts?.allowGenerated || !/\/generated\//i.test(norm)) pathsToDelete.add(norm);
      const grid = gridSiblingPath(norm);
      if (grid) pathsToDelete.add(grid);
    }
  }

  if (opts?.force) {
    const cardId = String(opts.excludeCardId || '').trim();
    if (uid && cardId) {
      const extra = new Set<string>();
      addCardPathCandidates(extra, uid, cardId);
      const stripped = cardId.replace(/^wh_/, '');
      if (stripped !== cardId) addCardPathCandidates(extra, uid, stripped);
      for (const p of extra) {
        if (opts.allowGenerated || !/\/generated\//i.test(p)) pathsToDelete.add(normalizePath(p));
      }
    }
    const jobId = String(opts.genJobId || '').replace(/#\d+$/, '').trim();
    if (uid && jobId && opts.allowGenerated) {
      for (const ext of ['jpg', 'jpeg', 'webp', 'png']) {
        pathsToDelete.add(`${uid}/generated/${jobId}.${ext}`);
        pathsToDelete.add(`${uid}/generated/${jobId}_grid.jpg`);
      }
    }
    const list = [...pathsToDelete].filter(Boolean);
    if (!list.length) return { removed: 0, skipped: 0, paths: [] };
    const result = await deleteStoragePaths(admin, env, list, { skipReferenceCheck: true });
    return {
      removed: result.r2Removed || result.removed,
      skipped: 0,
      paths: list
    };
  }

  if (!path) return { removed: 0, skipped: 0, paths: [] };

  const norm = normalizePath(path);
  if (!norm.startsWith(`${uid}/`)) {
    throw new Error('无权删除该图片');
  }
  if (!opts?.allowGenerated && /\/generated\//i.test(norm)) {
    return { removed: 0, skipped: 1, paths: [] };
  }

  const pathsToCheck: string[] = [norm];
  const grid = gridSiblingPath(norm);
  if (grid) pathsToCheck.push(grid);

  const excludeUserCard =
    opts?.excludeCardId && uid ? { userId: uid, cardId: String(opts.excludeCardId).trim() } : undefined;
  const { referenced, stemIndex } = await buildLibraryMediaIndex(admin, { excludeUserCard });

  const toDelete: string[] = [];
  let skipped = 0;
  for (const p of pathsToCheck) {
    if (referenced.has(p) || isPathProtectedByLibrary(p, stemIndex)) skipped += 1;
    else toDelete.push(p);
  }
  if (!toDelete.length) return { removed: 0, skipped, paths: [] };

  const result = await deleteStoragePaths(admin, env, toDelete, { skipReferenceCheck: true });
  return {
    removed: result.r2Removed || result.removed,
    skipped,
    paths: toDelete
  };
}

export async function deleteStoragePaths(
  admin: SupabaseClient,
  env: Env,
  paths: string[],
  opts?: { skipReferenceCheck?: boolean }
): Promise<{ removed: number; r2Removed: number; blocked?: string[] }> {
  const clean = [...new Set(paths.map(normalizePath).filter(Boolean))];
  if (!clean.length) return { removed: 0, r2Removed: 0 };

  let allowed = clean;
  let blocked: string[] = [];
  if (!opts?.skipReferenceCheck) {
    const { referenced, stemIndex } = await buildLibraryMediaIndex(admin);
    blocked = clean.filter((p) => referenced.has(p) || isPathProtectedByLibrary(p, stemIndex));
    allowed = clean.filter((p) => !blocked.includes(p));
    if (!allowed.length) {
      throw new Error(
        `以下路径仍被卡片库/社区/生图引用，已拒绝删除：${blocked.slice(0, 3).join('、')}${blocked.length > 3 ? '…' : ''}`
      );
    }
  }

  const mode = mediaStorageMode(env);
  let supabaseRemoved = 0;
  if (mode !== 'r2') {
    const { error } = await admin.storage.from(CARD_IMAGES_BUCKET).remove(allowed);
    if (error) throw error;
    supabaseRemoved = allowed.length;
  }

  let r2Removed = 0;
  for (const p of allowed) {
    if (await deleteFromR2(env, p)) r2Removed += 1;
  }
  await invalidateOrphanScanCache();
  return {
    removed: mode === 'r2' ? r2Removed : Math.max(supabaseRemoved, r2Removed),
    r2Removed,
    ...(blocked.length ? { blocked } : {})
  };
}

export function publicThumbUrls(
  apiOrigin: string,
  imageRef: string | null | undefined
): { thumbUrl: string | null; thumbFallbackUrl: string | null } {
  const base = resolveStoragePath(imageRef);
  if (!base) return { thumbUrl: null, thumbFallbackUrl: null };
  const origin = apiOrigin.replace(/\/$/, '');
  const grid = gridSiblingPath(base);
  return {
    thumbUrl: `${origin}/api/v1/media/c/${encodeStoragePath(grid || base)}`,
    thumbFallbackUrl: `${origin}/api/v1/media/c/${encodeStoragePath(base)}`
  };
}
