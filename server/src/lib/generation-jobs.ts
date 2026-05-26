import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchApimartTaskOnce } from './apimart';
import { ApiError } from './errors';

type JobRow = {
  id: string;
  user_id: string;
  credits_charged: number;
  status: string;
  result_image_url: string | null;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export async function refundGenerationCredits(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  amount: number
): Promise<void> {
  if (amount <= 0) return;
  const { data: job } = await admin
    .from('generation_requests')
    .select('meta')
    .eq('id', jobId)
    .maybeSingle();
  const meta = (job?.meta as Record<string, unknown>) || {};
  if (meta.refunded) return;

  const { error } = await admin.rpc('apply_credit_delta', {
    p_user_id: userId,
    p_delta: amount,
    p_reason: 'image_generation_refund',
    p_ref_id: jobId,
    p_meta: { reason: meta.failReason || 'generation_failed' }
  });
  if (error) throw error;

  await admin
    .from('generation_requests')
    .update({
      meta: { ...meta, refunded: true }
    })
    .eq('id', jobId);
}

export async function finalizeFailedJob(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  errorMessage: string
): Promise<void> {
  await admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      meta: { ...(job.meta || {}), failReason: errorMessage }
    })
    .eq('id', job.id);

  await refundGenerationCredits(admin, userId, job.id, job.credits_charged);
}

export async function pollAndUpdateJob(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  imageApiKey: string,
  imageApiBaseUrl: string | undefined
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  imageUrl: string | null;
  errorMessage: string | null;
  refunded: boolean;
}> {
  if (job.status === 'completed') {
    return {
      status: 'completed',
      imageUrl: job.result_image_url,
      errorMessage: null,
      refunded: !!(job.meta as Record<string, unknown>)?.refunded
    };
  }
  if (job.status === 'failed') {
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: job.error_message,
      refunded: !!(job.meta as Record<string, unknown>)?.refunded
    };
  }

  const meta = (job.meta as Record<string, unknown>) || {};
  const taskId = typeof meta.apimartTaskId === 'string' ? meta.apimartTaskId : null;
  const createdMs = new Date(job.created_at).getTime();
  const staleMs = 12 * 60 * 1000;

  if (!imageApiKey) {
    await admin
      .from('generation_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    return { status: 'completed', imageUrl: null, errorMessage: null, refunded: false };
  }

  if (!taskId) {
    await finalizeFailedJob(admin, userId, job, 'missing_task_id');
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: 'missing_task_id',
      refunded: true
    };
  }

  if (Date.now() - createdMs > staleMs) {
    await finalizeFailedJob(admin, userId, job, 'upstream_timeout');
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: 'upstream_timeout',
      refunded: true
    };
  }

  const polled = await fetchApimartTaskOnce(imageApiKey, imageApiBaseUrl, taskId);

  if (polled.status === 'completed' && polled.imageUrl) {
    await admin
      .from('generation_requests')
      .update({
        status: 'completed',
        result_image_url: polled.imageUrl,
        error_message: null,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    return {
      status: 'completed',
      imageUrl: polled.imageUrl,
      errorMessage: null,
      refunded: false
    };
  }

  if (polled.status === 'failed') {
    const msg = polled.errorMessage || 'upstream_failed';
    await finalizeFailedJob(admin, userId, job, msg);
    return { status: 'failed', imageUrl: null, errorMessage: msg, refunded: true };
  }

  return { status: 'processing', imageUrl: null, errorMessage: null, refunded: false };
}

export function assertJobOwner(job: JobRow, userId: string) {
  if (job.user_id !== userId) {
    throw new ApiError(404, 'NOT_FOUND', '任务不存在');
  }
}
