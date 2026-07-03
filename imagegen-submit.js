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

  async function runImageGenWithPrompt(promptOverride, opts) {
    const batchOpts = opts && typeof opts === 'object' ? opts : {};
    if (!global.AuthGate?.requireAuth?.('imagegen')) return { ok: false };
    const metaEarly = d().getImageGenFormMeta();
    const mjBlendMode = d().isImageGenMidjourneyModel?.(metaEarly.model) && d().getImageGenMjMode?.() === 'blend';
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

    const btn = global.document.getElementById(batchOpts.submitBtnId || 'imageGenSubmit');
    const singleRun = !batchOpts.batch;
    if (singleRun && btn?.disabled && !d().getImageGenBatchRunning?.()) {
      btn.disabled = false;
    }
    if (singleRun && btn) {
      btn.disabled = true;
      btn.textContent = '准备中…';
    }

    let pendingId = null;
    let submitUiReleased = false;
    const releaseSubmitUi = () => {
      if (!singleRun || submitUiReleased) return;
      submitUiReleased = true;
      if (btn) {
        btn.disabled = false;
        d().restoreImageGenSubmitLabel();
      }
    };
    try {
      const meta = d().getImageGenFormMeta();
      const { model, resolution, quality, size } = meta;
      let cost = global.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
      let balance = global.PointsSystem?.getCredits?.() ?? 0;
      const useApi = global.PointsSystem?.useApiForAccount?.();

      if (balance < cost) {
        d().toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      d().saveImageGenDraft({
        prompt,
        model,
        refImages: d().getImageGenRefImages?.() || [],
        refImage: d().getImageGenPrimaryRef?.(),
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

      const modelLabel = global.PointsSystem?.getImageGenModel?.(model)?.label || model;
      pendingId = d().genId('pending');
      const saveTarget = d().getImageGenSaveTarget();
      const pendingJob = {
        id: pendingId,
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
        startedAt: Date.now()
      };
      d().unshiftPendingJob(pendingJob);
      d().persistPendingGenJobs();
      d().switchImageGenFeedToRecent();
      d().updateImageGenFeedHint();
      d().renderImageGenFeed({ preserveScroll: true });
      if (singleRun && d().isMobileViewport?.() && global.MobileUI?.setImageGenView) {
        global.MobileUI.setImageGenView('feed', { scrollToTop: false });
      }
      releaseSubmitUi();

      if (useApi) {
        const localCost = cost;
        const quoted = await Promise.race([
          d().quoteGenerationCost(resolution, quality, model, cost),
          new Promise((resolve) => {
            setTimeout(() => resolve({ cost: localCost, fromApi: false }), d().getGenCostQuoteTimeoutMs?.() ?? 1800);
          })
        ]);
        cost = quoted.cost;
        pendingJob.cost = cost;
        d().persistPendingGenJobs();
        balance = global.PointsSystem?.getCredits?.() ?? 0;
      }

      if (balance < cost) {
        d().removePendingJob(pendingId);
        d().renderImageGenFeed({ preserveScroll: true });
        d().toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      if (!useApi && !global.PointsSystem?.deductCredits?.(cost)) {
        d().removePendingJob(pendingId);
        d().renderImageGenFeed({ preserveScroll: true });
        d().toast('积分扣除失败');
        return { ok: false };
      }

      if (useApi) {
        const refSources = batchOpts.skipRefImages
          ? []
          : Array.isArray(batchOpts.refImages) && batchOpts.refImages.length
            ? batchOpts.refImages
            : (d().getImageGenRefImages?.() || []);
        const refUrls = await d().resolveRefUrlsFromList(refSources);
        if (refSources.length && refUrls.length < refSources.length && !batchOpts.silentToast) {
          d().toast(`已使用 ${refUrls.length}/${refSources.length} 张参考图继续生成`);
        }
        const genPayload = {
          prompt: prompt || '[MJ 混图]',
          model,
          resolution,
          quality,
          size,
          refImageUrls: refUrls.length ? refUrls : undefined,
          ...(meta.mjParams ? { mjParams: meta.mjParams } : {})
        };
        let gen;
        if (mjBlendMode) {
          gen = await global.PromptHubApi.mjBlend({
            refImageUrls: refUrls.slice(0, 5),
            model,
            speed: meta.mjParams?.speed || d().getImageGenMjSpeed?.() || 'relax'
          });
        } else {
          gen = await global.PromptHubApi.generateImage(genPayload);
        }
        if (!gen.ok && batchOpts.batch && !mjBlendMode) {
          const retryable = gen.code === 'RATE_LIMITED'
            || gen.status === 429
            || /过于频繁|upstream|502|503|429|rate limit/i.test(String(gen.message || ''));
          for (let attempt = 0; attempt < 2 && !gen.ok && retryable; attempt += 1) {
            await new Promise((r) => setTimeout(r, 2000 + attempt * 2500));
            gen = await global.PromptHubApi.generateImage(genPayload);
          }
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
              d().renderImageGenFeed({ preserveScroll: true });
              return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
            }
            d().deferPendingJobRecovery(
              pendingId,
              d().pendingJobToPollCtx(pendingJob),
              gen.status === 524 || /524/.test(String(gen.message || ''))
                ? '连接超时（524），任务可能已提交，后台继续等待…'
                : ge('slowGenDeferNote', d().pendingJobToPollCtx(pendingJob))
            );
            d().renderImageGenFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          const errMsg = ge('friendlyGenErrorMessage', gen.message);
          if (/524|请求失败 \(524\)/i.test(errMsg) || /524/i.test(String(gen.message || ''))) {
            d().deferPendingJobRecovery(
              pendingId,
              d().pendingJobToPollCtx(pendingJob),
              '连接超时（524），任务可能已提交，后台继续等待…'
            );
            d().renderImageGenFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          d().failPendingJob(pendingId, errMsg);
          d().renderImageGenFeed({ preserveScroll: true });
          await global.PointsSystem?.refreshCreditsFromServer?.();
          if (!batchOpts.silentToast) d().toast(errMsg);
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
                fromInspirationDraw: !!batchOpts.fromInspirationDraw
              });
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
              silentToast: batchOpts.silentToast,
              fromInspirationDraw: !!batchOpts.fromInspirationDraw,
              pendingId
            });
          }
          return { ok: true, creditsCharged: cost };
        }

        const jobId = gen.data.jobId;
        if (!jobId) {
          d().failPendingJob(pendingId, '未收到任务编号');
          d().renderImageGenFeed();
          if (!batchOpts.silentToast) d().toast('未收到任务编号，请重试');
          return { ok: false, message: '未收到任务编号', batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
        }
        pendingJob.jobId = jobId;
        pendingJob.slowProvider = ge('isSlowGenProviderModel', model);
        if (gen.data.progressNote) pendingJob.pendingNote = gen.data.progressNote;
        d().trackSessionGenJob(jobId);
        d().persistPendingGenJobs();
        if (!batchOpts.silentToast) {
          d().toast(
            pendingJob.slowProvider
              ? '已提交，约 1–12 分钟出图，下方可看进度'
              : '已提交生图，下方可查看进度，可继续点击生成'
          );
        }
        void d().pollGenerationJobUntilDone(jobId, pendingId, {
          prompt,
          model,
          resolution,
          quality,
          size,
          cost,
          jobId,
          targetGroup: pendingJob.targetGroup,
          targetTags: pendingJob.targetTags,
          startedAt: pendingJob.startedAt,
          fromInspirationDraw: !!batchOpts.fromInspirationDraw,
          silentToast: !!batchOpts.silentToast,
          batchIndex: batchOpts.batchIndex || null,
          batchTotal: batchOpts.batchTotal || null,
          batchId: batchOpts.batchId || null
        });
        return { ok: true, creditsCharged: cost };
      }

      d().removePendingJob(pendingId);
      d().renderImageGenFeed();
      if (!batchOpts.silentToast) d().toast('请登录并连接后端 API 后使用真实生图（演示占位已关闭）');
      return { ok: false };
    } catch (e) {
      console.error('[imagegen] runImageGenWithPrompt failed', e);
      if (typeof pendingId === 'string' && pendingId) {
        d().failPendingJob(pendingId, String(e?.message || '生图提交失败'));
        d().safeRenderImageGenFeed({ preserveScroll: true });
      }
      if (!batchOpts.silentToast) {
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
      }
      return { ok: false, message: e?.message || 'submit failed' };
    } finally {
      releaseSubmitUi();
    }
  }

  function init(injected) {
    deps = injected || {};
    return { runImageGenWithPrompt };
  }

  global.ImageGenSubmit = { init };
})(typeof window !== 'undefined' ? window : globalThis);
