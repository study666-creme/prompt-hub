import type { SupabaseClient } from '@supabase/supabase-js';
import {
  confirmUpstreamTaskOutcome,
  fetchUpstreamTaskOnce,
  readJobProvider,
  type ImageUpstreamBindings
} from './image-upstream';
import { ApiError } from './errors';
import { archiveRemoteImage, isStorageRef, toStorageRef } from './image-archive';
import { storageObjectExistsLight } from './media-cdn';

const GEN_IMAGE_BUCKET = 'card-images';
import { type DebitSplit, deductUserCredits, refundUserCredits } from './membership-credits';

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

  const split = (meta.debitSplit as DebitSplit | undefined) || {
    fromDaily: 0,
    fromPermanent: amount
  };

  await refundUserCredits(
    admin,
    userId,
    amount,
    'image_generation_refund',
    jobId,
    split,
    { reason: meta.failReason || 'generation_failed' }
  );

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
  errorMessage: string,
  opts?: { skipRefund?: boolean }
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

  if (!opts?.skipRefund) {
    await refundGenerationCredits(admin, userId, job.id, job.credits_charged);
  }
}

export async function pollAndUpdateJob(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  imageUrl: string | null;
  errorMessage: string | null;
  refunded: boolean;
  extraImageUrls?: string[];
}> {
  job = (await tryRecoverDebitFailedJob(admin, userId, job)) || job;
  const meta = (job.meta as Record<string, unknown>) || {};
  const taskId =
    typeof meta.upstreamTaskId === 'string'
      ? meta.upstreamTaskId
      : typeof meta.apimartTaskId === 'string'
        ? meta.apimartTaskId
        : null;
  const refundOnViolation = meta.refundOnViolation !== false;
  const provider = readJobProvider(meta);

  if (job.status === 'completed') {
    if (
      !job.result_image_url
      && taskId
      && (upstream.grsaiKey || upstream.apimartKey)
    ) {
      const recovered = await tryRecoverJobFromUpstream(
        admin,
        userId,
        job,
        upstream,
        taskId,
        provider
      );
      if (recovered) return recovered;
      const polled = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
        attempts: 4,
        intervalMs: 1500
      });
      if (polled.status === 'completed' && polled.imageUrl) {
        return completeJobFromPoll(admin, userId, job, polled);
      }
      const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id);
      if (storedArchive) {
        return finishJobFromStoredArchive(admin, userId, job, storedArchive);
      }
    }
    const archived = await ensureJobImageArchived(admin, userId, job);
    let extraImageUrls: string[] | undefined;
    if (taskId && provider === 'grsai' && upstream.grsaiKey) {
      try {
        extraImageUrls = await syncExtraImagesFromUpstream(
          admin,
          job,
          upstream,
          taskId
        );
      } catch (e) {
        console.warn('[generation] sync extras failed', job.id, e);
      }
    }
    if (!extraImageUrls?.length && Array.isArray(meta.extraImageUrls)) {
      extraImageUrls = (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u);
    }
    return {
      status: 'completed',
      imageUrl: archived,
      errorMessage: null,
      refunded: !!meta.refunded,
      extraImageUrls: extraImageUrls?.length ? extraImageUrls : undefined
    };
  }
  if (job.status === 'failed') {
    const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id);
    if (storedArchive) {
      return finishJobFromStoredArchive(admin, userId, job, storedArchive);
    }
    if (taskId && (upstream.grsaiKey || upstream.apimartKey)) {
      const recovered = await tryRecoverJobFromUpstream(
        admin,
        userId,
        job,
        upstream,
        taskId,
        provider
      );
      if (recovered) return recovered;
    }
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: job.error_message,
      refunded: !!(job.meta as Record<string, unknown>)?.refunded
    };
  }

  const createdMs = new Date(job.created_at).getTime();
  const upstreamModel = String(meta.upstreamModel || meta.model || '').toLowerCase();
  const slowUpstream =
    upstreamModel.includes('nano-banana') || upstreamModel.includes('jimeng');
  const staleMs = slowUpstream ? 40 * 60 * 1000 : 22 * 60 * 1000;

  if (!upstream.grsaiKey && !upstream.apimartKey) {
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

  const ageMs = Date.now() - createdMs;
  if (job.status === 'processing' && ageMs > 45 * 1000 && ageMs < staleMs) {
    const deep = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: 6,
      intervalMs: 2000
    });
    if (deep.status === 'completed' && deep.imageUrl) {
      return completeJobFromPoll(admin, userId, job, deep);
    }
    if (deep.status === 'failed') {
      if (deep.isViolation) {
        const msg = deep.errorMessage || 'upstream_content_violation';
        const skipRefund = refundOnViolation === false;
        await finalizeFailedJob(admin, userId, job, msg, { skipRefund });
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: msg,
          refunded: !skipRefund
        };
      }
    }
  }

  if (Date.now() - createdMs > staleMs) {
    const late = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: slowUpstream ? 8 : 5,
      intervalMs: slowUpstream ? 12000 : 8000
    });
    if (late.status === 'completed' && late.imageUrl) {
      return completeJobFromPoll(admin, userId, job, late);
    }
    const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id);
    if (storedArchive) {
      return finishJobFromStoredArchive(admin, userId, job, storedArchive);
    }
    await finalizeFailedJob(admin, userId, job, 'upstream_timeout');
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: 'upstream_timeout',
      refunded: true
    };
  }

  const polled = await fetchUpstreamTaskOnce(upstream, provider, taskId);

  if (polled.status === 'completed' && polled.imageUrl) {
    return completeJobFromPoll(admin, userId, job, polled);
  }

  if (polled.status === 'pending' && job.status === 'processing' && ageMs > 20 * 1000) {
    const deep = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: 5,
      intervalMs: 1800
    });
    if (deep.status === 'completed' && deep.imageUrl) {
      return completeJobFromPoll(admin, userId, job, deep);
    }
  }

  const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id);
  if (storedArchive) {
    return finishJobFromStoredArchive(admin, userId, job, storedArchive);
  }

  if (polled.status === 'failed') {
    if (polled.isViolation) {
      const msg = polled.errorMessage || 'upstream_content_violation';
      const skipRefund = refundOnViolation === false;
      await finalizeFailedJob(admin, userId, job, msg, { skipRefund });
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: msg,
        refunded: !skipRefund
      };
    }
    const confirmed = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: 8,
      intervalMs: 5000
    });
    if (confirmed.status === 'completed' && confirmed.imageUrl) {
      return completeJobFromPoll(admin, userId, job, confirmed);
    }
    const msg = confirmed.errorMessage || polled.errorMessage || 'upstream_failed';
    const skipRefund = confirmed.isViolation === true && refundOnViolation === false;
    await finalizeFailedJob(admin, userId, job, msg, { skipRefund });
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: msg,
      refunded: !skipRefund
    };
  }

  return { status: 'processing', imageUrl: null, errorMessage: null, refunded: false };
}

