import type { Context } from 'hono';
import type { Env } from '../env';
import { createAdminClient } from './supabase';
import { generationStorageAssetId, storagePathFromRef } from './image-archive';
import { cardImageExists } from './r2-storage';
import { buildPrivateMediaCdnUrl, materializeGridForPrimaryPath, signingPathForVariant } from './media-cdn';
import { resolveImageRefForJob } from './recover-generation-warehouse';

function slotJobId(baseJobId: string, slot: number): string {
  const base = String(baseJobId || '').replace(/#\d+$/, '');
  if (!Number.isFinite(slot) || slot <= 0) return base;
  return `${base}#${slot + 1}`;
}

function primaryPathCandidates(userId: string, jobId: string): string[] {
  const asset = generationStorageAssetId(jobId);
  const base = String(jobId).replace(/#\d+$/, '');
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && !out.includes(key)) out.push(key);
  };
  for (const ext of ['png', 'jpg', 'webp']) add(`${userId}/generated/${asset}.${ext}`);
  if (asset !== generationStorageAssetId(base)) {
    for (const ext of ['png', 'jpg', 'webp']) add(`${userId}/generated/${generationStorageAssetId(base)}.${ext}`);
  }
  return out;
}

/** 服务端：归档原图（若缺）→ 生成 _grid → 返回签名缩略图 URL */
export async function ensureWarehouseJobThumb(
  c: Context<{ Bindings: Env }>,
  userId: string,
  jobId: string
): Promise<{ url: string; gridPath: string } | null> {
  const admin = createAdminClient(c.env);
  const baseJobId = String(jobId).replace(/#\d+$/, '');
  let primaryPath: string | null = null;

  for (const p of primaryPathCandidates(userId, jobId)) {
    if (await cardImageExists(c.env, p, admin)) {
      primaryPath = p;
      break;
    }
  }

  if (!primaryPath) {
    const { data: job, error } = await admin
      .from('generation_requests')
      .select('id, result_image_url, status, user_id, meta, resolution, prompt')
      .eq('id', baseJobId)
      .maybeSingle();
    if (error || !job || job.user_id !== userId || job.status !== 'completed') return null;
    const ref = await resolveImageRefForJob(
      admin,
      userId,
      generationStorageAssetId(jobId),
      job,
      c.env
    );
    if (!ref) return null;
    primaryPath = storagePathFromRef(ref);
  }

  if (!primaryPath) return null;

  const signPath = signingPathForVariant(primaryPath, 'grid').replace(/^\//, '');
  if (await cardImageExists(c.env, signPath, admin)) {
    const url = await buildPrivateMediaCdnUrl(c, signPath);
    if (url) return { url, gridPath: signPath };
  }

  const gridClean = await materializeGridForPrimaryPath(c.env, admin, primaryPath);
  if (!gridClean) return null;
  const url = await buildPrivateMediaCdnUrl(c, gridClean);
  return { url, gridPath: gridClean };
}

export function warehouseThumbCacheKey(jobId: string, slot: number): string {
  const slotJob = slotJobId(jobId, slot);
  return `${slotJob.replace(/#\d+$/, '')}:${slot}`;
}

export { slotJobId };
