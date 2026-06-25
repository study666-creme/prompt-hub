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

/** GrsAI / Apimart：Cron / 列表轮询补提，避免 waitUntil 丢失导致长期卡在「正在提交」 */
export async function drainFastProviderPendingSubmits(
  env: Env,
  ctx?: DrainContext
): Promise<{ submitted: number; queued: number }> {
  const upstream = upstreamBindingsFromEnv(env);
  if (!upstream.grsaiKey && !upstream.apimartKey) {
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

  const queued = ((rows || []) as JobRow[]).filter((row) => {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readFastMeta(meta);
    if (m.provider !== 'grsai' && m.provider !== 'apimart') return false;
    if (typeof meta.upstreamTaskId === 'string' && meta.upstreamTaskId) return false;
    return m.submitState === 'queued';
  });

  const maxSubmit = Math.min(12, Math.max(1, ctx?.maxSubmit ?? 4));
  const batch = queued.slice(0, maxSubmit);
  const tasks = batch.map((row) => {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readFastMeta(meta);
    const provider = m.provider === 'apimart' ? 'apimart' : 'grsai';
    if (!upstream.grsaiKey && provider === 'grsai') return null;
    if (!upstream.apimartKey && provider === 'apimart') return null;
    return processFastProviderPendingSubmit(
      admin,
      row.user_id,
      row,
      upstream,
      provider,
      fastSubmitParamsFromJob(row)
    );
  }).filter(Boolean) as Promise<void>[];

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
