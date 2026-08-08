import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { ApiError } from './errors';
import { deductUserCredits, refundUserCredits, type DebitSplit } from './membership-credits';
import { newApiKeyForRoute } from './newapi';
import {
  submitNewApiVideo,
  type NewApiVideoSubmitParams,
  type NewApiVideoTask
} from './newapi-video';

export type VideoSubmissionJob = {
  id: string;
  user_id: string;
  credits_charged: number;
  status: string;
  prompt?: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type VideoSubmitResult = 'processed' | 'retry' | 'ignored';

type SubmitOptions = {
  now?: () => Date;
  attemptId?: () => string;
  checkpointDelay?: (attempt: number) => Promise<void>;
  submit?: (
    apiKey: string,
    baseUrl: string | undefined,
    params: NewApiVideoSubmitParams
  ) => Promise<NewApiVideoTask>;
};

const VIDEO_TASK_CHECKPOINT_ATTEMPTS = 3;

function defaultCheckpointDelay(attempt: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
}

export function videoMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(item => String(item || '').trim()).filter(Boolean);
  return result.length ? result : undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = String(value || '').trim();
  if (!result) throw new Error(`video submission envelope is missing ${field}`);
  return result;
}

function positiveInteger(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`video submission envelope has invalid ${field}`);
  }
  return result;
}

export function videoSubmitParamsFromJob(job: VideoSubmissionJob): NewApiVideoSubmitParams {
  const meta = videoMeta(job.meta);
  const envelope = videoMeta(meta.videoSubmitEnvelope);
  return {
    idempotencyKey: requiredString(envelope.idempotencyKey, 'idempotencyKey'),
    upstreamModel: requiredString(envelope.upstreamModel, 'upstreamModel'),
    prompt: requiredString(envelope.prompt ?? job.prompt, 'prompt'),
    duration: positiveInteger(envelope.duration, 'duration'),
    ratio: requiredString(envelope.ratio, 'ratio'),
    resolution: requiredString(envelope.resolution, 'resolution'),
    size: String(envelope.size || '').trim() || undefined,
    generateAudio: typeof envelope.generateAudio === 'boolean' ? envelope.generateAudio : undefined,
    referenceImages: strings(envelope.referenceImages),
    firstImage: String(envelope.firstImage || '').trim() || undefined,
    lastImage: String(envelope.lastImage || '').trim() || undefined,
    referenceVideos: strings(envelope.referenceVideos),
    referenceAudios: strings(envelope.referenceAudios)
  };
}

export function isDefinitiveVideoSubmitError(error: unknown): boolean {
  return error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && ![408, 425, 429].includes(error.status);
}

function debitSplit(meta: Record<string, unknown>, amount: number): DebitSplit {
  const value = videoMeta(meta.debitSplit);
  const fromDaily = Math.min(amount, Math.max(0, Number(value.fromDaily) || 0));
  return {
    fromDaily,
    fromPermanent: Math.min(amount - fromDaily, Math.max(0, Number(value.fromPermanent) || 0))
  };
}

function videoEnvelopeKey(meta: Record<string, unknown>): string {
  return String(videoMeta(meta.videoSubmitEnvelope).idempotencyKey || '').trim();
}

async function failAwaitingVideoSubmit(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  message: string,
  now: Date
): Promise<void> {
  const meta = videoMeta(job.meta);
  const { error } = await admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: message.slice(0, 300),
      completed_at: now.toISOString(),
      meta: {
        ...meta,
        videoSubmitState: 'failed',
        videoSubmitError: message.slice(0, 400),
        refundState: 'not_required'
      }
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'awaiting_debit');
  if (error) throw error;
}

