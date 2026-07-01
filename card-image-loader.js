/**
 * 列表图片统一管线：批量签名 → 缓存 → 限流下载(≤2) → IntersectionObserver 懒加载
 * 适用：#cardsContainer、#imageGenFeed、社区网格
 */
(function () {
  let observer = null;
  let observedRoot = null;
  const inflight = new WeakMap();
  const resolveQueue = [];
  const feedResolveQueue = [];
  let resolveActive = 0;
  let feedResolveActive = 0;
  function maxResolveCap() {
    return window.MobileUI?.getPerf?.()?.maxResolve ?? 10;
  }
  function feedMaxResolveCap() {
    return window.MobileUI?.getPerf?.()?.feedMaxResolve ?? 8;
  }
  function maxDownloadCap() {
    return window.MobileUI?.getPerf?.()?.maxDownload ?? 8;
  }
  function igFeedPatchMax() {
    return window.MobileUI?.getPerf?.()?.igFeedPatchMax ?? 6;
  }
  function igFeedBoostMax() {
    return window.MobileUI?.getPerf?.()?.igFeedBoostMax ?? 10;
  }
  function igFeedPrefetchMax() {
    return window.MobileUI?.getPerf?.()?.igFeedPrefetchCap ?? 4;
  }
  function cardEagerCap() {
    return window.MobileUI?.getPerf?.()?.cardEagerCap ?? 16;
  }
  function cardFirstScreenCap() {
    return window.MobileUI?.getPerf?.()?.cardFirstScreenCap ?? 16;
  }
  const VISIBLE_LOAD_MARGIN = 160;
  const prefetchedImageRefs = new Set();
  const containerSignReady = new Map();

  const downloadQueue = [];
  let downloadActive = 0;

  function setContainerSignReady(container, promise) {
    const id = container?.id;
    if (!id) return;
    containerSignReady.set(id, (promise || Promise.resolve()).catch(() => {}));
  }

  function whenContainerSigned(containerOrId) {
    const id = typeof containerOrId === 'string' ? containerOrId : containerOrId?.id;
    return containerSignReady.get(id) || Promise.resolve();
  }

  /** 手机：不阻塞等整批 prefetch，320ms 后视口内也开载 */
  function whenContainerReady(containerOrId) {
    const pending = whenContainerSigned(containerOrId);
    if (!window.MobileUI?.isMobileViewport?.()) return pending;
    return Promise.race([pending, new Promise((r) => setTimeout(r, 320))]);
  }

  function clearFeedObserverBindings(container) {
    if (!container) return;
    feedImagesIn(container).forEach((img) => {
      delete img.dataset.feedObserverBound;
    });
  }

  function pumpDownloadQueue() {
    while (downloadActive < maxDownloadCap() && downloadQueue.length) {
      const job = downloadQueue.shift();
      downloadActive += 1;
      job().finally(() => {
        downloadActive -= 1;
        pumpDownloadQueue();
      });
    }
  }

  function enqueueDownload(fn) {
    return new Promise((resolve) => {
      downloadQueue.push(() => fn().then(resolve, resolve));
      pumpDownloadQueue();
    });
  }

  function runResolveQueue() {
    while (resolveActive < maxResolveCap() && resolveQueue.length) {
      const job = resolveQueue.shift();
      resolveActive += 1;
      job().finally(() => {
        resolveActive -= 1;
        runResolveQueue();
      });
    }
  }

  function enqueueResolve(fn) {
    return new Promise((resolve) => {
      resolveQueue.push(() => fn().then(resolve, resolve));
      runResolveQueue();
    });
  }

  function enqueueFeedResolve(fn) {
    return new Promise((resolve) => {
      feedResolveQueue.push(() => fn().then(resolve, resolve));
      runFeedResolveQueue();
    });
  }

  function runFeedResolveQueue() {
    while (feedResolveActive < feedMaxResolveCap() && feedResolveQueue.length) {
      const job = feedResolveQueue.shift();
      feedResolveActive += 1;
      job().finally(() => {
        feedResolveActive -= 1;
        runFeedResolveQueue();
      });
    }
  }

  function cardIdFromImg(img) {
    return img.dataset?.sourceCardId
      || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-id]')?.dataset?.id
      || img.closest('.card[data-post-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-post-id]')?.dataset?.postId
      || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
  }

  function jobIdFromImg(img) {
    const fromAttr = img?.getAttribute?.('data-job-id');
    if (fromAttr) return String(fromAttr);
    const cardId = cardIdFromImg(img);
    if (!cardId) return null;
    const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
    if (card?.genJobId) return String(card.genJobId).replace(/#\d+$/, '');
    return null;
  }

  let igWhRepairTimer = null;
  let igWhRepairLastAt = 0;
  function scheduleImageGenWarehouseRepair() {
    if (igWhRepairTimer) return;
    const now = Date.now();
    if (now - igWhRepairLastAt < 90000) return;
    igWhRepairLastAt = now;
    igWhRepairTimer = setTimeout(() => {
      igWhRepairTimer = null;
      void window.ImageGenWarehouseRepair?.recoverWarehouseImagesViaServer?.({ max: 4, hours: 72 })
        .catch(() => {});
    }, 1200);
  }

  function warehouseCollectResolveOpts(img) {
    const card = img.closest('.card[data-id]');
    if (!card?.closest?.('#cardsContainer') || card.dataset.communityCollect !== '1') return null;
    const cardId = card.dataset.id;
    const fromCard = cardId && window.getCommunityCollectImageResolveOpts
      ? window.getCommunityCollectImageResolveOpts(
        (window.__promptHubCards || []).find((c) => c.id === cardId)
      )
      : null;
    if (fromCard) {
      return {
        ...fromCard,
        communityFeed: true,
        tryAllPaths: false,
        listOnly: true,
        allowFullFallback: false,
        variant: 'grid'
      };
    }
    const authorId = card.dataset.authorId || img.dataset.authorId || '';
    if (!authorId) return null;
    return {
      communityFeed: true,
      authorId,
      assetId: card.dataset.sourceCardId || img.dataset.sourceCardId || cardId,
      cardId: card.dataset.sourceCardId || img.dataset.sourceCardId || undefined,
      tryAllPaths: false,
      listOnly: true,
      allowFullFallback: false,
      variant: 'grid'
    };
  }

  function imageGenFeedResolveOpts(img) {
    const ig = window.FeatureDraft?.imageGenFeedSignOpts?.(img);
    if (!ig) return null;
    return {
      ...ig,
      communityFeed: ig.communityFeed === true || ig.fromPublicFeed === true,
      authorId: ig.authorId || undefined,
      cardId: ig.cardId || ig.assetId || cardIdFromImg(img),
      tryAllPaths: false,
      listOnly: true,
      allowFullFallback: false,
      variant: 'grid'
    };
  }

  function communityResolveOpts(img) {
    const collect = warehouseCollectResolveOpts(img);
    if (collect) return collect;
    const ig = imageGenFeedResolveOpts(img);
    if (ig) return ig;
    const inFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid, #communitySideBody, #creationsSideBody, .community-side-img-btn');
    if (!inFeed) return {};
    const authorId = img.dataset?.authorId || img.closest('.card')?.dataset?.authorId || '';
    const ref = img.getAttribute('data-image-ref') || '';
    if (window.SupabaseSync?.isInvalidMediaUrl?.(ref)) return { skip: true };
    const path = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
    const uid = window.SupabaseSync?.getUserId?.();
    const own = !!(path && uid && path.replace(/^\//, '').startsWith(`${uid}/`));
    const inGrid = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
    const sidePanel = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn');
    return {
      communityFeed: !window.SupabaseSync?.isLoggedIn?.() || (!own && (inGrid || sidePanel)),
      authorId:
        img.dataset?.authorId
        || img.closest('.card')?.dataset?.authorId
        || img.closest('[data-author-id]')?.dataset?.authorId
        || undefined,
      cardId: cardIdFromImg(img),
      tryAllPaths: false,
      listOnly: inGrid ? true : undefined,
      allowFullFallback: false,
      variant: 'grid'
    };
  }

  function isOwnImageGenWarehouseImg(img) {
    return !!img?.closest?.('#imageGenFeed .imagegen-feed-card[data-feed-id^="wh_"]');
  }

  /** 浏览器已解码出像素 — 勿因签名过期重复拉 media */
  function isImgVisuallyLoaded(img) {
    if (!img) return false;
    if (img.dataset.feedLoadDone === '1') return true;
    const src = img.currentSrc || img.src || '';
    if (!/^https?:\/\//i.test(src) || src.includes('data:image/svg')) return false;
    return img.complete && img.naturalWidth > 8;
  }

  function isImgSameDisplayResource(img, url) {
    if (!img || !url) return false;
    const cur = img.currentSrc || img.src || '';
    if (!cur || cur === url) return cur === url;
    const pathA = window.SupabaseSync?.storagePathFromDisplayUrl?.(cur);
    const pathB = window.SupabaseSync?.storagePathFromDisplayUrl?.(url);
    if (pathA && pathB) return String(pathA).replace(/^\//, '') === String(pathB).replace(/^\//, '');
    return false;
  }

  function isCommunityImg(img) {
    return !!img?.closest?.('#communityGrid, #creationsGrid, #userProfileGrid, #imageGenFeed');
  }

  function isImageGenFeedImg(img) {
    return !!img?.closest?.('#imageGenFeed');
  }

  function feedMediaFromImg(img) {
    return img?.closest?.('.card-media, .imagegen-feed-media');
  }

  function isCommunitySideImg(img) {
    return !!img?.closest?.('#communitySideBody, #creationsSideBody, .community-side-img-btn, #appreciateViewer, #imageLightbox');
  }

  function listImageVariant(img) {
    if (isCommunitySideImg(img)) return 'full';
    return 'grid';
  }

  function isCommunityContainer(container) {
    const id = container?.id;
    return id === 'communityGrid' || id === 'creationsGrid' || id === 'userProfileGrid';
  }

  function isLazyOnlyContainer(container) {
    if (window.MobileUI?.isMobileViewport?.()) {
      if (container?.id === 'cardsContainer') return false;
      if (container?.id === 'imageGenFeed' && document.body.classList.contains('imagegen-mobile-view-feed')) {
        return false;
      }
    }
    return container?.id === 'cardsContainer' || container?.id === 'imageGenFeed';
  }

  const IMAGEGEN_FEED_PATCH_MAX = 6;
  const IMAGEGEN_FEED_BOOST_MAX = 10;
  const IMAGEGEN_FEED_PREFETCH_MAX = 4;

  function sortImgsByViewport(imgs) {
    return [...imgs].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const aVis = ar.bottom > -40 && ar.top < window.innerHeight + 40;
      const bVis = br.bottom > -40 && br.top < window.innerHeight + 40;
      if (aVis !== bVis) return aVis ? -1 : 1;
      return ar.top - br.top;
    });
  }

  function cachedUrl(ref, cardId, img) {
    const authorId =
      img?.dataset?.authorId
      || img?.closest('.card')?.dataset?.authorId
      || img?.closest('[data-author-id]')?.dataset?.authorId
      || undefined;
    if (window.MediaPipeline?.getListCached) {
      const piped = window.MediaPipeline.getListCached(ref, cardId, { authorId, assetId: cardId });
      if (piped && isReadySrc(piped, img)) return piped;
    }
    if ((isOwnImageGenWarehouseImg(img) || isOwnWarehouseListImg(img))
      && window.SupabaseSync?.getListDisplayImageSrc) {
      const url = window.SupabaseSync.getListDisplayImageSrc(ref, cardId, { authorId, assetId: cardId, allowFullFallback: false });
      if (url && isReadySrc(url, img)) return url;
      return '';
    }
    const variant = listImageVariant(img);
    return window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, authorId, variant }) || '';
  }

  function isReadySrc(src, img) {
    if (!src || !src.startsWith('http') || src.includes('data:image/svg')) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return false;
    if (img && (isOwnImageGenWarehouseImg(img) || isOwnWarehouseListImg(img))) {
      if (src.startsWith('blob:')) return false;
      if (window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(src)) return false;
      if (!window.SupabaseSync?.isGridDisplayUrl?.(src)) return false;
    }
    if (img && isImgVisuallyLoaded(img) && (isOwnImageGenWarehouseImg(img) || isOwnWarehouseListImg(img))) {
      return true;
    }
    if (img && window.SupabaseSync?.isWarehouseBlockedFullUrl?.(src, img)) return false;
    if (img && isCommunityImg(img) && !isOwnImageGenWarehouseImg(img) && window.SupabaseSync?.isResolvableDisplayUrl) {
      return window.SupabaseSync.isResolvableDisplayUrl(src);
    }
    if (window.SupabaseSync?.isValidSignedDisplayUrl) {
      return window.SupabaseSync.isValidSignedDisplayUrl(src);
    }
    if (window.SupabaseSync?.isFreshSignedDisplayUrl) {
      return window.SupabaseSync.isFreshSignedDisplayUrl(src, 60000);
    }
    return true;
  }

  function isOwnWarehouseListImg(img) {
    if (isOwnImageGenWarehouseImg(img)) return true;
    const card = img?.closest?.('#cardsContainer .card[data-id]');
    return !!(card && card.dataset.communityCollect !== '1');
  }

  function isOwnCommunityGridImg(img) {
    if (!img?.closest?.('#communityGrid, #creationsGrid, #userProfileGrid')) return false;
    const ref = img.getAttribute('data-image-ref');
    const path = window.SupabaseSync?.storagePathFromRef?.(ref);
    return !!(path && window.SupabaseSync?.storagePathOwnedByCurrentUser?.(path));
  }

  function tryAlternateFeedCover(img) {
    if (!isOwnImageGenWarehouseImg(img)) return false;
    const cardId = cardIdFromImg(img);
    const card = cardId && (window.__promptHubCards || []).find((c) => c.id === cardId);
    if (!card || !window.PromptHubCardGallery?.normalizeCardGallery) return false;
    const currentRef = img.getAttribute('data-image-ref') || '';
    const gallery = window.PromptHubCardGallery.normalizeCardGallery(card);
    const tried = new Set(String(img.dataset.igAltTried || '').split('|').filter(Boolean));
    if (currentRef) tried.add(currentRef);
    for (let i = 0; i < gallery.length; i += 1) {
      const ref = gallery[i];
      if (!ref || tried.has(ref)) continue;
      if (window.PromptHubCardGallery.isResolvableCoverRef?.(ref, cardId) === false) continue;
      tried.add(ref);
      img.dataset.igAltTried = [...tried].join('|');
      img.setAttribute('data-image-ref', ref);
      const slotJob = window.PromptHubCardGallery.gallerySlotJobId?.(
        card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null,
        i
      );
      if (slotJob) img.setAttribute('data-job-id', slotJob);
      img.classList.remove('img-load-failed');
      feedMediaFromImg(img)?.classList.remove('card-media--load-failed');
      delete img.dataset.igWhResolveRetry;
      delete img.dataset.feedImgRetry;
      if (card && ref && card.image !== ref) {
        window.PromptHubCardGallery?.ensureFeedCoverFromGallery?.(card, { persist: true, backfill: true });
        global.invalidateWarehouseCardsForImageGenCache?.();
      }
      loadImg(img);
      return true;
    }
    return false;
  }

  function queueGridBackfillForImg(img) {
    const cardId = cardIdFromImg(img);
    if (!cardId || !window.SupabaseSync?.queueGridBackfill) return false;
    const ref = img.getAttribute('data-image-ref') || '';
    if (window.SupabaseSync?.cardImageStillResolvable?.(ref, cardId) === false) {
      window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
      return false;
    }
    const refPath = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
    if (refPath.replace(/^\//, '').includes('/generated/')) {
      if (isOwnImageGenWarehouseImg(img)) {
        const jobId = jobIdFromImg(img);
        window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
        void resolveUrl(ref, cardId, { jobId: jobId || undefined, bypassSignBudget: true }, img).then((url) => {
          if (url && applyUrlToImg(img, url)) return;
          scheduleImageGenWarehouseRepair();
        });
        return true;
      }
      return false;
    }
    let card = (window.__promptHubCards || []).find((c) => c.id === cardId);
    if (!card && isOwnCommunityGridImg(img)) {
      const refPath = window.SupabaseSync?.storagePathFromRef?.(img.getAttribute('data-image-ref'));
      const refPrimary = refPath ? refPath.replace(/^\//, '').replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg') : '';
      card = (window.__promptHubCards || []).find((c) => {
        if (!c?.image) return false;
        const p = window.SupabaseSync?.primaryImagePath?.(c.image, c.id);
        return p && refPrimary && p.replace(/^\//, '') === refPrimary;
      });
    }
    if (!card?.image) return false;
    window.SupabaseSync.queueGridBackfill(card, { force: true });
    const media = feedMediaFromImg(img);
    if (media) {
      media.classList.remove('card-media--load-failed');
      if (media.__whBackfillFailTimer) clearTimeout(media.__whBackfillFailTimer);
      media.__whBackfillFailTimer = setTimeout(() => {
        media.__whBackfillFailTimer = null;
        const pending = (media.classList.contains('is-loading') || media.classList.contains('card-media--await'))
          && !media.classList.contains('media-revealed');
        if (pending) {
          window.finalizeWarehouseCardMediaFailure?.(media, img);
        }
      }, 6000);
    }
    return true;
  }

  async function resolveUrl(ref, cardId, extraOpts, img) {
    const inWarehouse = !!img?.closest?.('#cardsContainer');
    const ownIgWh = isOwnImageGenWarehouseImg(img);
    const collect = inWarehouse ? warehouseCollectResolveOpts(img) : null;
    const ownWarehouseCard = inWarehouse && !collect;
    const hit = cachedUrl(ref, cardId, img);
    if (isReadySrc(hit, img)) return hit;
    if (extraOpts?.skip) return '';
    if (!window.SupabaseSync?.resolveDisplayUrl && !window.MediaPipeline?.resolveListUrl) return '';
    try {
      const inIgFeed = isImageGenFeedImg(img);
      const listOnly = inIgFeed || inWarehouse || (isCommunityImg(img) && !isCommunitySideImg(img));
      const communityExtra = ownIgWh ? {} : communityResolveOpts(img);
      if (communityExtra.skip) return '';
      const ownListCard = ownWarehouseCard || ownIgWh;
      const jobId = jobIdFromImg(img) || extraOpts?.jobId || undefined;
      if ((ownWarehouseCard || ownIgWh) && jobId && window.WarehouseThumb?.resolveForCard) {
        const wh = await window.WarehouseThumb.resolveForCard(ref, {
          jobId,
          assetId: cardId,
          cardId,
          galleryIndex: extraOpts?.galleryIndex || 0
        });
        if (isReadySrc(wh, img)) return wh;
      } else if (ownListCard && cardId && window.WarehouseThumb?.resolveForCardModel) {
        const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
        if (card?.genJobId) {
          const wh = await window.WarehouseThumb.resolveForCardModel(card);
          if (isReadySrc(wh, img)) return wh;
        }
      }
      const degradedList = ownListCard
        && window.SupabaseSync?.needsDegradedListPreview?.(ref, cardId);
      const resolveOpts = {
        assetId: cardId,
        cardId,
        jobId: jobIdFromImg(img) || undefined,
        tryAllPaths: communityExtra.tryAllPaths === true,
        allowFullFallback: false,
        listOnly: listOnly ? true : undefined,
        degradedListFull: degradedList === true,
        ...(ownWarehouseCard || ownIgWh ? {} : (collect || communityExtra)),
        ...(extraOpts || {})
      };
      let url = '';
      if (listOnly && window.MediaPipeline?.resolveListUrl) {
        url = await window.MediaPipeline.resolveListUrl(ref, resolveOpts);
      } else if (window.SupabaseSync?.resolveDisplayUrl) {
        url = await window.SupabaseSync.resolveDisplayUrl(ref, {
          ...resolveOpts,
          variant: (ownWarehouseCard || ownIgWh) ? 'grid' : listImageVariant(img),
          allowFullFallback: false,
          listOnly: listOnly ? true : undefined,
          degradedListFull: false
        });
      }
      return isReadySrc(url, img) ? url : '';
    } catch (e) {
      console.warn('[CardImageLoader] resolve failed', ref, e);
      return '';
    }
  }

  function applyUrlToImg(img, url) {
    if (!img || !isReadySrc(url, img)) return false;
    if (window.SupabaseSync?.isWarehouseBlockedFullUrl?.(url, img)) return false;
    const urlPath = window.SupabaseSync?.storagePathFromDisplayUrl?.(url);
    const urlKey = urlPath ? String(urlPath).replace(/^\//, '') : '';
    if (urlKey && window.SupabaseSync?.isPathKnownMissing?.(urlKey)) return false;
    if (urlKey && window.SupabaseSync?.isGridFetchFailed?.(urlKey)) return false;
    if (img.dataset.feedLoadDone === '1' && isImgVisuallyLoaded(img)) return true;
    const media = feedMediaFromImg(img);
    if (!media) return false;
    const quietWhList = isOwnWarehouseListImg(img);
    if (quietWhList) {
      if (!media.classList.contains('card-media--await')) media.classList.add('card-media--await');
      media.classList.remove('is-loading');
    } else {
      media.classList.remove('card-media--await');
      if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
      if (!media.classList.contains('is-loading')) media.classList.add('is-loading');
    }

    const finish = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const srcNow = img.currentSrc || img.src || '';
      const pathNow = window.SupabaseSync?.storagePathFromDisplayUrl?.(srcNow);
      const isGridSrc = pathNow && /_grid\.(jpe?g|webp|png)$/i.test(pathNow);
      if (media.__whBackfillFailTimer) {
        clearTimeout(media.__whBackfillFailTimer);
        media.__whBackfillFailTimer = null;
      }
      if (isGridSrc && (w < 32 || h < 32)) {
        fail();
        return;
      }
      const isWhList = isOwnImageGenWarehouseImg(img) || isOwnWarehouseListImg(img);
      if (isGridSrc && isCommunityImg(img) && !isCommunitySideImg(img) && !isWhList && (w > 720 || h > 720)) {
        fail();
        return;
      }
      img.dataset.feedLoadDone = '1';
      observer?.unobserve(img);
      const cardIdDone = cardIdFromImg(img);
      if (isGridSrc && cardIdDone && (isOwnWarehouseListImg(img) || isOwnImageGenWarehouseImg(img))) {
        window.SupabaseSync?.markGridThumbReady?.(cardIdDone);
      }
      if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      else media.classList.remove('is-loading');
    };

    const fail = () => {
      media.classList.remove('is-loading', 'media-shine-reveal');
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
      const failedUrl = img.currentSrc || img.src || '';
      const failedPath = window.SupabaseSync?.storagePathFromDisplayUrl?.(failedUrl);
      const isGridFail = failedPath && /_grid\.(jpe?g|webp|png)$/i.test(failedPath);
      const ownWh = isOwnImageGenWarehouseImg(img);
      const ownList = isOwnWarehouseListImg(img);
      const retryWarehouseList = () => {
        if (!ref || !ownWh || img.dataset.whListRetried === '1') return false;
        img.dataset.whListRetried = '1';
        window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
        return queueGridBackfillForImg(img);
      };
      const isCommOther = isCommunityImg(img) && !ownList && !isOwnCommunityGridImg(img);
      if (failedPath && window.SupabaseSync?.markGridFetchFailed) {
        if (isGridFail && !isCommOther && !ownWh) window.SupabaseSync.markGridFetchFailed(failedPath);
        else if (!ownWh && !isCommOther && !ownList) window.SupabaseSync?.markPathMissing?.(failedPath);
      } else if (failedPath && !ownWh && !isCommOther && !ownList) {
        window.SupabaseSync?.markPathMissing?.(failedPath);
      }
      if (ownList && failedPath && window.SupabaseSync?.invalidateSignedCache) {
        window.SupabaseSync.invalidateSignedCache(String(failedPath).replace(/^\//, ''));
      }
      if (isGridFail && ref && !img.dataset.primaryRetried) {
        img.dataset.primaryRetried = '1';
        const failedKey = failedPath ? String(failedPath).replace(/^\//, '') : '';
        if (failedKey && failedKey.includes('/generated/')) {
          window.SupabaseSync?.invalidateCorruptGrid?.(failedKey, cardId);
          const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
          if (card) {
            void window.SupabaseSync?.warmGeneratedGridThumb?.(card).then(() => {
              void resolveUrl(ref, cardId, { bypassSignBudget: true }, img).then((retryUrl) => {
                if (retryUrl && applyUrlToImg(img, retryUrl)) return;
                if (ownList) window.finalizeWarehouseCardMediaFailure?.(media, img);
                else media.classList.add('card-media--load-failed');
              });
            });
            return;
          }
        }
        if (ownList || isOwnCommunityGridImg(img)) {
          const primary = window.SupabaseSync?.primaryImagePath?.(ref, cardId);
          const mayUsePrimaryFallback = primary
            && window.SupabaseSync?.gridListNeedsPrimaryFallback?.(primary, cardId) === true;
          if (mayUsePrimaryFallback) {
            const tryPrimary = () => {
              if (!window.SupabaseSync?.resolveListPrimaryFallback) return Promise.resolve('');
              return window.SupabaseSync.resolveListPrimaryFallback(primary, cardId, {});
            };
            void tryPrimary().then((retryUrl) => {
              if (retryUrl && applyUrlToImg(img, retryUrl)) return;
              if (queueGridBackfillForImg(img)) return;
              if (ownList) window.finalizeWarehouseCardMediaFailure?.(media, img);
              else media.classList.add('card-media--load-failed');
            });
            return;
          }
          if (ownWh && retryWarehouseList()) return;
          if (queueGridBackfillForImg(img)) return;
          if (ownList) window.finalizeWarehouseCardMediaFailure?.(media, img);
          else media.classList.add('card-media--load-failed');
          return;
        }
        if (isCommOther) {
          const failedKey = failedPath ? String(failedPath).replace(/^\//, '') : '';
          if (failedKey && window.SupabaseSync?.invalidateSignedCache) {
            window.SupabaseSync.invalidateSignedCache(failedKey);
          }
          const extra = communityResolveOpts(img);
          resolveUrl(ref, cardId, {
            ...extra,
            tryAllPaths: false,
            listOnly: true,
            degradedListFull: false,
            bypassSignBudget: true
          }, img).then((retryUrl) => {
            if (retryUrl && retryUrl !== failedUrl) applyUrlToImg(img, retryUrl);
            else media.classList.add('card-media--load-failed');
          });
          return;
        }
        media.classList.add('card-media--load-failed');
        return;
      }
      if (retryWarehouseList()) return;
      if (window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)) return;
      const inWarehouseOwn = media.closest('#cardsContainer') && !media.closest('.card[data-community-collect="1"]');
      if (inWarehouseOwn && isGridFail && ref && !img.dataset.listPrimaryRetried) {
        img.dataset.listPrimaryRetried = '1';
        if (queueGridBackfillForImg(img)) return;
      }
      if (inWarehouseOwn) {
        window.finalizeWarehouseCardMediaFailure?.(media, img);
        return;
      }
      media.classList.add('card-media--load-failed');
    };

    if (img.src === url && img.complete && img.naturalWidth > 0 && !img.src.includes('data:image/svg')) {
      finish();
      return true;
    }
    if (isImgVisuallyLoaded(img) || (isImgSameDisplayResource(img, url) && img.complete && img.naturalWidth > 8)) {
      finish();
      return true;
    }

    void enqueueDownload(() => new Promise((resolve) => {
      img.decoding = 'async';
      img.addEventListener('load', () => { finish(); resolve(); }, { once: true });
      img.addEventListener('error', () => { fail(); resolve(); }, { once: true });
      img.src = url;
      if (img.complete && img.naturalWidth > 0) finish();
      resolve();
    }));
    return true;
  }

  async function tryMissingPathFallback(img, cardId) {
    if (cardId && typeof window.getCardImageBackup === 'function') {
      const backup = await window.getCardImageBackup(cardId);
      if (backup && String(backup).startsWith('data:') && applyUrlToImg(img, backup)) return;
    }
    const media = img.closest('.card-media, .imagegen-feed-media');
    media?.classList.remove('is-loading');
    if (window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)) return;
    media?.classList.add('card-media--load-failed');
  }

  function loadImg(img) {
    if (window.MobileUI?.isUserInteracting?.() && !isImgNearViewport(img, 120)) return;
    const ref = img.getAttribute('data-image-ref') || '';
    const cardId = cardIdFromImg(img);
    const jobId = jobIdFromImg(img);
    if (!ref && !jobId) return;
    const extra = isOwnImageGenWarehouseImg(img) ? {} : communityResolveOpts(img);
    if (extra.skip) {
      img.closest('.card-media, .imagegen-feed-media')?.remove();
      return;
    }
    const primary = ref ? window.SupabaseSync?.primaryImagePath?.(ref, cardId) : '';
    const commOther = isCommunityImg(img) && !isOwnCommunityGridImg(img) && !isOwnWarehouseListImg(img);
    if (primary && window.SupabaseSync?.isPathKnownMissing?.(primary) && !commOther) {
      if (isOwnImageGenWarehouseImg(img)) {
        window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
        void resolveUrl(ref, cardId, { jobId: jobId || undefined, bypassSignBudget: true }, img).then((url) => {
          if (url) {
            applyUrlToImg(img, url);
            return;
          }
          scheduleImageGenWarehouseRepair();
          window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
        });
        return;
      }
      if (isOwnWarehouseListImg(img)) {
        window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
        void resolveUrl(ref, cardId, { bypassSignBudget: true }, img).then((url) => {
          if (url) {
            applyUrlToImg(img, url);
            return;
          }
          window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
        });
        return;
      }
      void tryMissingPathFallback(img, cardId);
      return;
    }
    const cur = img.currentSrc || img.src || '';
    if (isImgVisuallyLoaded(img) || isReadySrc(cur, img)) return;
    const hit = cachedUrl(ref, cardId, img);
    if (hit) {
      applyUrlToImg(img, hit);
      return;
    }
    if (inflight.has(img)) return;

    const signedRoot = img.closest('#cardsContainer, #imageGenFeed');
    const finishResolve = (url) => {
      inflight.delete(img);
      if (url) {
        applyUrlToImg(img, url);
        return;
      }
      if (isOwnWarehouseListImg(img)) {
        if (!queueGridBackfillForImg(img)) {
          if (isOwnImageGenWarehouseImg(img) && img.dataset.igWhResolveRetry !== '1') {
            img.dataset.igWhResolveRetry = '1';
            const ref = img.getAttribute('data-image-ref');
            const cardId = cardIdFromImg(img);
            window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
            void resolveUrl(ref, cardId, {
              jobId: jobIdFromImg(img) || undefined,
              bypassSignBudget: true
            }, img).then((retryUrl) => {
              if (retryUrl) applyUrlToImg(img, retryUrl);
              else {
                if (!tryAlternateFeedCover(img)) {
                  scheduleImageGenWarehouseRepair();
                  window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
                }
              }
            });
            return;
          }
          if (isOwnImageGenWarehouseImg(img)) {
            if (!tryAlternateFeedCover(img)) scheduleImageGenWarehouseRepair();
          }
          window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
        }
        return;
      }
      if (signedRoot?.id === 'cardsContainer' && !img.closest('.card[data-community-collect="1"]')) {
        window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
      }
    };
    const job = () => resolveUrl(ref, cardId, extra, img).then(finishResolve);
    const startLoad = () => {
      const p = signedRoot
        ? enqueueFeedResolve(job)
        : enqueueResolve(job);
      inflight.set(img, p);
    };
    if (signedRoot?.id) {
      void whenContainerReady(signedRoot.id).then(startLoad);
      return;
    }
    startLoad();
  }

  function isImgNearViewport(img, margin) {
    const rect = img.getBoundingClientRect();
    const m = margin || VISIBLE_LOAD_MARGIN;
    return rect.bottom > -m && rect.top < window.innerHeight + m;
  }

  function prefetchOneCardImg(img) {
    const ref = img?.getAttribute?.('data-image-ref');
    const cardId = cardIdFromImg(img);
    if (!ref || !window.SupabaseSync?.prefetchCardsImages) return;
    const dedupeKey = `one:${ref}|${cardId || ''}`;
    if (prefetchedImageRefs.has(dedupeKey)) return;
    prefetchedImageRefs.add(dedupeKey);
    const card = cardId && (window.__promptHubCards || []).find((c) => c.id === cardId);
    if (card?.image) {
      void window.SupabaseSync.prefetchCardsImages([card], 1400, { maxCards: 1 });
      window.SupabaseSync?.queueGridBackfill?.(card);
    }
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      const media = img.closest('.card-media, .imagegen-feed-media');
      if (media?.classList.contains('card-media--load-failed')) {
        media.classList.remove('card-media--load-failed', 'card-media--await');
        img.style.visibility = '';
        img.style.opacity = '';
        delete img.dataset.whListRetried;
        delete img.dataset.igWhResolveRetry;
        delete img.dataset.feedLoadDone;
        delete img.dataset.primaryRetried;
        delete img.dataset.listPrimaryRetried;
      }
      const cur = img.currentSrc || img.src || '';
      if (isImgVisuallyLoaded(img) || img.dataset.feedLoadDone === '1' || (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8)) {
        observer?.unobserve(img);
        continue;
      }
      prefetchOneCardImg(img);
      loadImg(img);
    }
  }

  function scrollRootFor(container) {
    if (window.MobileUI?.isMobileViewport?.()) {
      if (container?.id === 'cardsContainer' || container?.id === 'imageGenFeed') {
        return document.querySelector('.app-main') || null;
      }
    }
    if (isCommunityContainer(container) && container.classList?.contains('community-feed-columns')) {
      const st = getComputedStyle(container);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'overlay') {
        return container;
      }
    }
    let el = container;
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  const prefetchContainerTimers = new Map();

  function prefetchRefsInContainer(container) {
    if (!container || !window.SupabaseSync?.prefetchCommunityDisplayUrls) return;
    if (isLazyOnlyContainer(container)) return;
    if (!isCommunityContainer(container)) return;
    if (window.PromptHubApi?.isApiRateLimited?.()) return;
    const key = container.id || 'feed';
    clearTimeout(prefetchContainerTimers.get(key));
    prefetchContainerTimers.set(key, setTimeout(() => {
      prefetchContainerTimers.delete(key);
      prefetchRefsInContainerNow(container);
    }, 450));
  }

  function prefetchRefsInContainerNow(container) {
    if (!container || !window.SupabaseSync?.prefetchCommunityDisplayUrls) return;
    if (window.PromptHubApi?.isApiRateLimited?.()) return;
    const cap = 24;
    const items = [];
    const seen = new Set();
    [...container.querySelectorAll('img.card-img[data-image-ref]')].forEach((img) => {
      if (items.length >= cap) return;
      const ref = img.getAttribute('data-image-ref');
      if (!ref || !ref.startsWith('storage://')) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      const authorId = img.dataset?.authorId || img.closest('.card')?.dataset?.authorId || '';
      const cardId = cardIdFromImg(img) || '';
      const key = `${ref}|${authorId}|${cardId}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ ref, authorId: authorId || undefined, cardId: cardId || undefined, id: cardId });
    });
    if (items.length) {
      void window.SupabaseSync.prefetchCommunityDisplayUrls(items, 3500).then(() => {
        window.MediaPipeline?.patchContainerFromCache?.(container, { visibleFirst: true, max: 24 });
        feedImagesIn(container).forEach((img) => {
          const cur = img.currentSrc || img.src || '';
          if (isReadySrc(cur, img)) return;
          const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
          if (hit) applyUrlToImg(img, hit);
        });
      });
    }
  }

  function feedImagesIn(container) {
    if (!container) return [];
    if (container.id === 'imageGenFeed') {
      return [...container.querySelectorAll('img[data-image-ref]')];
    }
    return [...container.querySelectorAll('img.card-img[data-image-ref]')];
  }

  function observeContainer(container) {
    if (!container) return;
    const imgs = feedImagesIn(container);
    const isIgFeed = container.id === 'imageGenFeed';
    const lazyOnly = isLazyOnlyContainer(container);

    if (!lazyOnly) prefetchRefsInContainer(container);

    if (container.id === 'imageGenFeed') {
      let eager = 0;
      const cap = igFeedPatchMax();
      sortImgsByViewport(imgs).forEach((img) => {
        if (isImgVisuallyLoaded(img)) return;
        if (eager >= cap) return;
        const cur = img.currentSrc || img.src || '';
        if (isReadySrc(cur, img)) return;
        if (isImgNearViewport(img, 480)) {
          eager += 1;
          loadImg(img);
        }
      });
    } else if (lazyOnly && container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.()) {
      let eager = 0;
      const eagerCap = cardEagerCap();
      sortImgsByViewport(imgs).forEach((img) => {
        if (isImgVisuallyLoaded(img)) return;
        if (eager >= eagerCap) return;
        const cur = img.currentSrc || img.src || '';
        if (isReadySrc(cur, img)) return;
        const ref = img.getAttribute('data-image-ref');
        const cardId = cardIdFromImg(img);
        const hit = cachedUrl(ref, cardId, img);
        if (hit) {
          applyUrlToImg(img, hit);
          return;
        }
        if (isImgNearViewport(img, 960)) {
          eager += 1;
          loadImg(img);
        }
      });
    } else if (!lazyOnly && (container.id === 'cardsContainer' || isCommunityContainer(container))) {
      let eager = 0;
      const mobileWh = container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
      const firstScreenCap = isCommunityContainer(container) ? 24 : (mobileWh ? cardFirstScreenCap() : 16);
      const nearPx = isCommunityContainer(container) ? 960 : (mobileWh ? 720 : 640);
      imgs.forEach((img) => {
        const cur = img.currentSrc || img.src || '';
        if (isReadySrc(cur, img)) return;
        if (eager < firstScreenCap && isImgNearViewport(img, nearPx)) {
          eager += 1;
          loadImg(img);
        }
      });
    }

    if (!('IntersectionObserver' in window)) {
      if (lazyOnly) {
        imgs.slice(0, 4).forEach((img) => loadImg(img));
      } else {
        void window.SupabaseSync?.hydrateImageElements?.(container, {
          onlyMissing: true,
          communityBoost: isCommunityContainer(container)
        });
      }
      return;
    }

    if (observedRoot !== container) {
      if (observedRoot) clearFeedObserverBindings(observedRoot);
      observer?.disconnect();
      observedRoot = container;
      const rootMargin = lazyOnly
        ? (container.id === 'imageGenFeed'
          ? '320px 0px'
          : container.id === 'cardsContainer'
            ? (window.MobileUI?.isMobileViewport?.() ? '520px 0px' : '320px 0px')
            : '140px 0px')
        : isCommunityContainer(container)
          ? '360px 0px'
          : (container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.()
            ? '240px 0px'
            : '160px 0px');
      observer = new IntersectionObserver(onIntersect, {
        root: scrollRootFor(container) || null,
        rootMargin,
        threshold: 0.01
      });
    }

    imgs.forEach((img) => {
      if (isImgVisuallyLoaded(img)) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
      const hit = cachedUrl(ref, cardId, img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (lazyOnly) {
        observer.observe(img);
        img.dataset.feedObserverBound = '1';
        return;
      }
      if (isImgNearViewport(img)) {
        loadImg(img);
        return;
      }
      observer.observe(img);
      img.dataset.feedObserverBound = '1';
    });
  }

  function disconnect() {
    if (observedRoot) clearFeedObserverBindings(observedRoot);
    observer?.disconnect();
    observer = null;
    observedRoot = null;
  }

  function prefetchItemsForContainer(container, items) {
    const mobileWh = container?.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
    const cap = container?.id === 'imageGenFeed'
      ? igFeedPrefetchMax()
      : (mobileWh ? (window.MobileUI?.getPerf?.()?.warehousePrefetchCap ?? 24) : 8);
    const list = (items || []).slice(0, cap);
    if (!list.length) return Promise.resolve();
    const hasCardIds = list.every((x) => x && x.id && x.image);
    if (hasCardIds && window.MediaPipeline?.prefetchList) {
      return window.MediaPipeline.prefetchList(list, 2600);
    }
    if (hasCardIds && window.SupabaseSync?.prefetchCardsImages) {
      return window.SupabaseSync.prefetchCardsImages(list, 2600);
    }
    const refs = list.map((x) => x?.image || x?.ref || x).filter(Boolean);
    if (refs.length && window.SupabaseSync?.prefetchDisplayUrlsWithCap) {
      return window.SupabaseSync.prefetchDisplayUrlsWithCap(refs, 2600, { gridOnly: true });
    }
    return Promise.resolve();
  }

  function bindWarehouse(container, pageCards) {
    return bindSignedContainer(container, pageCards);
  }

  function bindFeed(container, items) {
    if (!container) return Promise.resolve();
    const signP = prefetchItemsForContainer(container, items).then(() => {
      window.MediaPipeline?.patchContainerFromCache?.(container, {
        visibleFirst: true,
        max: container.id === 'imageGenFeed' ? igFeedPatchMax() : cardFirstScreenCap()
      });
    });
    setContainerSignReady(container, signP);
    observeContainer(container);
    return signP.catch(() => {});
  }

  function bindSignedContainer(container, items) {
    if (!container) return Promise.resolve();
    const mobileWh = container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
    const patchCache = (o) => {
      if (window.MediaPipeline?.patchContainerFromCache) {
        window.MediaPipeline.patchContainerFromCache(container, o);
      } else {
        window.MediaPipeline?.patchContainerFromCache?.(container, o);
      }
    };
    patchCache({ visibleFirst: true, max: mobileWh ? cardFirstScreenCap() : 8 });
    const signP = prefetchItemsForContainer(container, items).then(() => {
      patchCache({ visibleFirst: true, max: mobileWh ? cardFirstScreenCap() : 14 });
    });
    setContainerSignReady(container, signP);
    observeContainer(container);
    return signP.catch(() => {});
  }

  function syncVisibilityPause() {
    if (document.hidden) {
      disconnect();
      return;
    }
    if (observedRoot) observeContainer(observedRoot);
    const wh = document.getElementById('cardsContainer');
    const ig = document.getElementById('imageGenFeed');
    if (wh && document.getElementById('pageWarehouse')?.classList.contains('active')) {
      boostWarehouseImages(wh, window.MobileUI?.isMobileViewport?.() ? cardEagerCap() : 10);
    }
    if (ig && document.getElementById('pageImageGen')?.classList.contains('active')) {
      boostImageGenWarehouseImages(ig, igFeedBoostMax());
    }
  }

  function boostCommunityFeedImages(container, max = 24) {
    if (!container || !isCommunityContainer(container)) return;
    let n = 0;
    feedImagesIn(container).forEach((img) => {
      if (n >= max) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (isImgNearViewport(img, 1200)) {
        n += 1;
        loadImg(img);
      }
    });
    observeContainer(container);
  }

  function boostImageGenWarehouseImages(container, max) {
    if (!container || container.id !== 'imageGenFeed') return;
    const cap = max ?? igFeedBoostMax();
    const mobile = window.MobileUI?.isMobileViewport?.();
    if (mobile && window.MobileUI?.isUserInteracting?.()) return;
    const nearPx = mobile ? 1800 : 480;
    let n = 0;
    sortImgsByViewport(feedImagesIn(container)).forEach((img) => {
      if (!isOwnImageGenWarehouseImg(img)) return;
      if (n >= cap) return;
      if (isImgVisuallyLoaded(img)) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (isImgNearViewport(img, nearPx)) {
        n += 1;
        loadImg(img);
      }
    });
    observeContainer(container);
  }

  function boostWarehouseImages(container, max = 24) {
    if (!container || container.id !== 'cardsContainer') return;
    const mobile = window.MobileUI?.isMobileViewport?.();
    if (mobile && window.MobileUI?.isUserInteracting?.()) return;
    const cap = max ?? (mobile ? cardEagerCap() : 8);
    let n = 0;
    const nearPx = mobile ? 2000 : 960;
    const imgs = mobile ? sortImgsByViewport(feedImagesIn(container)) : feedImagesIn(container);
    imgs.forEach((img, idx) => {
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      const placeholder = !cur || cur.includes('data:image/svg');
      const inView = isImgNearViewport(img, nearPx);
      if (placeholder || inView || (mobile && idx < cardFirstScreenCap())) {
        if (n >= cap && !inView) return;
        n += 1;
        loadImg(img);
      }
    });
    observeContainer(container);
  }

  document.addEventListener('visibilitychange', syncVisibilityPause);

  window.CardImageLoader = {
    observeContainer,
    disconnect,
    bindWarehouse,
    bindFeed,
    applyUrlToImg,
    loadImg,
    boostCommunityFeedImages,
    boostWarehouseImages,
    boostImageGenWarehouseImages,
    patchVisibleFromCache(container) {
      window.MediaPipeline?.patchContainerFromCache?.(container);
      observeContainer(container);
    }
  };
})();
