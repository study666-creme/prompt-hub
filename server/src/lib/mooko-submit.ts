import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { finalizeFailedJob, pollAndUpdateJob, type JobRow } from './generation-jobs';
import type { ImageUpstreamBindings } from './image-upstream';
import { submitMookoImageJob } from './mooko';

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
  await admin.from('generation_requests').update({ meta: next }).eq('id', jobId);
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
      upstreamModel: params.upstreamModel.trim() || String(meta.upstreamModel || 'gpt-image-2'),
      prompt: params.prompt,
      resolution: params.resolution,
      quality: params.quality,
      size: params.size,
      refImageUrls: params.refImageUrls
    });
    const submitUrls = submitted.imageUrls?.filter(Boolean) || [];
    const primaryUrl = submitted.imageUrl || submitUrls[0] || null;
    const nextMeta = await patchJobMeta(admin, job.id, {
      upstreamTaskId: submitted.taskId,
      ...(primaryUrl ? { syncImageUrl: primaryUrl } : {}),
      ...(submitUrls.length ? { mookoSubmitImageUrls: submitUrls } : {}),
      mookoSubmitState: 'done',
      mookoSubmitError: null,
      mookoSubmitFinishedAt: new Date().toISOString()
    });
    const { data: fresh } = await admin
      .from('generation_requests')
      .select('*')
      .eq('id', job.id)
      .maybeSingle();
    if (fresh) {
      await pollAndUpdateJob(admin, userId, fresh, upstream, env, { quick: false });
    } else if (submitted.imageUrl) {
      console.warn('[mooko] submit ok but job row missing', job.id, nextMeta);
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
