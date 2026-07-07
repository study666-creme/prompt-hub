        prompt: data.prompt,
        refImages: data.refImages,
        refImage: data.refImage,
        referenceAssets: data.referenceAssets,
        resolution: data.resolution
      });
    } catch (e) { /* ignore */ }
  }

  function getImageGenRefImages() { return ru('getImageGenRefImages') || []; }
  function getImageGenPrimaryRef() { return ru('getImageGenPrimaryRef') || null; }
  function getImageGenReferenceAssets() { return ru('getImageGenReferenceAssets') || []; }
  function setImageGenRefs(urls, opts) { return ru('setImageGenRefs', urls, opts); }
  function clearImageGenRef() { return ru('clearImageGenRef'); }
  async function resolveRefDisplayUrl(ref, opts) { return ru('resolveRefDisplayUrl', ref, opts) || ''; }
  function addImageGenRefFromFeed(payload) { return ru('addImageGenRefFromFeed', payload); }
  function bindImageGenUpload() { return ru('bindImageGenUpload'); }
  function bindImageGenPromptTools() { return ru('bindImageGenPromptTools'); }
  function renderImageGenRefGallery() { return ru('renderImageGenRefGallery'); }


  async function resolveRefUrlsFromList(sources) {
    return rr('resolveRefUrlsFromList', sources);
  }

  async function resolveRefUrlsForApi() {
    return resolveRefUrlsFromList(getImageGenRefImages());
  }

  function removePendingJob(pendingId) { return jr('removePendingJob', pendingId); }

  function getPollExtraImageUrls(poll, primaryUrl) { return pw('getPollExtraImageUrls', poll, primaryUrl); }

  async function syncMissingBonusImagesForJob(recoverJob, ctx = {}, opts = {}) {
    if (!recoverJob?.id || !recoverJob.imageUrl) return false;
    if (recoverJob.isMidjourney || isImageGenMidjourneyModel(recoverJob.model || ctx.model)) return false;
    const extras = Array.isArray(recoverJob.extraImageUrls)
      ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
      : [];
    if (!extras.length) return false;
    if (allGenCreationSlotsSaved(recoverJob.id, extras.length)) return false;
    await ensureGenJobCreationsFromPoll(
      { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: extras } },
      {
        prompt: recoverJob.prompt || ctx.prompt || '',
        model: recoverJob.model || ctx.model || 'gpt-image-2',
        resolution: recoverJob.resolution || ctx.resolution || '1k',
        quality: recoverJob.quality || ctx.quality || 'standard',
        size: recoverJob.size || ctx.size || '1:1',
        cost: recoverJob.creditsCharged || ctx.cost || 0,
        jobId: recoverJob.id,
        silentToast: opts.silentToast !== false,
        isRecovery: true
      },
      null
    );
    if (opts.silentToast === false) {
      toast(`已补全同任务附赠图 ${extras.length} 张（不重复扣积分）`);
    }
    return true;
  }

  function isGenCreationSlotSaved(baseJobId, slotIndex) { return pw('isGenCreationSlotSaved', baseJobId, slotIndex); }

  function allGenCreationSlotsSaved(baseJobId, extraCount) { return pw('allGenCreationSlotsSaved', baseJobId, extraCount); }

  async function saveMjToWarehouse(opts) { return pw('saveMjToWarehouse', opts); }

  async function ensureGenJobCreationsFromPoll(poll, ctx, pendingId) {
    return pw('ensureGenJobCreationsFromPoll', poll, ctx, pendingId);
  }

  function isSlowGenProviderModel(modelId) { return !!ge('isSlowGenProviderModel', modelId); }
  function isLongRunningGenJob(ctx) { return !!ge('isLongRunningGenJob', ctx); }
  function genActivePollMaxMs(ctx) { return ge('genActivePollMaxMs', ctx) ?? 5 * 60 * 1000; }
  function genRecoveringDeferGiveUpMs(ctx) { return ge('genRecoveringDeferGiveUpMs', ctx) ?? 22 * 60 * 1000; }
  function pendingRecoveryGiveUpMs(pending) {
    return genRecoveringDeferGiveUpMs(pendingJobToPollCtx(pending || {}));
  }
  function formatPendingRecoveryNote(pending, fallback) {
    const age = Date.now() - (pending?.startedAt || 0);
    const mins = Math.max(1, Math.floor(age / 60000));
    const base = fallback || pending?.recoverNote || '后台恢复中';
    return `${base} · 已等 ${mins} 分钟`;
  }
  function slowGenDeferNote(ctx) { return ge('slowGenDeferNote', ctx) ?? '可能已出图，正在后台恢复（请勿重复提交）'; }
  const ACTIVE_POLL_MAX_MS = window.ImageGenGenErrors?.ACTIVE_POLL_MAX_MS ?? 5 * 60 * 1000;
  function isDefinitiveGenFailure(errRaw, pollData) { return !!ge('isDefinitiveGenFailure', errRaw, pollData); }
  async function failPendingJobImmediately(pendingId, ctx, errRaw) {
    const msg = friendlyGenErrorMessage(errRaw);
    failPendingJob(pendingId, msg);
    await window.PointsSystem?.refreshCreditsFromServer?.();
    renderImageGenFeed({ preserveScroll: true, force: true });
    if (!ctx?.silentToast) toastGenFailure(ctx, msg);
  }
  function genJobPollDelayMs(ctx, attemptIndex) { return ge('genJobPollDelayMs', ctx, attemptIndex) ?? 5500; }

  function applyGenPollProgressNote(pendingId, pollData) { return jr('applyGenPollProgressNote', pendingId, pollData); }
  async function pollGenerationJobUntilDone(jobId, pendingId, ctx) { return jr('pollGenerationJobUntilDone', jobId, pendingId, ctx); }

  function getCloudSlice() {
    return {
      communityPosts: communityPosts.filter(p => !p.isMock),
      creations: filterCreationsForCloud(creations),
      communityLikes: [...likedIds],
      communityFavorites: [...favIds],
      follows: [...follows],
      communityEvents,
      notifications
    };
  }

  function applyCloudSlice(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.communityPosts)) {
      const normalizePost = (p) => {
        if (!p?.image || !window.SupabaseSync?.normalizeImageRef) return p;
        return { ...p, image: window.SupabaseSync.normalizeImageRef(p.image) };
      };
      const cloudPosts = payload.communityPosts.filter((p) => !p.isMock).map(normalizePost);
      const localPosts = communityPosts.filter((p) => !p.isMock);
      communityPosts = window.CloudSyncSafety?.mergeCommunityPostsList
        ? window.CloudSyncSafety.mergeCommunityPostsList(localPosts, cloudPosts)
        : (cloudPosts.length ? cloudPosts : localPosts);
      dedupeCommunityPosts({ persist: false });
      migrateCommunityAuthorIds();
      pruneOrphanFeatureData();
      if (window.__promptHubCards?.length) {
        reconcileCommunityWithCards(window.__promptHubCards);
      }
      pruneOwnStaleCommunityPostsFromCloud();
      pruneLocalCommunityNotOnServer();
      pruneOrphanFeatureData();
      saveJson(LS_COMMUNITY, communityPosts);
    }
    if (Array.isArray(payload.creations)) {
      const tomb = window.getDeletedCreationTombstones?.() || {};
      const normalizeCre = (c) => {
        if (!c?.image || !window.SupabaseSync?.normalizeImageRef) return c;
        return { ...c, image: window.SupabaseSync.normalizeImageRef(c.image) };
      };
      const cloudCreations = payload.creations
        .filter((c) => c && c.id != null && !tomb[String(c.id)])
        .filter((c) => !c.jobId || !isGenerationJobDeleted(c.jobId))
        .map(normalizeCre);
      const localCreations = filterCreationsForCloud(creations);
      const mergedCreations = window.CloudSyncSafety?.mergeCreationsList
        ? window.CloudSyncSafety.mergeCreationsList(localCreations, cloudCreations, tomb)
        : (cloudCreations.length ? cloudCreations : localCreations);
      creations = dedupeCreationsByJobId(mergedCreations);
      pruneCreations();
      saveJson(LS_CREATIONS, creations);
    }
    if (Array.isArray(payload.communityLikes)) {
      likedIds = new Set(payload.communityLikes);
      saveJson(LS_LIKES, [...likedIds]);
    }
    if (Array.isArray(payload.communityFavorites)) {
      favIds = new Set(payload.communityFavorites);
      saveJson(LS_FAVS, [...favIds]);
    }
    if (Array.isArray(payload.follows)) {
      follows = new Set(payload.follows.map(String));
      persistFollows();
    }
    if (Array.isArray(payload.communityEvents)) {
      communityEvents = payload.communityEvents.slice(-200);
      ingestCommunityEvents(communityEvents);
    }
    if (Array.isArray(payload.notifications)) {
      mergeNotifications(payload.notifications);
    }
    if (document.getElementById('pageCommunity')?.classList.contains('active')) {
      if (communityFeedNeedsRerender('communityGrid')) {
        renderCommunity({ skipFeedFetch: true });
      } else {
        const container = document.getElementById('communityGrid');
        const list = filterAndSortPosts(getCommunityFeedForDisplay());
        if (container) patchFeedLikeLabels(container, list);
      }
    }
    if (document.getElementById('pageCreations')?.classList.contains('active')) {
      const container = document.getElementById('creationsGrid');
      const list = getMyPublishedPosts();
      const sig = feedListSignature(list, 'creationsGrid');
      if (container?.dataset.feedSig === sig && container.querySelector('.community-post-card')) {
        patchFeedLikeLabels(container, list);
      } else if (communityFeedNeedsRerender('creationsGrid')) {
        renderCreations();
      }
    }
    updateNotifyBadge();
  }

  async function rebuildCommunityFeedFromApi() {
    try { localStorage.removeItem(LS_PUBLIC_FEED_CACHE); } catch (e) { /* ignore */ }
    if (window.PromptHubApi?.prepareApiCall) await window.PromptHubApi.prepareApiCall();
    else window.__PH_API_DOWN_UNTIL__ = 0;
    publicFeedState.at = 0;
    publicFeedState.posts = [];
    publicFeedState.apiOffset = 0;
    publicFeedState.nextApiOffset = 0;
    publicFeedState.remoteHasMore = true;
    resetCommunityFeedGrid('communityGrid');
    const fetched = await fetchAllPublicCommunityFeedPages(28000);
    if (!fetched?.length) {
      return { ok: false, reason: 'feed_fetch_empty', ...getCommunityFeedPagedDebug('communityGrid') };
    }
    publicFeedState.posts = fetched;
    publicFeedState.at = Date.now();
    publicFeedState.apiOffset = publicFeedState.nextApiOffset;
    publicFeedState.remoteHasMore = false;
    savePublicFeedCache(publicFeedState.posts);
    const list = filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost);
    await renderPostsIntoContainer(list, 'communityGrid');
    await drainCommunityFeedPagesUntilDone('communityGrid');
    finishCommunityFeedLayoutAfterBatch('communityGrid');
    const grid = document.getElementById('communityGrid');
    if (grid) {
      window.__PH_FEED_BULK_DRAIN__ = true;
      try {
        await softHydrateFeedContainer(grid);
      } finally {
        window.__PH_FEED_BULK_DRAIN__ = false;
      }
      finishCommunityFeedLayoutAfterBatch('communityGrid');
    }
    return { ok: true, ...getCommunityFeedPagedDebug('communityGrid') };
  }

  function getCommunityFeedPagedDebug(containerId = 'communityGrid') {
    const store = feedPagedStore[containerId];
    const g = document.getElementById(containerId);
    const scrollEl = g ? (getFeedScrollRoot(g) || g) : null;
    return {
      build: window.__APP_BUILD__,
      cards: g?.querySelectorAll('.card').length || 0,
      uniqueDomPosts: getCommunityFeedRenderedPostIds(containerId).size,
      dupDomPosts: Math.max(0, (g?.querySelectorAll('.card[data-post-id]').length || 0) - getCommunityFeedRenderedPostIds(containerId).size),
      zeroCards: g ? [...g.querySelectorAll('.card')].filter((c) => c.offsetHeight < 8).length : 0,
      storeTotal: store?.posts?.length || 0,
      page: store?.page || 0,
      apiOffset: publicFeedState.apiOffset,
      apiNextOffset: publicFeedState.nextApiOffset,
      publicRemoteHasMore: publicFeedState.remoteHasMore,
      publicPosts: publicFeedState.posts.length,
      renderableTotal: filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost).length,
      remoteExhausted: !!store?.remoteExhausted,
      canLoadMoreLocal: store ? getPendingFeedPosts(store, containerId, 1).length > 0 : false,
      pendingDom: store ? Math.max(0, store.posts.length - getCommunityFeedRenderedPostIds(containerId).size) : 0,
      drainComplete: feedDrainComplete(containerId),
      scrollTop: scrollEl?.scrollTop,
      scrollHeight: scrollEl?.scrollHeight,
      clientHeight: scrollEl?.clientHeight
    };
  }

  function forceRefreshAllImages() {
    const box = document.getElementById('cardsContainer');
    if (box && window.CardImageLoader) {
      window.CardImageLoader.patchVisibleFromCache(box);
    }
    ['communityGrid', 'creationsGrid', 'userProfileGrid', 'imageGenFeed'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      window.MediaPipeline?.patchContainerFromCache?.(el);
      if (id === 'imageGenFeed') scheduleImageGenFeedLayout();
      else if (id === 'communityGrid' || id === 'creationsGrid') {
        if (isMobileViewport()) enforceMobileCommunityFeedGrid(id);
        else {
          scrubCommunityFeedFlexCards(el);
          if (id === 'communityGrid') window.FeedLayout?.repairCommunityMasonry?.(id);
          repairCommunityFeedLayout(id);
        }
      } else layoutCommunityMasonry(id);
    });
  }

  let _jobRunner;
  let _pollWarehouse;
  let _imageGenSubmit;
  let _refResolve;
  let _finishRun;
  let _refCompress;
  let _refUi;
  let _warehouseSave;
  let _warehouseRepair;

  function pw(name, ...args) {
    const fn = _pollWarehouse?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ig(name, ...args) {
    const fn = _imageGenSubmit?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function rr(name, ...args) {
    const fn = _refResolve?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function fr(name, ...args) {
    const fn = _finishRun?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ge(name, ...args) {
    const fn = window.ImageGenGenErrors?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function wr(name, ...args) {
    const fn = _warehouseRepair?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function rc(name, ...args) {
    const fn = _refCompress?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ru(name, ...args) {
    const fn = _refUi?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ws(name, ...args) {
    const fn = _warehouseSave?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function switchImageGenFeedToRecent() {
    imageGenFeedTab = 'recent';
    document.querySelectorAll('[data-feed-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.feedTab === 'recent');
    });
  }

  function switchImageGenFeedToWarehouse() {
    switchImageGenFeedToRecent();
  }

  function wireImageGenWarehouseRepair() {
    if (window.__imageGenWarehouseRepairWired) return;
    if (!window.ImageGenWarehouseRepair?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenWarehouseRepair missing');
      return;
    }
    _warehouseRepair = window.ImageGenWarehouseRepair.init({
      isGenerationJobDeleted,
      isDisplayableImage,
      isUsableWarehouseImage,
      getCreations: () => creations,
      persistCreations,
      getCards: () => window.__promptHubCards || [],
      persistPromptHubCards: async () => {
        if (typeof window.persistPromptHubCards === 'function') await window.persistPromptHubCards();
      },
      renderImageGenFeed: (...a) => renderImageGenFeed(...a),
      resolveMjPollImages,
      queueUrgentCardsSync,
      refreshWarehouseUI: () => window.refreshWarehouseUI?.({ softCards: true }),
      isPageImageGenActive: () => document.getElementById('pageImageGen')?.classList.contains('active')
    });
    window.__imageGenWarehouseRepairWired = true;
  }

  function wireImageGenRefUI() {
    if (window.__imageGenRefUiWired) return;
    if (!window.ImageGenRefUI?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenRefUI missing');
      return;
    }
    _refUi = window.ImageGenRefUI.init({
      toast,
      isDisplayableImage,
      updateImageGenCostHint,
      getMaxRefImages: () => getImageGenMaxRefImages(),
      compressRefImageFromSource: (...a) => rc('compressRefImageFromSource', ...a)
    });
    window.__imageGenRefUiWired = true;
  }

  function wireImageGenRefCompress() {
    if (window.__imageGenRefCompressWired) return;
    if (!window.ImageGenRefCompress?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenRefCompress missing');
      return;
    }
    _refCompress = window.ImageGenRefCompress.init({
      getRefMaxSide: () => REF_MAX_SIDE,
      getRefTargetMaxBytes: () => REF_TARGET_MAX_BYTES
    });
    window.__imageGenRefCompressWired = true;
  }

  function wireImageGenWarehouseSave() {
    if (window.__imageGenWarehouseSaveWired) return;
    if (!window.ImageGenWarehouseSave?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenWarehouseSave missing');
      return;
    }
    _warehouseSave = window.ImageGenWarehouseSave.init({ toast });
    window.__imageGenWarehouseSaveWired = true;
  }

  function wireImageGenRefResolve() {
    if (window.__imageGenRefResolveWired) return;
    if (!window.ImageGenRefResolve?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenRefResolve missing');
      return;
    }
    _refResolve = window.ImageGenRefResolve.init({
      genId,
      compressRefImageFromSource: (...a) => rc('compressRefImageFromSource', ...a),
      getRefMaxSide: () => REF_MAX_SIDE,
      getRefResolveTimeoutMs: () => REF_URL_RESOLVE_TIMEOUT_MS
    });
    window.__imageGenRefResolveWired = true;
  }

  function wireImageGenFinishRun() {
    if (window.__imageGenFinishRunWired) return;
    if (!window.ImageGenFinishRun?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenFinishRun missing');
      return;
    }
    _finishRun = window.ImageGenFinishRun.init({
      toast,
      genId,
      isGenerationJobDeleted,
      findWarehouseCardForJob: (...a) => jr('findWarehouseCardForJob', ...a),
      hasWarehouseCardForJob: (...a) => jr('hasWarehouseCardForJob', ...a),
      repairMjWarehouseCardFields: (...a) => wr('repairMjWarehouseCardFields', ...a),
      repairMjGalleryFromJob: (...a) => wr('repairMjGalleryFromJob', ...a),
      warehouseCardImageNeedsRecovery: (...a) => wr('warehouseCardImageNeedsRecovery', ...a),
      repairWarehouseCardImageFromJob: (...a) => wr('repairWarehouseCardImageFromJob', ...a),
      clearSessionGenJob: (...a) => jr('clearSessionGenJob', ...a),
      removePendingJob: (...a) => jr('removePendingJob', ...a),
      prunePendingJobsWithCreations: (...a) => jr('prunePendingJobsWithCreations', ...a),
      getCreations: () => creations,
      setCreations: (v) => { creations = v; },
      persistCreations,
      getImageGenRefImages,
      getImageGenPrimaryRef,
      getImageGenReferenceAssets,
      isImageGenMjSaveAllTiles,
      genRetentionMs,
      dedupeCreationsByJobId,
      setImageGenLastResult: (v) => { imageGenLastResult = v; },
      setImageGenActiveHistoryId: (v) => { imageGenActiveHistoryId = v; },
      switchImageGenFeedToRecent,
      updateImageGenFeedHint,
      restoreImageGenSubmitLabel,
      isImageGenGenPublicChecked,
      renderImageGenFeed: (...a) => renderImageGenFeed(...a),
      renderImageGenMobileResult,
      queueUrgentCardsSync,
      isCommunityPublishEligible
    });
    window.__imageGenFinishRunWired = true;
  }

  function wireImageGenPollWarehouse() {
    if (window.__imageGenPollWarehouseWired) return;
    if (!window.ImageGenPollWarehouse?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenPollWarehouse missing');
      return;
    }
    _pollWarehouse = window.ImageGenPollWarehouse.init({
      isImageGenMidjourneyModel,
      isImageGenMjSaveAllTiles,
      resolveMjPollImages,
      repairMjWarehouseCardFields,
      repairMjGalleryFromJob,
      persistPromptHubCards: () => persistPromptHubCards(),
      queueUrgentCardsSync: () => queueUrgentCardsSync(),
      finishImageGenRun: (opts) => fr('finishImageGenRun', opts),
      removePendingJob: (...a) => jr('removePendingJob', ...a),
      clearSessionGenJob: (...a) => jr('clearSessionGenJob', ...a),
      renderImageGenFeed: (...a) => renderImageGenFeed(...a),
      getCreations: () => creations,
      persistCreations,
      toast,
      isDisplayableImage: (url) => window.MediaPipeline?.isDisplayableImage?.(url) ?? !!url
    });
    window.__imageGenPollWarehouseWired = true;
  }

  function wireImageGenSubmit() {
    if (window.__imageGenSubmitWired) return;
    if (!window.ImageGenSubmit?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenSubmit missing');
      return;
    }
    _imageGenSubmit = window.ImageGenSubmit.init({
      getImageGenFormMeta,
      isImageGenMidjourneyModel,
      getImageGenMjMode,
      getImageGenMjSpeed,
      getImageGenMjExtrasValue,
      isImageGenMjSaveAllTiles,
      getImageGenRefImages,
      getImageGenPrimaryRef,
      getImageGenReferenceAssets,
      getImageGenBatchCount,
      getImageGenCardTitle,
      isImageGenBatchSplitCards,
      getImageGenModelCatalogReady: () => imageGenModelCatalogReady,
      getImageGenBatchRunning: () => imageGenBatchRunning,
      genId,
      toast,
      restoreImageGenSubmitLabel,
      saveImageGenDraft,
      getImageGenSaveTarget,
      unshiftPendingJob: (job) => { imageGenPendingJobs.unshift(job); },
      persistPendingGenJobs: () => jr('persistPendingGenJobs'),
      switchImageGenFeedToRecent,
      updateImageGenFeedHint,
      renderImageGenFeed: (...a) => renderImageGenFeed(...a),
      safeRenderImageGenFeed,
      isMobileViewport,
      quoteGenerationCost,
      getGenCostQuoteTimeoutMs: () => GEN_COST_QUOTE_TIMEOUT_MS,
      resolveRefUrlsFromList: (sources) => rr('resolveRefUrlsFromList', sources),
      removePendingJob: (...a) => jr('removePendingJob', ...a),
      failPendingJob: (...a) => jr('failPendingJob', ...a),
      tryRecoverOrphanGenJobAfterSubmitError: (...a) => jr('tryRecoverOrphanGenJobAfterSubmitError', ...a),
      deferPendingJobRecovery: (...a) => jr('deferPendingJobRecovery', ...a),
      pendingJobToPollCtx: (...a) => jr('pendingJobToPollCtx', ...a) || {},
      trackSessionGenJob: (...a) => jr('trackSessionGenJob', ...a),
      resolveMjPollImages,
      saveMjToWarehouse: (opts) => pw('saveMjToWarehouse', opts),
      saveBatchMergedFromPoll: (...a) => pw('saveBatchMergedFromPoll', ...a),
      finishImageGenRun: (opts) => fr('finishImageGenRun', opts),
      pollGenerationJobUntilDone: (...a) => jr('pollGenerationJobUntilDone', ...a)
    });
    window.__imageGenSubmitWired = true;
  }

  function wireImageGenJobRunner() {
    if (window.__imageGenJobRunnerWired) return;
    if (!window.ImageGenJobRunner?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenJobRunner missing');
      return;
    }
    _jobRunner = window.ImageGenJobRunner.init({
      getPendingJobs: () => imageGenPendingJobs,
      setPendingJobs: (v) => { imageGenPendingJobs = v; },
      getFailedJobs: () => imageGenFailedJobs,
      setFailedJobs: (v) => { imageGenFailedJobs = v; },
      genId,
      toast,
      batchIndexLabel,
      normalizeImageGenModelId,
      imageGenModelLabel,
      renderImageGenFeed: (...a) => renderImageGenFeed(...a),
      renderImageGenMobileResult,
      resumePendingGenerationJobs: (...a) => jr('resumePendingGenerationJobs', ...a),
      ensureGenJobCreationsFromPoll: (...a) => pw('ensureGenJobCreationsFromPoll', ...a),
      allGenCreationSlotsSaved: (...a) => pw('allGenCreationSlotsSaved', ...a),
      findBestApiJobForPrompt: (...a) => jr('findBestApiJobForPrompt', ...a),
      isGenerationJobDeleted,
      isDisplayableImage,
      isMobileViewport,
      prunePendingJobsWithCreations: (...a) => jr('prunePendingJobsWithCreations', ...a),
      tryRecoverPendingJobDirect: (...a) => jr('tryRecoverPendingJobDirect', ...a),
      needsApiImageRecovery: (...a) => jr('needsApiImageRecovery', ...a),
      pendingPromptsMatch: (...a) => jr('pendingPromptsMatch', ...a),
      syncMissingBonusImagesForJob,
      repairWarehouseCardImageFromJob: (...a) => wr('repairWarehouseCardImageFromJob', ...a),
      finishImageGenRun: (opts) => fr('finishImageGenRun', opts)
    });
    window.__imageGenJobRunnerWired = true;
  }

  function jr(name, ...args) {
    const fn = _jobRunner?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function getActivePollJobIds() { return jr('getActivePollJobIds') || new Set(); }

  function wireAllFeedModules() {
    wireCommunityPublicFeed();
    wireImageGenJobRunner();
    wireImageGenWarehouseRepair();
    wireImageGenRefCompress();
    wireImageGenRefUI();
    wireImageGenWarehouseSave();
    wireImageGenRefResolve();
    wireImageGenFinishRun();
    wireImageGenPollWarehouse();
    wireImageGenSubmit();
    wireFeedImages();
    wireImageGenFeed();
    wireFeedLayout();
  }

  function buildFeatureDraftExports() {
    return {
    init,
    onAppChange,
    cancelCommunityPageWork,
    activateCommunityPage,
    clearSensitiveLocalStateOnSignOut,
    clearAllLocalFeatureData,
    reloadStores,
    refreshImageGenCost,
    refreshImageGenModelCatalog,
    warmImageGenModelCatalog,
    prefetchImageGenModelCatalog,
    scheduleDeferredImageGenModelCatalogRefresh,
    syncCardToCommunity,
    removeCommunityByCardId,
    unpublishCommunityByCardId,
    isCommunityPublishEligible,
    isGeneratedWarehouseCard,
    readPublishCheckbox,
    setPublishCheckbox,
    syncCardPublishFromPrompt,
    getCloudSlice,
    applyCloudSlice,
    reconcileCommunityWithCards,
    reconcileCreationsWarehouseLinks,
    maybeReconcileCommunityWithCards,
    invalidateCommunityReconcileCache,
    materializeCommunityFromCards,
    syncEligibleCardsToCommunity,
    runSyncCardLibraryToCommunity,
    inspectCardLibraryPublishGap,
    markAllEligibleCardsPublished,
    restoreCardsFromCommunityFeed,
    refreshFeedsAfterCardsSync,
    ensureCommunityFromCards,
    refreshPublicCommunityFeed,
    restorePublishedFlagsFromFeed,
    applyCardPublishState,
    clearPublishDraft,
    toggleMyPublishedPostVisibility,
    syncPublishToggleForOpenCard,
    syncMyPostsToPublicFeed,
    renderCommunity,
    getCommunityFeedForDisplay,
    getCommunityFeedPagedDebug,
    rebuildCommunityFeedFromApi,
    drainCommunityFeedPagesUntilDone,
    findPost,
    toggleCommunityAppreciate,
    exitCommunityAppreciate,
    isCommunityQuickPreviewActive,
    onAppreciateViewerClose,
    bumpAppreciateViewerGen,
    openCommunityAppreciateViewer,
    openCommunityAppreciateById,
    openCommunitySidePanel,
    isPostFavorited,
    pruneOrphanFeatureData,
    purgeGhostCommunityData,
    imageGenFeedSignOpts,
    hydrateFeedImages,
    resetMobileFeedGridStyles,
    enforceMobileImageGenFeed,
    enforceMobileCommunityFeedGrid,
    closeImageGenFilterSheet,
    renderImageGenFeed,
    renderImageGenMobileResult,
    prunePendingGenJobsFromWarehouse: () => {
      prunePendingJobsWithCreations();
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        renderImageGenFeed({ preserveScroll: true });
      }
    },
    canonicalCommunityImageRef,
    communityPostDisplayImageRef,
    isCommunityCollectCard,
    COMMUNITY_COLLECT_TAG,
    isDisplayableImage,
    isUsableWarehouseImage,
    getWarehouseCardKind,
    removeBrokenCommunityFeedCard,
    pruneEmptyCommunityFeedCards,
    scheduleLayout: (...args) => scheduleCommunityLayout?.(...args),
    scheduleCommunityLayout: (...args) => scheduleCommunityLayout?.(...args),
    scheduleImageGenFeedLayout: (...args) => scheduleImageGenFeedLayout?.(...args),
    repairCreationsFeedLayout,
    repairCommunityFeedLayout,
    settleCommunityFeedLayout,
    syncCommunityFeedColumnCount,
    scrubCommunityFeedFlexCards,
    scheduleCommunityFeedHeightBalance,
    scheduleCommunityMasonryRelayout,
    scheduleFeedMasonryRelayout,
    layoutCommunityMasonry,
    layoutFeedFlexColumns,
    getFeedLayoutMode,
    relayoutCommunityFeeds,
    onCardDeletedForGen,
    recoverRecentGenerationJobs,
    recoverLostGenerationsFromApi,
    repairMissingGenCardImagesQuiet,
    repairRecentCreationImagesQuiet,
    diagnoseRecentFeedThumbs,
    pickCreationFeedImage,
    creationFeedImageCandidates,
    repairMjWarehousePreviewsQuiet,
    resumePendingGenerationJobs,
    scheduleGenJobsSync,
    renderCreations,
    renderMyHomeProfile,
    onDisplayNameChanged,
    scheduleCreationsLayout: () => scheduleCommunityLayout?.('creationsGrid'),
    fillFormPromptOnly,
    copyFeedPromptText,
    fillFeedPromptToImageGen,
    fillFeedPromptToActiveMode,
    getActiveImageGenMode,
    fillCardToImageGen,
    getImageGenFeedNavItems,
    openImageGenLightboxAt,
    resolveImageGenFullUrl,
    findCreationById,
    runImageGenWithPrompt,
    recordImageGenFailure: addFailedGenJob,
    getImageGenRefImages: () => [...getImageGenRefImages()],
    refreshImageGenSaveTargetSelects: updateImageGenSaveTargetSelects,
    resolveRefDisplayUrl,
    updateNotifyBadge,
    getCommunityPostsForTasks() {
      return communityPosts
        .filter(p => !p.isMock)
        .map(p => ({
          prompt: p.prompt || '',
          title: p.title || '',
          image: p.image || null
        }));
    }
    };
  }

  function startFeatureDraftInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  function bootstrapFeatureDraft() {
    wireAllFeedModules();
    if (!_hydratePublicFeedFromCache || !_scheduleCommunityLayout || !_renderImageGenFeed) {
      console.error('[FeatureDraft] feed modules not wired — check pack-feed.js / pack-assets.js loaded');
    }
    window.FeatureDraft = buildFeatureDraftExports();
    window.recoverLostGenerationsFromApi = recoverLostGenerationsFromApi;
    window.forceRefreshAllImages = forceRefreshAllImages;
    startFeatureDraftInit();
  }

  function feedPacksReady() {
    return !!(window.CommunityPublicFeed?.init && window.FeedImages?.init
      && window.ImageGenFeed?.init && window.FeedLayout?.init);
  }

  if (!feedPacksReady()) {
    let feedWireTries = 0;
    (function retryFeedWire() {
      if (feedPacksReady()) {
        bootstrapFeatureDraft();
        return;
      }
      if (++feedWireTries > 120) {
        console.error('[FeatureDraft] feed packs not ready after', feedWireTries, 'retries');
        bootstrapFeatureDraft();
        return;
      }
      setTimeout(retryFeedWire, 25);
    })();
  } else {
    bootstrapFeatureDraft();
  }
})();
