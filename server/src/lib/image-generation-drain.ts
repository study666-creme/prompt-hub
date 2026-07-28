import type { Env } from '../env';
import { drainFastProviderPendingSubmits } from './fast-provider-drain';
import {
  archivePendingJobImage,
  pollAndUpdateJob,
  type JobRow
} from './generation-jobs';
import { readJobProvider, upstreamBindingsFromEnv } from './image-upstream';
import { createAdminClient } from './supabase';

type ImageDrainOptions = {
  maxSubmit?: number;
  maxPoll?: number;
  maxArchive?: number;
};

function boundedWorkLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(value ?? fallback)));
}

function hasPollableImageTask(job: JobRow): boolean {
  const meta = (job.meta as Record<string, unknown>) || {};
  const provider = readJobProvider(meta);
  const taskId = typeof meta.upstreamTaskId === 'string'
    ? meta.upstreamTaskId.trim()
    : typeof meta.apimartTaskId === 'string'
      ? meta.apimartTaskId.trim()
      : '';
  return !!taskId && (provider === 'newapi' || provider === 'apimart' || provider === 'grsai');
}

export async function drainPendingImageTasks(
  env: Env,
  opts?: { maxPoll?: number }
): Promise<{ polled: number; completed: number; failed: number }> {
  const maxPoll = boundedWorkLimit(opts?.maxPoll, 4, 12);
  const admin = createAdminClient(env);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const queries = await Promise.all([
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'processing')
      .not('meta->>upstreamTaskId', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(maxPoll * 4),
    admin
      .from('generation_requests')
      .select('*')
      .eq('status', 'processing')
      .not('meta->>apimartTaskId', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(maxPoll * 2)
  ]);
  const queryError = queries.find(result => result.error)?.error;
  if (queryError) {
    console.error('[image-drain] task list failed', queryError.message);
    return { polled: 0, completed: 0, failed: 0 };
  }

  const rowMap = new Map<string, JobRow>();
  for (const result of queries) {
    for (const row of (result.data || []) as JobRow[]) rowMap.set(row.id, row);
  }
  const jobs = [...rowMap.values()]
    .filter(hasPollableImageTask)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, maxPoll);
  const upstream = upstreamBindingsFromEnv(env);
  let completed = 0;
  let failed = 0;

  await Promise.allSettled(jobs.map(async job => {
    const result = await pollAndUpdateJob(
      admin,
      job.user_id,
      job,
      upstream,
      env,
      { quick: true }
    );
    if (result.status === 'completed') {
      completed += 1;
      if (/^https?:\/\//i.test(String(result.imageUrl || ''))) {
        await archivePendingJobImage(admin, job.user_id, job.id, env);
      }
    } else if (result.status === 'failed') {
      failed += 1;
    }
  }));

  if (jobs.length) {
    console.log('[image-drain] poll tick', { polled: jobs.length, completed, failed });
  }
  return { polled: jobs.length, completed, failed };
}

export async function drainPendingImageArchives(
  env: Env,
  opts?: { maxArchive?: number }
): Promise<{ attempted: number; archived: number }> {
  const maxArchive = boundedWorkLimit(opts?.maxArchive, 2, 8);
  const admin = createAdminClient(env);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'completed')
    .eq('meta->>archivePending', 'true')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(maxArchive * 4);
  if (error) {
    console.error('[image-drain] archive list failed', error.message);
    return { attempted: 0, archived: 0 };
  }

  const now = Date.now();
  const jobs = ((data || []) as JobRow[])
    .filter(job => {
      if (!/^https?:\/\//i.test(String(job.result_image_url || ''))) return false;
      const meta = (job.meta as Record<string, unknown>) || {};
      const nextAttemptAt = Date.parse(String(meta.archiveNextAttemptAt || ''));
      return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now;
    })
    .slice(0, maxArchive);
  const results = await Promise.allSettled(
    jobs.map(job => archivePendingJobImage(admin, job.user_id, job.id, env))
  );
  const archived = results.filter(
    result => result.status === 'fulfilled' && result.value === true
  ).length;

  if (jobs.length) console.log('[image-drain] archive tick', { attempted: jobs.length, archived });
  return { attempted: jobs.length, archived };
}

export async function drainImageGenerationWork(
  env: Env,
  opts?: ImageDrainOptions
): Promise<void> {
  await Promise.allSettled([
    drainFastProviderPendingSubmits(env, {
      awaitSubmit: true,
      maxSubmit: opts?.maxSubmit ?? 2
    }),
    drainPendingImageTasks(env, { maxPoll: opts?.maxPoll }),
    drainPendingImageArchives(env, { maxArchive: opts?.maxArchive })
  ]);
}
