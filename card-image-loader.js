/**
 * 卡片库 / 社区图片：视口优先加载 + IntersectionObserver 懒加载
 */
(function () {
  let observer = null;
  let observedRoot = null;
  const inflight = new WeakMap();
  const resolveQueue = [];
  let resolveActive = 0;
  const MAX_RESOLVE = 16;
  const VISIBLE_LOAD_MARGIN = 240;

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

  function cardIdFromImg(img) {
    return img.dataset?.sourceCardId
      || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-id]')?.dataset?.id
      || img.closest('.card[data-post-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-post-id]')?.dataset?.postId
      || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
  }

  function communityResolveOpts(img) {
    const inFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid, #communitySideBody, #creationsSideBody, .community-side-img-btn');
    if (!inFeed) return {};
    const authorId = img.dataset?.authorId || img.closest('.card')?.dataset?.authorId || '';
    const ref = img.getAttribute('data-image-ref') || '';
    if (window.SupabaseSync?.isInvalidMediaUrl?.(ref)) return { skip: true };
    const path = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
    const uid = window.SupabaseSync?.getUserId?.();
    const own = !!(path && uid && path.replace(/^\//, '').startsWith(`${uid}/`));
    return {
      communityFeed: !window.SupabaseSync?.isLoggedIn?.() || !own,
      authorId: authorId || undefined,
      cardId: cardIdFromImg(img),
      tryAllPaths: !own
    };
  }

  function cachedUrl(ref, cardId, img) {
    const inWarehouse = !!img?.closest?.('#cardsContainer');
    const variant = inWarehouse ? 'full' : 'grid';
    let url = window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant }) || '';
    if (!url && inWarehouse) {
      url = window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant: 'grid' }) || '';
    }
    return url;
  }

  function isReadySrc(src) {
    if (!src || !src.startsWith('http') || src.includes('data:image/svg')) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return false;
    if (window.SupabaseSync?.isValidSignedDisplayUrl) {
      return window.SupabaseSync.isValidSignedDisplayUrl(src);
    }
    if (window.SupabaseSync?.isFreshSignedDisplayUrl) {
      return window.SupabaseSync.isFreshSignedDisplayUrl(src, 60000);
    }
    return true;
  }

  async function resolveUrl(ref, cardId, extraOpts, img) {
    const inWarehouse = !!img?.closest?.('#cardsContainer');
    const hit = cachedUrl(ref, cardId, img);
    if (isReadySrc(hit)) return hit;
    if (extraOpts?.skip) return '';
    if (!window.SupabaseSync?.resolveDisplayUrl) return '';
    try {
      const url = await window.SupabaseSync.resolveDisplayUrl(ref, {
        assetId: cardId,
        variant: inWarehouse ? 'full' : 'grid',
        tryAllPaths: inWarehouse || extraOpts?.tryAllPaths === true,
        ...(extraOpts || {})
      });
      return isReadySrc(url) ? url : '';
    } catch (e) {
      console.warn('[CardImageLoader] resolve failed', ref, e);
      return '';
    }
  }

  function applyUrlToImg(img, url) {
    if (!img || !isReadySrc(url)) return false;
    const media = img.closest('.card-media');
    if (!media) return false;
    media.classList.remove('card-media--await');
    if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
    if (!media.classList.contains('is-loading')) media.classList.add('is-loading');
    const finish = () => {
      if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      else media.classList.remove('is-loading');
    };
    const fail = () => {
      media.classList.remove('is-loading', 'media-shine-reveal');
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
      if (ref && img.dataset.imgRetry !== '1') {
        img.dataset.imgRetry = '1';
        window.SupabaseSync?.invalidateSignedCacheForRef?.(ref, cardId);
        const extra = communityResolveOpts(img);
        void resolveUrl(ref, cardId, { ...extra, tryAllPaths: true }, img).then((retryUrl) => {
          if (retryUrl) applyUrlToImg(img, retryUrl);
          else if (!window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)) {
            media.classList.add('card-media--load-failed');
          }
        });
        return;
      }
      if (window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)) return;
      media.classList.add('card-media--load-failed');
    };
    if (img.src === url && img.complete && img.naturalWidth > 0 && !img.src.includes('data:image/svg')) {
      finish();
      return true;
    }
    img.decoding = 'async';
    img.addEventListener('load', finish, { once: true });
    img.addEventListener('error', fail, { once: true });
    img.src = url;
    if (img.complete && img.naturalWidth > 0) finish();
    return true;
  }

  async function tryMissingPathFallback(img, cardId) {
    if (cardId && typeof window.getCardImageBackup === 'function') {
      const backup = await window.getCardImageBackup(cardId);
      if (backup && String(backup).startsWith('data:') && applyUrlToImg(img, backup)) return;
    }
    const media = img.closest('.card-media');
    media?.classList.remove('is-loading');
    if (window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)) return;
    media?.classList.add('card-media--load-failed');
  }

  function loadImg(img) {
    const ref = img.getAttribute('data-image-ref');
    if (!ref) return;
    const extra = communityResolveOpts(img);
    if (extra.skip) {
      img.closest('.card-media')?.remove();
      return;
    }
    const cardId = cardIdFromImg(img);
    const primary = window.SupabaseSync?.primaryImagePath?.(ref, cardId);
    if (primary && window.SupabaseSync?.isPathKnownMissing?.(primary)) {
      void tryMissingPathFallback(img, cardId);
      return;
    }
    const cur = img.currentSrc || img.src || '';
    if (isReadySrc(cur)) return;
    const hit = cachedUrl(ref, cardId, img);
    if (hit) {
      applyUrlToImg(img, hit);
      return;
    }
    if (inflight.has(img)) return;
    const run = () => resolveUrl(ref, cardId, extra, img).then((url) => {
      inflight.delete(img);
      if (url) applyUrlToImg(img, url);
    });
    const p = img.closest('#cardsContainer') ? run() : enqueueResolve(() => resolveUrl(ref, cardId, extra, img)).then((url) => {
      inflight.delete(img);
      if (url) applyUrlToImg(img, url);
    });
    inflight.set(img, p);
  }

  function isImgNearViewport(img, margin) {
    const rect = img.getBoundingClientRect();
    const m = margin || VISIBLE_LOAD_MARGIN;
    return rect.bottom > -m && rect.top < window.innerHeight + m;
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      loadImg(entry.target);
      observer?.unobserve(entry.target);
    }
  }

  function scrollRootFor(container) {
    let el = container;
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  function prefetchRefsInContainer(container) {
    if (!container || !window.SupabaseSync?.prefetchDisplayUrls) return;
    const cap = container.id === 'cardsContainer' ? 24 : 32;
    const refs = [];
    [...container.querySelectorAll('img.card-img[data-image-ref]')].forEach((img) => {
      if (refs.length >= cap) return;
      const ref = img.getAttribute('data-image-ref');
      if (!ref || !ref.startsWith('storage://')) return;
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur)) return;
      refs.push(ref);
    });
    if (refs.length) void window.SupabaseSync.prefetchDisplayUrls(refs);
  }

  function observeContainer(container) {
    if (!container) return;
    const imgs = [...container.querySelectorAll('img.card-img[data-image-ref]')];
    prefetchRefsInContainer(container);
    if (container.id === 'cardsContainer') {
      imgs.forEach((img) => {
        const cur = img.currentSrc || img.src || '';
        if (isReadySrc(cur)) return;
        loadImg(img);
      });
    }
    if (!('IntersectionObserver' in window)) {
      void window.SupabaseSync?.hydrateImageElements?.(container, { onlyMissing: true });
      return;
    }
    if (observedRoot !== container) {
      observer?.disconnect();
      observedRoot = container;
      const rootMargin = container.id === 'cardsContainer' ? '320px 0px' : '160px 0px';
      observer = new IntersectionObserver(onIntersect, {
        root: scrollRootFor(container) || null,
        rootMargin,
        threshold: 0.01
      });
    }
    imgs.forEach((img) => {
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur)) return;
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
    const hit = cachedUrl(ref, cardId, img);
    if (hit) {
      applyUrlToImg(img, hit);
      return;
    }
    if (container.id === 'cardsContainer' || isImgNearViewport(img)) {
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

  async function warmCards(cardList, capMs) {
    if (window.SupabaseSync?.prefetchCardsImages) {
      await window.SupabaseSync.prefetchCardsImages(cardList, capMs);
    } else if (window.SupabaseSync?.prefetchDisplayUrlsWithCap) {
      const imgs = (cardList || []).map((c) => c?.image).filter(Boolean);
      await window.SupabaseSync.prefetchDisplayUrlsWithCap(imgs, capMs);
    }
    if (observedRoot) {
      window.SupabaseSync?.patchImageSrcFromCache?.(observedRoot);
      observeContainer(observedRoot);
    }
  }

  function warmCardsBackground(cardList, capMs) {
    const list = (cardList || []).slice();
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    const capped = list.slice(0, 24);
    const budget = capMs ?? (mobile ? 2800 : 14000);
    const run = () => void warmCards(capped, budget);
    if (mobile && typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1800 });
    } else {
      run();
    }
  }

  function syncVisibilityPause() {
    if (document.hidden) disconnect();
    else if (observedRoot) observeContainer(observedRoot);
  }

  document.addEventListener('visibilitychange', syncVisibilityPause);

  window.CardImageLoader = {
    observeContainer,
    disconnect,
    warmCards,
    warmCardsBackground,
    applyUrlToImg,
    patchVisibleFromCache(container) {
      window.SupabaseSync?.patchImageSrcFromCache?.(container);
      observeContainer(container);
    }
  };
})();
