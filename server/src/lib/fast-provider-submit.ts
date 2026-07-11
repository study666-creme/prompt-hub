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
    quality: String(job.quality || 'standard'),
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
  provider: Extract<ImageUpstreamProvider, 'grsai' | 'apimart' | 'newapi'>,
  params: FastSubmitParams,
  env?: Env
): Promise<boolean> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const claimed = await claimFastSubmit(admin, job.id, meta);
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
      fastSubmitError: null
    };
    const immediateUrls = (submitted.immediateImageUrls?.length
      ? submitted.immediateImageUrls
      : submitted.immediateImageUrl
        ? [submitted.immediateImageUrl]
        : [])
      .filter((url, index, urls): url is string => !!url && urls.indexOf(url) === index);
    if (immediateUrls.length) {
      const archived = await archiveGenerationResultUrls(
        admin,
        userId,
        job.id,
        immediateUrls,
        env
      );
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
    const msg = e instanceof ApiError ? e.message : String((e as Error).message || e || 'upstream_submit_failed');
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
