/**
 * 生图提交入口：鉴权、扣费、调 API、同步/异步入库
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }
  function GE() { return global.ImageGenGenErrors || {}; }

  function ge(name, ...args) {
    const fn = GE()[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function waitForSubmitPaint() {
    if (typeof global.requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
      global.requestAnimationFrame(() => global.requestAnimationFrame(resolve));
    });
  }

  function shouldRenderSubmitFeed() {
    return !d().isImageGenMobileFormActive?.();
  }

  function renderSubmitFeed(opts = { preserveScroll: true }) {
    if (!shouldRenderSubmitFeed()) return;
    d().renderImageGenFeed(opts);
  }

  function showQueuedSubmitFeedback(silent) {
    if (silent) return;
    const message = '已加入作品，正在生成';
    if (typeof global.showQuickToast === 'function') {
      global.showQuickToast(message, 900);
      return;
    }
    d().toast(message, 900);
  }

  function showSubmitFailureFeedback(silent) {
    if (silent) return;
    const message = '任务未完成，可重新生成';
    if (typeof global.showQuickToast === 'function') {
      global.showQuickToast(message, 1200);
      return;
    }
    d().toast(message, 1200);
  }

  function normalizeReferenceAssets(refs, assets, fallback = {}) {
    const list = Array.isArray(refs) ? refs.filter(Boolean) : [];
    const sourceAssets = Array.isArray(assets) ? assets : [];
    return list.map((ref, index) => {
      const matched = sourceAssets.find((a) => a && (a.ref === ref || a.imageRef === ref)) || sourceAssets[index] || {};
      return {
        ref,
        sourceCardId: String(matched.sourceCardId || matched.cardId || fallback.sourceCardId || fallback.assetId || '').trim() || null,
        jobId: String(matched.jobId || fallback.jobId || '').trim() || null,
        source: String(matched.source || fallback.source || '').trim() || null
      };
    });
  }

  function normalizeClientRequestId(value) {
    const normalized = String(value || '')
      .replace(/[^A-Za-z0-9._:-]+/g, '_')
      .slice(0, 128);
    return normalized.length >= 8 ? normalized : `web.image.${normalized || Date.now()}`;
  }

  function runImageGenBatchTasks(count, taskFactory) {
    const total = Math.min(5, Math.max(1, Math.floor(Number(count)) || 1));
    const tasks = [];
    for (let index = 0; index < total; index += 1) {
      try {
        // Invoke every task synchronously so all optimistic cards exist before
        // waiting for any quote or generation response.
        tasks.push(Promise.resolve(taskFactory(index, total)));
      } catch (error) {
        tasks.push(Promise.reject(error));
      }
    }
    return Promise.allSettled(tasks);
  }

  async function runImageGenWithPrompt(promptOverride, opts) {
    const batchOpts = opts && typeof opts === 'object' ? opts : {};
    if (!global.AuthGate?.requireAuth?.('imagegen')) return { ok: false };
    const meta = d().getImageGenFormMeta();
    const { model, resolution, quality, size } = meta;
    const mjBlendMode = d().isImageGenMidjourneyModel?.(model) && d().getImageGenMjMode?.() === 'blend';
    const prompt = String(
      promptOverride ?? global.document.getElementById('imageGenPrompt')?.value ?? ''
    ).trim();
    if (!prompt && !mjBlendMode) {
      d().toast('请先填写提示词');
      return { ok: false };
    }
    if (mjBlendMode && !batchOpts.batch) {
      const refCount = (d().getImageGenRefImages?.() || []).filter(Boolean).length;
      if (refCount < 2) {
        d().toast('混图需要参考图框内 2～5 张图');
        return { ok: false };
      }
    }
    if (!d().getImageGenModelCatalogReady?.() || !global.document.getElementById('imageGenModel')?.value) {
      d().toast('模型列表加载中，请稍候再点生成');
      return { ok: false };
    }

    let cost = global.PointsSystem?.getImageGenCost?.(
      model,
      resolution,
      quality,
      meta.mjParams?.speed
    ) ?? 10;
    let quotedCredits = cost;
    let balance = global.PointsSystem?.getCredits?.() ?? 0;
    const useApi = global.PointsSystem?.useApiForAccount?.();
    if (balance < cost) {
      d().toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
      return { ok: false, reason: 'credits' };
    }

    const btn = global.document.getElementById(batchOpts.submitBtnId || 'imageGenSubmit');
    const singleRun = !batchOpts.batch;
    if (singleRun && btn?.disabled && !d().getImageGenBatchRunning?.()) {
      btn.disabled = false;
    }
    if (singleRun && btn) {
      if (btn.__imageGenSubmitResetTimer && typeof global.clearTimeout === 'function') {
        global.clearTimeout(btn.__imageGenSubmitResetTimer);
        btn.__imageGenSubmitResetTimer = null;
      }
      btn.disabled = true;
      btn.classList.remove('is-submitted');
      btn.classList.add('is-submitting');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = '正在准备…';
    }

    let pendingId = null;
    let submitAccepted = false;
    let submitUiReleased = false;
    const releaseSubmitUi = (accepted = submitAccepted) => {
      if (!singleRun || submitUiReleased) return;
      submitUiReleased = true;
      if (btn) {
        btn.classList.remove('is-submitting');
        btn.removeAttribute('aria-busy');
        if (accepted) {
          btn.classList.add('is-submitted');
          btn.textContent = '已加入作品';
          btn.disabled = true;
          const reset = () => {
            btn.__imageGenSubmitResetTimer = null;
            btn.classList.remove('is-submitted');
            btn.disabled = false;
            d().restoreImageGenSubmitLabel();
          };
          if (typeof global.setTimeout === 'function') {
            btn.__imageGenSubmitResetTimer = global.setTimeout(
              reset,
              d().getSubmitSuccessHoldMs?.() ?? 720
            );
          } else {
            reset();
          }
        } else {
          btn.classList.remove('is-submitted');
          btn.disabled = false;
          d().restoreImageGenSubmitLabel();
        }
      }
    };
    const markSubmitQueuedUi = () => {
      if (!singleRun || !btn || submitUiReleased) return;
      btn.classList.remove('is-submitting');
      btn.classList.add('is-submitted');
      btn.removeAttribute('aria-busy');
      btn.textContent = '已加入作品';
      btn.disabled = true;
    };
    const scheduleQueuedUiConfirmation = () => {
      if (!singleRun) return;
      markSubmitQueuedUi();
    };
    try {
      const modelLabel = global.PointsSystem?.getImageGenModel?.(model)?.label || model;
      pendingId = d().genId('pending');
      const clientRequestId = normalizeClientRequestId(
        batchOpts.clientRequestId || `web.image.${pendingId}`
      );
      const saveTarget = d().getImageGenSaveTarget();
      const submittedRefImages = batchOpts.skipRefImages
        ? []
        : (Array.isArray(batchOpts.refImages) && batchOpts.refImages.length
          ? batchOpts.refImages
          : (d().getImageGenRefImages?.() || []))
          .filter(Boolean);
      const submittedRefImage = submittedRefImages[0] || (!batchOpts.skipRefImages ? d().getImageGenPrimaryRef?.() : null) || null;
      const submittedReferenceAssets = batchOpts.skipRefImages
        ? []
        : normalizeReferenceAssets(
          submittedRefImages,
          Array.isArray(batchOpts.referenceAssets)
            ? batchOpts.referenceAssets
            : (d().getImageGenReferenceAssets?.() || []),
          {
            assetId: batchOpts.assetId,
            sourceCardId: batchOpts.sourceCardId,
            jobId: batchOpts.jobId,
            source: 'form'
          }
        );
      const pendingJob = {
        id: pendingId,
        clientRequestId,
        prompt,
        model,
        modelLabel,
        resolution,
        quality,
        size,
        cost,
        targetGroup: saveTarget.targetGroup,
        targetTags: saveTarget.targetTags,
        cardTitle: batchOpts.cardTitle ?? d().getImageGenCardTitle?.() ?? '',
        batchMergeCards: !!(
          batchOpts.batch
          && batchOpts.batchTotal > 1
          && batchOpts.batchMergeCards !== false
          && !d().isImageGenMidjourneyModel?.(model)
        ),
        fromInspirationDraw: !!batchOpts.fromInspirationDraw,
        batchIndex: batchOpts.batchIndex || null,
        batchTotal: batchOpts.batchTotal || null,
        batchId: batchOpts.batchId || null,
        silentToast: !!batchOpts.silentToast,
        refImage: submittedRefImage,
        refImages: submittedRefImages.length ? [...submittedRefImages] : null,
        referenceAssets: submittedReferenceAssets.length ? submittedReferenceAssets : null,
        submitPhase: 'local',
        startedAt: Date.now()
      };
      d().unshiftPendingJob(pendingJob);
      d().switchImageGenFeedToRecent();
      d().updateImageGenFeedHint();
      showQueuedSubmitFeedback(batchOpts.silentToast);

      const inserted = d().renderImageGenPendingNow?.(pendingJob);
      if (!inserted) d().renderImageGenFeed({ preserveScroll: true, force: true });
      if (d().isImageGenMobileFormActive?.()) {
        global.MobileUI?.setImageGenView?.('feed', {
          scrollToTop: true,
          deferRefresh: true
        });
      }
      scheduleQueuedUiConfirmation();

      // Every batch task reaches this point synchronously, so all optimistic
      // cards are inserted first. Their paint waits run in parallel and keep
      // storage/network work out of the first visible feedback frame.
      await waitForSubmitPaint();

      const shouldPersistInitialBatchState = !batchOpts.batch || !batchOpts.batchIndex || batchOpts.batchIndex === 1;
      if (shouldPersistInitialBatchState) {
        d().persistPendingGenJobs();
        d().saveImageGenDraft({
          prompt,
          model,
          refImages: d().getImageGenRefImages?.() || [],
          refImage: d().getImageGenPrimaryRef?.(),
          referenceAssets: d().getImageGenReferenceAssets?.() || [],
          resolution,
          quality,
          size,
          count: d().getImageGenBatchCount?.(),
          cardTitle: d().getImageGenCardTitle?.(),
          batchSplit: d().isImageGenBatchSplitCards?.(),
          mjMode: d().getImageGenMjMode?.(),
          mjSaveAllTiles: d().isImageGenMjSaveAllTiles?.(),
          mjSpeed: d().getImageGenMjSpeed?.(),
          mjExtras: d().getImageGenMjExtrasValue?.()
        });
      }

      if (useApi) {
        const localCost = cost;
        const quoted = await Promise.race([
          d().quoteGenerationCost(
            resolution,
            quality,
            model,
            cost,
            meta.mjParams?.speed ? { speed: meta.mjParams.speed } : undefined
          ),
          new Promise((resolve) => {
            setTimeout(() => resolve({ cost: localCost, fromApi: false }), d().getGenCostQuoteTimeoutMs?.() ?? 1800);
          })
        ]);
        cost = quoted.cost;
        quotedCredits = Number.isFinite(Number(quoted.quotedCredits))
          ? Number(quoted.quotedCredits)
          : cost;
        pendingJob.cost = cost;
        d().persistPendingGenJobs();
        balance = global.PointsSystem?.getCredits?.() ?? 0;
      }

      if (balance < cost) {
        d().removePendingJob(pendingId);
        renderSubmitFeed({ preserveScroll: true });
        d().toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      if (!useApi && !global.PointsSystem?.deductCredits?.(cost)) {
        d().removePendingJob(pendingId);
        renderSubmitFeed({ preserveScroll: true });
        d().toast('积分扣除失败');
        return { ok: false };
      }

      if (useApi) {
        const refSources = submittedRefImages;
        const refUrls = await d().resolveRefUrlsFromList(refSources, submittedReferenceAssets);
        if (refSources.length && refUrls.length < refSources.length && !batchOpts.silentToast) {
          d().toast(`已使用 ${refUrls.length}/${refSources.length} 张参考图继续生成`);
        }
        const genPayload = {
          clientRequestId,
          prompt: prompt || '[MJ 混图]',
          model,
          resolution,
          quality,
          size,
          quotedCredits,
          refImageUrls: refUrls.length ? refUrls : undefined,
          ...(meta.mjParams ? { mjParams: meta.mjParams } : {})
        };
        let gen;
        if (mjBlendMode) {
          gen = await global.PromptHubApi.mjBlend({
            refImageUrls: refUrls.slice(0, 5),
            model,
            resolution,
            quality,
            speed: meta.mjParams?.speed || d().getImageGenMjSpeed?.() || 'relax',
            quotedCredits
          });
        } else {
          gen = await global.PromptHubApi.generateImage(genPayload);
        }
        if (!gen.ok) {
          const networkLike =
            gen.code === 'NETWORK_ERROR'
            || gen.code === 'API_UNREACHABLE'
            || gen.status === 524
            || /524|无法连接 api\.prompt-hub|连接.*超时|Failed to fetch|请求失败 \(524\)/i.test(String(gen.message || ''));
          if (networkLike) {
            const recovered = await d().tryRecoverOrphanGenJobAfterSubmitError(genPayload, pendingId, pendingJob);
            if (recovered) {
              submitAccepted = true;
              renderSubmitFeed({ preserveScroll: true });
              return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
            }
            d().deferPendingJobRecovery(
              pendingId,
              d().pendingJobToPollCtx(pendingJob),
              gen.status === 524 || /524/.test(String(gen.message || ''))
                ? '连接超时（524），任务可能已提交，后台继续等待…'
                : ge('slowGenDeferNote', d().pendingJobToPollCtx(pendingJob))
            );
            submitAccepted = true;
            renderSubmitFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          const errMsg = ge('friendlyGenErrorMessage', gen.message);
          if (/524|请求失败 \(524\)/i.test(errMsg) || /524/i.test(String(gen.message || ''))) {
            d().deferPendingJobRecovery(
              pendingId,
              d().pendingJobToPollCtx(pendingJob),
              '连接超时（524），任务可能已提交，后台继续等待…'
            );
            submitAccepted = true;
            renderSubmitFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          const failed = d().failPendingJob(pendingId, errMsg);
          if (!d().renderImageGenFailedNow?.(failed)) {
            renderSubmitFeed({ preserveScroll: true });
          }
          await global.PointsSystem?.refreshCreditsFromServer?.();
          showSubmitFailureFeedback(batchOpts.silentToast);
          return { ok: false, message: errMsg, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
        }
        if (typeof gen.data.creditsRemaining === 'number') {
          global.PointsSystem?.setCreditsFromServer?.(gen.data.creditsRemaining);
          global.PointsSystem?.updateCreditsUI?.();
        }
        cost = gen.data.creditsCharged ?? cost;
        pendingJob.cost = cost;

        if (gen.data.status === 'completed' && gen.data.imageUrl) {
          if (gen.data.jobId) d().trackSessionGenJob(gen.data.jobId);
          if (gen.data.isMidjourney || mjBlendMode) {
            let pollPayload = gen.data;
            const mjParsed0 = d().resolveMjPollImages({ data: pollPayload });
            if ((mjParsed0?.gallery?.length || 0) < 4 && gen.data.jobId) {
              try {
                const settled = await window.PromptHubApi.getGenerationJob(gen.data.jobId, { settle: true });
                if (settled?.ok && settled.data?.status === 'completed') pollPayload = settled.data;
              } catch (e) { /* ignore */ }
            }
            const mjParsed = d().resolveMjPollImages({ data: pollPayload });
            if ((mjParsed?.gallery?.length || 0) < 4) {
              void d().pollGenerationJobUntilDone(gen.data.jobId, pendingId, {
                ...d().pendingJobToPollCtx(pendingJob),
                prompt,
                model,
                resolution,
                quality,
                size,
                cost,
                jobId: gen.data.jobId,
                silentToast: batchOpts.silentToast,
                fromInspirationDraw: !!batchOpts.fromInspirationDraw,
                referenceAssets: submittedReferenceAssets
              });
              submitAccepted = true;
              return { ok: true, creditsCharged: cost };
            }
            await d().saveMjToWarehouse({
              prompt: prompt || '[MJ 混图]',
              model,
              resolution,
              quality,
              size,
              cost,
              jobId: gen.data.jobId,
              targetGroup: pendingJob.targetGroup,
              targetTags: pendingJob.targetTags,
              cardTitle: pendingJob.cardTitle,
              genBatchId: pendingJob.batchMergeCards ? pendingJob.batchId : null,
              batchMergeCards: pendingJob.batchMergeCards,
              referenceAssets: submittedReferenceAssets,
              silentToast: batchOpts.silentToast,
              fromInspirationDraw: !!batchOpts.fromInspirationDraw,
              pendingId,
              primary: mjParsed.primary || pollPayload.imageUrl,
              gridUrls: mjParsed.tiles,
              composite: mjParsed.composite,
              gallery: mjParsed.gallery,
              buttons: pollPayload.mjButtons
            });
          } else if (pendingJob.batchMergeCards && pendingJob.batchId) {
            await d().saveBatchMergedFromPoll?.(
              { data: { status: 'completed', imageUrl: gen.data.imageUrl, extraImageUrls: gen.data.extraImageUrls } },
              { ...d().pendingJobToPollCtx(pendingJob), jobId: gen.data.jobId },
              pendingId
            );
          } else {
            await d().finishImageGenRun({
              prompt,
              model,
              resolution,
              quality,
              size,
              image: gen.data.imageUrl,
              cost,
              jobId: gen.data.jobId,
              targetGroup: pendingJob.targetGroup,
              targetTags: pendingJob.targetTags,
              cardTitle: pendingJob.cardTitle,
              referenceAssets: submittedReferenceAssets,
              silentToast: batchOpts.silentToast,
              fromInspirationDraw: !!batchOpts.fromInspirationDraw,
              pendingId
            });
          }
          submitAccepted = true;
          return { ok: true, creditsCharged: cost };
        }

        const jobId = gen.data.jobId;
        if (!jobId) {
          const failed = d().failPendingJob(pendingId, '未收到任务编号');
          if (!d().renderImageGenFailedNow?.(failed)) renderSubmitFeed();
          showSubmitFailureFeedback(batchOpts.silentToast);
          return { ok: false, message: '未收到任务编号', batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
        }
        pendingJob.jobId = jobId;
        pendingJob.submitPhase = 'accepted';
        pendingJob.slowProvider = ge('isSlowGenProviderModel', model);
        if (gen.data.progressNote) pendingJob.pendingNote = gen.data.progressNote;
        d().trackSessionGenJob(jobId);
        d().persistPendingGenJobs();
        d().renderImageGenPendingNow?.(pendingJob);
        void d().pollGenerationJobUntilDone(jobId, pendingId, {
          prompt,
          model,
          resolution,
          quality,
          size,
          cost,
          jobId,
          referenceAssets: submittedReferenceAssets,
          targetGroup: pendingJob.targetGroup,
          targetTags: pendingJob.targetTags,
          startedAt: pendingJob.startedAt,
          fromInspirationDraw: !!batchOpts.fromInspirationDraw,
          silentToast: !!batchOpts.silentToast,
          batchIndex: batchOpts.batchIndex || null,
          batchTotal: batchOpts.batchTotal || null,
          batchId: batchOpts.batchId || null,
          batchMergeCards: !!pendingJob.batchMergeCards,
          cardTitle: pendingJob.cardTitle || ''
        });
        submitAccepted = true;
        return { ok: true, creditsCharged: cost };
      }

      d().removePendingJob(pendingId);
      renderSubmitFeed();
      if (!batchOpts.silentToast) d().toast('请登录并连接后端 API 后使用真实生图（演示占位已关闭）');
      return { ok: false };
    } catch (e) {
      console.error('[imagegen] runImageGenWithPrompt failed', e);
      if (typeof pendingId === 'string' && pendingId) {
        const failed = d().failPendingJob(pendingId, String(e?.message || '生图提交失败'));
        if (!d().renderImageGenFailedNow?.(failed) && shouldRenderSubmitFeed()) {
          d().safeRenderImageGenFeed({ preserveScroll: true });
        }
      }
      if (!batchOpts.silentToast && !pendingId) {
        const msg = String(e?.message || '');
        let hint = msg || '请刷新页面后重试';
        if (/quota|exceeded/i.test(msg)) {
          hint = '浏览器存储已满，已跳过草稿保存；请清除站点数据或减少参考图后重试';
        } else if (/please wait|too many|rate limit|busy/i.test(msg)) {
          hint = '生图服务繁忙，请稍等 1～2 分钟再试';
        } else if (/apikey|api.key|invalid.*api.*key|unauthorized|401|upstream_auth/i.test(msg)) {
          hint = '生图服务认证失败，请联系站长';
        }
        d().toast('生图提交失败：' + hint);
      } else {
        showSubmitFailureFeedback(batchOpts.silentToast);
      }
      return { ok: false, message: e?.message || 'submit failed' };
    } finally {
      releaseSubmitUi();
    }
  }

  function init(injected) {
    deps = injected || {};
    return { runImageGenWithPrompt, runImageGenBatchTasks, waitForSubmitPaint };
  }

  global.ImageGenSubmit = { init };
})(typeof window !== 'undefined' ? window : globalThis);
