import type { Env } from '../env';
import { type JobRow } from './generation-jobs';
import { fastSubmitParamsFromJob, processFastProviderPendingSubmit } from './fast-provider-submit';
import { upstreamBindingsFromEnv, type ImageUpstreamProvider } from './image-upstream';
import { createAdminClient } from './supabase';

type DrainContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  awaitSubmit?: boolean;
  /** 单次最多处理几条 queued（避免 Cron 超时） */
  maxSubmit?: number;
};

const NEWAPI_IDEMPOTENT_RECOVERY_DELAY_MS = 60_000;
const LEGACY_RUNNING_RECOVERY_DELAY_MS = 15 * 60_000;

function readFastMeta(meta: Record<string, unknown>) {
  return {
    provider: String(meta.provider || '') as ImageUpstreamProvider,
    submitState: String(meta.fastSubmitState || ''),
    upstreamModel: String(meta.upstreamModel || 'gpt-image-2'),
    size: typeof meta.size === 'string' ? meta.size : undefined,
    refImageUrls: Array.isArray(meta.refImageUrls)
      ? (meta.refImageUrls as string[]).filter(Boolean)
      : undefined
  };
}

export function isFastProviderSubmitRecoverable(row: JobRow, now = Date.now()): boolean {
  const meta = (row.meta as Record<string, unknown>) || {};
  const m = readFastMeta(meta);
  if (m.provider !== 'grsai' && m.provider !== 'apimart' && m.provider !== 'newapi') return false;
  if (typeof meta.upstreamTaskId === 'string' && meta.upstreamTaskId) return false;
  if (m.submitState === 'queued') return true;

  const startedAt = Date.parse(String(meta.fastSubmitStartedAt || ''));
  const elapsed = Number.isFinite(startedAt) ? now - startedAt : Number.POSITIVE_INFINITY;
  if (m.provider === 'newapi') {
    return (m.submitState === 'running' || m.submitState === 'uncertain')
      && elapsed >= NEWAPI_IDEMPOTENT_RECOVERY_DELAY_MS;
  }
  return m.submitState === 'running' && elapsed >= LEGACY_RUNNING_RECOVERY_DELAY_MS;
}

/** GrsAI / Apimart：Cron / 列表轮询补提，避免 waitUntil 丢失导致长期卡在「正在提交」 */
export async function drainFastProviderPendingSubmits(
  env: Env,
  ctx?: DrainContext
): Promise<{ submitted: number; queued: number }> {
  const upstream = upstreamBindingsFromEnv(env);
  if (!upstream.grsaiKey && !upstream.apimartKey && !upstream.newapiKey) {
    return { submitted: 0, queued: 0 };
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
    console.error('[fast-drain] list failed', error.message);
    return { submitted: 0, queued: 0 };
  }

  const queued = ((rows || []) as JobRow[]).filter((row) => isFastProviderSubmitRecoverable(row));

  const maxSubmit = Math.min(12, Math.max(1, ctx?.maxSubmit ?? 4));
  const batch = queued.slice(0, maxSubmit);
  const tasks = batch.map((row) => {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readFastMeta(meta);
    const provider = m.provider === 'apimart' ? 'apimart' : m.provider === 'newapi' ? 'newapi' : 'grsai';
    if (!upstream.grsaiKey && provider === 'grsai') return null;
    if (!upstream.apimartKey && provider === 'apimart') return null;
    if (!upstream.newapiKey && provider === 'newapi') return null;
    return processFastProviderPendingSubmit(
      admin,
      row.user_id,
      row,
      upstream,
      provider,
      fastSubmitParamsFromJob(row),
      env,
      {
        reclaimRunning: m.submitState === 'running',
        reclaimUncertain: provider === 'newapi' && m.submitState === 'uncertain'
      }
    );
  }).filter(Boolean) as Promise<unknown>[];

  if (ctx?.awaitSubmit) {
    await Promise.allSettled(tasks);
  } else if (ctx?.waitUntil) {
    tasks.forEach((t) => ctx.waitUntil!(t));
  } else {
    tasks.forEach((t) => void t);
  }
  const submitted = tasks.length;

  if (submitted) {
    console.log('[fast-drain] tick', { submitted, queued: queued.length });
  }
  return { submitted, queued: queued.length };
}