async function syncExtraImagesFromUpstream(
  admin: SupabaseClient,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  taskId: string
): Promise<string[]> {
  const meta = (job.meta as Record<string, unknown>) || {};
  const existing = Array.isArray(meta.extraImageUrls)
    ? (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u)
    : [];
  if (!upstream.grsaiKey) return existing;
  const fresh = await fetchUpstreamTaskOnce(upstream, 'grsai', taskId);
  const all = fresh.imageUrls.filter(Boolean);
  if (all.length <= 1) return existing;
  const extras = all.slice(1);
  const changed =
    extras.length !== existing.length || extras.some((u, i) => u !== existing[i]);
  if (!changed) return existing;
  await admin
    .from('generation_requests')
    .update({ meta: { ...meta, extraImageUrls: extras } })
    .eq('id', job.id);
  return extras;
}

async function completeJobFromPoll(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  polled: { imageUrl: string | null; imageUrls?: string[] }
): Promise<{
  status: 'completed';
  imageUrl: string | null;
  errorMessage: null;
  refunded: boolean;
  extraImageUrls?: string[];
}> {
  const allUrls = polled.imageUrls?.length
    ? polled.imageUrls
    : polled.imageUrl
      ? [polled.imageUrl]
      : [];
  const primary = allUrls[0] || polled.imageUrl!;
  const extras = allUrls.slice(1).filter(Boolean);
  const storedUrl = await ensureJobImageArchived(admin, userId, {
    ...job,
    status: 'completed',
    result_image_url: primary
  });
  const meta = (job.meta as Record<string, unknown>) || {};
  await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      result_image_url: storedUrl,
      error_message: null,
      completed_at: new Date().toISOString(),
      meta: {
        ...meta,
        extraImageUrls: extras.length ? extras : meta.extraImageUrls || undefined,
        recoveredFromUpstream: meta.recoveredFromUpstream || undefined
      }
    })
    .eq('id', job.id);
  return {
    status: 'completed',
    imageUrl: storedUrl,
    errorMessage: null,
    refunded: false,
    extraImageUrls: extras.length ? extras : undefined
  };
}

function isDebitRecoveryCandidate(job: JobRow): boolean {
  if (job.status !== 'failed') return false;
  const meta = (job.meta as Record<string, unknown>) || {};
  if (meta.debitSplit) return false;
  if (job.error_message === 'debit_failed') return true;
  return /积分小数|apply_credit_delta|扣费函数|SERVER_CONFIG|debit_failed/i.test(
    String(job.error_message || '')
  );
}

