import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import {
  archiveGenerationResultUrls,
  archiveRemoteImage,
  isDataImageUrl,
  isLikelyDataImageUrl,
  isParseableDataImageUrl,
  isStorageRef
} from './image-archive';
import { finalizeFailedJob, type JobRow } from './generation-jobs';
import type { ImageUpstreamBindings } from './image-upstream';
import {
  confirmMookoTaskOutcome,
  fetchMookoTaskOnce,
  isMookoPlaceholderTaskId,
  submitMookoImageJob
} from './mooko';

/** 从木瓜 task_id 拉 gimg HTTP 链（勿用截断的 base64） */
export async function resolveMookoHttpImageFromTask(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  opts?: { attempts?: number; intervalMs?: number }
): Promise<string | null> {
  if (!taskId || isMookoPlaceholderTaskId(taskId)) return null;
  const polled = await confirmMookoTaskOutcome(apiKey, baseUrl, taskId, {
    attempts: opts?.attempts ?? 45,
    intervalMs: opts?.intervalMs ?? 4000
  });
  const httpUrls = (polled.imageUrls || []).filter((u) => /^https?:\/\//i.test(u));
  if (httpUrls.length) return httpUrls[0];
  if (polled.imageUrl && /^https?:\/\//i.test(polled.imageUrl)) return polled.imageUrl;
  return null;
}

type MookoSubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
};

async function patchJobMeta(
  admin: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data } = await admin
    .from('generation_requests')
    .select('meta')
    .eq('id', jobId)
    .maybeSingle();
  const meta = ((data?.meta as Record<string, unknown>) || {});
  const next = { ...meta, ...patch };
  const { error } = await admin.from('generation_requests').update({ meta: next }).eq('id', jobId);
  if (error) throw new ApiError(500, 'DB_ERROR', `更新任务 meta 失败：${error.message}`);
  return next;
}

/** 仅 queued → running 的原子认领，避免 Cron 并发时同一任务重复 POST 扣费 */
async function claimMookoSubmit(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>,
  channel: 'cron' | 'http' = 'cron'
): Promise<Record<string, unknown> | null> {
  const attempts = Number(meta.mookoSubmitAttempts || 0);
  if (String(meta.mookoSubmitState || '') !== 'queued') return null;
  if (attempts >= 1) return null;

  const nextMeta = {
    ...meta,
    mookoSubmitState: 'running',
    mookoSubmitStartedAt: new Date().toISOString(),
    mookoSubmitAttempts: attempts + 1,
    mookoSubmitChannel: channel
  };

  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', jobId)
    .eq('status', 'processing')
    .filter('meta->>mookoSubmitState', 'eq', 'queued')
    .select('meta')
    .maybeSingle();

  if (error || !data?.meta) return null;
  return data.meta as Record<string, unknown>;
}

/** 慢速线（木瓜/Think）上游已出图：直接写 completed，勿等轮询 */
export async function completeMookoJobWithImage(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>,
  imageUrl: string,
  extraUrls: string[]
): Promise<void> {
  if (isDataImageUrl(imageUrl)) {
    throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_image_not_archived');
  }
  const extras = extraUrls.filter((u) => u && u !== imageUrl && !isDataImageUrl(u));
  await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      result_image_url: imageUrl,
      error_message: null,
      completed_at: new Date().toISOString(),
      meta: {
        ...meta,
        syncImageUrl: imageUrl,
        mookoSubmitState: 'done',
        mookoSubmitError: null,
        archived: isStorageRef(imageUrl),
        archivePending: !isStorageRef(imageUrl) && /^https?:\/\//i.test(imageUrl),
        ...(extras.length ? { extraImageUrls: extras, mookoSubmitImageUrls: extraUrls } : {})
      }
    })
    .eq('id', jobId);
}

