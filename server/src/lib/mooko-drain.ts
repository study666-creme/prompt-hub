import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { finalizeFailedJob, pollAndUpdateJob, type JobRow } from './generation-jobs';
import { upstreamBindingsFromEnv, type ImageUpstreamBindings } from './image-upstream';
import {
  finalizeMookoArchivedImage,
  processMookoPendingSubmit,
  tryCompleteMookoFromStoredArchive
} from './mooko-submit';
import { createAdminClient } from './supabase';

/** 木瓜同步 POST 常需 400s+；90s 误判会导致木瓜已扣费、站内却退款 */
const STUCK_RUNNING_MS = 30 * 60 * 1000;
/** 同步 POST 可达 8 分钟；无 taskId 的 running 须留足时间，勿误杀已扣费的上游请求 */
const DEAD_RUNNING_MS = 15 * 60 * 1000;
/** 无 taskId 的 running 超过此时长视为未真正打到木瓜，释槽并回队列 */
const NO_TASK_RELEASE_MS = 6 * 60 * 1000;
/** 有 upstreamTaskId 但无图：上游多半已扣费，POST 后归档/写库失败 */
const ZOMBIE_RUNNING_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 8;

type DrainContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Cron 内必须 await 同步 POST（可达 8 分钟）；waitUntil 在 HTTP 场景仅 ~30s */
  awaitSubmit?: boolean;
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

function mookoRunningMs(meta: Record<string, unknown>): number {
  const m = readMookoMeta(meta);
  return Number.isFinite(m.startedAt) ? Date.now() - m.startedAt : 0;
}

function isDeadMookoRunning(meta: Record<string, unknown>): boolean {
  const m = readMookoMeta(meta);
  if (m.submitState !== 'running') return false;
  if (m.taskId || m.syncUrl) return false;
  return mookoRunningMs(meta) >= DEAD_RUNNING_MS;
}

function isZombieMookoRunning(meta: Record<string, unknown>): boolean {
  const m = readMookoMeta(meta);
  if (m.submitState !== 'running') return false;
  if (m.syncUrl) return false;
  return mookoRunningMs(meta) >= ZOMBIE_RUNNING_MS;
}

/** HTTP waitUntil 认领后 ~30s 被掐断：无 taskId、未打到木瓜，占槽位导致队列堵死 */
function isHttpOrphanMookoRunning(meta: Record<string, unknown>): boolean {
  if (String(meta.mookoSubmitChannel || '') !== 'http') return false;
  const m = readMookoMeta(meta);
  if (m.submitState !== 'running' || m.syncUrl || m.taskId) return false;
  return mookoRunningMs(meta) >= 45 * 1000;
}

export function countRunningMookoSubmits(jobs: JobRow[]): number {
  return jobs.filter((j) => {
    const meta = (j.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') return false;
    const m = readMookoMeta(meta);
    if (m.submitState !== 'running') return false;
    if (isDeadMookoRunning(meta)) return false;
    if (isZombieMookoRunning(meta)) return false;
    if (isHttpOrphanMookoRunning(meta)) return false;
    if (!m.taskId && mookoRunningMs(meta) >= NO_TASK_RELEASE_MS) return false;
    return true;
  }).length;
}

/** 释放 waitUntil 假 running，让 Cron 重新 queued 提交（未扣木瓜费） */
async function releaseStaleNoTaskMookoRunning(
  admin: SupabaseClient,
  rows: JobRow[]
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'processing') continue;
    const meta = (row.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') continue;
    const m = readMookoMeta(meta);
    if (m.submitState !== 'running' || m.syncUrl || m.taskId) continue;
    if (mookoRunningMs(meta) < NO_TASK_RELEASE_MS) continue;
    const nextMeta = { ...meta };
    delete nextMeta.mookoSubmitStartedAt;
    delete nextMeta.mookoSubmitChannel;
    await admin
      .from('generation_requests')
      .update({
        meta: {
          ...nextMeta,
          mookoSubmitState: 'queued',
          mookoSubmitAttempts: 0,
          mookoSubmitError: null
        }
      })
      .eq('id', row.id);
    n += 1;
    console.warn('[mooko-drain] released no-task running back to queued', row.id);
  }
  return n;
}

async function releaseHttpOrphanMookoRunning(
  admin: SupabaseClient,
  rows: JobRow[]
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'processing') continue;
    const meta = (row.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') continue;
    if (!isHttpOrphanMookoRunning(meta)) continue;
    const nextMeta = { ...meta };
    delete nextMeta.mookoSubmitStartedAt;
    delete nextMeta.mookoSubmitChannel;
    await admin
      .from('generation_requests')
      .update({
        meta: {
          ...nextMeta,
          mookoSubmitState: 'queued',
          mookoSubmitAttempts: 0,
          mookoSubmitError: null
        }
      })
      .eq('id', row.id);
    n += 1;
    console.warn('[mooko-drain] released http orphan back to queued', row.id);
  }
  return n;
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

