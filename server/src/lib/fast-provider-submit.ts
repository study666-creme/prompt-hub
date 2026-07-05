import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { finalizeFailedJob, type JobRow } from './generation-jobs';
import {
  submitImageJobForProvider,
  type ImageUpstreamBindings,
  type ImageUpstreamProvider
} from './image-upstream';
import { refundUserCredits } from './membership-credits';

export type FastSubmitParams = {
  upstreamModel: string;
  prompt: string;
  resolution: string;
  quality: string;
  size?: string;
  refImageUrls?: string[];
  mjParams?: Record<string, unknown>;
};

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
    quality: String(job.quality || 'standard'),
    size: typeof meta.size === 'string' ? meta.size : undefined,
    refImageUrls: Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[]).filter(Boolean)
      : undefined,
    ...(mjParams ? { mjParams } : {})
  };
}

async function claimFastSubmit(
  admin: SupabaseClient,
  jobId: string,
  meta: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (String(meta.fastSubmitState || '') !== 'queued') return null;
  const nextMeta = {
    ...meta,
    fastSubmitState: 'running',
    fastSubmitStartedAt: new Date().toISOString()
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', jobId)
    .eq('status', 'processing')
    .filter('meta->>fastSubmitState', 'eq', 'queued')
    .select('meta')
    .maybeSingle();
  if (error || !data?.meta) return null;
  return data.meta as Record<string, unknown>;
}

/** GrsAI / Apimart：后台提交，避免 POST /generate 同步等待触发 Cloudflare 524 */
export async function processFastProviderPendingSubmit(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  provider: Extract<ImageUpstreamProvider, 'grsai' | 'apimart'>,
  params: FastSubmitParams
): Promise<void> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const claimed = await claimFastSubmit(admin, job.id, meta);
  if (!claimed) return;

  const claimedSplit = (claimed.debitSplit as { fromDaily?: number; fromPermanent?: number } | undefined) || {};
  const debitSplit = {
    fromDaily: Number(claimedSplit.fromDaily) || 0,
    fromPermanent: Number(claimedSplit.fromPermanent) || 0
  };
  const creditsCharged = Number(job.credits_charged) || 0;

  try {
    const submitted = await submitImageJobForProvider(upstream, provider, params);
    const nextMeta: Record<string, unknown> = {
      ...claimed,
      upstreamTaskId: submitted.taskId,
      fastSubmitState: 'done',
      fastSubmitFinishedAt: new Date().toISOString(),
      fastSubmitError: null
    };
    if (submitted.immediateImageUrl) {
      nextMeta.syncImageUrl = submitted.immediateImageUrl;
    }
    await admin.from('generation_requests').update({ meta: nextMeta }).eq('id', job.id);
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String((e as Error).message || e || 'upstream_submit_failed');
    if (creditsCharged > 0) {
      await refundUserCredits(
        admin,
        userId,
        creditsCharged,
        'image_generation_refund',
        job.id,
        debitSplit,
        { reason: msg, model: String(claimed.model || '') }
      );
    }
    await finalizeFailedJob(admin, userId, job, msg);
    await admin
      .from('generation_requests')
      .update({
        meta: {
          ...claimed,
          fastSubmitState: 'failed',
          fastSubmitError: msg.slice(0, 400),
          refunded: true
        }
      })
      .eq('id', job.id);
    console.error('[fast-submit] failed', provider, job.id, msg);
  }
}
