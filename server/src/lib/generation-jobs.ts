import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { isMookoPlaceholderTaskId } from './mooko';
import {
  confirmUpstreamTaskOutcome,
  fetchUpstreamTaskOnce,
  readJobProvider,
  type ImageUpstreamBindings
} from './image-upstream';
import { ApiError } from './errors';
import { resolveMookoHttpImageFromTask } from './mooko-submit';
import {
  archiveGenerationResultUrls,
  isParseableDataImageUrl,
  archiveRemoteImage,
  isDataImageUrl,
  isStorageRef,
  toStorageRef
} from './image-archive';
import { findFirstExistingStoragePath } from './media-cdn';
import { defaultGridMjButtons } from './apimart-midjourney';
import { parseMjImagineUrls } from './midjourney-models';

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

export type PollJobOpts = {
  quick?: boolean;
  /** 将慢速上游提交挂到 waitUntil，避免轮询 HTTP 被 100s 掐断 */
  kickSubmit?: (task: Promise<void>) => void;
};

function scheduleBackgroundSubmit(
  opts: PollJobOpts | undefined,
  task: Promise<void>,
  label: string
) {
  const wrapped = task.catch((e) => {
    console.warn(`[generation] ${label} background submit failed`, e);
  });
  if (opts?.kickSubmit) opts.kickSubmit(wrapped);
  else void wrapped;
}

function isSlowSubmitProvider(provider: ReturnType<typeof readJobProvider>): boolean {
  return provider === 'mooko' || provider === 'ithink';
}

function jobStaleMs(
  provider: ReturnType<typeof readJobProvider>,
  upstreamModel: string,
  resolution?: string | null
): number {
  const res = String(resolution || '1k').toLowerCase();
  if (provider === 'mooko') return 35 * 60 * 1000;
  if (provider === 'ithink') return 25 * 60 * 1000;
  if (res === '4k') return 55 * 60 * 1000;
  if (res === '2k' || upstreamModel.includes('vip') || upstreamModel.includes('-pro')) {
    return 45 * 60 * 1000;
  }
  const slowUpstream =
    upstreamModel.includes('nano-banana') || upstreamModel.includes('jimeng');
  return slowUpstream ? 45 * 60 * 1000 : 28 * 60 * 1000;
}

export function slowProviderProgressNote(
  meta: Record<string, unknown>,
  provider: ReturnType<typeof readJobProvider>
): string | null {
  if (provider === 'mooko') {
    const st = String(meta.mookoSubmitState || '');
    if (st === 'queued') return '已扣积分，排队生成中（约 1 分钟内发出）…';
    if (st === 'running') {
      return '正在生成中（约 2–12 分钟，请耐心等待）';
    }
    if (st === 'done' && !meta.syncImageUrl && !meta.upstreamTaskId) {
      return '生成完成，正在入库…';
    }
    if (st === 'done') return '生成完成，正在同步到仓库…';
  }
  if (provider === 'ithink') {
    const st = String(meta.ithinkSubmitState || '');
    if (st === 'queued') return '已扣积分，正在提交生成任务…';
    if (st === 'running') return '正在生成中（约 2–5 分钟）…';
    if (st === 'done') return '生成完成，正在入库…';
  }
  if (provider === 'grsai' || provider === 'apimart') {
    const st = String(meta.fastSubmitState || '');
    if (st === 'queued') return '已扣积分，正在提交…';
    if (st === 'running') return '提交中，请稍候…';
    if (st === 'done' && !meta.upstreamTaskId) return '已响应，正在同步…';
  }
  return null;
}

