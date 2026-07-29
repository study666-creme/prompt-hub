import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { finalizeFailedJob, type JobRow } from './generation-jobs';
import { archiveGenerationResultUrls } from './image-archive';
import {
  submitImageJobForProvider,
  type ImageSubmitParams,
  type ImageUpstreamBindings,
  type ImageUpstreamProvider
} from './image-upstream';

export type FastSubmitParams = ImageSubmitParams;

/** 从 job.meta 还原 GrsAI/Apimart 后台提交参数（含 MJ speed 等） */
export function fastSubmitParamsFromJob(job: JobRow): FastSubmitParams {
  const meta = (job.meta as Record<string, unknown>) || {};
  const mjParams =
    meta.mjParams && typeof meta.mjParams === 'object' && !Array.isArray(meta.mjParams)
      ? (meta.mjParams as Record<string, unknown>)
      : undefined;
  return {
    upstreamModel: String(meta.upstreamModel || 'gpt-image-2-pro'),
    prompt: String(job.prompt || ''),
    resolution: String(job.resolution || '1k'),
    quality: String(meta.upstreamQuality || job.quality || 'standard'),
    fixedQualityLow: meta.fixedQualityLow === true,
    size: typeof meta.size === 'string' ? meta.size : undefined,
    count: typeof meta.count === 'number' ? meta.count : undefined,
    refImageUrls: Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[]).filter(Boolean)
      : undefined,
    catalogParameters: Array.isArray(meta.newApiParameters)
      ? (meta.newApiParameters as ImageSubmitParams['catalogParameters'])
      : undefined,
    ...(mjParams ? { mjParams } : {})
  };
}

async function claimFastSubmit(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  meta: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (String(meta.fastSubmitState || '') !== 'queued') return null;
  const attemptId = crypto.randomUUID();
  const nextMeta = {
    ...meta,
    fastSubmitState: 'running',
    fastSubmitAttemptId: attemptId,
    fastSubmitStartedAt: new Date().toISOString(),
    fastSubmitDispatchedAt: new Date().toISOString(),
    upstreamClientRequestId: String(meta.upstreamClientRequestId || jobId)
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'processing')
    .filter('meta->>fastSubmitState', 'eq', 'queued')
    .select('meta')
    .maybeSingle();
  if (error) return null;
  if (data?.meta && typeof data.meta === 'object') {
    return data.meta as Record<string, unknown>;
  }

  // Some PostgREST-compatible deployments apply the update but omit the
  // requested representation. Confirm this attempt owns the running state
  // before issuing the irreversible upstream generation request.
  const { data: persisted, error: verifyError } = await admin
    .from('generation_requests')
    .select('meta')
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'processing')
    .filter('meta->>fastSubmitState', 'eq', 'running')
    .filter('meta->>fastSubmitAttemptId', 'eq', attemptId)
    .maybeSingle();
  if (verifyError || !persisted?.meta || typeof persisted.meta !== 'object') return null;
  const persistedMeta = persisted.meta as Record<string, unknown>;
  if (
    persistedMeta.fastSubmitState !== 'running'
    || persistedMeta.fastSubmitAttemptId !== attemptId
    || persistedMeta.upstreamClientRequestId !== nextMeta.upstreamClientRequestId
  ) {
    return null;
  }
  return persistedMeta;
}

function pendingResultUrls(meta: Record<string, unknown>): string[] {
  return Array.isArray(meta.upstreamResultUrls)
    ? (meta.upstreamResultUrls as unknown[])
        .filter((value): value is string => typeof value === 'string' && !!value)
    : [];
}

/** Retry only local archival after a paid request has already returned image URLs. */
export async function recoverFastProviderResultArchive(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  env?: Env
): Promise<{ imageUrl: string; extraImageUrls?: string[] } | null> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const urls = pendingResultUrls(meta);
  if (!urls.length) return null;

  const archived = await archiveGenerationResultUrls(admin, userId, job.id, urls, env);
  if (!archived[0]) throw new Error('upstream_image_archive_failed');
  const {
    upstreamResultUrls: _discardResultUrls,
    fastSubmitError: _discardSubmitError,
    ...retainedMeta
  } = meta;
  const nextMeta: Record<string, unknown> = {
    ...retainedMeta,
    fastSubmitState: 'done',
    fastSubmitFinishedAt: new Date().toISOString(),
    fastSubmitRecoveredAt: new Date().toISOString(),
    syncImageUrl: archived[0]
  };
  if (archived.length > 1) nextMeta.extraImageUrls = archived.slice(1);
  const { error } = await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      result_image_url: archived[0],
      completed_at: new Date().toISOString(),
      error_message: null,
      meta: nextMeta
    })
    .eq('id', job.id)
    .eq('status', 'processing');
  if (error) throw error;
  return {
    imageUrl: archived[0],
    ...(archived.length > 1 ? { extraImageUrls: archived.slice(1) } : {})
  };
}

