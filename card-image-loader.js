/**
 * 列表图片统一管线：批量签名 → 缓存 → 限流下载(≤2) → IntersectionObserver 懒加载
 * 适用：#cardsContainer、#imageGenFeed、社区网格
 */
(function () {
  let observer = null;
  let observedRoot = null;
  const inflight = new WeakMap();
  const queues = window.CardImageLoaderQueues.create();
  function maxResolveCap() { return queues.maxResolveCap(); }
  function feedMaxResolveCap() { return queues.feedMaxResolveCap(); }
  function maxDownloadCap() { return queues.maxDownloadCap(); }
  function igFeedPatchMax() { return queues.igFeedPatchMax(); }
  function igFeedBoostMax() { return queues.igFeedBoostMax(); }
  function igFeedPrefetchMax() { return queues.igFeedPrefetchMax(); }
  function warehousePrefetchCap() { return queues.warehousePrefetchCap(); }
  function warehouseInitialSignCap() { return queues.warehouseInitialSignCap(); }
  function warehouseDesktopPatchCap() { return queues.warehouseDesktopPatchCap(); }
  function cardEagerCap() { return queues.cardEagerCap(); }
  function cardFirstScreenCap() { return queues.cardFirstScreenCap(); }
  function enqueueDownload(fn) { return queues.enqueueDownload(fn); }
  function enqueueResolve(fn) { return queues.enqueueResolve(fn); }
  function enqueueFeedResolve(fn) { return queues.enqueueFeedResolve(fn); }
  const VISIBLE_LOAD_MARGIN = 160;
  const prefetchedImageRefs = new Set();
  const containerSignReady = new Map();
  const warehousePrefetchSigs = new Map();

  function setContainerSignReady(container, promise) {
    const id = container?.id;
    if (!id) return;
    containerSignReady.set(id, (promise || Promise.resolve()).catch(() => {}));
  }

  function whenContainerSigned(containerOrId) {
    const id = typeof containerOrId === 'string' ? containerOrId : containerOrId?.id;
    return containerSignReady.get(id) || Promise.resolve();
  }

  /** 卡片库：不等 batch 签完，视口内 img 立即单独 resolve */
  function whenContainerReady(containerOrId) {
    const id = typeof containerOrId === 'string' ? containerOrId : containerOrId?.id;
    if (id === 'cardsContainer') return Promise.resolve();
    const pending = whenContainerSigned(containerOrId);
    const ms = window.MobileUI?.isMobileViewport?.() ? 320 : 480;
    return Promise.race([pending, new Promise((r) => setTimeout(r, ms))]);
  }

  function clearFeedObserverBindings(container) {
    if (!container) return;
    feedImagesIn(container).forEach((img) => {
      delete img.dataset.feedObserverBound;
    });
  }

  function cardIdFromImg(img) {
    const fromSource = img.dataset?.sourceCardId
      || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId;
    if (fromSource) return fromSource;
    const feedId = img.closest('[data-feed-id]')?.dataset?.feedId || '';
    if (feedId.startsWith('cr_')) return feedId.slice(3);
    if (feedId.startsWith('wh_')) return feedId.slice(3);
    return img.closest('.card[data-id]')?.dataset?.id
      || img.closest('.card[data-post-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-post-id]')?.dataset?.postId
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

  function isOwnImageGenRecentImg(img) {
    return !!img?.closest?.('#imageGenFeed .imagegen-feed-card[data-feed-id^="cr_"]');
  }

  function creationFromRecentFeedImg(img) {
    const feedId = img?.closest?.('.imagegen-feed-card')?.dataset?.feedId || '';
    if (!feedId.startsWith('cr_')) return null;
    const id = feedId.slice(3);
    return window.FeatureDraft?.findCreationById?.(id)
      || (window.FeatureDraft?.getCreations?.() || []).find((c) => c.id === id)
      || null;
  }

  async function resolveRecentCreationFeedUrl(img, opts = {}) {
    const creation = creationFromRecentFeedImg(img);
    if (!creation) return '';
    const jobId = String(creation.jobId || img.getAttribute('data-job-id') || '').replace(/#\d+$/, '');
    const wantFull = opts.preferFull === true;
    const refFromDom = img.getAttribute('data-image-ref') || '';
    const refs = [];
    const pushRef = (u) => {
      if (u && String(u).trim() && !refs.includes(u)) refs.push(String(u).trim());
    };
    pushRef(refFromDom);
    pushRef(creation.image);
    if (window.FeatureDraft?.creationFeedImageCandidates) {
      window.FeatureDraft.creationFeedImageCandidates(creation).forEach(pushRef);
    } else {
      if (Array.isArray(creation.cardImages)) creation.cardImages.forEach(pushRef);
      pushRef(creation.mjCompositeUrl);
      if (Array.isArray(creation.mjGridUrls)) creation.mjGridUrls.forEach(pushRef);
    }
    for (const ref of refs) {
      if (!ref) continue;
      const storageRef = window.SupabaseSync?.isStorageRef?.(ref);
      if (window.MediaPipeline?.resolveListUrl) {
        const list = await window.MediaPipeline.resolveListUrl(ref, {
          assetId: creation.id,
          cardId: creation.id,
          jobId: jobId || undefined,
          tryAllPaths: true,
          bypassSignBudget: storageRef
        });
        if (list && isReadySrc(list, img)) return list;
      }
      if (storageRef && window.SupabaseSync?.resolvePreviewFullUrl) {
        const archived = await window.SupabaseSync.resolvePreviewFullUrl(ref, {
          assetId: creation.id,
          cardId: creation.id,
          jobId: jobId || undefined,
          useJobImageApi: false,
          allowGridFallback: true
        });
        if (archived && isReadySrc(archived, img)) return archived;
      } else if (wantFull && window.MediaPipeline?.resolvePreviewUrl) {
        const full = await window.MediaPipeline.resolvePreviewUrl(ref, {
          assetId: creation.id,
          cardId: creation.id,
          jobId: jobId || undefined,
          useJobImageApi: false,
          allowGridFallback: true
        });
        if (full && isReadySrc(full, img)) return full;
      }
      if (/^https?:\/\//i.test(ref) && !window.SupabaseSync?.isInvalidMediaUrl?.(ref)) {
        if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
          try {
            const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(ref);
            if (blobUrl && isReadySrc(blobUrl, img)) return blobUrl;
          } catch (e) { /* ignore */ }
        }
        if (isReadySrc(ref, img)) return ref;
      }
    }
    if (jobId && window.PromptHubApi?.getGenerationImageUrl) {
      try {
        const r = await window.PromptHubApi.getGenerationImageUrl(jobId);
        const jobUrl = r?.ok ? r.data?.url : '';
        if (jobUrl && window.PromptHubApi?.fetchMediaAsBlobUrl) {
          const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(jobUrl);
          if (blobUrl && isReadySrc(blobUrl, img)) return blobUrl;
        }
        if (
          jobUrl
          && !window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(jobUrl)
          && isReadySrc(jobUrl, img)
        ) return jobUrl;
      } catch (e) { /* ignore */ }
    }
    if (window.FeatureDraft?.resolveImageGenFullUrl && wantFull) {
      const feedKey = `cr_${creation.id}`;
      return window.FeatureDraft.resolveImageGenFullUrl('recent', creation.id, feedKey, img) || '';
    }
    return '';
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
    return container?.id === 'cardsContainer'
      || container?.id === 'imageGenFeed'
      || isCommunityContainer(container);
  }

  const IMAGEGEN_FEED_PATCH_MAX = 12;
  const IMAGEGEN_FEED_BOOST_MAX = 12;
  const IMAGEGEN_FEED_PREFETCH_MAX = 12;

  function sortImgsByViewport(imgs, container) {
    const root = container ? scrollRootFor(container) : null;
    const isVisible = (img) => {
      const rect = img.getBoundingClientRect();
      if (root && root !== document.body && root !== document.documentElement) {
        const rr = root.getBoundingClientRect();
        return rect.bottom > rr.top - 40 && rect.top < rr.bottom + 40;
      }
      return rect.bottom > -40 && rect.top < window.innerHeight + 40;
    };
    return [...imgs].sort((a, b) => {
      const aVis = isVisible(a);
      const bVis = isVisible(b);
      if (aVis !== bVis) return aVis ? -1 : 1;
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
  }

  function allowWarehouseFullFallback(img) {
    return !!(img?.dataset?.allowFullFallback === '1'
      && isOwnWarehouseListImg(img));
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
      const url = window.SupabaseSync.getListDisplayImageSrc(ref, cardId, {
        authorId,
        assetId: cardId,
        jobId: jobIdFromImg(img) || undefined,
        allowFullFallback: allowWarehouseFullFallback(img)
      });
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
      if (!window.SupabaseSync?.isGridDisplayUrl?.(src) && !allowWarehouseFullFallback(img)) return false;
    }
    if (img && isOwnImageGenRecentImg(img)) {
      if (window.SupabaseSync?.isValidSignedDisplayUrl?.(src)) return true;
      if (/^https?:\/\//i.test(src) && !window.SupabaseSync?.isInvalidMediaUrl?.(src)) return true;
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

  function recoverWarehouseListGeneratedImg(img, media) {
    const cardEl = img?.closest?.('#cardsContainer .card[data-id]');
    if (!cardEl || cardEl.dataset.communityCollect === '1') return false;
    if (img.dataset.whServerRecover === '1') return false;
    const cardId = cardEl.dataset.id;
    const cardModel = (window.__promptHubCards || []).find((c) => c.id === cardId);
    if (!cardModel) return false;
    const jobId = cardModel.genJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(cardModel);
    if (!jobId) return false;
    const ref = img.getAttribute('data-image-ref') || cardModel.image || '';
    if (!window.SupabaseSync?.isGeneratedStoragePath?.(ref) && !jobId) return false;
    img.dataset.whServerRecover = '1';
    window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
    const applyOrFail = (url) => {
      if (url && applyUrlToImg(img, url)) return;
      window.finalizeWarehouseCardMediaFailure?.(media || feedMediaFromImg(img), img);
    };
    if (window.WarehouseThumb?.resolveForCardModel) {
      void window.WarehouseThumb.resolveForCardModel(cardModel).then(applyOrFail);
      return true;
    }
    if (window.WarehouseThumb?.resolveForCard) {
      void window.WarehouseThumb.resolveForCard(ref, {
        jobId: String(jobId).replace(/#\d+$/, ''),
        assetId: cardId,
        cardId
      }).then(applyOrFail);
      return true;
    }
    return false;
  }

  function queueGridBackfillForImg(img) {
    const inCardsContainer = !!img?.closest?.('#cardsContainer');
    if (inCardsContainer) {
      const refPath = window.SupabaseSync?.storagePathFromRef?.(img.getAttribute('data-image-ref') || '') || '';
      if (refPath.replace(/^\//, '').includes('/generated/')) {
        return recoverWarehouseListGeneratedImg(img, feedMediaFromImg(img));
      }
      return false;
    }
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
      const allowFullListFallback = allowWarehouseFullFallback(img);
      const jobId = jobIdFromImg(img) || extraOpts?.jobId || undefined;
      const degradedList = ownListCard
        && window.SupabaseSync?.needsDegradedListPreview?.(ref, cardId);
      const resolveOpts = {
        assetId: cardId,
        cardId,
        jobId: jobIdFromImg(img) || undefined,
        tryAllPaths: communityExtra.tryAllPaths === true,
        allowFullFallback: allowFullListFallback,
        listOnly: listOnly ? true : undefined,
        degradedListFull: degradedList === true || allowFullListFallback,
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
          allowFullFallback: allowFullListFallback,
          listOnly: listOnly ? true : undefined,
          degradedListFull: allowFullListFallback
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
    const targetLoadKey = urlKey || url;
    if (urlKey && window.SupabaseSync?.isPathKnownMissing?.(urlKey)) return false;
    if (urlKey && window.SupabaseSync?.isGridFetchFailed?.(urlKey)) {
      const ref = img.getAttribute('data-image-ref');
      const cid = cardIdFromImg(img);
      const cached = ref && window.SupabaseSync?.getListDisplayImageSrc?.(ref, cid, {
        allowFullFallback: allowWarehouseFullFallback(img)
      });
      if (!cached || cached !== url) return false;
    }
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

    const currentSrc = img.currentSrc || img.src || '';
    const currentPlaceholder = !currentSrc || currentSrc.includes('data:image/svg');
    const sameTargetLoading = !currentPlaceholder
      && !img.complete
      && (currentSrc === url || isImgSameDisplayResource(img, url));
    const pendingKey = img.dataset.feedLoadingKey || '';
    if (!img.complete && (
      img.dataset.feedLoadingUrl === url
      || (targetLoadKey && pendingKey === targetLoadKey)
      || sameTargetLoading
    )) {
      img.dataset.feedLoadingUrl = url;
      if (targetLoadKey) img.dataset.feedLoadingKey = targetLoadKey;
      return true;
    }

    let requestToken = '';
    const isStaleRequest = () => requestToken
      && img.dataset.feedLoadToken
      && img.dataset.feedLoadToken !== requestToken;
    const clearPending = () => {
      if (requestToken) {
        if (img.dataset.feedLoadToken && img.dataset.feedLoadToken !== requestToken) return false;
        delete img.dataset.feedLoadToken;
        delete img.dataset.feedLoadingUrl;
        delete img.dataset.feedLoadingKey;
        return true;
      }
      if (!img.dataset.feedLoadToken
        || img.dataset.feedLoadingUrl === url
        || (targetLoadKey && img.dataset.feedLoadingKey === targetLoadKey)) {
        delete img.dataset.feedLoadingUrl;
        delete img.dataset.feedLoadingKey;
      }
      return true;
    };

    const finish = () => {
      if (isStaleRequest()) return;
      clearPending();
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
      if (isStaleRequest()) return;
      clearPending();
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
          if (ownList && recoverWarehouseListGeneratedImg(img, media)) return;
          if (img.dataset.whWarmTried === '1') {
            if (ownList) window.finalizeWarehouseCardMediaFailure?.(media, img);
            else media.classList.add('card-media--load-failed');
            return;
          }
          img.dataset.whWarmTried = '1';
          window.SupabaseSync?.invalidateCorruptGrid?.(failedKey, cardId);
          const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
          if (card && window.WarehouseThumb?.resolveForCardModel) {
            void window.WarehouseThumb.resolveForCardModel(card).then((retryUrl) => {
              if (retryUrl && applyUrlToImg(img, retryUrl)) return;
              if (ownList) window.finalizeWarehouseCardMediaFailure?.(media, img);
              else media.classList.add('card-media--load-failed');
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

    img.dataset.feedLoadingUrl = url;
    if (targetLoadKey) img.dataset.feedLoadingKey = targetLoadKey;
    void enqueueDownload(() => new Promise((resolve) => {
      const pendingStillMatches = img.dataset.feedLoadingUrl === url
        || (targetLoadKey && img.dataset.feedLoadingKey === targetLoadKey);
      if (!pendingStillMatches) {
        resolve();
        return;
      }
      requestToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      img.dataset.feedLoadToken = requestToken;
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
    const ownWarehouseMobile = !!img?.closest?.('#cardsContainer') && window.MobileUI?.isMobileViewport?.();
    if (window.MobileUI?.isUserInteracting?.()) {
      const whRoot = ownWarehouseMobile ? scrollRootFor(document.getElementById('cardsContainer')) : null;
      const nearEnough = ownWarehouseMobile
        ? isImgNearViewport(img, 900, whRoot)
        : isImgNearViewport(img, 120);
      if (!nearEnough) return;
    }
    const ref = img.getAttribute('data-image-ref') || '';
    const cardId = cardIdFromImg(img);
    const jobId = jobIdFromImg(img);
    if (!ref && !jobId) return;
    const extra = isOwnImageGenWarehouseImg(img) ? {} : communityResolveOpts(img);
    if (extra.skip) {
      img.closest('.card-media, .imagegen-feed-media')?.remove();
      return;
    }
    if (isOwnImageGenRecentImg(img)) {
      const p = resolveRecentCreationFeedUrl(img).then((url) => {
        inflight.delete(img);
        if (url) {
          applyUrlToImg(img, url);
          return;
        }
        window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img);
      });
      inflight.set(img, p);
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

  function isImgNearViewport(img, margin, container) {
    const rect = img.getBoundingClientRect();
    const m = margin == null ? VISIBLE_LOAD_MARGIN : margin;
    const root = container
      ? scrollRootFor(container)
      : scrollRootFor(img?.closest?.('#cardsContainer, #imageGenFeed, .community-feed-columns'));
    if (root && root !== document.body && root !== document.documentElement) {
      const rr = root.getBoundingClientRect();
      return rect.bottom > rr.top - m && rect.top < rr.bottom + m;
    }
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
    if (card?.id) {
      void window.SupabaseSync.prefetchCardsImages([card], 1400, { maxCards: 1 });
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

  function isUsableScrollRoot(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.height < 120 || rect.width < 120) return false;
    const st = getComputedStyle(el);
    const canScroll = /(auto|scroll|overlay)/.test(st.overflowY || '');
    return canScroll || el.scrollHeight > el.clientHeight + 2;
  }

  function mobileScrollRootFor(container) {
    const appMain = document.querySelector('.app-main');
    if (isUsableScrollRoot(appMain)) return appMain;
    return document.scrollingElement || document.documentElement;
  }

  function scrollRootFor(container) {
    if (window.MobileUI?.isMobileViewport?.()) {
      if (container?.id === 'cardsContainer' || container?.id === 'imageGenFeed') {
        return mobileScrollRootFor(container);
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
    } else if (container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.()) {
      let eager = 0;
      const eagerCap = cardFirstScreenCap();
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
        if (isImgNearViewport(img, 520)) {
          eager += 1;
          loadImg(img);
        }
      });
    } else if (!lazyOnly && (container.id === 'cardsContainer' || isCommunityContainer(container))) {
      let eager = 0;
      const isWh = container.id === 'cardsContainer';
      const firstScreenCap = isCommunityContainer(container) ? 24 : warehousePrefetchCap();
      const nearPx = isCommunityContainer(container) ? 960 : 720;
      const ordered = isWh ? sortImgsByViewport(imgs) : imgs;
      ordered.forEach((img) => {
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
          ? (window.MobileUI?.isMobileViewport?.() ? '720px 0px' : '320px 0px')
          : container.id === 'cardsContainer'
            ? (window.MobileUI?.isMobileViewport?.() ? '640px 0px' : '320px 0px')
            : (window.MobileUI?.isMobileViewport?.() ? '160px 0px' : '280px 0px'))
        : isCommunityContainer(container)
          ? '360px 0px'
          : (container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.()
            ? '260px 0px'
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
        const nearPx = container.id === 'imageGenFeed'
          ? 720
          : container.id === 'cardsContainer'
            ? 640
            : (window.MobileUI?.isMobileViewport?.() ? 160 : 280);
        if (isImgNearViewport(img, nearPx)) loadImg(img);
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

  function observeUnboundImages(container) {
    if (!container || !('IntersectionObserver' in window)) return;
    if (!observer || observedRoot !== container) {
      observeContainer(container);
      return;
    }
    feedImagesIn(container).forEach((img) => {
      if (img.dataset.feedObserverBound === '1') return;
      if (isImgVisuallyLoaded(img)) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      observer.observe(img);
      img.dataset.feedObserverBound = '1';
    });
  }

  function disconnect() {
    if (observedRoot) clearFeedObserverBindings(observedRoot);
    if (observedRoot?.id) warehousePrefetchSigs.delete(observedRoot.id);
    observer?.disconnect();
    observer = null;
    observedRoot = null;
  }

  function prefetchItemsForContainer(container, items) {
    const mobileWh = container?.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
    const cap = container?.id === 'imageGenFeed'
      ? igFeedPrefetchMax()
      : (container?.id === 'cardsContainer'
        ? warehouseInitialSignCap()
        : (mobileWh ? warehousePrefetchCap() : warehouseInitialSignCap()));
    const list = (items || []).slice(0, cap);
    if (!list.length) return Promise.resolve();
    if (container?.id === 'cardsContainer') {
      const sig = list.map((x) => `${x?.id || ''}:${x?.image || ''}`).join('\u001e');
      if (warehousePrefetchSigs.get(container.id) === sig) return Promise.resolve();
      warehousePrefetchSigs.set(container.id, sig);
    }
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
    const signCap = warehouseInitialSignCap();
    const signList = (pageCards || []).slice(0, signCap);
    const signP = bindSignedContainer(container, signList);
    const mobile = container?.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
    const cap = mobile
      ? (window.MobileUI?.getPerf?.()?.cardEagerCap ?? cardEagerCap())
      : warehousePrefetchCap();
    void signP.finally?.(() => {
      boostWarehouseImages(container, cap);
    });
    return signP;
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
    const patchMax = mobileWh ? cardFirstScreenCap() : warehouseDesktopPatchCap();
    patchCache({ visibleFirst: true, max: patchMax });
    const signP = prefetchItemsForContainer(container, items).then(() => {
      patchCache({ visibleFirst: true, max: patchMax });
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
    const nearPx = window.MobileUI?.isMobileViewport?.() ? 180 : 360;
    let n = 0;
    sortImgsByViewport(feedImagesIn(container), container).forEach((img) => {
      if (n >= max) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (isImgNearViewport(img, nearPx, container)) {
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
      const isRecent = isOwnImageGenRecentImg(img);
      if (!isOwnImageGenWarehouseImg(img) && !isRecent) return;
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

  function boostImageGenRecentImages(container, max) {
    if (!container || container.id !== 'imageGenFeed') return;
    const cap = max ?? igFeedBoostMax();
    let n = 0;
    sortImgsByViewport(feedImagesIn(container)).forEach((img) => {
      if (!isOwnImageGenRecentImg(img)) return;
      if (n >= cap) return;
      if (isImgVisuallyLoaded(img)) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img)) return;
      n += 1;
      loadImg(img);
    });
    observeContainer(container);
  }

  function boostWarehouseImages(container, max = 24) {
    if (!container || container.id !== 'cardsContainer') return;
    const mobile = window.MobileUI?.isMobileViewport?.();
    const defaultCap = mobile ? (window.MobileUI?.getPerf?.()?.cardEagerCap ?? cardEagerCap()) : warehousePrefetchCap();
    const cap = max ?? defaultCap;
    let n = 0;
    const nearPx = mobile ? 640 : 720;
    const imgs = sortImgsByViewport(feedImagesIn(container), container);
    imgs.forEach((img, idx) => {
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      const placeholder = !cur || cur.includes('data:image/svg');
      const inView = isImgNearViewport(img, nearPx, container);
      const shouldLoad = inView || (mobile && (placeholder || idx < cardFirstScreenCap()));
      if (!shouldLoad) return;
      if (n >= cap && !inView) return;
      n += 1;
      loadImg(img);
    });
    observeUnboundImages(container);
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
