/**
 * 生图任务：pending 持久化、轮询、会话追踪（与 features-draft 业务状态解耦）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  const jobState = global.ImageGenJobState.create(() => deps);
  const {
    LS_SESSION_GEN_JOBS,
    LS_PENDING_GEN_JOBS,
    LS_FAILED_GEN_JOBS,
    LS_GEN_JOBS_STATE,
    RECENT_GEN_RECOVER_MS,
    SERVER_RECOVER_AFTER_MS,
    FAILED_JOB_RECOVER_MAX_MS,
    GEN_JOBS_LIST_MIN_MS
  } = jobState;

  const activePollJobIds = new Set();
  let resumeGenJobsInflight = null;
  let genJobsSyncTimer = null;
  let genJobsSyncInterval = null;
  let genJobsSyncRetry = 0;
  let lastGenJobsListAt = 0;

  function d() { return deps; }
  function GE() { return global.ImageGenGenErrors || {}; }
  function pendingList() { return jobState.pendingList(); }
  function setPending(v) { jobState.setPending(v); }
  function failedList() { return jobState.failedList(); }
  function setFailed(v) { jobState.setFailed(v); }

  function ge(name, ...args) {
    const fn = GE()[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function loadGenJobStateFromLocal() { return jobState.loadGenJobStateFromLocal(); }
  function getSessionGenJobIdsRaw() { return jobState.getSessionGenJobIdsRaw(); }
  function writeSessionGenJobIds(list) { return jobState.writeSessionGenJobIds(list); }
  function afterGenJobsResume(changed) { return jobState.afterGenJobsResume(changed); }
  function scheduleImageGenPendingUiRefresh() { return jobState.scheduleImageGenPendingUiRefresh(); }
  function persistPendingGenJobs() { return jobState.persistPendingGenJobs(); }
  function loadPendingGenJobs() { return jobState.loadPendingGenJobs(); }
  function persistFailedGenJobs() { return jobState.persistFailedGenJobs(); }
  function loadFailedGenJobs() { return jobState.loadFailedGenJobs(); }
  function purgeExpiredGenPendingJobs() { return jobState.purgeExpiredGenPendingJobs(); }

  /** @see imagegen-gen-errors.js（pack-imagegen.js） */
  function stringifyGenErrorRaw(errRaw) {
    const fn = window.ImageGenGenErrors?.stringifyGenErrorRaw;
    return typeof fn === 'function' ? fn(errRaw) : String(errRaw ?? '').trim();
  }

  function isStaleConfigError(msg) {
    const fn = window.ImageGenGenErrors?.isStaleConfigError;
    return typeof fn === 'function' ? fn(msg) : false;
  }

  function isLikelyRecoverableGenFailure(errRaw, ctx, opts = {}) {
    const fn = window.ImageGenGenErrors?.isLikelyRecoverableGenFailure;
    return typeof fn === 'function' ? fn(errRaw, ctx, opts) : false;
  }

  function purgeExpiredGenPendingJobs() {
    const now = Date.now();
    const before = pendingList().length;
    setPending(pendingList().filter((p) => {
      const age = now - (p.startedAt || 0);
      if (!p.jobId) return age < 15 * 60 * 1000;
      return age < RECENT_GEN_RECOVER_MS;
    }));
    if (pendingList().length !== before) persistPendingGenJobs();
  }

  function abandonUnrecoverablePendingJob(pending, reason, opts = {}) {
    if (!pending) return;
    if (pending.jobId) {
      window.recordGenerationJobDeletion?.(pending.jobId);
      clearSessionGenJob(pending.jobId);
    }
    removePendingJob(pending.id);
    persistPendingGenJobs();
    if (opts.toast !== false && reason) d().toast(reason, 5000);
    d().renderImageGenFeed({ preserveScroll: true });
  }

  function deferPendingJobRecovery(pendingId, ctx, note) {
    const job = pendingList().find((j) => j.id === pendingId);
    if (!job) return;
    const age = Date.now() - (job.startedAt || 0);
    if (age >= RECENT_GEN_RECOVER_MS) {
      abandonUnrecoverablePendingJob(
        job,
        '上游临时链接约 2 小时有效，该任务已过期，无法恢复（积分若已扣请查消费记录）'
      );
      return;
    }
    if (ge('isSlowGenProviderModel', job.model)) {
      job.recovering = false;
      job.recoverNote = '';
      job.pendingNote = formatPendingRecoveryNote(job, note || '仍在后台生成中（请勿重复提交）');
    } else {
      job.recovering = true;
      job.recoverNote = formatPendingRecoveryNote(job, note || '上游可能仍在出图，后台继续恢复…');
    }
    persistPendingGenJobs();
    if (job.jobId && age >= SERVER_RECOVER_AFTER_MS) {
      void d().tryRecoverPendingJobDirect(job);
    }
    void resumePendingGenerationJobs();
    scheduleImageGenPendingUiRefresh();
  }

  function addFailedGenJob(job) {
    const entry = {
      id: job.id || d().genId('fail'),
      jobId: job.jobId || null,
      prompt: String(job.prompt || '').trim(),
      errorMessage: ge('friendlyGenErrorMessage', job.errorMessage || '生图失败'),
      failedAt: job.failedAt || Date.now(),
      model: job.model ? d().normalizeImageGenModelId(job.model) : '',
      modelLabel: job.modelLabel || (job.model ? d().imageGenModelLabel(job.model) : ''),
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null,
      fromInspirationDraw: !!job.fromInspirationDraw,
      needsRecovery: !!job.needsRecovery || ge('isStaleConfigError', job.errorMessage)
    };
    if (!entry.prompt) return;
    setFailed([entry, ...failedList().filter((f) => f.id !== entry.id)].slice(0, 24));
    persistFailedGenJobs();
  }

  function removeFailedGenJob(failId) {
    setFailed(failedList().filter((f) => f.id !== failId));
    persistFailedGenJobs();
  }

  function clearFailedGenJobsForRecovery({ prompt, model, jobId } = {}) {
    const p = String(prompt || '').trim();
    const m = model ? d().normalizeImageGenModelId(model) : '';
    const before = failedList().length;
    setFailed(failedList().filter((f) => {
      if (jobId && f.jobId === jobId) return false;
      if (!p || !m) return true;
      if (String(f.prompt || '').trim() !== p) return true;
      if (f.model && d().normalizeImageGenModelId(f.model) !== m) return true;
      return false;
    }));
    if (failedList().length !== before) persistFailedGenJobs();
  }

  /** 提交请求网络中断时，从 API 找回刚创建的 processing 任务 */
  async function tryRecoverOrphanGenJobAfterSubmitError(payload, pendingId, pendingJob) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return false;
    const usedJobIds = new Set(
      pendingList().map((p) => p.jobId).filter(Boolean)
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 + attempt * 1200));
      const r = await window.PromptHubApi.listRecentGenerationJobs();
      if (!r?.ok || !Array.isArray(r.data?.jobs)) continue;
      const prompt = String(payload.prompt || '').trim();
      const model = d().normalizeImageGenModelId(payload.model || 'gpt-image-2');
      const job = d().findBestApiJobForPrompt(r.data.jobs, prompt, model, {
        minCreatedAt: pendingJob.startedAt || Date.now(),
        usedJobIds,
        preferProcessing: true,
        resolution: pendingJob.resolution
      });
      if (job?.id) {
        const t = Date.parse(job.createdAt);
        const now = Date.now();
        if (Number.isFinite(t) && now - t <= 300_000) {
          pendingJob.jobId = job.id;
          trackSessionGenJob(job.id);
          persistPendingGenJobs();
          clearFailedGenJobsForRecovery({ prompt, model, jobId: job.id });
          d().toast('网络波动，已找回刚提交的任务，正在恢复进度…');
          void pollGenerationJobUntilDone(job.id, pendingId, pendingJobToPollCtx(pendingJob));
          return true;
        }
      }
    }
    return false;
  }

  function failPendingJob(pendingId, errorMessage) {
    const job = pendingList().find((j) => j.id === pendingId);
    if (job) {
      addFailedGenJob({
        prompt: job.prompt,
        model: job.model,
        modelLabel: job.modelLabel || d().imageGenModelLabel(job.model),
        batchIndex: job.batchIndex,
        batchTotal: job.batchTotal,
        batchId: job.batchId,
        fromInspirationDraw: !!job.fromInspirationDraw,
        errorMessage: ge('stringifyGenErrorRaw', errorMessage)
      });
    }
    removePendingJob(pendingId);
  }

  function removePendingJob(pendingId) {
    setPending(pendingList().filter((j) => j.id !== pendingId));
    persistPendingGenJobs();
  }

  function toastGenFailure(ctx, message) {
    const label = d().batchIndexLabel?.(ctx?.batchIndex, ctx?.batchTotal) || '';
    const msg = String(message || '生图失败，积分已全额退回');
    d().toast(label ? `${label} ${msg}` : msg);
  }

  function pendingJobToPollCtx(job) {
    return {
      prompt: job.prompt || '',
      model: job.model || 'gpt-image-2',
      resolution: job.resolution || '1k',
      quality: job.quality || 'standard',
      size: job.size || '1:1',
      cost: job.cost || 0,
      jobId: job.jobId,
      targetGroup: job.targetGroup || null,
      targetTags: job.targetTags || null,
      fromInspirationDraw: !!job.fromInspirationDraw,
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null,
      batchMergeCards: !!job.batchMergeCards,
      cardTitle: job.cardTitle || '',
      silentToast: !!job.silentToast,
      refImage: job.refImage || null,
      refImages: Array.isArray(job.refImages) ? job.refImages.filter(Boolean) : null,
      referenceAssets: Array.isArray(job.referenceAssets) ? job.referenceAssets.filter(Boolean) : null,
      startedAt: job.startedAt || Date.now()
    };
  }

  function scheduleGenJobsSync(delayMs) {
    clearTimeout(genJobsSyncTimer);
    genJobsSyncTimer = setTimeout(() => {
      void resumePendingGenerationJobs().then((ok) => {
        if (!ok && genJobsSyncRetry < 6) {
          genJobsSyncRetry += 1;
          scheduleGenJobsSync(Math.min(12000, 3000 + genJobsSyncRetry * 1500));
        } else if (ok) {
          genJobsSyncRetry = 0;
        }
      });
    }, delayMs == null ? 400 : delayMs);
  }

  function shouldRunGenJobsBackgroundSync() {
    if (pendingList().length > 0 || activePollJobIds.size > 0) return true;
    const onImageGen = document.getElementById('pageImageGen')?.classList.contains('active');
    if (!onImageGen) return false;
    return getSessionGenJobIds().length > 0;
  }

  function startGenJobsBackgroundSync() {
    if (genJobsSyncInterval) return;
    const hasActiveRecover = pendingList().some(
      (p) => p.recovering || ge('isSlowGenProviderModel', p.model)
    );
    const syncIntervalMs = hasActiveRecover
      ? (d().isMobileViewport() ? 8000 : 7000)
      : pendingList().length > 0
        ? (d().isMobileViewport() ? 12000 : 12000)
        : (d().isMobileViewport() ? 45000 : 30000);
    genJobsSyncInterval = setInterval(() => {
      if (!window.PointsSystem?.useApiForAccount?.()) return;
      if (!shouldRunGenJobsBackgroundSync()) return;
      void resumePendingGenerationJobs().then((ok) => d().afterGenJobsResume?.(ok));
      if (document.getElementById('pageImageGen')?.classList.contains('active') && pendingList().length) {
        scheduleImageGenPendingUiRefresh();
      }
    }, syncIntervalMs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistPendingGenJobs();
        return;
      }
      loadPendingGenJobs();
      if (shouldRunGenJobsBackgroundSync()) scheduleGenJobsSync(300);
    });
    window.addEventListener('pagehide', () => {
      persistPendingGenJobs();
    });
    window.addEventListener('pageshow', () => {
      loadPendingGenJobs();
      if (pendingList().length > 0) {
        d().renderImageGenFeed({ preserveScroll: true });
        d().renderImageGenMobileResult();
      }
      if (shouldRunGenJobsBackgroundSync()) scheduleGenJobsSync(200);
    });
  }

  function getSessionGenJobIds() {
    const ids = new Set(getSessionGenJobIdsRaw());
    const localSession = loadGenJobStateFromLocal()?.session;
    if (Array.isArray(localSession)) {
      localSession.forEach((x) => ids.add(String(x)));
    }
    return [...ids];
  }

  function trackSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    const list = getSessionGenJobIds().filter((x) => x !== id);
    list.push(id);
    writeSessionGenJobIds(list);
  }

  function clearSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    writeSessionGenJobIds(getSessionGenJobIds().filter((x) => x !== id));
  }

  function isSessionGenJob(jobId) {
    return jobId && getSessionGenJobIds().includes(String(jobId));
  }

  function shouldDeferFailedPendingRecovery(pending, apiJob, ctx) {
    const age = Date.now() - (pending.startedAt || 0);
    const errRaw = apiJob?.errorMessage || apiJob?.message || '';
    if (ge('isDefinitiveGenFailure', errRaw, apiJob)) return false;
    if (age >= pendingRecoveryGiveUpMs(pending)) return false;
    if (age >= FAILED_JOB_RECOVER_MAX_MS && !ge('isLikelyRecoverableGenFailure', errRaw, ctx, { confirmedFailed: true })) {
      return false;
    }
    if (pending.recovering || ge('isLikelyRecoverableGenFailure', errRaw, ctx)) {
      return age < pendingRecoveryGiveUpMs(pending);
    }
    return false;
  }

  function isLongRunningGenJob(ctx) {
    const fn = GE().isLongRunningGenJob;
    return typeof fn === 'function' ? fn(ctx) : false;
  }

  function pendingRecoveryGiveUpMs(pending) {
    const fn = GE().genRecoveringDeferGiveUpMs;
    const ctx = pendingJobToPollCtx(pending || {});
    return typeof fn === 'function' ? fn(ctx) : 22 * 60 * 1000;
  }

  function formatPendingRecoveryNote(pending, fallback) {
    const age = Date.now() - (pending?.startedAt || 0);
    const mins = Math.max(1, Math.floor(age / 60000));
    const base = fallback || pending?.recoverNote || '后台恢复中';
    return `${base} · 已等 ${mins} 分钟`;
  }

  function slowGenDeferNote(ctx) {
    const fn = GE().slowGenDeferNote;
    return typeof fn === 'function' ? fn(ctx) : '可能已出图，正在后台恢复（请勿重复提交）';
  }

  async function failPendingJobImmediately(pendingId, ctx, errRaw) {
    const msg = ge('friendlyGenErrorMessage', errRaw);
    failPendingJob(pendingId, msg);
    await window.PointsSystem?.refreshCreditsFromServer?.();
    d().renderImageGenFeed({ preserveScroll: true });
    if (!ctx?.silentToast) toastGenFailure(ctx, msg);
  }

  function applyGenPollProgressNote(pendingId, pollData) {
    const note = pollData?.progressNote;
    if (!note || !pendingId) return;
    const job = pendingList().find((j) => j.id === pendingId);
    if (!job) return;
    if (job.pendingNote === note) return;
    job.pendingNote = note;
    if (pollData?.status === 'processing' && isLongRunningGenJob({ model: job.model, resolution: job.resolution })) {
      job.recovering = false;
      job.recoverNote = '';
    }
    persistPendingGenJobs();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      scheduleImageGenPendingUiRefresh();
      return;
    }
    d().renderImageGenFeed({ preserveScroll: true });
  }

  async function pollGenerationJobUntilDone(jobId, pendingId, ctx) {
    if (activePollJobIds.has(jobId)) return;
    activePollJobIds.add(jobId);
    try {
    const maxAttempts = 90;
    const finishFromPoll = async (poll) => {
      if (poll.data.status === 'failed') {
        const errRaw = poll.data.errorMessage || poll.data.message || '';
        if (ge('isDefinitiveGenFailure', errRaw, poll.data)) {
          await failPendingJobImmediately(pendingId, ctx, errRaw);
          return true;
        }
        return false;
      }
      if (poll.data.status === 'completed') {
        if (poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model)) {
          const parsed = d().resolveMjPollImages?.(poll);
          if ((parsed?.gallery?.length || 0) < 4) {
            const settled = await window.PromptHubApi.getGenerationJob(jobId, { settle: true });
            if (settled?.ok && settled.data?.status === 'completed') {
              return d().ensureGenJobCreationsFromPoll(
                settled,
                { ...ctx, jobId: ctx.jobId || jobId },
                pendingId
              );
            }
            return false;
          }
        }
        return d().ensureGenJobCreationsFromPoll(poll, { ...ctx, jobId: ctx.jobId || jobId }, pendingId);
      }
      return false;
    };

    const failAfterGrace = async () => {
      for (let g = 0; g < 12; g += 1) {
        await new Promise((r) => setTimeout(r, g === 0 ? 2500 : g < 4 ? 4000 : 6000));
        const retry = await window.PromptHubApi.getGenerationJob(jobId);
        if (retry.ok && await finishFromPoll(retry)) return true;
        if (retry.ok && (retry.data.status === 'processing' || (retry.data.status === 'completed' && !retry.data.imageUrl))) {
          continue;
        }
        if (retry.ok && retry.data.status === 'failed' && ge('isLikelyRecoverableGenFailure', retry.data.errorMessage, ctx)) {
          continue;
        }
      }
      const last = await window.PromptHubApi.getGenerationJob(jobId);
      if (last.ok && await finishFromPoll(last)) return true;
      const errRaw = last.ok && last.data.status === 'failed'
        ? (last.data.errorMessage || last.data.message)
        : '生图超时或上游无结果';
        if (ge('isLikelyRecoverableGenFailure', errRaw, ctx)) {
        deferPendingJobRecovery(pendingId, ctx, slowGenDeferNote(ctx));
        return true;
      }
      const msg = ge('friendlyGenErrorMessage', errRaw);
      failPendingJob(pendingId, msg);
      await window.PointsSystem?.refreshCreditsFromServer?.();
      d().renderImageGenFeed({ preserveScroll: true });
      toastGenFailure(ctx, msg);
      return true;
    };

    for (let i = 0; i < maxAttempts; i++) {
      const elapsed = Date.now() - (ctx?.startedAt || Date.now());
      const activeMax = ge('genActivePollMaxMs', ctx);
      if (elapsed >= activeMax) {
        deferPendingJobRecovery(
          pendingId,
          ctx,
          ge('isSlowGenProviderModel', ctx?.model)
            ? '前台已等 15 分钟，仍在后台生成（请勿重复提交）'
            : isLongRunningGenJob(ctx)
              ? '前台已等 15 分钟，2K/4K 仍在后台等待（请勿重复提交）'
              : '前台已等 5 分钟，仍在后台恢复（请勿重复提交）'
        );
        void resumePendingGenerationJobs();
        return;
      }
      if (i > 0) await new Promise((r) => setTimeout(r, ge('genJobPollDelayMs', ctx, i)));
      const elapsedNow = Date.now() - (ctx?.startedAt || Date.now());
      const isMj = d().isImageGenMidjourneyModel?.(ctx?.model);
      const useSettle = isMj
        || ge('isSlowGenProviderModel', ctx?.model)
        || (isLongRunningGenJob(ctx) && elapsedNow > 60_000);
      let poll = await window.PromptHubApi.getGenerationJob(jobId, { settle: useSettle && elapsedNow > (isMj ? 8000 : 20000) });
      if (poll.ok) applyGenPollProgressNote(pendingId, poll.data);
      if (!poll.ok) {
        const recoverableNet =
          poll.code === 'NETWORK_ERROR'
          || poll.code === 'API_UNREACHABLE'
          || poll.status === 524
          || /524|timeout|超时/i.test(String(poll.message || ''));
        if (i < maxAttempts - 1) {
          const backoff = poll.code === 'RATE_LIMITED'
            ? 4500
            : recoverableNet
              ? 2800
              : 2200;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (recoverableNet || poll.code === 'RATE_LIMITED') {
          deferPendingJobRecovery(pendingId, ctx, slowGenDeferNote(ctx));
          void resumePendingGenerationJobs();
          return;
        }
        d().toast(poll.message || '查询生图进度失败，正在尝试恢复…');
        void resumePendingGenerationJobs();
        return;
      }

      if (typeof poll.data.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(poll.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }

      if (poll.data.status === 'processing') {
        continue;
      }

      if (poll.data.status === 'completed' && !poll.data.imageUrl) {
        continue;
      }

      if (poll.data.status === 'failed') {
        const errRaw = poll.data.errorMessage || poll.data.message || '';
        if (ge('isDefinitiveGenFailure', errRaw, poll.data)) {
          await failPendingJobImmediately(pendingId, ctx, errRaw);
          return;
        }
        if (ge('isLikelyRecoverableGenFailure', errRaw, ctx) && elapsed < (window.ImageGenGenErrors?.ACTIVE_POLL_MAX_MS ?? 5 * 60 * 1000)) {
          continue;
        }
        if (await failAfterGrace()) return;
        continue;
      }

      if (await finishFromPoll(poll)) return;
    }

    const last = await window.PromptHubApi.getGenerationJob(jobId);
    if (last.ok && await finishFromPoll(last)) return;
    if (await failAfterGrace()) return;

    d().toast('生图时间较长，正在恢复本次任务…');
    void resumePendingGenerationJobs();
    d().renderImageGenFeed({ preserveScroll: true });
    } finally {
      activePollJobIds.delete(jobId);
    }
  }

  /**
   * 从 API 恢复生图结果。
   * - sessionOnly：仅恢复「本会话提交」的任务（轮询失败时用）
   * - crossDevice：登录/切回前台时，从 API 补全本机缺失的近期已完成任务（跨手机/电脑）
   * - manual：用户点「恢复丢失的生图」并确认后
   */
  async function recoverRecentGenerationJobs(opts = {}) {
    if (opts.manual === true) return { ok: true, recovered: 0 };
    const crossDevice = opts.crossDevice === true;
    if (!opts.sessionOnly && !crossDevice) return;

    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return { ok: false, recovered: 0 };

    let changed = false;
    let recovered = 0;

    if (crossDevice) {
      for (const job of r.data.jobs) {
        if (!job?.id || d().isGenerationJobDeleted(job.id)) continue;
        if (job.status !== 'completed' || !job.imageUrl) continue;
        if (!isRecentGenJob(job)) continue;
        const existing = findWarehouseCardForJob(job.id);
        if (existing) {
          const gallery = global.PromptHubCardGallery?.normalizeCardGallery?.(existing) || [];
          const isMj = job.isMidjourney || d().isImageGenMidjourneyModel?.(job.model);
          const mjNeedsGallery = isMj && gallery.length < 4;
          if (!warehouseCardImageNeedsRecovery(existing, job.imageUrl) && !mjNeedsGallery) continue;
        }
        const meta = {
          prompt: job.prompt || '',
          model: job.model || 'gpt-image-2',
          resolution: job.resolution || '1k',
          quality: job.quality || 'standard',
          size: job.size || '1:1',
          cost: job.creditsCharged || 0,
          jobId: job.id
        };
        try {
          let pollData = {
            status: 'completed',
            imageUrl: job.imageUrl,
            extraImageUrls: job.extraImageUrls,
            jobId: job.id,
            isMidjourney: job.isMidjourney,
            model: job.model
          };
          const isMj = job.isMidjourney || d().isImageGenMidjourneyModel?.(job.model);
          if (isMj && window.PromptHubApi?.getGenerationJob) {
            const full = await window.PromptHubApi.getGenerationJob(job.id);
            if (full?.ok && full.data) pollData = { ...full.data, status: full.data.status || 'completed' };
          }
          const ok = await d().ensureGenJobCreationsFromPoll(
            { data: pollData },
            { ...meta, silentToast: true, isRecovery: true },
            null
          );
          if (ok !== false) {
            changed = true;
            recovered += 1;
          }
        } catch (e) {
          console.warn('[recover] crossDevice job failed', job.id, e);
        }
      }
      if (recovered > 0) {
        changed = true;
        d().queueUrgentCardsSync?.();
        if (typeof window.persistPromptHubCards === 'function') {
          await window.persistPromptHubCards({ skipCloud: true });
        }
        window.refreshWarehouseUI?.();
      }
      if (changed) d().renderImageGenFeed({ preserveScroll: true });
      return { ok: true, recovered };
    }

    for (const job of r.data.jobs) {
      if (!job?.id) continue;
      if (d().isGenerationJobDeleted(job.id)) continue;

      const meta = {
        prompt: job.prompt || '',
        model: job.model || 'gpt-image-2',
        resolution: job.resolution || '1k',
        quality: job.quality || 'standard',
        size: job.size || '1:1',
        cost: job.creditsCharged || 0,
        jobId: job.id
      };
      const inSession = isSessionGenJob(job.id);

      if (job.status === 'processing') {
        if (!inSession) continue;
        const alreadyPending = pendingList().some((j) => j.jobId === job.id);
        if (!alreadyPending) {
          const pendingId = d().genId('pending');
          pendingList().unshift({
            id: pendingId,
            jobId: job.id,
            prompt: meta.prompt,
            model: meta.model,
            modelLabel: job.modelLabel || d().imageGenModelLabel(job.model),
            resolution: meta.resolution,
            quality: meta.quality,
            size: meta.size,
            cost: meta.cost,
            startedAt: Date.parse(job.createdAt) || Date.now()
          });
          changed = true;
          void pollGenerationJobUntilDone(job.id, pendingId, meta);
        }
        continue;
      }

      if (job.status !== 'completed' || !job.imageUrl) continue;
      if (!inSession) continue;
      if (!d().needsApiImageRecovery(job.id, job.imageUrl)) continue;
      const matchesActivePending = pendingList().some(
        (p) => p.jobId === job.id
          || (d().pendingPromptsMatch(p.prompt, job.prompt)
            && d().normalizeImageGenModelId(p.model) === d().normalizeImageGenModelId(job.model)
            && (!p.resolution || !job.resolution || p.resolution === job.resolution))
      );
      if (pendingList().length && !matchesActivePending) continue;

      const recoverExtrasList = Array.isArray(job.extraImageUrls)
        ? job.extraImageUrls.filter((u) => u && u !== job.imageUrl)
        : [];
      if (await d().syncMissingBonusImagesForJob(job, meta, { silentToast: true })) {
        changed = true;
        recovered += 1;
        continue;
      }

      const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);

      changed = true;
      if (existingCard && !existingCard.image) {
        const ok = await d().repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
        if (ok) {
          recovered += 1;
          continue;
        }
      }

      recovered += 1;
      await d().ensureGenJobCreationsFromPoll(
        { data: { status: 'completed', imageUrl: job.imageUrl, extraImageUrls: recoverExtrasList } },
        { ...meta, silentToast: true, isRecovery: true },
        null
      );
    }

    if (changed) d().renderImageGenFeed({ preserveScroll: true });
  }

  /** —— 任务恢复 / resume（自 features-draft 拆出）—— */

  function creations() {
    return d().getCreations?.() || [];
  }

  function isRecentGenJob(job) {
    const t = Date.parse(job?.createdAt || '');
    return Number.isFinite(t) && Date.now() - t < RECENT_GEN_RECOVER_MS;
  }

  function shouldAutoRecoverCompletedJob(job) {
    if (d().isGenerationJobDeleted(job.id)) return false;
    if (!job?.imageUrl) return false;
    if (!isRecentGenJob(job)) return false;
    if (!needsApiImageRecovery(job.id, job.imageUrl)) return false;
    if (isSessionGenJob(job.id)) return true;
    if (pendingList().some((p) => p.jobId === job.id)) return true;
    return false;
  }

  function warehouseCardImageNeedsRecovery(card, apiImageUrl) {
    if (!apiImageUrl) return false;
    if (!card?.image || !d().isDisplayableImage(card.image)) return true;
    if (/^https?:\/\//i.test(card.image)) return true;
    if (window.SupabaseSync?.isDataUrl?.(card.image)) return true;
    if (window.SupabaseSync?.isStorageRef?.(card.image)) {
      const path = window.SupabaseSync.storagePathFromRef?.(card.image);
      if (path && window.SupabaseSync.isPathKnownMissing?.(path)) return true;
    }
    return false;
  }

  function findWarehouseCardForJob(jobId) {
    if (!jobId) return null;
    const key = String(jobId).replace(/#\d+$/, '');
    return (window.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    }) || null;
  }

  function findCreationForJob(jobId) {
    if (!jobId) return null;
    const key = String(jobId).replace(/#\d+$/, '');
    return creations().find((c) => {
      if (!c?.jobId) return false;
      const cj = String(c.jobId).replace(/#\d+$/, '');
      return c.jobId === jobId || cj === key;
    }) || null;
  }

  function creationHasDisplayableImage(creation) {
    if (!creation) return false;
    if (creation.image && d().isDisplayableImage(creation.image)) return true;
    if (creation.isMidjourney) {
      if (creation.mjCompositeUrl && d().isDisplayableImage(creation.mjCompositeUrl)) return true;
      if (Array.isArray(creation.mjGridUrls) && creation.mjGridUrls.some((u) => d().isDisplayableImage(u))) return true;
      if (Array.isArray(creation.cardImages) && creation.cardImages.some((u) => d().isDisplayableImage(u))) return true;
    }
    return false;
  }

  function hasCreationForJob(jobId) {
    return creationHasDisplayableImage(findCreationForJob(jobId));
  }

  function needsApiImageRecovery(jobId, apiImageUrl, force = false) {
    if (!jobId || !apiImageUrl) return false;
    if (d().isGenerationJobDeleted(jobId) && !force) return false;
    const creation = findCreationForJob(jobId);
    if (!creation) return true;
    if (!creation.image || !d().isDisplayableImage(creation.image)) return true;
    if (/^https?:\/\//i.test(creation.image)) return true;
    if (window.SupabaseSync?.isDataUrl?.(creation.image)) return true;
    if (window.SupabaseSync?.isStorageRef?.(creation.image)) {
      const path = window.SupabaseSync.storagePathFromRef?.(creation.image);
      if (path && window.SupabaseSync.isPathKnownMissing?.(path)) return true;
    }
    return false;
  }

  function jobNeedsRecovery(job) {
    if (!job?.id || d().isGenerationJobDeleted(job.id)) return false;
    if (job.status === 'processing' || job.status === 'failed') return true;
    if (job.status === 'completed' && job.imageUrl) {
      return needsApiImageRecovery(job.id, job.imageUrl);
    }
    if (job.status === 'completed' && !job.imageUrl) return true;
    return false;
  }

  async function refreshGenerationJobFromServer(job, opts = {}) {
    if (!job?.id || !window.PromptHubApi?.getGenerationJob) return job;
    try {
      const retry = await window.PromptHubApi.getGenerationJob(job.id, {
        settle: opts.settle === true
      });
      if (!retry.ok) return job;
      return {
        ...job,
        status: retry.data.status || job.status,
        imageUrl: retry.data.imageUrl || job.imageUrl || null,
        extraImageUrls: retry.data.extraImageUrls || job.extraImageUrls,
        isMidjourney: retry.data.isMidjourney || job.isMidjourney,
        mjGridUrls: retry.data.mjGridUrls || job.mjGridUrls,
        mjCompositeUrl: retry.data.mjCompositeUrl || job.mjCompositeUrl,
        mjButtons: retry.data.mjButtons || job.mjButtons,
        errorMessage: retry.data.errorMessage || retry.data.message || job.errorMessage,
        prompt: job.prompt,
        model: job.model,
        resolution: job.resolution,
        quality: job.quality,
        size: job.size,
        creditsCharged: job.creditsCharged,
        createdAt: job.createdAt
      };
    } catch (e) {
      return job;
    }
  }

  function recoveryJobPriority(job) {
    const t = Date.parse(job?.createdAt || '') || 0;
    const hasCre = hasCreationForJob(job?.id);
    if (job?.status === 'completed' && job?.imageUrl && !hasCre) return 1e15 + t;
    if (job?.status === 'completed' && !job?.imageUrl) return 5e14 + t;
    if (job?.status === 'processing') return 1e14 + t;
    if (job?.status === 'failed') return 1e13 + t;
    return t;
  }

  async function collectJobsNeedingRecovery(opts = {}) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return [];
    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return [];
    const maxCount = Math.max(1, opts.maxCount ?? 12);
    const ignoreTombstones = opts.ignoreTombstones === true;
    const candidates = [];
    for (const job of r.data.jobs) {
      if (!job?.id) continue;
      if (!ignoreTombstones && d().isGenerationJobDeleted(job.id)) continue;
      const mightNeed = job.status === 'processing'
        || job.status === 'failed'
        || (job.status === 'completed' && (!job.imageUrl || needsApiImageRecovery(job.id, job.imageUrl, opts.force === true)));
      if (!mightNeed) continue;
      candidates.push(job);
    }
    candidates.sort((a, b) => recoveryJobPriority(b) - recoveryJobPriority(a));
    const out = [];
    for (const job of candidates.slice(0, maxCount)) {
      const needRefresh = job.status === 'processing'
        || job.status === 'failed'
        || !job.imageUrl;
      const live = needRefresh ? await refreshGenerationJobFromServer(job) : job;
      if (jobNeedsRecovery(live)) out.push(live);
    }
    return out;
  }

  function findBestApiJobForPrompt(jobs, prompt, model, opts = {}) {
    const p = String(prompt || '').trim();
    const m = d().normalizeImageGenModelId(model || 'gpt-image-2');
    if (!p || !Array.isArray(jobs)) return null;
    const minCreated = Number(opts.minCreatedAt) || 0;
    const used = opts.usedJobIds;
    const preferProcessing = opts.preferProcessing === true;
    let best = null;
    let bestScore = -Infinity;
    for (const j of jobs) {
      if (!j?.id || d().isGenerationJobDeleted(j.id)) continue;
      if (used?.has?.(j.id)) continue;
      if (String(j.prompt || '').trim() !== p) continue;
      if (d().normalizeImageGenModelId(j.model || 'gpt-image-2') !== m) continue;
      if (opts.resolution && j.resolution && j.resolution !== opts.resolution) continue;
      const created = Date.parse(j.createdAt) || 0;
      if (minCreated && created < minCreated - 120000) continue;
      let score = created;
      if (j.status === 'processing') score += 2e15;
      else if (preferProcessing) score -= 1e15;
      else if (j.status === 'completed') score += 1e12;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    return best;
  }

  function hasWarehouseCardForJob(jobId) {
    if (!jobId) return false;
    const key = String(jobId).replace(/#\d+$/, '');
    const card = (window.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    });
    if (!card?.image) return false;
    if (!d().isDisplayableImage(card.image)) return false;
    return true;
  }

  function normalizePendingPromptKey(prompt) {
    return String(prompt || '')
      .replace(/（同任务附赠图\s*\d+）/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  function pendingPromptsMatch(a, b) {
    const ka = normalizePendingPromptKey(a);
    const kb = normalizePendingPromptKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const head = Math.min(ka.length, kb.length, 56);
    if (head >= 28 && ka.slice(0, head) === kb.slice(0, head)) return true;
    return ka.includes(kb.slice(0, 48)) || kb.includes(ka.slice(0, 48));
  }

  function isGeneratedWarehouseCard(card) {
    if (!card) return false;
    const tags = Array.isArray(card.tags) ? card.tags : [];
    if (tags.includes('图片生成')) return true;
    const inspireTag = window.INSPIRE_DRAW_TAG || '灵感抽卡';
    if (tags.includes(inspireTag)) return true;
    return !!(card.genJobId || card.genSourceId);
  }

  function findWarehouseCardForPending(pending) {
    if (!pending) return null;
    const cards = window.__promptHubCards || [];
    if (pending.batchMergeCards && pending.batchId && pending.jobId) {
      const byBatch = cards.find((c) => c.genBatchId === pending.batchId);
      if (byBatch && Array.isArray(byBatch.genBatchJobIds) && byBatch.genBatchJobIds.includes(pending.jobId)) {
        return byBatch;
      }
    }
    if (pending.jobId) {
      const key = String(pending.jobId).replace(/#\d+$/, '');
      const byJob = cards.find((c) => {
        if (!c?.genJobId) return false;
        const cardKey = String(c.genJobId).replace(/#\d+$/, '');
        return c.genJobId === pending.jobId || cardKey === key;
      });
      if (byJob?.image && d().isDisplayableImage(byJob.image)) return byJob;
    }
    if (pending.jobId) {
      const cre = creations().find((c) => {
        if (!c?.jobId) return false;
        const cj = String(c.jobId).replace(/#\d+$/, '');
        const pj = String(pending.jobId).replace(/#\d+$/, '');
        return cj === pj;
      });
      if (cre?.id) {
        const bySource = cards.find((c) => c.genSourceId === cre.id);
        if (bySource?.image && d().isDisplayableImage(bySource.image)) return bySource;
      }
      return null;
    }
    const started = pending.startedAt || 0;
    if (!pending.prompt || !started) return null;
    const windowMs = 45 * 60 * 1000;
    const candidates = cards.filter((c) => {
      if (!c?.image || !d().isDisplayableImage(c.image)) return false;
      if (!isGeneratedWarehouseCard(c)) return false;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tags.includes('自动恢复') && c.genJobId && pending.jobId) {
        const pj = String(pending.jobId).replace(/#\d+$/, '');
        const cj = String(c.genJobId).replace(/#\d+$/, '');
        if (pj !== cj) return false;
      }
      if (!pendingPromptsMatch(c.prompt, pending.prompt)) return false;
      if (pending.resolution) {
        if (!c.resolution || c.resolution !== pending.resolution) return false;
      }
      if (pending.model && c.model && d().normalizeImageGenModelId(c.model) !== d().normalizeImageGenModelId(pending.model)) {
        return false;
      }
      const created = c.createdAt || c.updatedAt || 0;
      if (created && created < started - 120000) return false;
      if (created && created > started + windowMs) return false;
      return true;
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const da = Math.abs((a.createdAt || a.updatedAt || 0) - started);
      const db = Math.abs((b.createdAt || b.updatedAt || 0) - started);
      return da - db;
    });
    return candidates[0];
  }

  function pendingHasCreation(pending) {
    if (!pending) return false;
    if (pending.jobId && hasCreationForJob(pending.jobId)) return true;
    if (pending.batchMergeCards && pending.batchId) {
      const cre = creations().find((c) => c.genBatchId === pending.batchId);
      if (cre && creationHasDisplayableImage(cre)) return true;
    }
    return false;
  }

  /** 最近生成已有对应记录时，清掉生图区「生成中/恢复中」占位 */
  function prunePendingJobsWithCreations() {
    let changed = false;
    const next = [];
    for (const p of pendingList()) {
      if (!pendingHasCreation(p)) {
        next.push(p);
        continue;
      }
      if (p?.jobId) clearSessionGenJob(p.jobId);
      changed = true;
    }
    if (!changed) return;
    setPending(next);
    persistPendingGenJobs();
    scheduleImageGenPendingUiRefresh();
  }

  function prunePendingJobsWithWarehouseCards() {
    prunePendingJobsWithCreations();
  }

  async function tryRecoverPendingJobDirect(pending) {
    if (!pending?.jobId || !window.PromptHubApi?.getGenerationJob) return false;
    const jobId = pending.jobId;
    try {
      if (window.PromptHubApi.recoverWarehouseFromJobs) {
        await window.PromptHubApi.recoverWarehouseFromJobs({
          mode: 'settle',
          jobIds: [jobId],
          max: 1,
          days: 7
        });
      }
    } catch (e) {
      console.warn('[imagegen] server settle recover failed', jobId, e);
    }
    if (hasCreationForJob(jobId)) {
      removePendingJob(pending.id);
      clearSessionGenJob(jobId);
      d().renderImageGenFeed({ preserveScroll: true });
      return true;
    }
    try {
      const poll = await window.PromptHubApi.getGenerationJob(jobId, { settle: true });
      if (poll.ok && poll.data?.status === 'completed' && poll.data.imageUrl) {
        await resolvePendingFromApiJob(pending, {
          id: jobId,
          status: 'completed',
          imageUrl: poll.data.imageUrl,
          extraImageUrls: poll.data.extraImageUrls,
          prompt: pending.prompt,
          model: pending.model
        }, { silent: true });
        return hasCreationForJob(jobId) || !pendingList().some((p) => p.id === pending.id);
      }
    } catch (e) {
      console.warn('[imagegen] direct job settle failed', jobId, e);
    }
    return hasCreationForJob(jobId);
  }

  async function tryServerRecoverPending(pending) {
    return tryRecoverPendingJobDirect(pending);
  }

  async function resolvePendingFromApiJob(pending, apiJob, opts = {}) {
    if (!pending || !apiJob?.id) return false;
    if (d().isGenerationJobDeleted(apiJob.id)) {
      removePendingJob(pending.id);
      clearSessionGenJob(apiJob.id);
      return true;
    }
    const ctx = pendingJobToPollCtx(pending);
    ctx.silentToast = opts.silent !== false;

    if (apiJob.status === 'completed' && apiJob.imageUrl) {
      pending.recovering = false;
      pending.recoverNote = '';
      pending.pendingNote = '';
      const existingCre = findCreationForJob(apiJob.id);
      if (existingCre && hasCreationForJob(apiJob.id)) {
        removePendingJob(pending.id);
        clearSessionGenJob(apiJob.id);
        return true;
      }
      await d().ensureGenJobCreationsFromPoll(
        {
          data: {
            status: 'completed',
            imageUrl: apiJob.imageUrl,
            extraImageUrls: apiJob.extraImageUrls
          }
        },
        { ...ctx, jobId: apiJob.id, isRecovery: true },
        pending.id
      );
      clearSessionGenJob(apiJob.id);
      return true;
    }

    if (apiJob.status === 'failed') {
      const refreshed = await refreshGenerationJobFromServer(apiJob);
      if (refreshed.status === 'completed' && refreshed.imageUrl) {
        return resolvePendingFromApiJob(pending, refreshed, opts);
      }
      if (shouldDeferFailedPendingRecovery(pending, refreshed, ctx)) {
        if (await tryServerRecoverPending(pending)) return true;
        pending.recovering = true;
        pending.recoverNote = formatPendingRecoveryNote(pending, '上游可能仍在出图，后台继续恢复…');
        persistPendingGenJobs();
        if (pending.jobId && Date.now() - (pending.startedAt || 0) >= SERVER_RECOVER_AFTER_MS) {
          void tryRecoverPendingJobDirect(pending);
        }
        if (!activePollJobIds.has(pending.jobId)) {
          void pollGenerationJobUntilDone(pending.jobId, pending.id, ctx);
        }
        scheduleImageGenPendingUiRefresh();
        return false;
      }
      await failPendingJobImmediately(
        pending.id,
        ctx,
        refreshed.errorMessage || apiJob.errorMessage || apiJob.message || '生图失败'
      );
      clearSessionGenJob(apiJob.id);
      return true;
    }

    if (
      pending.recovering
      && Date.now() - (pending.startedAt || 0) >= pendingRecoveryGiveUpMs(pending)
    ) {
      if (await tryServerRecoverPending(pending)) return true;
      if (apiJob.status === 'processing') {
        if (!activePollJobIds.has(apiJob.id)) {
          void pollGenerationJobUntilDone(apiJob.id, pending.id, ctx);
        }
        return false;
      }
      const retry = await window.PromptHubApi.getGenerationJob(apiJob.id);
      if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
        return resolvePendingFromApiJob(pending, {
          id: apiJob.id,
          status: 'completed',
          imageUrl: retry.data.imageUrl,
          extraImageUrls: retry.data.extraImageUrls,
          prompt: pending.prompt,
          model: pending.model
        }, opts);
      }
      if (retry.ok && retry.data.status === 'processing') {
        if (!activePollJobIds.has(apiJob.id)) {
          void pollGenerationJobUntilDone(apiJob.id, pending.id, ctx);
        }
        return false;
      }
      if (retry.ok && retry.data.status === 'failed') {
        const failSnap = {
          id: apiJob.id,
          status: 'failed',
          errorMessage: retry.data.errorMessage || retry.data.message,
          prompt: pending.prompt,
          model: pending.model
        };
        if (shouldDeferFailedPendingRecovery(pending, failSnap, ctx)) {
          if (await tryServerRecoverPending(pending)) return true;
          return false;
        }
        await failPendingJobImmediately(
          pending.id,
          ctx,
          failSnap.errorMessage || '生图失败'
        );
        clearSessionGenJob(apiJob.id);
        return true;
      }
      if (await tryServerRecoverPending(pending)) return true;
      if (Date.now() - (pending.startedAt || 0) < RECENT_GEN_RECOVER_MS) return false;
      await failPendingJobImmediately(pending.id, ctx, '生图超时或上游无结果，积分已全额退回');
      clearSessionGenJob(apiJob.id);
      return true;
    }

    return false;
  }

  async function listRecoverableOrphanJobs(opts = {}) {
    return collectJobsNeedingRecovery(opts);
  }

  async function settleStuckGenerationJob(job, opts = {}) {
    const maxMs = Math.max(8000, opts.maxMs ?? 18000);
    const stepMs = opts.stepMs ?? 2200;
    let live = { ...job };
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      live = await refreshGenerationJobFromServer(live);
      if (live.status === 'completed' && live.imageUrl) return live;
      if (live.status === 'failed') return live;
      if (live.status !== 'processing') break;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return live;
  }

  async function recoverSingleJobFromApi(job, opts = {}) {
    if (!job?.id) return false;
    if (d().isGenerationJobDeleted(job.id)) return false;
    const force = opts.force === true;
    const awaitSettle = opts.awaitSettle === true;
    let live = await refreshGenerationJobFromServer(job);

    if (awaitSettle && (live.status === 'processing' || !live.imageUrl)) {
      live = await settleStuckGenerationJob(live, {
        maxMs: opts.settleMaxMs ?? (awaitSettle ? 16000 : 18000),
        stepMs: 2200
      });
    } else if (live.status === 'processing' || live.status === 'failed' || !live.imageUrl) {
      live = await refreshGenerationJobFromServer(live);
    }

    if (live.status === 'failed') {
      const settled = await refreshGenerationJobFromServer(live);
      if (settled.status === 'completed' && settled.imageUrl) {
        live = settled;
      } else {
        const pending = pendingList().find((p) => p.jobId === live.id);
        if (pending && (force || pending.recovering)) {
          if (await tryServerRecoverPending(pending)) return true;
          if (!force && Date.now() - (pending.startedAt || 0) < pendingRecoveryGiveUpMs(pending)) {
            pending.recovering = true;
            persistPendingGenJobs();
            return false;
          }
        }
        if (pending) {
          await resolvePendingFromApiJob(pending, {
            id: live.id,
            status: 'failed',
            errorMessage: live.errorMessage || live.message || '生图失败',
            prompt: live.prompt,
            model: live.model
          }, opts);
        }
        return false;
      }
    }

    if (live.status !== 'completed' || !live.imageUrl) {
      if (awaitSettle) return false;
      const existing = pendingList().find((p) => p.jobId === live.id);
      const pendingId = existing?.id || d().genId('pending');
      if (!existing) {
        pendingList().unshift({
          id: pendingId,
          jobId: live.id,
          prompt: live.prompt || '',
          model: live.model || 'gpt-image-2',
          modelLabel: live.modelLabel || d().imageGenModelLabel(live.model),
          resolution: live.resolution || '1k',
          quality: live.quality || 'standard',
          size: live.size || '1:1',
          cost: live.creditsCharged || 0,
          startedAt: Date.parse(live.createdAt) || Date.now()
        });
        persistPendingGenJobs();
      }
      if (!activePollJobIds.has(live.id)) {
        void pollGenerationJobUntilDone(live.id, pendingId, {
          prompt: live.prompt || '',
          model: live.model || 'gpt-image-2',
          resolution: live.resolution || '1k',
          quality: live.quality || 'standard',
          size: live.size || '1:1',
          cost: live.creditsCharged || 0,
          jobId: live.id,
          silentToast: opts.silentToast !== false,
          startedAt: Date.parse(live.createdAt) || Date.now()
        });
      }
      return false;
    }
    if (live.status !== 'completed' || !live.imageUrl) return false;
    if (!needsApiImageRecovery(live.id, live.imageUrl, force)) return false;
    const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === live.id);
    if (existingCard) {
      await d().repairWarehouseCardImageFromJob(existingCard, live.imageUrl, live.id);
      setPending(pendingList().filter((p) => p.jobId !== live.id));
      clearSessionGenJob(live.id);
      return true;
    }
    const extras = Array.isArray(live.extraImageUrls)
      ? live.extraImageUrls.filter((u) => u && u !== live.imageUrl)
      : [];
    await d().ensureGenJobCreationsFromPoll(
      { data: { status: 'completed', imageUrl: live.imageUrl, extraImageUrls: extras } },
      {
        prompt: live.prompt || '',
        model: live.model || 'gpt-image-2',
        resolution: live.resolution || '1k',
        quality: live.quality || 'standard',
        size: live.size || '1:1',
        cost: live.creditsCharged || 0,
        jobId: live.id,
        silentToast: opts.silentToast !== false,
        isRecovery: true
      },
      pendingList().find((p) => p.jobId === live.id)?.id || null
    );
    return true;
  }

  async function resumePendingGenerationJobs(opts = {}) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return false;
    if (!window.PointsSystem?.useApiForAccount?.()) return false;
    purgeExpiredGenPendingJobs();
    const now = Date.now();
    if (!opts.force && now - lastGenJobsListAt < (pendingList().length > 0 ? 4000 : GEN_JOBS_LIST_MIN_MS)) return false;
    if (resumeGenJobsInflight) return resumeGenJobsInflight;

    resumeGenJobsInflight = (async () => {
      lastGenJobsListAt = Date.now();
      const r = await window.PromptHubApi.listRecentGenerationJobs();
      if (!r?.ok || !Array.isArray(r.data?.jobs)) return false;

      let changed = false;
      const apiById = new Map();
      const attachedJobIds = new Set();

      for (const job of r.data.jobs) {
        if (job?.id) apiById.set(job.id, job);
      }

      /** 所有 pending 任务强制拉最新状态（不受 list 轮询预算限制） */
      const pendingJobIds = [...new Set(
        pendingList().map((p) => p.jobId).filter(Boolean)
      )];
      for (const jobId of pendingJobIds) {
        const pending = pendingList().find((p) => p.jobId === jobId);
        if (!pending) continue;
        const pendingAge = Date.now() - (pending.startedAt || 0);
        const ctx = pendingJobToPollCtx(pending);
        try {
          const retry = await window.PromptHubApi.getGenerationJob(jobId, {
            settle: isLongRunningGenJob(ctx) && pendingAge > 60_000
          });
          if (!retry.ok) continue;
          const aj = {
            id: jobId,
            status: retry.data.status,
            imageUrl: retry.data.imageUrl,
            extraImageUrls: retry.data.extraImageUrls,
            errorMessage: retry.data.errorMessage || retry.data.message,
            prompt: pending.prompt,
            model: pending.model,
            resolution: pending.resolution,
            quality: pending.quality,
            size: pending.size
          };
          apiById.set(jobId, aj);
          if (aj.status === 'completed' && aj.imageUrl) {
            pending.recovering = false;
            pending.recoverNote = '';
            if (await resolvePendingFromApiJob(pending, aj, { silent: true })) changed = true;
          } else if (
            aj.status === 'failed'
            && !ge('isLikelyRecoverableGenFailure', aj.errorMessage, ctx)
          ) {
            if (await resolvePendingFromApiJob(pending, aj, { silent: true })) changed = true;
          }
        } catch (e) { /* ignore */ }
      }

      const refreshTargets = r.data.jobs.filter((j) => {
        if (!j?.id || d().isGenerationJobDeleted(j.id)) return false;
        if (j.status !== 'processing' && !(j.status === 'completed' && !j.imageUrl)) return false;
        const age = Date.now() - (Date.parse(j.createdAt) || 0);
        return pendingList().some((p) => p.jobId === j.id)
          || isSessionGenJob(j.id)
          || age > 4 * 60 * 1000;
      }).slice(0, 6);
      for (const job of refreshTargets) {
        const live = await refreshGenerationJobFromServer(job);
        apiById.set(job.id, live);
      }

      /** 按提示词+模型匹配 API 任务（无 jobId 的旧占位；取最新/进行中） */
      function matchApiJobForPending(p) {
        if (p.jobId && apiById.has(p.jobId)) return apiById.get(p.jobId);
        return findBestApiJobForPrompt(r.data.jobs, p.prompt, p.model, {
          minCreatedAt: p.startedAt || Date.now(),
          preferProcessing: true,
          resolution: p.resolution
        });
      }

      for (const pending of pendingList().slice()) {
        if (pendingHasCreation(pending)) {
          removePendingJob(pending.id);
          if (pending.jobId) clearSessionGenJob(pending.jobId);
          changed = true;
          continue;
        }
        if (!pending.jobId) {
          const matched = matchApiJobForPending(pending);
          if (matched?.id) {
            pending.jobId = matched.id;
            trackSessionGenJob(matched.id);
            persistPendingGenJobs();
          }
        }
        if (!pending.jobId) {
          if (Date.now() - (pending.startedAt || 0) > 20 * 60 * 1000) {
            failPendingJob(pending.id, '未找到对应任务，积分已全额退回');
            changed = true;
          }
          continue;
        }
        let aj = apiById.get(pending.jobId);
        const pendingAge = Date.now() - (pending.startedAt || 0);
        const pollCtx = pendingJobToPollCtx(pending);
        if (pending.jobId && (!aj || aj.status === 'processing' || pendingAge > 20_000)) {
          try {
            const retry = await window.PromptHubApi.getGenerationJob(pending.jobId, {
              settle: isLongRunningGenJob(pollCtx) && pendingAge > 60_000
            });
            if (retry.ok) {
              aj = {
                id: pending.jobId,
                status: retry.data.status,
                imageUrl: retry.data.imageUrl,
                extraImageUrls: retry.data.extraImageUrls,
                errorMessage: retry.data.errorMessage || retry.data.message,
                prompt: pending.prompt,
                model: pending.model
              };
              apiById.set(pending.jobId, aj);
            }
          } catch (e) { /* ignore */ }
        }
        if (aj && aj.status !== 'processing') {
          if (await resolvePendingFromApiJob(pending, aj)) changed = true;
          continue;
        }
        const deferAge = Date.now() - (pending.startedAt || 0);
        if (pending.recovering && deferAge >= pendingRecoveryGiveUpMs(pending) && aj?.status === 'processing') {
          if (!activePollJobIds.has(pending.jobId)) {
            void pollGenerationJobUntilDone(pending.jobId, pending.id, pendingJobToPollCtx(pending));
          }
          continue;
        }
        if (pending.recovering && pending.jobId && !activePollJobIds.has(pending.jobId)) {
          const retry = await window.PromptHubApi.getGenerationJob(pending.jobId, {
            settle: isLongRunningGenJob(pendingJobToPollCtx(pending)) && pendingAge > 60_000
          });
          if (retry.ok) {
            const snap = {
              id: pending.jobId,
              status: retry.data.status,
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls,
              errorMessage: retry.data.errorMessage || retry.data.message,
              prompt: pending.prompt,
              model: pending.model
            };
            apiById.set(pending.jobId, snap);
            if (await resolvePendingFromApiJob(pending, snap)) {
              changed = true;
              continue;
            }
            if (retry.data.status === 'processing' && !activePollJobIds.has(pending.jobId)) {
              void pollGenerationJobUntilDone(pending.jobId, pending.id, pendingJobToPollCtx(pending));
            }
          }
        }
      }

      for (const job of pendingList().slice()) {
        if (!job.jobId || activePollJobIds.has(job.jobId)) continue;
        if (Date.now() - (job.startedAt || 0) >= RECENT_GEN_RECOVER_MS) {
          abandonUnrecoverablePendingJob(
            job,
            '该任务已超过 2 小时恢复窗口，已关闭占位',
            { toast: true }
          );
          if (job.jobId) window.recordGenerationJobDeletion?.(job.jobId);
          changed = true;
          continue;
        }
        const aj = apiById.get(job.jobId);
        if (aj?.status === 'processing') {
          void pollGenerationJobUntilDone(job.jobId, job.id, pendingJobToPollCtx(job));
        }
      }

      for (const job of r.data.jobs) {
        if (!job?.id || job.status !== 'failed') continue;
        const pending = pendingList().find((p) => p.jobId === job.id);
        if (!pending) continue;
        if (await resolvePendingFromApiJob(pending, job, { silent: true })) changed = true;
      }

      for (const job of r.data.jobs) {
        if (!job?.id || job.status !== 'failed') continue;
        if (!isSessionGenJob(job.id)) continue;
        if (pendingList().some((p) => p.jobId === job.id)) continue;
        if (failedList().some((f) => f.jobId === job.id)) continue;
        if (hasCreationForJob(job.id)) continue;
        const live = apiById.get(job.id) || job;
        const failCtx = {
          model: live.model || job.model,
          resolution: live.resolution || job.resolution
        };
        if (ge('isLikelyRecoverableGenFailure', live.errorMessage || job.errorMessage, failCtx)) continue;
        addFailedGenJob({
          jobId: job.id,
          prompt: job.prompt || live.prompt,
          model: job.model || live.model,
          modelLabel: job.modelLabel || live.modelLabel,
          errorMessage: live.errorMessage || job.errorMessage || '生图失败'
        });
        changed = true;
      }

      for (const job of r.data.jobs) {
        if (!job?.id) continue;
        if (d().isGenerationJobDeleted(job.id)) continue;

        if (job.status === 'processing') {
          if (hasCreationForJob(job.id)) {
            const stale = pendingList().find((j) => j.jobId === job.id);
            if (stale) {
              removePendingJob(stale.id);
              clearSessionGenJob(job.id);
              changed = true;
            }
            continue;
          }
          const jobAge = Date.now() - (Date.parse(job.createdAt) || 0);
          if (jobAge >= RECENT_GEN_RECOVER_MS) {
            if (job.status === 'processing' && !hasCreationForJob(job.id)) {
              window.recordGenerationJobDeletion?.(job.id);
            }
            continue;
          }
          if (jobAge > 12 * 60 * 1000) {
            const settled = await settleStuckGenerationJob(apiById.get(job.id) || job, { maxMs: 12000 });
            if (settled.status === 'completed' && settled.imageUrl) {
              if (await recoverSingleJobFromApi(settled, { silentToast: true, force: true })) {
                changed = true;
                continue;
              }
            }
          }
          const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);
          if (existingCard && !existingCard.image && job.imageUrl) {
            await d().repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
            setPending(pendingList().filter((p) => p.jobId !== job.id));
            clearSessionGenJob(job.id);
            changed = true;
            continue;
          }
          const hasCreation = creations().some((c) => c.jobId === job.id);
          if (hasCreation) continue;
          let pending = pendingList().find((j) => j.jobId === job.id);
          if (!pending) {
            const pendingId = d().genId('pending');
            pending = {
              id: pendingId,
              jobId: job.id,
              prompt: job.prompt || '',
              model: job.model || 'gpt-image-2',
              modelLabel: job.modelLabel || d().imageGenModelLabel(job.model),
              resolution: job.resolution || '1k',
              quality: job.quality || 'standard',
              size: job.size || '1:1',
              cost: job.creditsCharged || 0,
              startedAt: Date.parse(job.createdAt) || Date.now()
            };
            pendingList().unshift(pending);
            trackSessionGenJob(job.id);
            changed = true;
          }
          if (Date.now() - (pending.startedAt || 0) >= RECENT_GEN_RECOVER_MS) {
            abandonUnrecoverablePendingJob(pending, null, { toast: false });
            window.recordGenerationJobDeletion?.(job.id);
            changed = true;
            continue;
          }
          attachedJobIds.add(job.id);
          clearFailedGenJobsForRecovery({
            prompt: job.prompt,
            model: job.model,
            jobId: job.id
          });
          if (!activePollJobIds.has(job.id)) {
            void pollGenerationJobUntilDone(job.id, pending.id, pendingJobToPollCtx(pending));
          }
          continue;
        }

        let recoverJob = job;
        if (job.status === 'failed') {
          let pendingJob = pendingList().find((j) => j.jobId === job.id);
          const retry = await window.PromptHubApi.getGenerationJob(job.id);
          if (retry.ok && retry.data.status === 'processing') {
            if (!pendingJob) {
              const pendingId = d().genId('pending');
              const newPending = {
                id: pendingId,
                jobId: job.id,
                prompt: job.prompt || '',
                model: job.model || 'gpt-image-2',
                modelLabel: job.modelLabel || d().imageGenModelLabel(job.model),
                resolution: job.resolution || '1k',
                quality: job.quality || 'standard',
                size: job.size || '1:1',
                cost: job.creditsCharged || 0,
                startedAt: Date.parse(job.createdAt) || Date.now()
              };
              pendingList().unshift(newPending);
              trackSessionGenJob(job.id);
              pendingJob = newPending;
              changed = true;
            }
            attachedJobIds.add(job.id);
            clearFailedGenJobsForRecovery({
              prompt: job.prompt,
              model: job.model,
              jobId: job.id
            });
            if (!activePollJobIds.has(job.id)) {
              void pollGenerationJobUntilDone(job.id, pendingJob.id, pendingJobToPollCtx(pendingJob));
            }
            continue;
          }
          if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
            recoverJob = {
              ...job,
              status: 'completed',
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls
            };
          } else if (pendingJob) {
            if (await resolvePendingFromApiJob(pendingJob, {
              id: job.id,
              status: 'failed',
              errorMessage: retry.ok
                ? (retry.data.errorMessage || retry.data.message)
                : (job.errorMessage || '生图失败'),
              prompt: job.prompt,
              model: job.model
            })) {
              changed = true;
            }
            continue;
          } else {
            continue;
          }
        }
        if (recoverJob.status !== 'completed' || !recoverJob.imageUrl) continue;

        const recoverCtx = {
          prompt: recoverJob.prompt || '',
          model: recoverJob.model || 'gpt-image-2',
          resolution: recoverJob.resolution || '1k',
          quality: recoverJob.quality || 'standard',
          size: recoverJob.size || '1:1',
          cost: recoverJob.creditsCharged || 0
        };
        if (await d().syncMissingBonusImagesForJob(recoverJob, recoverCtx, { silentToast: false })) {
          changed = true;
          attachedJobIds.add(recoverJob.id);
          continue;
        }

        if (!shouldAutoRecoverCompletedJob(recoverJob)) continue;

        const existingCre = findCreationForJob(recoverJob.id);
        if (existingCre && hasCreationForJob(recoverJob.id)) continue;
        const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === recoverJob.id);
        const recoverExtrasEarly = Array.isArray(recoverJob.extraImageUrls)
          ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
          : [];
        if (
          !existingCard
          && creations().some(
            (c) => c.jobId === recoverJob.id || String(c.jobId || '').startsWith(`${recoverJob.id}#`)
          )
        ) {
          if (!hasCreationForJob(recoverJob.id)) {
            changed = true;
            attachedJobIds.add(recoverJob.id);
            setPending(pendingList().filter((p) => p.jobId !== recoverJob.id));
            await d().ensureGenJobCreationsFromPoll(
              { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: recoverExtrasEarly } },
              {
                prompt: recoverJob.prompt || '',
                model: recoverJob.model || 'gpt-image-2',
                resolution: recoverJob.resolution || '1k',
                quality: recoverJob.quality || 'standard',
                size: recoverJob.size || '1:1',
                cost: recoverJob.creditsCharged || 0,
                jobId: recoverJob.id,
                silentToast: true,
                isRecovery: true
              },
              null
            );
          } else if (!d().allGenCreationSlotsSaved(recoverJob.id, recoverExtrasEarly.length)) {
            changed = true;
            attachedJobIds.add(recoverJob.id);
            setPending(pendingList().filter((p) => p.jobId !== recoverJob.id));
            await d().ensureGenJobCreationsFromPoll(
              { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: recoverExtrasEarly } },
              {
                prompt: recoverJob.prompt || '',
                model: recoverJob.model || 'gpt-image-2',
                resolution: recoverJob.resolution || '1k',
                quality: recoverJob.quality || 'standard',
                size: recoverJob.size || '1:1',
                cost: recoverJob.creditsCharged || 0,
                jobId: recoverJob.id,
                silentToast: true,
                isRecovery: true
              },
              null
            );
          }
          continue;
        }

        changed = true;
        attachedJobIds.add(recoverJob.id);
        setPending(pendingList().filter((p) => p.jobId !== recoverJob.id));
        if (existingCard && !existingCard.image) {
          await d().repairWarehouseCardImageFromJob(existingCard, recoverJob.imageUrl, recoverJob.id);
          continue;
        }
        const recoverExtras = Array.isArray(recoverJob.extraImageUrls)
          ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
          : [];
        await d().finishImageGenRun({
          prompt: recoverJob.prompt || '',
          model: recoverJob.model || 'gpt-image-2',
          resolution: recoverJob.resolution || '1k',
          quality: recoverJob.quality || 'standard',
          size: recoverJob.size || '1:1',
          cost: recoverJob.creditsCharged || 0,
          jobId: recoverJob.id,
          image: recoverJob.imageUrl,
          extraImages: recoverExtras,
          silentToast: true,
          isRecovery: true
        });
      }

      // 无 jobId 的占位（提交中）：尝试按提示词匹配 API 进行中任务
      const processingOnApi = r.data.jobs.filter(
        (j) => j?.id && j.status === 'processing' && !attachedJobIds.has(j.id) && !d().isGenerationJobDeleted(j.id)
      );
      for (const p of pendingList().filter((x) => !x.jobId)) {
        if (Date.now() - (p.startedAt || 0) > 15 * 60 * 1000) continue;
        const match = findBestApiJobForPrompt(processingOnApi, p.prompt, p.model, {
          minCreatedAt: p.startedAt || Date.now(),
          usedJobIds: attachedJobIds,
          preferProcessing: true,
          resolution: p.resolution
        });
        if (!match || attachedJobIds.has(match.id)) continue;
        p.jobId = match.id;
        trackSessionGenJob(match.id);
        attachedJobIds.add(match.id);
        changed = true;
        if (!activePollJobIds.has(match.id)) {
          void pollGenerationJobUntilDone(match.id, p.id, pendingJobToPollCtx(p));
        }
      }

      const before = pendingList().length;
      for (const p of pendingList().slice()) {
        if (!p.jobId) continue;
        const aj = apiById.get(p.jobId);
        if (aj && aj.status !== 'processing') {
          await resolvePendingFromApiJob(p, aj);
        }
      }
      setPending(pendingList().filter((p) => {
        if (p.recovering) {
          if (p.jobId) return Date.now() - (p.startedAt || 0) < RECENT_GEN_RECOVER_MS;
          return Date.now() - (p.startedAt || 0) < 30 * 60 * 1000;
        }
        if (!p.jobId) {
          return Date.now() - (p.startedAt || 0) < 15 * 60 * 1000;
        }
        const aj = apiById.get(p.jobId);
        if (!aj) {
          return Date.now() - (p.startedAt || 0) < RECENT_GEN_RECOVER_MS;
        }
        if (aj.status === 'failed') {
          return false;
        }
        if (aj.status === 'completed') return false;
        return aj.status === 'processing';
      }));
      if (pendingList().length !== before) {
        persistPendingGenJobs();
        changed = true;
      } else if (changed) {
        persistPendingGenJobs();
      }

      if (changed) {
        afterGenJobsResume(true);
      }

      for (const p of pendingList().slice()) {
        if (!p.jobId) continue;
        const age = Date.now() - (p.startedAt || 0);
        const slowPending = ge('isSlowGenProviderModel', p.model);
        const needsServerRecover = (p.recovering || slowPending) && age >= SERVER_RECOVER_AFTER_MS;
        if (needsServerRecover) {
          if (p.recovering) {
            p.recoverNote = formatPendingRecoveryNote(p, p.recoverNote || '后台恢复中');
          } else if (slowPending) {
            p.pendingNote = formatPendingRecoveryNote(p, p.pendingNote || '后台生成中');
          }
          persistPendingGenJobs();
          if (!p._serverRecoverAt || Date.now() - p._serverRecoverAt > 5 * 60 * 1000) {
            p._serverRecoverAt = Date.now();
            if (await tryRecoverPendingJobDirect(p)) {
              changed = true;
              continue;
            }
          }
        }
        if (!p.recovering && !slowPending) continue;
        if (age < pendingRecoveryGiveUpMs(p)) continue;
        try {
          const retry = await window.PromptHubApi.getGenerationJob(p.jobId);
          if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
            if (await resolvePendingFromApiJob(p, {
              id: p.jobId,
              status: 'completed',
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls,
              prompt: p.prompt,
              model: p.model
            }, { silent: true })) {
              changed = true;
              continue;
            }
            if (await tryServerRecoverPending(p)) {
              changed = true;
              continue;
            }
          }
          if (retry.ok && retry.data.status === 'processing') {
            if (!activePollJobIds.has(p.jobId)) {
              void pollGenerationJobUntilDone(p.jobId, p.id, pendingJobToPollCtx(p));
            }
            continue;
          }
          if (await recoverSingleJobFromApi({ id: p.jobId, prompt: p.prompt, model: p.model }, { silentToast: true, force: true })) {
            changed = true;
            continue;
          }
          if (await tryServerRecoverPending(p)) {
            changed = true;
            continue;
          }
        } catch (e) { /* ignore */ }
        if (age >= RECENT_GEN_RECOVER_MS) {
          abandonUnrecoverablePendingJob(
            p,
            '上游临时链接约 2 小时有效，该任务已过期，无法恢复（可点 × 关闭占位）',
            { toast: true }
          );
          if (p.jobId) window.recordGenerationJobDeletion?.(p.jobId);
          changed = true;
        }
      }
      if (changed) {
        persistPendingGenJobs();
        d().renderImageGenFeed({ preserveScroll: true });
      }

      return changed;
    })().finally(() => {
      resumeGenJobsInflight = null;
    });

    return resumeGenJobsInflight;
  }

  function init(injected) {
    deps = injected || {};
    return {
      LS_SESSION_GEN_JOBS,
      LS_PENDING_GEN_JOBS,
      LS_FAILED_GEN_JOBS,
      LS_GEN_JOBS_STATE,
      getActivePollJobIds: () => activePollJobIds,
      loadPendingGenJobs,
      loadFailedGenJobs,
      persistPendingGenJobs,
      persistFailedGenJobs,
      getSessionGenJobIds,
      trackSessionGenJob,
      clearSessionGenJob,
      isSessionGenJob,
      removePendingJob,
      addFailedGenJob,
      removeFailedGenJob,
      clearFailedGenJobsForRecovery,
      failPendingJob,
      pendingJobToPollCtx,
      pollGenerationJobUntilDone,
      deferPendingJobRecovery,
      tryRecoverOrphanGenJobAfterSubmitError,
      scheduleGenJobsSync,
      startGenJobsBackgroundSync,
      recoverRecentGenerationJobs,
      shouldDeferFailedPendingRecovery,
      purgeExpiredGenPendingJobs,
      abandonUnrecoverablePendingJob,
      scheduleImageGenPendingUiRefresh,
      afterGenJobsResume,
      getLastGenJobsListAt: () => lastGenJobsListAt,
      setLastGenJobsListAt: (v) => { lastGenJobsListAt = v; },
      getResumeGenJobsInflight: () => resumeGenJobsInflight,
      setResumeGenJobsInflight: (v) => { resumeGenJobsInflight = v; },
      resumePendingGenerationJobs,
      resolvePendingFromApiJob,
      tryRecoverPendingJobDirect,
      tryServerRecoverPending,
      recoverSingleJobFromApi,
      refreshGenerationJobFromServer,
      collectJobsNeedingRecovery,
      settleStuckGenerationJob,
      needsApiImageRecovery,
      findWarehouseCardForJob,
      findCreationForJob,
      hasCreationForJob,
      prunePendingJobsWithCreations,
      pendingHasCreation,
      pendingHasWarehouseCard: pendingHasCreation,
      findWarehouseCardForPending,
      shouldAutoRecoverCompletedJob,
      prunePendingJobsWithWarehouseCards,
      findBestApiJobForPrompt,
      pendingPromptsMatch,
      listRecoverableOrphanJobs,
      isRecentGenJob
    };
  }


  global.ImageGenJobRunner = { init };
})(typeof window !== 'undefined' ? window : globalThis);