/** GrsAI / Apimart：后台提交，避免 POST /generate 同步等待触发 Cloudflare 524 */
export async function processFastProviderPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  provider: Extract<ImageUpstreamProvider, 'grsai' | 'apimart' | 'newapi'>,
  params: FastSubmitParams,
  env?: Env
): Promise<boolean> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const claimed = await claimFastSubmit(admin, userId, job.id, meta);
  if (!claimed) return false;

  const creditsCharged = Number(job.credits_charged) || 0;
  let requestId = typeof claimed.upstreamRequestId === 'string' ? claimed.upstreamRequestId : '';
  let upstreamTaskId = '';
  let resultUrls: string[] = [];
  let paidRequestReturned = false;
  const attemptId = String(claimed.fastSubmitAttemptId || '');

  try {
    const submitted = await submitImageJobForProvider(upstream, provider, {
      ...params,
      clientRequestId: String(claimed.upstreamClientRequestId || job.id),
      onRequestId: async (nextRequestId) => {
        requestId = nextRequestId;
        const { error } = await admin
          .from('generation_requests')
          .update({
            meta: {
              ...claimed,
              upstreamRequestId: nextRequestId
            }
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .filter('meta->>fastSubmitState', 'eq', 'running')
          .filter('meta->>fastSubmitAttemptId', 'eq', attemptId);
        if (error) throw error;
      }
    });
    paidRequestReturned = true;
    upstreamTaskId = submitted.taskId;
    const nextMeta: Record<string, unknown> = {
      ...claimed,
      upstreamTaskId: submitted.taskId,
      ...((submitted.upstreamRequestId || requestId)
        ? { upstreamRequestId: submitted.upstreamRequestId || requestId }
        : {}),
      fastSubmitState: 'done',
      fastSubmitFinishedAt: new Date().toISOString(),
      fastSubmitError: null
    };
    resultUrls = (submitted.immediateImageUrls?.length
      ? submitted.immediateImageUrls
      : submitted.immediateImageUrl
        ? [submitted.immediateImageUrl]
        : [])
      .filter((url, index, urls): url is string => !!url && urls.indexOf(url) === index);
    if (resultUrls.length) {
      nextMeta.fastSubmitState = 'archiving';
      nextMeta.upstreamResultUrls = resultUrls;
      const { error: checkpointError } = await admin
        .from('generation_requests')
        .update({ meta: nextMeta })
        .eq('id', job.id)
        .eq('status', 'processing')
        .filter('meta->>fastSubmitState', 'eq', 'running')
        .filter('meta->>fastSubmitAttemptId', 'eq', attemptId);
      if (checkpointError) throw checkpointError;
      return !!(await recoverFastProviderResultArchive(
        admin,
        userId,
        { ...job, meta: nextMeta },
        env
      ));
    }
    const { error } = await admin
      .from('generation_requests')
      .update({ meta: nextMeta })
      .eq('id', job.id)
      .eq('status', 'processing')
      .filter('meta->>fastSubmitState', 'eq', 'running')
      .filter('meta->>fastSubmitAttemptId', 'eq', attemptId);
    if (error) throw error;
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String((e as Error).message || e || 'upstream_submit_failed');
    const outcomeUnknown =
      paidRequestReturned
      || resultUrls.length > 0
      || !(e instanceof ApiError)
      || e.code === 'UPSTREAM_OUTCOME_UNKNOWN';
    if (outcomeUnknown) {
      const recoverableCheckpoint = !!upstreamTaskId || resultUrls.length > 0;
      const recoveryMeta: Record<string, unknown> = {
        ...claimed,
        ...(upstreamTaskId ? { upstreamTaskId } : {}),
        ...(requestId ? { upstreamRequestId: requestId } : {}),
        ...(resultUrls.length ? { upstreamResultUrls: resultUrls } : {}),
        fastSubmitState: recoverableCheckpoint ? 'recovery_required' : 'outcome_unknown',
        fastSubmitError: recoverableCheckpoint ? 'result_recovery_required' : 'upstream_outcome_unknown',
        fastSubmitRecoveryReason: msg.slice(0, 400),
        ...(!recoverableCheckpoint ? { fastSubmitOutcomeUnknownAt: new Date().toISOString() } : {}),
        refunded: false
      };
      const { error: recoveryError } = await admin
        .from('generation_requests')
        .update({ meta: recoveryMeta, error_message: null })
        .eq('id', job.id)
        .eq('status', 'processing')
        .filter('meta->>fastSubmitAttemptId', 'eq', attemptId);
      if (recoveryError) {
        console.error('[fast-submit] recovery checkpoint failed', provider, job.id, recoveryError);
        return false;
      }
      console.error(
        recoverableCheckpoint ? '[fast-submit] result recovery required' : '[fast-submit] upstream outcome unknown',
        provider,
        job.id,
        msg
      );
      // A persisted image URL is a durable local-recovery checkpoint. Keep the
      // queue delivery alive until archival succeeds; never issue another POST.
      return resultUrls.length === 0;
    }
    await finalizeFailedJob(admin, userId, job, msg);
    await admin
      .from('generation_requests')
      .update({
        meta: {
          ...claimed,
          failReason: msg,
          fastSubmitState: 'failed',
          fastSubmitError: msg.slice(0, 400),
          refunded: creditsCharged > 0
        }
      })
      .eq('id', job.id);
    console.error('[fast-submit] failed', provider, job.id, msg);
  }
  return true;
}