async function tryRecoverDebitFailedJob(
  admin: SupabaseClient,
  userId: string,
  job: JobRow
): Promise<JobRow | null> {
  if (!isDebitRecoveryCandidate(job)) return null;
  const meta = (job.meta as Record<string, unknown>) || {};
  const attempts = Number(meta.debitRecoveryAttempts) || 0;
  if (attempts >= 3) return null;
  const taskId =
    typeof meta.upstreamTaskId === 'string'
      ? meta.upstreamTaskId
      : typeof meta.apimartTaskId === 'string'
        ? meta.apimartTaskId
        : null;
  if (!taskId && job.error_message !== 'debit_failed') return null;

  try {
    const amount = Number(job.credits_charged) || 0;
    const debitedResult = await deductUserCredits(
      admin,
      userId,
      amount,
      'image_generation',
      job.id,
      { recovered: true, model: meta.model }
    );
    const nextMeta = {
      ...meta,
      debitSplit: debitedResult.split,
      debitRecovered: true,
      failReason: undefined
    };
    const { data, error } = await admin
      .from('generation_requests')
      .update({
        status: 'processing',
        error_message: null,
        completed_at: null,
        meta: nextMeta
      })
      .eq('id', job.id)
      .select('*')
      .single();
    if (error || !data) return null;
    return data as JobRow;
  } catch (e) {
    console.warn('[generation] debit_failed recovery skipped', job.id, e);
    await admin
      .from('generation_requests')
      .update({
        meta: { ...meta, debitRecoveryAttempts: attempts + 1 }
      })
      .eq('id', job.id);
    return null;
  }
}

async function tryRecoverJobFromUpstream(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  taskId: string,
  provider: ReturnType<typeof readJobProvider>
): Promise<{
  status: 'completed' | 'failed';
  imageUrl: string | null;
  errorMessage: string | null;
  refunded: boolean;
  extraImageUrls?: string[];
} | null> {
  const polled = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
    attempts: 10,
    intervalMs: 8000
  });
  if (polled.status !== 'completed' || !polled.imageUrl) {
    const stored = await tryRestoreJobImageFromStorage(admin, userId, job.id);
    if (stored) return finishJobFromStoredArchive(admin, userId, job, stored);
    return null;
  }
  const meta = (job.meta as Record<string, unknown>) || {};
  const result = await completeJobFromPoll(admin, userId, job, polled);
  await admin
    .from('generation_requests')
    .update({
      meta: { ...meta, recoveredFromUpstream: true, wasRefunded: !!meta.refunded }
    })
    .eq('id', job.id);
  return result;
}

async function tryRestoreJobImageFromStorage(
  admin: SupabaseClient,
  userId: string,
  jobId: string
): Promise<string | null> {
  const path = `${userId}/generated/${jobId}.jpg`;
  if (!(await storageObjectExistsLight(admin, path, GEN_IMAGE_BUCKET))) return null;
  return toStorageRef(path);
}

async function finishJobFromStoredArchive(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  storedRef: string
): Promise<{
  status: 'completed';
  imageUrl: string;
  errorMessage: null;
  refunded: boolean;
  extraImageUrls?: string[];
}> {
  const meta = (job.meta as Record<string, unknown>) || {};
  await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      result_image_url: storedRef,
      error_message: null,
      completed_at: job.completed_at || new Date().toISOString(),
      meta: { ...meta, archived: true, archivePending: false, restoredFromStorage: true }
    })
    .eq('id', job.id);
  return {
    status: 'completed',
    imageUrl: storedRef,
    errorMessage: null,
    refunded: false
  };
}

/** 已完成任务：远程 URL 必须归档到 Storage；已是 storage:// 则直接返回 */
async function ensureJobImageArchived(
  admin: SupabaseClient,
  userId: string,
  job: JobRow
): Promise<string | null> {
  const url = job.result_image_url;
  if (!url) return null;
  if (isStorageRef(url)) return url;

  const meta = (job.meta as Record<string, unknown>) || {};
  try {
    const stored = await archiveRemoteImage(admin, userId, job.id, url, {
      maxAttempts: 3
    });
    if (stored !== url) {
      await admin
        .from('generation_requests')
        .update({
          result_image_url: stored,
          meta: { ...meta, archived: true, archivePending: false }
        })
        .eq('id', job.id);
    }
    return stored;
  } catch (e) {
    console.warn('[generation] archive pending', job.id, e);
    const stored = await tryRestoreJobImageFromStorage(admin, userId, job.id);
    if (stored) {
      await admin
        .from('generation_requests')
        .update({
          result_image_url: stored,
          meta: { ...meta, archived: true, archivePending: false, restoredFromStorage: true }
        })
        .eq('id', job.id);
      return stored;
    }
    if (!meta.archivePending) {
      await admin
        .from('generation_requests')
        .update({
          meta: { ...meta, archivePending: true, archiveError: String(e instanceof Error ? e.message : e) }
        })
        .eq('id', job.id);
    }
    return url;
  }
}

export function assertJobOwner(job: JobRow, userId: string) {
  if (job.user_id !== userId) {
    throw new ApiError(404, 'NOT_FOUND', '任务不存在');
  }
}
