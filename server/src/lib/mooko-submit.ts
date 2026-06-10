import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { archiveGenerationResultUrls, isDataImageUrl, isStorageRef } from './image-archive';
import { finalizeFailedJob, type JobRow } from './generation-jobs';
import type { ImageUpstreamBindings } from './image-upstream';
import { fetchMookoTaskOnce, isMookoPlaceholderTaskId, submitMookoImageJob } from './mooko';

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
  meta: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const attempts = Number(meta.mookoSubmitAttempts || 0);
  if (String(meta.mookoSubmitState || '') !== 'queued') return null;
  if (attempts >= 1) return null;

  const nextMeta = {
    ...meta,
    mookoSubmitState: 'running',
    mookoSubmitStartedAt: new Date().toISOString(),
    mookoSubmitAttempts: attempts + 1
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

/** waitUntil 内直接标记完成，避免依赖后续轮询 HTTP 才入库 */
async function completeMookoJobWithImage(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>,
  imageUrl: string,
  extraUrls: string[]
): Promise<void> {
  const extras = extraUrls.filter((u) => u && u !== imageUrl);
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
  attempts = 12,
  intervalMs = 5000
): Promise<string | null> {
  if (!taskId || isMookoPlaceholderTaskId(taskId)) return null;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    const polled = await fetchMookoTaskOnce(apiKey, baseUrl, taskId);
    const httpUrls = (polled.imageUrls || []).filter((u) => /^https?:\/\//i.test(u));
    if (httpUrls.length) return httpUrls[0];
    if (polled.imageUrl && /^https?:\/\//i.test(polled.imageUrl)) return polled.imageUrl;
    if (polled.status === 'failed') break;
  }
  return null;
}

/** 木瓜AI：POST 同步阻塞可达 8 分钟，必须在 waitUntil 中跑，轮询请求只触发、不等待 */
export async function processMookoPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  env: Env | undefined,
  params: MookoSubmitParams
): Promise<void> {
  if (!upstream.mookoKey) return;

  const { data: live } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', job.id)
    .maybeSingle();
  if (!live || live.status !== 'processing') return;

  const meta = (live.meta as Record<string, unknown>) || {};
  const submitState = String(meta.mookoSubmitState || '');
  if (submitState === 'done') return;
  if (typeof meta.upstreamTaskId === 'string' && meta.upstreamTaskId) return;
  if (typeof meta.syncImageUrl === 'string' && meta.syncImageUrl) return;
  // 同步 POST 可达 8 分钟：running 期间禁止再次提交（此前 90s 重试导致同一任务多次扣费）
  if (submitState === 'running') return;
  const attempts = Number(meta.mookoSubmitAttempts || 0);
  if (attempts >= 1 || submitState !== 'queued') return;

  const claimed = await claimMookoSubmit(admin, job.id, meta);
  if (!claimed) return;

  try {
    const submitted = await submitMookoImageJob(upstream.mookoKey, upstream.mookoBase, {
      upstreamModel: params.upstreamModel.trim() || String(meta.upstreamModel || 'gpt-image-2-pro'),
      prompt: params.prompt,
      resolution: params.resolution,
      quality: params.quality,
      size: params.size,
      refImageUrls: params.refImageUrls
    });
    const submitUrls = submitted.imageUrls?.filter(Boolean) || [];
    const rawUrls = submitUrls.length
      ? submitUrls
      : submitted.imageUrl
        ? [submitted.imageUrl]
        : [];

    await patchJobMeta(admin, job.id, {
      upstreamTaskId: submitted.taskId,
      mookoSubmitState: 'done',
      mookoSubmitError: null,
      mookoSubmitFinishedAt: new Date().toISOString()
    });

    let archivedUrls: string[] = [];
    let primaryUrl: string | null = null;
    if (rawUrls.length) {
      try {
        archivedUrls = await archiveGenerationResultUrls(admin, userId, job.id, rawUrls, env);
        primaryUrl = archivedUrls[0] || null;
      } catch (archiveErr) {
        console.warn('[mooko] archive failed, trying http poll fallback', job.id, archiveErr);
        const httpOnly = rawUrls.filter((u) => /^https?:\/\//i.test(u));
        if (httpOnly.length) {
          primaryUrl = httpOnly[0];
          archivedUrls = httpOnly;
        } else {
          const polledHttp = await pollMookoHttpImage(
            upstream.mookoKey,
            upstream.mookoBase,
            submitted.taskId
          );
          if (polledHttp) {
            primaryUrl = polledHttp;
            archivedUrls = [polledHttp];
          } else {
            const dataUrls = rawUrls.filter(isDataImageUrl);
            if (dataUrls.length) {
              try {
                archivedUrls = await archiveGenerationResultUrls(admin, userId, job.id, dataUrls, env);
                primaryUrl = archivedUrls[0] || null;
              } catch (retryErr) {
                console.warn('[mooko] data url archive retry failed', job.id, retryErr);
                throw archiveErr;
              }
            } else {
              throw archiveErr;
            }
          }
        }
      }
      if (primaryUrl && /^https?:\/\//i.test(primaryUrl) && !isStorageRef(primaryUrl)) {
        try {
          archivedUrls = await archiveGenerationResultUrls(admin, userId, job.id, [primaryUrl], env);
          primaryUrl = archivedUrls[0] || primaryUrl;
        } catch (e) {
          console.warn('[mooko] http archive deferred to poll', job.id, e);
        }
      }
    } else if (submitted.taskId && !isMookoPlaceholderTaskId(submitted.taskId)) {
      const polledHttp = await pollMookoHttpImage(
        upstream.mookoKey,
        upstream.mookoBase,
        submitted.taskId
      );
      if (polledHttp) {
        primaryUrl = polledHttp;
        archivedUrls = [polledHttp];
      }
    }

    const nextMeta = await patchJobMeta(admin, job.id, {
      upstreamTaskId: submitted.taskId,
      ...(primaryUrl ? { syncImageUrl: primaryUrl } : {}),
      ...(archivedUrls.length > 1 ? { mookoSubmitImageUrls: archivedUrls } : {}),
      mookoSubmitState: 'done',
      mookoSubmitError: null,
      mookoSubmitFinishedAt: new Date().toISOString()
    });

    if (primaryUrl) {
      await completeMookoJobWithImage(admin, job.id, nextMeta, primaryUrl, archivedUrls);
    } else if (submitted.taskId && !isMookoPlaceholderTaskId(submitted.taskId)) {
      await patchJobMeta(admin, job.id, {
        mookoAwaitPoll: true,
        mookoSubmitState: 'done'
      });
      console.warn('[mooko] submit ok but no image yet, await poll', job.id, submitted.taskId);
    }
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String((e as Error)?.message || e);
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