export async function prepareAwaitingVideoSubmit(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  now = new Date()
): Promise<VideoSubmissionJob | null> {
  const meta = videoMeta(job.meta);
  if (
    job.status !== 'processing'
    || meta.mediaType !== 'video'
    || String(meta.videoSubmitState || '') !== 'awaiting_debit'
  ) {
    return null;
  }

  try {
    videoSubmitParamsFromJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'video submission envelope is invalid';
    await failAwaitingVideoSubmit(admin, job, message, now);
    return null;
  }

  const amount = Math.max(0, Number(meta.credits) || Number(job.credits_charged) || 0);
  if (amount <= 0) {
    await failAwaitingVideoSubmit(admin, job, 'video credits are invalid', now);
    return null;
  }

  let debit;
  try {
    debit = await deductUserCredits(admin, job.user_id, amount, 'video_generation', job.id, {
      product: meta.product,
      projectId: meta.projectId,
      nodeId: meta.nodeId,
      idempotencyKey: meta.clientRequestId,
      model: meta.model,
      duration: meta.duration,
      resolution: meta.resolution
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'video debit failed');
    if (/insufficient|amount_invalid/i.test(message)) {
      await failAwaitingVideoSubmit(admin, job, message, now);
      return null;
    }
    // A wallet timeout may have committed. Leave the row awaiting_debit so the
    // same ledger ref can be replayed safely by the next queue/cron attempt.
    throw error;
  }

  const queuedMeta = {
    ...meta,
    debitSplit: debit.split,
    videoSubmitState: 'queued',
    videoSubmitQueuedAt: now.toISOString(),
    videoSubmitError: null
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta: queuedMeta })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'awaiting_debit')
    .select('*')
    .maybeSingle();
  if (data) return data as VideoSubmissionJob;

  const { data: persisted, error: verifyError } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (!persisted) return null;
  const persistedJob = persisted as VideoSubmissionJob;
  const persistedMeta = videoMeta(persistedJob.meta);
  const persistedState = String(persistedMeta.videoSubmitState || '');
  if (
    persistedJob.status === 'processing'
    && persistedState === 'queued'
    && videoEnvelopeKey(persistedMeta) === videoEnvelopeKey(meta)
  ) {
    return persistedJob;
  }
  if (persistedState !== 'awaiting_debit') return null;
  throw error || new Error('video queue state was not persisted');
}

async function claimVideoSubmit(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  now: Date,
  attemptId: string
): Promise<VideoSubmissionJob | null> {
  const meta = videoMeta(job.meta);
  if (String(meta.videoSubmitState || '') !== 'queued') return null;
  const nextMeta = {
    ...meta,
    videoSubmitState: 'running',
    videoSubmitAttemptId: attemptId,
    videoSubmitStartedAt: now.toISOString(),
    videoSubmitAttempts: 1,
    videoSubmitError: null
  };
  const query = admin
    .from('generation_requests')
    .update({ meta: nextMeta })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'queued')
    .select('*');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) return data as VideoSubmissionJob;

  // Some PostgREST-compatible services apply the update but omit its returned
  // representation. Verify ownership before issuing the irreversible POST.
  const { data: persisted, error: verifyError } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'running')
    .filter('meta->>videoSubmitAttemptId', 'eq', attemptId)
    .maybeSingle();
  if (verifyError || !persisted) return null;
  return persisted as VideoSubmissionJob;
}

