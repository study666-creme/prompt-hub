import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { finalizeFailedJob, requestedGenerationQuality, type JobRow } from './generation-jobs';
import { archiveGenerationResultUrls } from './image-archive';
import {
  submitImageJobForProvider,
  type ImageSubmitParams,
  type ImageUpstreamBindings,
  type ImageUpstreamProvider
} from './image-upstream';

export type FastSubmitParams = ImageSubmitParams;

function isAmbiguousSubmitError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function submitErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : String((error as Error)?.message || error || 'upstream_submit_failed');
}

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
    quality: requestedGenerationQuality(job),
    fixedQualityLow: meta.fixedQualityLow === true,
    size: typeof meta.size === 'string' ? meta.size : undefined,
    count: typeof meta.count === 'number' ? meta.count : undefined,
    refImageUrls: Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[]).filter(Boolean)
      : undefined,
    catalogParameters: Array.isArray(meta.newApiParameters)
      ? (meta.newApiParameters as ImageSubmitParams['catalogParameters'])
      : undefined,
    idempotencyKey: job.id,
    ...(mjParams ? { mjParams } : {})
  };
}

async function claimFastSubmit(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>,
  opts?: { reclaimRunning?: boolean; reclaimUncertain?: boolean }
): Promise<Record<string, unknown> | null> {
  const previousState = String(meta.fastSubmitState || '');
  const reclaimRunning = opts?.reclaimRunning === true && previousState === 'running';
  const reclaimUncertain = opts?.reclaimUncertain === true && previousState === 'uncertain';
  const reclaiming = reclaimRunning || reclaimUncertain;
  if (previousState !== 'queued' && !reclaiming) return null;
  const retryAt = Date.parse(String(meta.fastSubmitRetryAt || ''));
  if (previousState === 'queued' && Number.isFinite(retryAt) && retryAt > Date.now()) return null;
  const leaseId = crypto.randomUUID();
  const nextMeta = {
    ...meta,
    fastSubmitState: 'running',
    fastSubmitStartedAt: new Date().toISOString(),
    fastSubmitLeaseId: leaseId,
    fastSubmitAttempt: Math.max(0, Number(meta.fastSubmitAttempt) || 0) + 1,
    fastSubmitRetryAt: null,
    ...(reclaiming ? { fastSubmitRecoveredAt: new Date().toISOString() } : {})
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', jobId)
    .eq('status', 'processing')
    .contains('meta', {
      fastSubmitState: previousState,
      ...(reclaiming && typeof meta.fastSubmitLeaseId === 'string'
        ? { fastSubmitLeaseId: meta.fastSubmitLeaseId }
        : {})
    })
    .select('meta')
    .maybeSingle();
  if (error) {
    throw new Error(`fast_submit_claim_failed: ${String(error.message || error)}`);
  }
  if (!data?.meta) return null;
  return data.meta as Record<string, unknown>;
}

/** GrsAI / Apimart：后台提交，避免 POST /generate 同步等待触发 Cloudflare 524 */
export async function processFastProviderPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  provider: Extract<ImageUpstreamProvider, 'grsai' | 'apimart' | 'newapi'>,
  params: FastSubmitParams,
  env?: Env,
  opts?: { reclaimRunning?: boolean; reclaimUncertain?: boolean }
): Promise<boolean> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const claimed = await claimFastSubmit(admin, job.id, meta, {
    reclaimRunning: opts?.reclaimRunning === true,
    reclaimUncertain: opts?.reclaimUncertain === true
  });
  if (!claimed) return false;

  const creditsCharged = Number(job.credits_charged) || 0;

  try {
    const submitted = await submitImageJobForProvider(upstream, provider, params);
    const nextMeta: Record<string, unknown> = {
      ...claimed,
      upstreamTaskId: submitted.taskId,
      ...(submitted.upstreamRequestId ? { upstreamRequestId: submitted.upstreamRequestId } : {}),
      fastSubmitState: 'done',
      fastSubmitFinishedAt: new Date().toISOString(),
      fastSubmitError: null,
      fastSubmitUncertain: false,
      fastSubmitRetryAt: null
    };
    const immediateUrls = (submitted.immediateImageUrls?.length
      ? submitted.immediateImageUrls
      : submitted.immediateImageUrl
        ? [submitted.immediateImageUrl]
        : [])
      .filter((url, index, urls): url is string => !!url && urls.indexOf(url) === index);
    if (immediateUrls.length) {
      let archived: string[];
      try {
        archived = await archiveGenerationResultUrls(
          admin,
          userId,
          job.id,
          immediateUrls,
          env
        );
      } catch (archiveError) {
        const archiveMessage = submitErrorMessage(archiveError);
        const { error } = await admin
          .from('generation_requests')
          .update({
            meta: {
              ...nextMeta,
              syncImageUrl: immediateUrls[0],
              ...(immediateUrls.length > 1 ? { mookoSubmitImageUrls: immediateUrls } : {}),
              archivePending: true,
              archiveError: archiveMessage.slice(0, 400)
            }
          })
          .eq('id', job.id)
          .eq('status', 'processing');
        if (error) throw new Error(`fast_submit_archive_state_failed: ${String(error.message || error)}`);
        // Submission has already been accepted. Never queue another paid POST
        // just because durable result storage is temporarily unavailable.
        console.warn('[fast-submit] accepted; archive pending', provider, job.id, archiveMessage.slice(0, 200));
        return true;
      }
      if (!archived[0]) throw new Error('upstream_image_archive_failed');
      nextMeta.syncImageUrl = archived[0];
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
        .eq('id', job.id);
      if (error) throw error;
      return true;
    }
    const { error } = await admin.from('generation_requests').update({ meta: nextMeta }).eq('id', job.id);
    if (error) throw error;
  } catch (e) {
    const msg = submitErrorMessage(e);
    if (isAmbiguousSubmitError(e)) {
      const uncertainMeta = {
        ...claimed,
        fastSubmitState: 'uncertain',
        fastSubmitUncertain: true,
        fastSubmitError: msg.slice(0, 400),
        fastSubmitRetryAt: null
      };
      const { error } = await admin
        .from('generation_requests')
        .update({ meta: uncertainMeta })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (error) throw new Error(`fast_submit_uncertain_state_failed: ${String(error.message || error)}`);
      console.warn('[fast-submit] result uncertain; automatic resubmission blocked', provider, job.id, {
        attempt: Number(claimed.fastSubmitAttempt) || 1,
        error: msg.slice(0, 200)
      });
      return true;
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
