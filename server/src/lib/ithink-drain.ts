import type { Env } from '../env';
import { type JobRow } from './generation-jobs';
import { upstreamBindingsFromEnv } from './image-upstream';
import { completeMookoJobWithImage } from './mooko-submit';
import { processIthinkPendingSubmit } from './ithink-submit';
import { createAdminClient } from './supabase';

type DrainContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  awaitSubmit?: boolean;
};

function readIthinkMeta(meta: Record<string, unknown>) {
  return {
    submitState: String(meta.ithinkSubmitState || ''),
    syncUrl: typeof meta.syncImageUrl === 'string' ? meta.syncImageUrl : '',
    upstreamModel: String(meta.upstreamModel || 'gpt-image-2'),
    size: typeof meta.size === 'string' ? meta.size : undefined
  };
}

/** Cron / 轮询补提：避免 HTTP waitUntil 丢失导致经济线从未发出上游请求 */
export async function drainIthinkPendingSubmits(
  env: Env,
  ctx?: DrainContext
): Promise<{ submitted: number; settled: number; queued: number }> {
  const upstream = upstreamBindingsFromEnv(env);
  if (!upstream.ithinkKey) {
    return { submitted: 0, settled: 0, queued: 0 };
  }

  const admin = createAdminClient(env);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('status', 'processing')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) {
    console.error('[ithink-drain] list failed', error.message);
    return { submitted: 0, settled: 0, queued: 0 };
  }

  const jobs = ((rows || []) as JobRow[]).filter((j) => {
    const meta = (j.meta as Record<string, unknown>) || {};
    return meta.provider === 'ithink';
  });

  let submitted = 0;
  let settled = 0;

  for (const row of jobs) {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readIthinkMeta(meta);
    if (m.submitState === 'done' && !row.result_image_url && m.syncUrl) {
      try {
        const meta = (row.meta as Record<string, unknown>) || {};
        await completeMookoJobWithImage(admin, row.id, meta, m.syncUrl, [m.syncUrl]);
        settled += 1;
      } catch (e) {
        console.error('[ithink-drain] settle failed', row.id, e);
      }
    }
  }

  const queued = jobs.filter((j) => {
    const m = readIthinkMeta((j.meta as Record<string, unknown>) || {});
    return m.submitState === 'queued' && !m.syncUrl;
  });

  for (const row of queued.slice(0, 2)) {
    const meta = (row.meta as Record<string, unknown>) || {};
    const m = readIthinkMeta(meta);
    const work = processIthinkPendingSubmit(admin, row.user_id, row, upstream, env, {
      upstreamModel: env.ITHINK_UPSTREAM_MODEL?.trim() || m.upstreamModel,
      prompt: String(row.prompt || ''),
      resolution: '1k',
      quality: String(row.quality || 'standard'),
      size: m.size
    }).catch((e) => {
      console.error('[ithink-drain] submit failed', row.id, e);
    });
    if (ctx?.awaitSubmit) await work;
    else if (ctx?.waitUntil) ctx.waitUntil(work);
    else void work;
    submitted += 1;
  }

  if (submitted || settled) {
    console.log('[ithink-drain] tick', { submitted, settled, queued: queued.length });
  }
  return { submitted, settled, queued: queued.length };
}
