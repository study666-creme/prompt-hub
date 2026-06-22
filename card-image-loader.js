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
  const MAX_RESOLVE = 10;
  const FEED_MAX_RESOLVE = 8;
  const MAX_DOWNLOAD = 8;
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

  function pumpDownloadQueue() {
    while (downloadActive < MAX_DOWNLOAD && downloadQueue.length) {
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
    while (resolveActive < MAX_RESOLVE && resolveQueue.length) {
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
    while (feedResolveActive < FEED_MAX_RESOLVE && feedResolveQueue.length) {
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
    return container?.id === 'cardsContainer' || container?.id === 'imageGenFeed';
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
      const url = window.SupabaseSync.getListDisplayImageSrc(ref, cardId, { authorId, assetId: cardId });
      if (url && isReadySrc(url, img)) return url;
      return '';
    }
    const variant = listImageVariant(img);
    return window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, authorId, variant }) || '';
  }

  function isReadySrc(src, img) {
    if (!src || !src.startsWith('http') || src.includes('data:image/svg')) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return false;
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

  function queueGridBackfillForImg(img) {
    const cardId = cardIdFromImg(img);
    if (!cardId || !window.SupabaseSync?.queueGridBackfill) return false;
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
      media.classList.add('is-loading', 'card-media--await');
      media.classList.remove('card-media--load-failed');
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
      const degradedList = ownListCard
        && window.SupabaseSync?.needsDegradedListPreview?.(ref, cardId);
      const resolveOpts = {
        assetId: cardId,
        cardId,
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
    const media = feedMediaFromImg(img);
    if (!media) return false;
    media.classList.remove('card-media--await');
    if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
    if (!media.classList.contains('is-loading')) media.classList.add('is-loading');

    const finish = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const srcNow = img.currentSrc || img.src || '';
      const pathNow = window.SupabaseSync?.storagePathFromDisplayUrl?.(srcNow);
      const isGridSrc = pathNow && /_grid\.(jpe?g|webp|png)$/i.test(pathNow);
      if (isGridSrc && (w < 32 || h < 32)) {
        fail();
        return;
      }
      if (isGridSrc && isCommunityImg(img) && !isCommunitySideImg(img) && (w > 720 || h > 720)) {
        fail();
        return;
      }
      img.dataset.feedLoadDone = '1';
      observer?.unobserve(img);
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
        if (isGridFail && !isCommOther) window.SupabaseSync.markGridFetchFailed(failedPath);
        else if (!ownWh && !isCommOther && !ownList) window.SupabaseSync?.markPathMissing?.(failedPath);
      } else if (failedPath && !ownWh && !isCommOther && !ownList) {
        window.SupabaseSync?.markPathMissing?.(failedPath);
      }
      if (ownList && failedPath && window.SupabaseSync?.invalidateSignedCache) {
        window.SupabaseSync.invalidateSignedCache(String(failedPath).replace(/^\//, ''));
      }
      if (isGridFail && ref && !img.dataset.primaryRetried) {
        img.dataset.primaryRetried = '1';
        if (ownList || isOwnCommunityGridImg(img)) {
          const primary = window.SupabaseSync?.primaryImagePath?.(ref, cardId);
          const tryPrimary = () => {
            if (!primary || !window.SupabaseSync?.resolveListPrimaryFallback) return Promise.resolve('');
            return window.SupabaseSync.resolveListPrimaryFallback(primary, cardId, {});
          };
          void tryPrimary().then((retryUrl) => {
            if (retryUrl && applyUrlToImg(img, retryUrl)) return;
            if (queueGridBackfillForImg(img)) return;
            media.classList.add('card-media--load-failed');
          });
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
        media.classList.add('card-media--load-failed');
        return;
      }
      media.classList.add('card-media--load-failed');
    };

    if (img.src === url && img.complete && img.naturalWidth > 0 && !img.src.includes('data:image/svg')) {
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
    const ref = img.getAttribute('data-image-ref');
    if (!ref) return;
    const extra = isOwnImageGenWarehouseImg(img) ? {} : communityResolveOpts(img);
    if (extra.skip) {
      img.closest('.card-media, .imagegen-feed-media')?.remove();
      return;
    }
    const cardId = cardIdFromImg(img);
    const primary = window.SupabaseSync?.primaryImagePath?.(ref, cardId);
    const commOther = isCommunityImg(img) && !isOwnCommunityGridImg(img) && !isOwnWarehouseListImg(img);
    if (primary && window.SupabaseSync?.isPathKnownMissing?.(primary) && !commOther) {
      if (isOwnImageGenWarehouseImg(img) || isOwnWarehouseListImg(img)) {
        window.SupabaseSync?.clearPathMissingForCard?.(cardId, ref);
      } else {
        void tryMissingPathFallback(img, cardId);
        return;
      }
    }
    const cur = img.currentSrc || img.src || '';
    if (isReadySrc(cur, img)) return;
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
      if (isOwnWarehouseListImg(img)) queueGridBackfillForImg(img);
    };
    const job = () => resolveUrl(ref, cardId, extra, img).then(finishResolve);
    const startLoad = () => {
      const p = signedRoot
        ? enqueueFeedResolve(job)
        : enqueueResolve(job);
      inflight.set(img, p);
    };
    if (signedRoot?.id) {
      void whenContainerSigned(signedRoot.id).then(startLoad);
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
      const cur = img.currentSrc || img.src || '';
      if (img.dataset.feedLoadDone === '1' || (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8)) {
        observer?.unobserve(img);
        continue;
      }
      prefetchOneCardImg(img);
      loadImg(img);
    }
  }

  function scrollRootFor(container) {
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
      const cap = 28;
      imgs.forEach((img) => {
        if (eager >= cap) return;
        const cur = img.currentSrc || img.src || '';
        if (isReadySrc(cur, img)) return;
        if (isImgNearViewport(img, 720)) {
          eager += 1;
          loadImg(img);
        }
      });
    } else if (!lazyOnly && (container.id === 'cardsContainer' || isCommunityContainer(container))) {
      let eager = 0;
      const mobileWh = container.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
      const firstScreenCap = isCommunityContainer(container) ? 24 : (mobileWh ? 14 : 16);
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
      observer?.disconnect();
      observedRoot = container;
      const rootMargin = lazyOnly
        ? (container.id === 'imageGenFeed'
          ? '480px 0px'
          : container.id === 'cardsContainer' ? '320px 0px' : '140px 0px')
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
        return;
      }
      if (isImgNearViewport(img)) {
        loadImg(img);
        return;
      }
      observer.observe(img);
    });
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
  }

  function prefetchItemsForContainer(container, items) {
    const mobileWh = container?.id === 'cardsContainer' && window.MobileUI?.isMobileViewport?.();
    const cap = container?.id === 'imageGenFeed' ? 28 : (mobileWh ? 14 : 8);
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
        max: container.id === 'imageGenFeed' ? 28 : 6
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
    patchCache({ visibleFirst: true, max: mobileWh ? 16 : 8 });
    const signP = prefetchItemsForContainer(container, items).then(() => {
      patchCache({ visibleFirst: true, max: mobileWh ? 24 : 14 });
    });
    setContainerSignReady(container, signP);
    observeContainer(container);
    return signP.catch(() => {});
  }

  function syncVisibilityPause() {
    if (document.hidden) disconnect();
    else if (observedRoot) observeContainer(observedRoot);
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

  function boostImageGenWarehouseImages(container, max = 32) {
    if (!container || container.id !== 'imageGenFeed') return;
    let n = 0;
    feedImagesIn(container).forEach((img) => {
      if (!isOwnImageGenWarehouseImg(img)) return;
      if (n >= max) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (isImgNearViewport(img, 960)) {
        n += 1;
        loadImg(img);
      }
    });
    observeContainer(container);
  }

  function boostWarehouseImages(container, max = 32) {
    if (!container || container.id !== 'cardsContainer') return;
    let n = 0;
    feedImagesIn(container).forEach((img) => {
      if (n >= max) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur, img) && img.complete && img.naturalWidth > 8) return;
      const hit = cachedUrl(img.getAttribute('data-image-ref'), cardIdFromImg(img), img);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (isImgNearViewport(img, 900)) {
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