async function pollMookoHttpImage(
  apiKey: string,
  baseUrl: string | undefined,
  taskId: string,
  attempts = 45,
  intervalMs = 4000
): Promise<string | null> {
  return resolveMookoHttpImageFromTask(apiKey, baseUrl, taskId, { attempts, intervalMs });
}

/** 将 sync 图（含木瓜 base64）归档后写 completed；data URL 不得写入 result_image_url */
export async function finalizeMookoArchivedImage(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  meta: Record<string, unknown>,
  rawUrl: string,
  env: Env | undefined
): Promise<void> {
  let stored = rawUrl;
  if (isDataImageUrl(rawUrl) || /^https?:\/\//i.test(rawUrl)) {
    stored = await archiveRemoteImage(admin, userId, jobId, rawUrl, { env, maxAttempts: 3 });
  }
  if (isDataImageUrl(stored)) {
    throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_image_archive_failed');
  }
  const nextMeta = {
    ...meta,
    syncImageUrl: stored,
    mookoSubmitState: 'done',
    mookoSubmitError: null,
    mookoAwaitPoll: false,
    mookoSubmitFinishedAt: new Date().toISOString()
  };
  await completeMookoJobWithImage(admin, jobId, nextMeta, stored, [stored]);
}

async function deferMookoAwaitPoll(
  admin: SupabaseClient,
  jobId: string,
  taskId: string,
  meta: Record<string, unknown>
): Promise<void> {
  const clean = { ...meta };
  delete clean.syncImageUrl;
  delete clean.mookoSubmitImageUrls;
  delete clean.mookoSubmitError;
  await patchJobMeta(admin, jobId, {
    ...clean,
    upstreamTaskId: taskId,
    mookoSubmitState: 'done',
    mookoAwaitPoll: true,
    mookoSubmitError: null,
    mookoSubmitFinishedAt: new Date().toISOString()
  });
  console.warn('[mooko] upstream ok, await task poll', jobId, taskId);
}

