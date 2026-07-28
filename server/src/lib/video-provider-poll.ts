import type { SupabaseClient } from '@supabase/supabase-js';

import type { Env } from '../env';
import { ApiError } from './errors';
import { newApiKeyForRoute } from './newapi';
import { fetchNewApiVideoTask, type NewApiVideoTask } from './newapi-video';
import {
  markVideoTaskNotFound,
  settleVideoBillingAdjustment
} from './video-provider-outcome';
import {
  settleVideoRefund,
  type VideoSubmissionJob,
  videoMeta
} from './video-provider-submit';
import { createAdminClient } from './supabase';

const VIDEO_POLL_INTERVAL_MS = 60_000;

type VideoTaskFetcher = typeof fetchNewApiVideoTask;
type PollOptions = {
  fetchTask?: VideoTaskFetcher;
  now?: () => Date;
};

export type VideoProviderPollResult =
  | 'ignored'
  | 'processing'
  | 'unknown'
  | 'completed'
  | 'failed'
  | 'not_found';

function boundedWorkLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(value ?? fallback)));
}

function parsedTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizedProgress(value: unknown): number {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
}

function safeErrorCode(value: unknown): string {
  const code = String(value || '').trim();
  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(code) ? code : 'result_uncertain';
}

function clearResultUncertainty(meta: Record<string, unknown>): Record<string, unknown> {
  const next = { ...meta };
  delete next.videoResultState;
  delete next.videoResultErrorCode;
  delete next.videoResultUncertainAt;
  delete next.videoSubmitOutcomeUnknownAt;
  if (next.videoSubmitError === 'upstream_task_not_found') delete next.videoSubmitError;
  return next;
}

function pollTiming(meta: Record<string, unknown>, now: Date) {
  return {
    videoLastPolledAt: now.toISOString(),
    videoNextPollAt: new Date(now.getTime() + VIDEO_POLL_INTERVAL_MS).toISOString()
  };
}

async function updateProcessingMeta(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  upstreamTaskId: string,
  meta: Record<string, unknown>
): Promise<VideoSubmissionJob | null> {
  const { data, error } = await admin
    .from('generation_requests')
    .update({ meta })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>upstreamTaskId', 'eq', upstreamTaskId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as VideoSubmissionJob | null;
}

async function completeVideoJob(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  task: NewApiVideoTask,
  now: Date
): Promise<VideoProviderPollResult> {
  const meta = videoMeta(job.meta);
  const nextMeta = {
    ...clearResultUncertainty(meta),
    ...pollTiming(meta, now),
    progress: 100,
    resultUrl: task.videoUrl,
    videoSubmitState: 'completed',
    ...(task.billedDurationSeconds == null ? {} : { actualDurationSeconds: task.billedDurationSeconds }),
    billingReconciliationState: task.billedDurationSeconds == null ? 'unverified' : 'pending'
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      completed_at: now.toISOString(),
      error_message: null,
      meta: nextMeta
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>upstreamTaskId', 'eq', String(meta.upstreamTaskId || ''))
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data && nextMeta.billingReconciliationState === 'pending') {
    await settleVideoBillingAdjustment(admin, data as VideoSubmissionJob);
  }
  return data ? 'completed' : 'ignored';
}

async function failVideoJob(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  task: NewApiVideoTask,
  now: Date
): Promise<VideoProviderPollResult> {
  const meta = videoMeta(job.meta);
  const nextMeta = {
    ...clearResultUncertainty(meta),
    ...pollTiming(meta, now),
    progress: task.progress ?? 0,
    videoSubmitState: 'refund_pending',
    refundState: 'pending',
    refundPhase: 'upstream_failed'
  };
  const { data, error } = await admin
    .from('generation_requests')
    .update({
      status: 'failed',
      error_message: (task.errorMessage || 'video_generation_failed').slice(0, 300),
      completed_at: now.toISOString(),
      meta: nextMeta
    })
    .eq('id', job.id)
    .eq('user_id', job.user_id)
    .eq('status', 'processing')
    .filter('meta->>upstreamTaskId', 'eq', String(meta.upstreamTaskId || ''))
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) await settleVideoRefund(admin, data as VideoSubmissionJob, 'upstream_failed');
  return data ? 'failed' : 'ignored';
}