async function releaseDeadMookoRunningJobs(
  admin: SupabaseClient,
  rows: JobRow[]
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'processing') continue;
    const meta = (row.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') continue;
    if (!isDeadMookoRunning(meta)) continue;
    await finalizeFailedJob(admin, row.user_id, row, 'upstream_submit_interrupted');
    n += 1;
    console.warn('[mooko-drain] dead running released (refunded)', row.id);
  }
  return n;
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
    if (m.syncUrl) continue;
    const runningMs = mookoRunningMs(meta);
    if (runningMs < STUCK_RUNNING_MS) continue;
    await finalizeFailedJob(admin, row.user_id, row, 'upstream_submit_stale');
    n += 1;
    console.warn('[mooko-drain] stuck running refunded', row.id, runningMs, m.taskId || 'no-task');
  }
  return n;
}

/** running + 有 taskId 但无图：先试 R2 恢复，超时再退款释槽（勿重复 POST 扣费） */
async function recoverZombieMookoRunningJobs(
  admin: SupabaseClient,
  rows: JobRow[],
  env: Env
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'processing' || row.result_image_url) continue;
    const meta = (row.meta as Record<string, unknown>) || {};
    if (meta.provider !== 'mooko') continue;
    const m = readMookoMeta(meta);
    if (m.submitState !== 'running' || m.syncUrl) continue;
    const runningMs = mookoRunningMs(meta);
    if (runningMs < 3 * 60 * 1000) continue;
    try {
      const recovered = await tryCompleteMookoFromStoredArchive(admin, row.user_id, row.id, env);
      if (recovered) {
        n += 1;
        console.warn('[mooko-drain] zombie running recovered from R2', row.id);
        continue;
      }
    } catch (e) {
      console.warn('[mooko-drain] zombie R2 recover failed', row.id, e);
    }
    if (!isZombieMookoRunning(meta)) continue;
    await finalizeFailedJob(admin, row.user_id, row, 'upstream_image_archive_failed');
    n += 1;
    console.warn('[mooko-drain] zombie running refunded', row.id, runningMs, m.taskId);
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
  const sync = typeof meta.syncImageUrl === 'string' ? meta.syncImageUrl.trim() : '';
  if (sync) {
    await finalizeMookoArchivedImage(admin, userId, row.id, meta, sync, env);
    return;
  }
  const { data: fresh } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', row.id)
    .maybeSingle();
  await pollAndUpdateJob(admin, userId, (fresh || row) as JobRow, upstream, env, { quick: false });
}

/** Cron/Queue 专用：木瓜同步 POST 可达 8 分钟，允许多任务并发（单任务仍防重复提交） */
export async function drainMookoPendingSubmits(
  env: Env,
  ctx?: DrainContext
): Promise<{
  submitted: number;
  releasedDead: number;
  failedStuck: number;
  settled: number;
  running: number;
  queued: number;
}> {
  const upstream = upstreamBindingsFromEnv(env);
  if (!upstream.mookoKey) {
    console.error('[mooko-drain] MOOKO_API_KEY not configured');
    return { submitted: 0, releasedDead: 0, failedStuck: 0, settled: 0, running: 0, queued: 0 };
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
    return { submitted: 0, releasedDead: 0, failedStuck: 0, settled: 0, running: 0, queued: 0 };
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

  const releasedHttpOrphan = await releaseHttpOrphanMookoRunning(admin, mookoJobs);
  const releasedNoTask = await releaseStaleNoTaskMookoRunning(admin, mookoJobs);
  const recoveredZombie = await recoverZombieMookoRunningJobs(admin, mookoJobs, env);
  settled += recoveredZombie;

  const releasedDead = await releaseDeadMookoRunningJobs(admin, mookoJobs);
  const failedStuck = await failStuckMookoJobs(admin, mookoJobs);

  const running = countRunningMookoSubmits(mookoJobs);
  const queuedJobs = pickQueuedMookoJobs(mookoJobs, 999);
  const slots = Math.max(0, maxConcurrentMookoSubmits(env) - running);
  const toStart = pickQueuedMookoJobs(mookoJobs, slots);

  const startWork = (row: JobRow) => {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readMookoMeta(meta);
    return processMookoPendingSubmit(admin, row.user_id, row, upstream, env, {
      upstreamModel: m.upstreamModel,
      prompt: String(row.prompt || ''),
      resolution: String(row.resolution || '1k'),
      quality: String(row.quality || 'standard'),
      size: m.size,
      refImageUrls: m.refImageUrls
    }).catch((e) => {
      console.error('[mooko-drain] submit failed', row.id, e);
    });
  };
  if (ctx?.awaitSubmit && toStart.length > 1) {
    await Promise.all(toStart.map((row) => startWork(row)));
    submitted += toStart.length;
  } else {
    for (const row of toStart) {
      const work = startWork(row);
      if (ctx?.awaitSubmit) {
        await work;
      } else if (ctx?.waitUntil) {
        ctx.waitUntil(work);
      } else {
        void work;
      }
      submitted += 1;
    }
  }

  if (submitted || failedStuck || settled || releasedDead || recoveredZombie || releasedHttpOrphan || releasedNoTask) {
    console.log('[mooko-drain] tick', {
      submitted,
      releasedDead,
      releasedHttpOrphan,
      releasedNoTask,
      failedStuck,
      recoveredZombie,
      settled,
      running: running + submitted,
      queued: Math.max(0, queuedJobs.length - submitted),
      maxConcurrent: maxConcurrentMookoSubmits(env)
    });
  }
  return {
    submitted,
    releasedDead,
    failedStuck,
    settled,
    running: running + submitted,
    queued: Math.max(0, queuedJobs.length - submitted)
  };
}