/** 木瓜AI：同步 POST 可达 8 分钟，仅 Cron（awaitSubmit）执行；轮询只读 DB */
export async function processMookoPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  env: Env | undefined,
  params: MookoSubmitParams,
  opts?: { channel?: 'cron' | 'http' }
): Promise<void> {
  if (!upstream.mookoKey) {
    console.error('[mooko] MOOKO_API_KEY missing, skip submit', job.id);
    return;
  }

  const { data: live } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', job.id)
    .maybeSingle();
  if (!live || live.status !== 'processing') return;

  const meta = (live.meta as Record<string, unknown>) || {};
  const submitState = String(meta.mookoSubmitState || '');
  if (submitState === 'done') return;
  if (typeof meta.syncImageUrl === 'string' && meta.syncImageUrl) return;
  // 同步 POST 可达 8 分钟：running 期间禁止再次 POST
  if (submitState === 'running') {
    const sync = typeof meta.syncImageUrl === 'string' ? meta.syncImageUrl.trim() : '';
    if (sync) {
      await finalizeMookoArchivedImage(admin, userId, job.id, meta, sync, env);
    }
    return;
  }
  const attempts = Number(meta.mookoSubmitAttempts || 0);
  if (attempts >= 1 || submitState !== 'queued') return;

  const claimed = await claimMookoSubmit(admin, job.id, meta, opts?.channel || 'cron');
  if (!claimed) return;

  try {
    const submitted = await submitMookoImageJob(
      upstream.mookoKey,
      upstream.mookoBase,
      {
        upstreamModel: params.upstreamModel.trim() || String(meta.upstreamModel || 'gpt-image-2-pro'),
        prompt: params.prompt,
        resolution: params.resolution,
        quality: params.quality,
        size: params.size,
        refImageUrls: params.refImageUrls
      },
      {
        onRequestId: async (taskId) => {
          await patchJobMeta(admin, job.id, { upstreamTaskId: taskId });
        }
      }
    );
    const submitUrls = submitted.imageUrls?.filter(Boolean) || [];
    const rawUrls = (submitUrls.length
      ? submitUrls
      : submitted.imageUrl
        ? [submitted.imageUrl]
        : []
    ).filter((u) => /^https?:\/\//i.test(u) || isParseableDataImageUrl(u));

    const realTaskId =
      submitted.taskId && !isMookoPlaceholderTaskId(submitted.taskId) ? submitted.taskId : '';

    let archivedUrls: string[] = [];
    let primaryUrl: string | null = null;

    if (rawUrls.length) {
      const httpOnly = rawUrls.filter((u) => /^https?:\/\//i.test(u));
      const dataOnly = rawUrls.filter((u) => isLikelyDataImageUrl(u));
      if (httpOnly.length) {
        archivedUrls = await archiveGenerationResultUrls(admin, userId, job.id, httpOnly, env);
        primaryUrl = archivedUrls[0] || null;
      } else if (dataOnly.length) {
        primaryUrl = await archiveRemoteImage(admin, userId, job.id, dataOnly[0], {
          env,
          maxAttempts: 3
        });
        archivedUrls = primaryUrl ? [primaryUrl] : [];
      }
      if (!primaryUrl || isDataImageUrl(primaryUrl)) {
        throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_image_archive_failed');
      }
      const nextMeta = await patchJobMeta(admin, job.id, {
        upstreamTaskId: submitted.taskId,
        syncImageUrl: primaryUrl,
        ...(archivedUrls.length > 1 ? { mookoSubmitImageUrls: archivedUrls } : {}),
        mookoSubmitState: 'done',
        mookoSubmitError: null,
        mookoAwaitPoll: false,
        mookoSubmitFinishedAt: new Date().toISOString()
      });
      await completeMookoJobWithImage(admin, job.id, nextMeta, primaryUrl, archivedUrls);
      return;
    }
    if (realTaskId) {
      console.error('[mooko] upstream charged but no sync image in body', job.id, realTaskId);
      throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_no_image');
    }
    throw new ApiError(502, 'UPSTREAM_NO_IMAGE', 'upstream_no_image');
  } catch (e) {
    let msg = e instanceof ApiError ? e.message : String((e as Error)?.message || e);
    if (/atob\(\)|invalid base64|invalid_data_url/i.test(msg)) {
      msg = 'upstream_image_archive_failed';
    }
    const recovered = await tryCompleteMookoFromStoredArchive(admin, userId, job.id, env);
    if (recovered) {
      console.warn('[mooko] archive failed but R2 exists, completed', job.id, msg);
      return;
    }
    console.error('[mooko] background submit failed', job.id, msg);
    await patchJobMeta(admin, job.id, {
      mookoSubmitState: 'failed',
      mookoSubmitError: msg.slice(0, 400)
    });
    const { data: fresh } = await admin
      .from('generation_requests')
      .select('*')
      .eq('id', job.id)
      .maybeSingle();
    if (fresh && fresh.status === 'processing') {
      await finalizeFailedJob(admin, userId, fresh, msg.slice(0, 400));
    }
  }
}

export async function tryCompleteMookoFromStoredArchive(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  env: Env | undefined
): Promise<boolean> {
  const { findFirstExistingStoragePath } = await import('./media-cdn');
  const { toStorageRef } = await import('./image-archive');
  const paths = ['jpg', 'png', 'webp'].map((ext) => `${userId}/generated/${jobId}.${ext}`);
  const found = await findFirstExistingStoragePath(admin, paths, 'card-images', env);
  if (!found) return false;
  const stored = toStorageRef(found);
  const { data } = await admin
    .from('generation_requests')
    .select('meta')
    .eq('id', jobId)
    .maybeSingle();
  const meta = ((data?.meta as Record<string, unknown>) || {});
  await completeMookoJobWithImage(admin, jobId, meta, stored, [stored]);
  return true;
}