export async function pollVideoProviderJob(
  admin: SupabaseClient,
  job: VideoSubmissionJob,
  env: Env,
  options: PollOptions = {}
): Promise<VideoProviderPollResult> {
  const meta = videoMeta(job.meta);
  const upstreamTaskId = String(meta.upstreamTaskId || '').trim();
  if (job.status !== 'processing' || meta.mediaType !== 'video' || !upstreamTaskId) return 'ignored';
  const apiKey = env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new Error('NEWAPI_API_KEY is not configured');
  const routeChannelId = Number(meta.routeChannelId) || 0;
  const now = options.now?.() ?? new Date();
  let task: NewApiVideoTask;
  try {
    task = await (options.fetchTask ?? fetchNewApiVideoTask)(
      newApiKeyForRoute(apiKey, routeChannelId ? { channelId: routeChannelId } : null),
      env.NEWAPI_API_BASE_URL,
      upstreamTaskId
    );
  } catch (error) {
    if (error instanceof ApiError && [404, 410].includes(error.status)) {
      await markVideoTaskNotFound(admin, job, now.getTime());
      return 'not_found';
    }
    throw error;
  }

  if (task.status === 'completed') return completeVideoJob(admin, job, task, now);
  if (task.status === 'failed') return failVideoJob(admin, job, task, now);
  if (task.status === 'unknown') {
    const firstUncertainAt = parsedTimestamp(meta.videoResultUncertainAt) === null
      ? now.toISOString()
      : String(meta.videoResultUncertainAt);
    const nextMeta = {
      ...meta,
      ...pollTiming(meta, now),
      progress: task.progress ?? normalizedProgress(meta.progress),
      videoSubmitState: 'submitted',
      videoResultState: 'result_uncertain',
      videoResultErrorCode: safeErrorCode(task.errorCode),
      videoResultUncertainAt: firstUncertainAt
    };
    const updated = await updateProcessingMeta(admin, job, upstreamTaskId, nextMeta);
    return updated ? 'unknown' : 'ignored';
  }

  const nextMeta = {
    ...clearResultUncertainty(meta),
    ...pollTiming(meta, now),
    progress: task.progress ?? normalizedProgress(meta.progress),
    videoSubmitState: 'submitted'
  };
  const updated = await updateProcessingMeta(admin, job, upstreamTaskId, nextMeta);
  return updated ? 'processing' : 'ignored';
}

export async function drainPendingVideoTasks(
  env: Env,
  options: { maxPoll?: number; now?: number; fetchTask?: VideoTaskFetcher } = {}
): Promise<{ polled: number; completed: number; failed: number; unknown: number }> {
  const maxPoll = boundedWorkLimit(options.maxPoll, 4, 12);
  const now = options.now ?? Date.now();
  const since = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'processing')
    .filter('meta->>mediaType', 'eq', 'video')
    .not('meta->>upstreamTaskId', 'is', null)
    .gte('created_at', since)
    .order('meta->>videoNextPollAt', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(maxPoll * 8);
  if (error) {
    console.error('[video-poll] task list failed', error.message);
    return { polled: 0, completed: 0, failed: 0, unknown: 0 };
  }

  const jobs = ((data || []) as VideoSubmissionJob[])
    .filter(job => {
      const nextPollAt = parsedTimestamp(videoMeta(job.meta).videoNextPollAt);
      return nextPollAt === null || nextPollAt <= now;
    })
    .sort((left, right) => {
      const leftPolled = parsedTimestamp(videoMeta(left.meta).videoLastPolledAt) ?? 0;
      const rightPolled = parsedTimestamp(videoMeta(right.meta).videoLastPolledAt) ?? 0;
      return leftPolled - rightPolled || Date.parse(left.created_at) - Date.parse(right.created_at);
    })
    .slice(0, maxPoll);

  const settled = await Promise.allSettled(
    jobs.map(job => pollVideoProviderJob(admin, job, env, {
      now: () => new Date(now),
      ...(options.fetchTask ? { fetchTask: options.fetchTask } : {})
    }))
  );
  let completed = 0;
  let failed = 0;
  let unknown = 0;
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error('[video-poll] task failed', jobs[index]?.id, result.reason);
      return;
    }
    if (result.value === 'completed') completed += 1;
    if (result.value === 'failed') failed += 1;
    if (result.value === 'unknown' || result.value === 'not_found') unknown += 1;
  });
  if (jobs.length) console.log('[video-poll] tick', { polled: jobs.length, completed, failed, unknown });
  return { polled: jobs.length, completed, failed, unknown };
}
