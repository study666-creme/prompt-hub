import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { finalizeFailedJob, pollAndUpdateJob, type JobRow } from './generation-jobs';
import { upstreamBindingsFromEnv, type ImageUpstreamBindings } from './image-upstream';
import { processMookoPendingSubmit } from './mooko-submit';
import { createAdminClient } from './supabase';

/** 木瓜同步 POST 常需 400s+；90s 误判会导致木瓜已扣费、站内却退款 */
const STUCK_RUNNING_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 8;

type DrainContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function readMookoMeta(meta: Record<string, unknown>) {
  return {
    submitState: String(meta.mookoSubmitState || ''),
    taskId: typeof meta.upstreamTaskId === 'string' ? meta.upstreamTaskId : '',
    syncUrl: typeof meta.syncImageUrl === 'string' ? meta.syncImageUrl : '',
    startedAt: Date.parse(String(meta.mookoSubmitStartedAt || '')),
    upstreamModel: String(meta.upstreamModel || 'gpt-image-2-pro'),
    size: typeof meta.size === 'string' ? meta.size : undefined,
    refImageUrls: Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[]).filter(Boolean)
      : undefined
  };
}

export function maxConcurrentMookoSubmits(env: Env): number {
  const raw = env.MOOKO_MAX_CONCURRENT_SUBMITS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_MAX_CONCURRENT;
  if (!Number.isFinite(n)) return DEFAULT_MAX_CONCURRENT;
  return Math.min(Math.max(n, 1), 16);
}

export function countRunningMookoSubmits(jobs: JobRow[]): number {
  return jobs.filter((j) => {
    const meta = (j.meta as Record<string, unknown>) || {};
    return meta.provider === 'mooko' && readMookoMeta(meta).submitState === 'running';
  }).length;
}

export function pickQueuedMookoJobs(jobs: JobRow[], limit: number): JobRow[] {
  if (limit <= 0) return [];
  return jobs
    .filter((j) => {
      const meta = (j.meta as Record<string, unknown>) || {};
      return meta.provider === 'mooko' && readMookoMeta(meta).submitState === 'queued';
    })
    .slice(0, limit);
}

async function failStuckMookoJobs(
  admin: SupabaseClient,
  rows: JobRow[]
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'processing') continue;
    const meta = (row.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') continue;
    const m = readMookoMeta(meta);
    if (m.submitState !== 'running') continue;
    if (m.taskId || m.syncUrl) continue;
    const runningMs = Number.isFinite(m.startedAt) ? Date.now() - m.startedAt : 0;
    if (runningMs < STUCK_RUNNING_MS) continue;
    await finalizeFailedJob(admin, row.user_id, row, 'upstream_submit_stale');
    n += 1;
    console.warn('[mooko-drain] stuck running without taskId, refunded', row.id, runningMs);
  }
  return n;
}

async function settleMookoDoneJobs(
  admin: SupabaseClient,
  userId: string,
  row: JobRow,
  upstream: ImageUpstreamBindings,
  env: Env
): Promise<void> {
  const meta = (row.meta as Record<string, unknown>) || {};
  if (String(meta.mookoSubmitState) !== 'done') return;
  if (row.result_image_url) return;
  await pollAndUpdateJob(admin, userId, row, upstream, env, { quick: false });
}

/** Cron/Queue 专用：木瓜同步 POST 可达 8 分钟，允许多任务并发（单任务仍防重复提交） */
export async function drainMookoPendingSubmits(
  env: Env,
  ctx?: DrainContext
): Promise<{
  submitted: number;
  failedStuck: number;
  settled: number;
  running: number;
  queued: number;
}> {
  const upstream = upstreamBindingsFromEnv(env);
  if (!upstream.mookoKey) {
    return { submitted: 0, failedStuck: 0, settled: 0, running: 0, queued: 0 };
  }

  const admin = createAdminClient(env);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'processing')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(80);
  if (error) {
    console.error('[mooko-drain] list failed', error.message);
    return { submitted: 0, failedStuck: 0, settled: 0, running: 0, queued: 0 };
  }

  const jobs = (rows || []) as JobRow[];
  const mookoJobs = jobs.filter((j) => {
    const meta = (j.meta as Record<string, unknown>) || {};
    return meta.provider === 'mooko';
  });

  let submitted = 0;
  let settled = 0;

  const doneNeedSettle = mookoJobs.filter((j) => {
    const m = readMookoMeta((j.meta as Record<string, unknown>) || {});
    return m.submitState === 'done' && !j.result_image_url;
  });
  for (const row of doneNeedSettle.slice(0, 10)) {
    try {
      await settleMookoDoneJobs(admin, row.user_id, row, upstream, env);
      settled += 1;
    } catch (e) {
      console.error('[mooko-drain] settle failed', row.id, e);
    }
  }

  const failedStuck = await failStuckMookoJobs(admin, mookoJobs);

  const running = countRunningMookoSubmits(mookoJobs);
  const queuedJobs = pickQueuedMookoJobs(mookoJobs, 999);
  const slots = Math.max(0, maxConcurrentMookoSubmits(env) - running);
  const toStart = pickQueuedMookoJobs(mookoJobs, slots);

  for (const row of toStart) {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readMookoMeta(meta);
    const work = processMookoPendingSubmit(admin, row.user_id, row, upstream, env, {
      upstreamModel: m.upstreamModel,
      prompt: String(row.prompt || ''),
      resolution: String(row.resolution || '1k'),
      quality: String(row.quality || 'standard'),
      size: m.size,
      refImageUrls: m.refImageUrls
    }).catch((e) => {
      console.error('[mooko-drain] submit failed', row.id, e);
    });
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else void work;
    submitted += 1;
  }

  if (submitted || failedStuck || settled) {
    console.log('[mooko-drain] tick', {
      submitted,
      failedStuck,
      settled,
      running: running + submitted,
      queued: Math.max(0, queuedJobs.length - submitted),
      maxConcurrent: maxConcurrentMookoSubmits(env)
    });
  }
  return {
    submitted,
    failedStuck,
    settled,
    running: running + submitted,
    queued: Math.max(0, queuedJobs.length - submitted)
  };
}