export async function settleVideoRefund(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  phase = 'submit_error'
): Promise<boolean> {
  const meta = videoMeta(job.meta);
  if (job.status !== 'failed' || meta.refundState !== 'pending') return false;
  const amount = Math.max(0, Number(meta.credits) || Number(job.credits_charged) || 0);
  if (amount > 0) {
    await refundUserCredits(
      admin,
      job.user_id,
      amount,
      'video_generation_refund',
      job.id,
      debitSplit(meta, amount),
      { model: meta.model, phase }
    );
  }
  const { error } = await admin
    .from('generation_requests')
    .update({
      meta: {
        ...meta,
        videoSubmitState: 'failed',
        refundState: 'refunded',
        videoRefundSettledAt: new Date().toISOString()
      }
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'failed')
    .filter('meta->>refundState', 'eq', 'pending');
  if (error) throw error;
  return true;
}

async function failClaimedVideoSubmit(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  message: string,
  now: Date
): Promise<void> {
  const meta = videoMeta(job.meta);
  const attemptId = String(meta.videoSubmitAttemptId || '');
  const pendingMeta = {
    ...meta,
    videoSubmitState: 'refund_pending',
    videoSubmitFinishedAt: now.toISOString(),
    videoSubmitError: message.slice(0, 400),
    refundState: 'pending'
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: message.slice(0, 300),
      completed_at: now.toISOString(),
      meta: pendingMeta
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'running')
    .filter('meta->>videoSubmitAttemptId', 'eq', attemptId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) await settleVideoRefund(admin, data as VideoSubmissionJob);
}

async function saveUnknownOutcome(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  message: string,
  now: Date
): Promise<void> {
  const meta = videoMeta(job.meta);
  const { error } = await admin
    .from('generation_requests')
    .update({
      meta: {
        ...meta,
        videoSubmitState: 'outcome_unknown',
        videoSubmitOutcomeUnknownAt: now.toISOString(),
        videoSubmitError: message.slice(0, 400)
      }
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>videoSubmitState', 'eq', 'running')
    .filter('meta->>videoSubmitAttemptId', 'eq', String(meta.videoSubmitAttemptId || ''));
  if (error) throw error;
}

function isPersistedVideoTask(
  row: VideoSubmissionJob | null,
  taskId: string
): boolean {
  if (!row) return false;
  const meta = videoMeta(row.meta);
  return String(meta.videoSubmitState || '') === 'submitted'
    && String(meta.upstreamTaskId || '') === taskId;
}

async function checkpointSubmittedVideoTask(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  attemptId: string,
  taskId: string,
  update: Record<string, unknown>,
  delay: (attempt: number) => Promise<void>
): Promise<VideoSubmissionJob> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < VIDEO_TASK_CHECKPOINT_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin
      .from('generation_requests')
      .update(update)
      .eq('id', job.id)
      .eq('user_id', job.user_id)
      .eq('status', 'processing')
      .filter('meta->>videoSubmitState', 'eq', 'running')
      .filter('meta->>videoSubmitAttemptId', 'eq', attemptId)
      .select('*')
      .maybeSingle();
    if (isPersistedVideoTask(data as VideoSubmissionJob | null, taskId)) return data as VideoSubmissionJob;
    if (error) lastError = error;

    const { data: persisted, error: verifyError } = await admin
      .from('generation_requests')
      .select('*')
      .eq('id', job.id)
      .eq('user_id', job.user_id)
      .maybeSingle();
    if (isPersistedVideoTask(persisted as VideoSubmissionJob | null, taskId)) {
      return persisted as VideoSubmissionJob;
    }
    if (verifyError) lastError = verifyError;
    if (persisted) {
      const persistedMeta = videoMeta((persisted as VideoSubmissionJob).meta);
      const stillOwned = (persisted as VideoSubmissionJob).status === 'processing'
        && String(persistedMeta.videoSubmitState || '') === 'running'
        && String(persistedMeta.videoSubmitAttemptId || '') === attemptId;
      if (!stillOwned) {
        throw new Error(`video task checkpoint lost ownership for ${taskId}`);
      }
    }
    if (attempt + 1 < VIDEO_TASK_CHECKPOINT_ATTEMPTS) await delay(attempt);
  }
  throw lastError || new Error(`video task checkpoint was not confirmed for ${taskId}`);
}

export async function processVideoPendingSubmit(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  env: Env,
  options: SubmitOptions = {}
): Promise<VideoSubmitResult> {
  const initialMeta = videoMeta(job.meta);
  if (job.status === 'failed' && initialMeta.refundState === 'pending') {
    await settleVideoRefund(admin, job, String(initialMeta.refundPhase || 'submit_error'));
    return 'processed';
  }
  if (job.status !== 'processing' || initialMeta.mediaType !== 'video') return 'ignored';
  const initialState = String(initialMeta.videoSubmitState || '');
  if (initialState !== 'awaiting_debit' && initialState !== 'queued') return 'ignored';

  const apiKey = env.NEWAPI_VIDEO_API_KEY?.trim();
  if (!apiKey) return 'retry';
  const now = options.now?.() ?? new Date();
  const pending = initialState === 'awaiting_debit'
    ? await prepareAwaitingVideoSubmit(admin, job, now)
    : job;
  if (!pending) return 'processed';
  if (String(videoMeta(pending.meta).videoSubmitState || '') !== 'queued') return 'ignored';
  const attemptId = options.attemptId?.() ?? crypto.randomUUID();
  const claimed = await claimVideoSubmit(admin, pending, now, attemptId);
  if (!claimed) return 'ignored';
  const submit = options.submit ?? submitNewApiVideo;
  const claimedMeta = videoMeta(claimed.meta);
  const routeChannelId = Number(claimedMeta.routeChannelId) || 0;

  let task: NewApiVideoTask;
  try {
    console.info('[video-submit] upstream submission phase', {
      jobId: claimed.id,
      clientRequestId: String(claimedMeta.clientRequestId || videoEnvelopeKey(claimedMeta)),
      model: String(claimedMeta.model || ''),
      phase: 'newapi_submit'
    });
    task = await submit(
      newApiKeyForRoute(apiKey, routeChannelId ? { channelId: routeChannelId } : null),
      env.NEWAPI_API_BASE_URL,
      videoSubmitParamsFromJob(claimed)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'video submit failed');
    console.error('[video-submit] upstream submission failed', {
      jobId: claimed.id,
      clientRequestId: String(claimedMeta.clientRequestId || videoEnvelopeKey(claimedMeta)),
      model: String(claimedMeta.model || ''),
      phase: 'newapi_submit',
      errorCode: error instanceof ApiError ? error.code : error instanceof Error ? error.name : 'UPSTREAM_SUBMIT_FAILED'
    });
    if (isDefinitiveVideoSubmitError(error)) {
      await failClaimedVideoSubmit(admin, claimed, message, now);
      return 'processed';
    }
    await saveUnknownOutcome(admin, claimed, message, now);
    // The paid result is ambiguous. Acknowledge this delivery and let the SLA
    // refund path finish it; no queue replay may issue another generation POST.
    return 'processed';
  }

  if (task.status === 'failed') {
    await failClaimedVideoSubmit(
      admin,
      claimed,
      task.errorMessage || 'Video generation failed',
      now
    );
    return 'processed';
  }

  console.info('[video-submit] upstream submission phase', {
    jobId: claimed.id,
    clientRequestId: String(claimedMeta.clientRequestId || videoEnvelopeKey(claimedMeta)),
    model: String(claimedMeta.model || ''),
    phase: 'accepted',
    upstreamTaskId: task.id,
    status: task.status
  });

  const resultUncertain = task.status === 'unknown';
  const nextMeta = {
    ...claimedMeta,
    upstreamTaskId: task.id,
    progress: task.progress ?? 0,
    resultUrl: task.videoUrl,
    videoSubmitState: 'submitted',
    videoSubmitFinishedAt: now.toISOString(),
    videoSubmitError: null,
    ...(resultUncertain
      ? {
          videoResultState: 'result_uncertain',
          videoResultErrorCode: task.errorCode || 'result_uncertain',
          videoResultUncertainAt: now.toISOString()
        }
      : {})
  };
  let submittedJob: VideoSubmissionJob;
  try {
    submittedJob = await checkpointSubmittedVideoTask(
      admin,
      claimed,
      attemptId,
      task.id,
      {
        status: 'processing',
        meta: nextMeta
      },
      options.checkpointDelay ?? defaultCheckpointDelay
    );
  } catch (error) {
    console.error('[video-submit] task checkpoint failed', claimed.id, task.id, error);
    // The paid POST already returned a task id. Surface the persistence fault
    // so it is retried/alerted, while the durable running fence prevents both
    // another POST and the unknown-submit refund SLA from taking ownership.
    throw error;
  }
  if (task.status === 'completed') {
    try {
      const { pollVideoProviderJob } = await import('./video-provider-poll');
      await pollVideoProviderJob(admin, submittedJob, env, {
        fetchTask: async () => task,
        now: () => now
      });
    } catch (error) {
      // The durable task id is already checkpointed. Background polling can
      // safely resume completion without ever replaying the generation POST.
      console.error('[video-submit] immediate completion finalize deferred', claimed.id, task.id, error);
    }
  }
  return 'processed';
}