export async function pollAndUpdateJob(
  admin: SupabaseClient,
  userId: string,
  job: JobRow,
  upstream: ImageUpstreamBindings,
  env?: Env,
  opts?: PollJobOpts
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  imageUrl: string | null;
  errorMessage: string | null;
  refunded: boolean;
  extraImageUrls?: string[];
  progressNote?: string | null;
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
      && (upstream.grsaiKey || upstream.apimartKey || upstream.ithinkKey || upstream.mookoKey)
    ) {
      const recovered = await tryRecoverJobFromUpstream(
        admin,
        userId,
        job,
        upstream,
        taskId,
        provider,
        env
      );
      if (recovered) return recovered;
      const polled = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
        attempts: 4,
        intervalMs: 1500
      });
      if (polled.status === 'completed' && polled.imageUrl) {
        return completeJobFromPoll(admin, userId, job, polled, env);
      }
      const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
      if (storedArchive) {
        return finishJobFromStoredArchive(admin, userId, job, storedArchive);
      }
    }
    const existingUrl = job.result_image_url as string | null;
    if (opts?.quick && existingUrl) {
      let extraImageUrls: string[] | undefined;
      if (Array.isArray(meta.extraImageUrls)) {
        extraImageUrls = (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u);
      }
      return {
        status: 'completed',
        imageUrl: existingUrl,
        errorMessage: null,
        refunded: !!meta.refunded,
        extraImageUrls: extraImageUrls?.length ? extraImageUrls : undefined
      };
    }
    if (existingUrl && isStorageRef(existingUrl)) {
      let extraImageUrls: string[] | undefined;
      if (Array.isArray(meta.extraImageUrls)) {
        extraImageUrls = (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u);
      }
      return {
        status: 'completed',
        imageUrl: existingUrl,
        errorMessage: null,
        refunded: !!meta.refunded,
        extraImageUrls: extraImageUrls?.length ? extraImageUrls : undefined
      };
    }
    if (existingUrl && isRemoteHttpImageUrl(existingUrl) && !opts?.quick) {
      let extraImageUrls: string[] | undefined;
      if (Array.isArray(meta.extraImageUrls)) {
        extraImageUrls = (meta.extraImageUrls as string[]).filter((u) => typeof u === 'string' && u);
      }
      return {
        status: 'completed',
        imageUrl: existingUrl,
        errorMessage: null,
        refunded: !!meta.refunded,
        extraImageUrls: extraImageUrls?.length ? extraImageUrls : undefined
      };
    }
    const archived = await ensureJobImageArchived(admin, userId, job, env);
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
    const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
    if (storedArchive) {
      return finishJobFromStoredArchive(admin, userId, job, storedArchive);
    }
    if (opts?.quick) {
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: job.error_message,
        refunded: !!(job.meta as Record<string, unknown>)?.refunded
      };
    }
    if (taskId && (upstream.grsaiKey || upstream.apimartKey || upstream.ithinkKey || upstream.mookoKey)) {
      const recovered = await tryRecoverJobFromUpstream(
        admin,
        userId,
        job,
        upstream,
        taskId,
        provider,
        env
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
  const staleMs = jobStaleMs(provider, upstreamModel, job.resolution);

  if (!upstream.grsaiKey && !upstream.apimartKey && !upstream.ithinkKey && !upstream.mookoKey) {
    await admin
      .from('generation_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    return { status: 'completed', imageUrl: null, errorMessage: null, refunded: false };
  }

  const mookoStoredUrls = (() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: unknown) => {
      if (typeof raw !== 'string') return;
      const url = raw.trim();
      if (!url || seen.has(url)) return;
      if (/^https?:\/\//i.test(url)) {
        seen.add(url);
        out.push(url);
        return;
      }
      if (isParseableDataImageUrl(url)) {
        seen.add(url);
        out.push(url);
      }
    };
    push(meta.syncImageUrl);
    if (Array.isArray(meta.mookoSubmitImageUrls)) {
      for (const u of meta.mookoSubmitImageUrls) push(u);
    }
    return out;
  })();
  let urlsToComplete = mookoStoredUrls;
  if (
    provider === 'mooko'
    && taskId
    && !isMookoPlaceholderTaskId(taskId)
    && !urlsToComplete.length
    && upstream.mookoKey
  ) {
    const pollAttempts = opts?.quick ? 6 : 40;
    const recovered = await resolveMookoHttpImageFromTask(
      upstream.mookoKey,
      upstream.mookoBase,
      taskId,
      { attempts: pollAttempts, intervalMs: 3000 }
    );
    if (recovered) {
      urlsToComplete = [recovered];
      await admin
        .from('generation_requests')
        .update({
          meta: { ...meta, syncImageUrl: recovered, mookoAwaitPoll: false }
        })
        .eq('id', job.id);
    }
  }
  if (urlsToComplete.some(isDataImageUrl)) {
    try {
      if (provider === 'mooko') {
        const { finalizeMookoArchivedImage } = await import('./mooko-submit');
        const raw = urlsToComplete.find(isDataImageUrl) || urlsToComplete[0];
        await finalizeMookoArchivedImage(admin, userId, job.id, meta, raw, env);
        const { data: fresh } = await admin
          .from('generation_requests')
          .select('*')
          .eq('id', job.id)
          .maybeSingle();
        if (fresh?.status === 'completed' && fresh.result_image_url) {
          return {
            status: 'completed',
            imageUrl: fresh.result_image_url as string,
            errorMessage: null,
            refunded: false
          };
        }
      } else {
        urlsToComplete = await archiveGenerationResultUrls(admin, userId, job.id, urlsToComplete, env);
        const syncPatch: Record<string, unknown> = {
          syncImageUrl: urlsToComplete[0]
        };
        if (urlsToComplete.length > 1) syncPatch.mookoSubmitImageUrls = urlsToComplete;
        await admin
          .from('generation_requests')
          .update({ meta: { ...meta, ...syncPatch } })
          .eq('id', job.id);
      }
    } catch (e) {
      console.warn('[generation] archive syncImageUrl before complete failed', job.id, e);
      return {
        status: 'processing',
        imageUrl: null,
        errorMessage: null,
        refunded: false,
        progressNote: slowProviderProgressNote(meta, provider)
      };
    }
  }
  const syncImageUrl = urlsToComplete[0] || null;
  if (syncImageUrl && job.status === 'processing') {
    return completeJobFromPoll(
      admin,
      userId,
      job,
      { imageUrl: syncImageUrl, imageUrls: urlsToComplete },
      env
    );
  }

  if (job.status === 'processing' && provider === 'mooko') {
    let submitState = String(meta.mookoSubmitState || '');
    const queuedMs = Date.now() - createdMs;
    if (submitState === 'failed' && meta.mookoSubmitError) {
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: String(meta.mookoSubmitError),
        refunded: !!meta.refunded
      };
    }
    if (
      (submitState === 'queued' || submitState === 'running')
      && queuedMs > staleMs
      && !syncImageUrl
      && !taskId
    ) {
      await finalizeFailedJob(admin, userId, job, 'upstream_timeout');
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: 'upstream_timeout',
        refunded: true
      };
    }
    if (submitState === 'queued') {
      const attempts = Number(meta.mookoSubmitAttempts || 0);
      if (queuedMs > 12 * 60 * 1000 && attempts < 1) {
        await finalizeFailedJob(admin, userId, job, 'upstream_submit_not_started');
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: 'upstream_submit_not_started',
          refunded: true
        };
      }
      // 木瓜仅 Cron 提交（mooko-drain awaitSubmit）；轮询只读 DB，不在 waitUntil 里 POST
      return {
        status: 'processing',
        imageUrl: null,
        errorMessage: null,
        refunded: false,
        progressNote: slowProviderProgressNote(meta, provider)
      };
    }
    if (
      (submitState === 'done' || submitState === 'running')
      && taskId
      && !isMookoPlaceholderTaskId(taskId)
      && upstream.mookoKey
      && !syncImageUrl
    ) {
      const recovered = await resolveMookoHttpImageFromTask(
        upstream.mookoKey,
        upstream.mookoBase,
        taskId,
        { attempts: opts?.quick ? 8 : 35, intervalMs: 3000 }
      );
      if (recovered) {
        return completeJobFromPoll(
          admin,
          userId,
          job,
          { imageUrl: recovered, imageUrls: [recovered] },
          env
        );
      }
    }
    if (submitState === 'running') {
      const startedAt = Date.parse(String(meta.mookoSubmitStartedAt || ''));
      const runningMs = Number.isFinite(startedAt) ? Date.now() - startedAt : queuedMs;
      if (runningMs > 3 * 60 * 1000 && !syncImageUrl) {
        const { tryCompleteMookoFromStoredArchive } = await import('./mooko-submit');
        const recovered = await tryCompleteMookoFromStoredArchive(admin, userId, job.id, env);
        if (recovered) {
          const { data: fresh } = await admin
            .from('generation_requests')
            .select('*')
            .eq('id', job.id)
            .maybeSingle();
          if (fresh?.status === 'completed' && fresh.result_image_url) {
            return {
              status: 'completed',
              imageUrl: fresh.result_image_url as string,
              errorMessage: null,
              refunded: false
            };
          }
        }
      }
      if (runningMs > 28 * 60 * 1000 && !syncImageUrl && !taskId) {
        await finalizeFailedJob(admin, userId, job, 'upstream_submit_stale');
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: 'upstream_submit_stale',
          refunded: true
        };
      }
      if (runningMs > 12 * 60 * 1000 && !syncImageUrl && taskId) {
        await finalizeFailedJob(admin, userId, job, 'upstream_image_archive_failed');
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: 'upstream_image_archive_failed',
          refunded: true
        };
      }
      const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
      if (storedArchive) {
        return finishJobFromStoredArchive(admin, userId, job, storedArchive);
      }
      if (typeof meta.syncImageUrl === 'string' && meta.syncImageUrl.trim()) {
        try {
          const { finalizeMookoArchivedImage } = await import('./mooko-submit');
          await finalizeMookoArchivedImage(
            admin,
            userId,
            job.id,
            meta,
            String(meta.syncImageUrl).trim(),
            env
          );
          const { data: fresh } = await admin
            .from('generation_requests')
            .select('*')
            .eq('id', job.id)
            .maybeSingle();
          if (fresh?.status === 'completed' && fresh.result_image_url) {
            return {
              status: 'completed',
              imageUrl: fresh.result_image_url as string,
              errorMessage: null,
              refunded: false
            };
          }
        } catch (e) {
          console.warn('[generation] mooko running finalize failed', job.id, e);
        }
      }
      return {
        status: 'processing',
        imageUrl: null,
        errorMessage: null,
        refunded: false,
        progressNote: slowProviderProgressNote(meta, provider)
      };
    }
    // done：继续往下用 upstreamTaskId / 任务查询拉图
  }

  if (job.status === 'processing' && provider === 'ithink') {
    let submitState = String(meta.ithinkSubmitState || '');
    const queuedMs = Date.now() - createdMs;
    if (submitState === 'failed' && meta.ithinkSubmitError) {
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: String(meta.ithinkSubmitError),
        refunded: !!meta.refunded
      };
    }
    if (
      (submitState === 'queued' || submitState === 'running')
      && queuedMs > staleMs
      && !syncImageUrl
    ) {
      await finalizeFailedJob(admin, userId, job, 'upstream_timeout');
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: 'upstream_timeout',
        refunded: true
      };
    }
    /** Think 仅 Cron（ithink-drain awaitSubmit）与 settle=1 提交；轮询只读 DB */
    return {
      status: 'processing',
      imageUrl: null,
      errorMessage: null,
      refunded: false,
      progressNote: slowProviderProgressNote(meta, provider)
    };
  }

  if (
    (provider === 'grsai' || provider === 'apimart')
    && !taskId
    && job.status === 'processing'
  ) {
    const st = String(meta.fastSubmitState || '');
    const queuedMs = Date.now() - createdMs;
    if (st === 'failed' && meta.fastSubmitError) {
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: String(meta.fastSubmitError),
        refunded: !!meta.refunded
      };
    }
    if (st === 'queued' || st === 'running') {
      if (queuedMs > 6 * 60 * 1000) {
        await finalizeFailedJob(admin, userId, job, 'upstream_submit_stale');
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: 'upstream_submit_stale',
          refunded: true
        };
      }
      if (st === 'queued') {
        const { processFastProviderPendingSubmit } = await import('./fast-provider-submit');
        scheduleBackgroundSubmit(
          opts,
          processFastProviderPendingSubmit(admin, userId, job, upstream, provider, {
            upstreamModel: String(meta.upstreamModel || 'gpt-image-2-pro'),
            prompt: String(job.prompt || ''),
            resolution: String(job.resolution || '1k'),
            quality: String(job.quality || 'standard'),
            size: typeof meta.size === 'string' ? meta.size : undefined,
            refImageUrls: Array.isArray(meta.refImageUrls)
              ? (meta.refImageUrls as string[]).filter(Boolean)
              : undefined
          }),
          provider
        );
      }
      return {
        status: 'processing',
        imageUrl: null,
        errorMessage: null,
        refunded: false,
        progressNote: slowProviderProgressNote(meta, provider)
      };
    }
  }

  if (!taskId || (provider === 'mooko' && isMookoPlaceholderTaskId(taskId) && !syncImageUrl)) {
    if (provider === 'mooko') {
      const st = String(meta.mookoSubmitState || '');
      if (st === 'queued' || st === 'running' || st === 'done') {
        return {
          status: 'processing',
          imageUrl: null,
          errorMessage: null,
          refunded: false,
          progressNote: slowProviderProgressNote(meta, provider)
        };
      }
    }
    await finalizeFailedJob(admin, userId, job, 'missing_task_id');
    return {
      status: 'failed',
      imageUrl: null,
      errorMessage: 'missing_task_id',
      refunded: true
    };
  }

  const ageMs = Date.now() - createdMs;

  if (opts?.quick) {
    const polled = await fetchUpstreamTaskOnce(upstream, provider, taskId);
    if (polled.status === 'completed' && polled.imageUrl) {
      return completeJobFromPoll(admin, userId, job, polled, env);
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
      if (provider === 'apimart') {
        const confirmed = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
          attempts: 2,
          intervalMs: 1200
        });
        if (confirmed.status === 'completed' && confirmed.imageUrl) {
          return completeJobFromPoll(admin, userId, job, confirmed, env);
        }
        const msg = confirmed.errorMessage || polled.errorMessage || 'upstream_failed';
        await finalizeFailedJob(admin, userId, job, msg);
        return {
          status: 'failed',
          imageUrl: null,
          errorMessage: msg,
          refunded: true
        };
      }
    }
    const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
    if (storedArchive) {
      return finishJobFromStoredArchive(admin, userId, job, storedArchive);
    }
    return {
      status: 'processing',
      imageUrl: null,
      errorMessage: null,
      refunded: false,
      progressNote:
        provider === 'mooko' && String(meta.mookoSubmitState) === 'done'
          ? slowProviderProgressNote(meta, provider)
          : null
    };
  }

  if (job.status === 'processing' && ageMs > 45 * 1000 && ageMs < staleMs) {
    const deep = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: provider === 'mooko' ? 24 : 6,
      intervalMs: provider === 'mooko' ? 3000 : 2000
    });
    if (deep.status === 'completed' && deep.imageUrl) {
      return completeJobFromPoll(admin, userId, job, deep, env);
    }
    if (deep.status === 'failed') {
      const msg = deep.errorMessage || 'upstream_failed';
      const skipRefund = deep.isViolation === true && refundOnViolation === false;
      await finalizeFailedJob(admin, userId, job, msg, { skipRefund });
      return {
        status: 'failed',
        imageUrl: null,
        errorMessage: msg,
        refunded: !skipRefund
      };
    }
  }

  if (Date.now() - createdMs > staleMs) {
    const slowPoll = staleMs > 22 * 60 * 1000;
    const late = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: slowPoll ? 8 : 5,
      intervalMs: slowPoll ? 12000 : 8000
    });
    if (late.status === 'completed' && late.imageUrl) {
      return completeJobFromPoll(admin, userId, job, late, env);
    }
    const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
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
    return completeJobFromPoll(admin, userId, job, polled, env);
  }

  if (polled.status === 'pending' && job.status === 'processing' && ageMs > 20 * 1000) {
    const deep = await confirmUpstreamTaskOutcome(upstream, provider, taskId, {
      attempts: provider === 'mooko' ? 20 : 5,
      intervalMs: provider === 'mooko' ? 3000 : 1800
    });
    if (deep.status === 'completed' && deep.imageUrl) {
      return completeJobFromPoll(admin, userId, job, deep, env);
    }
  }

  const storedArchive = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
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
      return completeJobFromPoll(admin, userId, job, confirmed, env);
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
  polled: { imageUrl: string | null; imageUrls?: string[] },
  env?: Env
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
  const meta = (job.meta as Record<string, unknown>) || {};
  const isMj = meta.isMidjourney === true;
  const mjParsed = isMj ? parseMjImagineUrls(allUrls) : null;
  const primary = (isMj ? mjParsed?.primary : null) || allUrls[0] || polled.imageUrl!;
  const extras = isMj ? [] : allUrls.slice(1).filter(Boolean);
  let mjButtons = Array.isArray(meta.mjButtons) ? meta.mjButtons : undefined;
  if (isMj && !mjButtons?.length) {
    mjButtons = defaultGridMjButtons();
  }

  /** 4K 等大图：先标记完成并返回上游临时链，R2 归档放后台（避免轮询 35s 超时） */
  if (isRemoteHttpImageUrl(primary)) {
    await admin
      .from('generation_requests')
      .update({
        status: 'completed',
        result_image_url: primary,
        error_message: null,
        completed_at: new Date().toISOString(),
        meta: {
          ...meta,
          extraImageUrls: isMj ? undefined : extras.length ? extras : meta.extraImageUrls || undefined,
          ...(isMj && mjParsed
            ? {
                mjGridUrls: mjParsed.tiles.length ? mjParsed.tiles : undefined,
                mjCompositeUrl: mjParsed.composite || undefined
              }
            : {}),
          archivePending: true,
          upstreamImageUrl: primary,
          ...(mjButtons?.length ? { mjButtons } : {})
        }
      })
      .eq('id', job.id);
    return {
      status: 'completed',
      imageUrl: primary,
      errorMessage: null,
      refunded: false,
      extraImageUrls: isMj ? undefined : extras.length ? extras : undefined
    };
  }

  const storedUrl = await ensureJobImageArchived(admin, userId, {
    ...job,
    status: 'completed',
    result_image_url: primary
  }, env);
  await admin
    .from('generation_requests')
    .update({
      status: 'completed',
      result_image_url: storedUrl,
      error_message: null,
      completed_at: new Date().toISOString(),
      meta: {
        ...meta,
        extraImageUrls: isMj ? undefined : extras.length ? extras : meta.extraImageUrls || undefined,
        recoveredFromUpstream: meta.recoveredFromUpstream || undefined,
        archived: true,
        archivePending: false,
        ...(isMj && mjParsed
          ? {
              mjGridUrls: mjParsed.tiles.length ? mjParsed.tiles : undefined,
              mjCompositeUrl: mjParsed.composite || undefined
            }
          : {}),
        ...(mjButtons?.length ? { mjButtons } : {})
      }
    })
    .eq('id', job.id);
  return {
    status: 'completed',
    imageUrl: storedUrl,
    errorMessage: null,
    refunded: false,
    extraImageUrls: isMj ? undefined : extras.length ? extras : undefined
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
  provider: ReturnType<typeof readJobProvider>,
  env?: Env
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
    const stored = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
    if (stored) return finishJobFromStoredArchive(admin, userId, job, stored);
    return null;
  }
  const meta = (job.meta as Record<string, unknown>) || {};
  const result = await completeJobFromPoll(admin, userId, job, polled, env);
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
  jobId: string,
  env?: Env
): Promise<string | null> {
  const paths = ['jpg', 'png', 'webp'].map((ext) => `${userId}/generated/${jobId}.${ext}`);
  const found = await findFirstExistingStoragePath(admin, paths, GEN_IMAGE_BUCKET, env);
  return found ? toStorageRef(found) : null;
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
  job: JobRow,
  env?: Env
): Promise<string | null> {
  const url = job.result_image_url;
  if (!url) return null;
  if (isStorageRef(url)) return url;

  const meta = (job.meta as Record<string, unknown>) || {};
  try {
    const stored = await archiveRemoteImage(admin, userId, job.id, url, {
      maxAttempts: 3,
      env
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
    const stored = await tryRestoreJobImageFromStorage(admin, userId, job.id, env);
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

function isRemoteHttpImageUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function jobPollNeedsBackgroundArchive(
  imageUrl: string | null | undefined
): boolean {
  return isRemoteHttpImageUrl(imageUrl);
}

/** 后台把上游临时链归档到 R2/Storage（不阻塞轮询响应） */
export async function archivePendingJobImage(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
  env?: Env
): Promise<boolean> {
  const { data: job, error } = await admin
    .from('generation_requests')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !job) return false;
  const url = job.result_image_url as string | null;
  if (!url || isStorageRef(url)) return false;
  if (!isRemoteHttpImageUrl(url)) return false;
  const meta = (job.meta as Record<string, unknown>) || {};
  if (meta.archived === true && meta.archivePending !== true) return false;
  try {
    await ensureJobImageArchived(admin, userId, job as JobRow, env);
    return true;
  } catch (e) {
    console.warn('[generation] background archive failed', jobId, e);
    return false;
  }
}
