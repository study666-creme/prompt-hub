/**
 * 卡片库图片加载：视口懒加载 + 后台批量签名（对齐「列表接口自带 URL」类产品体验）
 */
(function () {
  let observer = null;
  let observedRoot = null;
  const inflight = new WeakMap();
  const resolveQueue = [];
  let resolveActive = 0;
  const MAX_RESOLVE = 12;
  const WAREHOUSE_PREFETCH_CAP = 20;
  const WAREHOUSE_IMMEDIATE_LOAD = 14;

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
    return img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
      || img.closest('.card[data-id]')?.dataset?.id
      || img.closest('.card[data-post-id]')?.dataset?.postId
      || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
  }

  function communityResolveOpts(img) {
    const inFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
    if (!inFeed) return {};
    const authorId = img.closest('.card')?.dataset?.authorId || '';
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

  function cachedUrl(ref, cardId) {
    return window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant: 'grid' }) || '';
  }

  function isReadySrc(src) {
    if (!src || !src.startsWith('http') || src.includes('data:image/svg')) return false;
    if (window.SupabaseSync?.isValidSignedDisplayUrl) {
      return window.SupabaseSync.isValidSignedDisplayUrl(src);
    }
    if (window.SupabaseSync?.isFreshSignedDisplayUrl) {
      return window.SupabaseSync.isFreshSignedDisplayUrl(src, 60000);
    }
    return true;
  }

  async function resolveUrl(ref, cardId, extraOpts) {
    const hit = cachedUrl(ref, cardId);
    if (isReadySrc(hit)) return hit;
    if (extraOpts?.skip) return '';
    if (!window.SupabaseSync?.resolveDisplayUrl) return '';
    try {
      const url = await window.SupabaseSync.resolveDisplayUrl(ref, {
        assetId: cardId,
        variant: 'grid',
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
    media.classList.remove('card-media--await');
    const finish = () => {
      if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      else media.classList.remove('is-loading');
    };
    const fail = () => {
      media.classList.remove('is-loading', 'media-shine-reveal');
      media.classList.add('card-media--load-failed');
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
      if (ref && img.dataset.imgRetry !== '1') {
        img.dataset.imgRetry = '1';
        window.SupabaseSync?.invalidateSignedCacheForRef?.(ref, cardId);
        const extra = communityResolveOpts(img);
        void resolveUrl(ref, cardId, { ...extra, tryAllPaths: true }).then((retryUrl) => {
          if (retryUrl) applyUrlToImg(img, retryUrl);
        });
      }
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
    media?.classList.add('card-media--load-failed');
  }

  function loadImg(img) {
    const ref = img.getAttribute('data-image-ref');
    if (!ref) return;
    const extra = communityResolveOpts(img);
    if (extra.skip) {
      const media = img.closest('.card-media');
      media?.remove();
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
    const hit = cachedUrl(ref, cardId);
    if (hit) {
      applyUrlToImg(img, hit);
      return;
    }
    if (inflight.has(img)) return;
    const run = () => resolveUrl(ref, cardId, extra).then((url) => {
      inflight.delete(img);
      if (url) applyUrlToImg(img, url);
    });
    const p = img.closest('#cardsContainer') ? run() : enqueueResolve(() => resolveUrl(ref, cardId, extra)).then((url) => {
      inflight.delete(img);
      if (url) applyUrlToImg(img, url);
    });
    inflight.set(img, p);
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      loadImg(img);
      observer?.unobserve(img);
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
    const warehouse = container.id === 'cardsContainer';
    const communityFeed = container.id === 'communityGrid' || container.id === 'creationsGrid' || container.id === 'userProfileGrid';
    const cap = warehouse ? WAREHOUSE_PREFETCH_CAP : (communityFeed ? 28 : 12);
    const refs = [];
    container.querySelectorAll('img.card-img[data-image-ref]').forEach((img) => {
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
    if (container.id === 'cardsContainer' && container.dataset.fastHydrate === '1') {
      return;
    }
    prefetchRefsInContainer(container);
    if (!('IntersectionObserver' in window)) {
      void window.SupabaseSync?.hydrateImageElements?.(container, { onlyMissing: true });
      return;
    }
    if (observedRoot !== container) {
      disconnect();
      observedRoot = container;
      const rootMargin = window.matchMedia('(max-width: 900px)').matches
      ? '400px 0px'
      : (container.id === 'communityGrid' || container.id === 'creationsGrid'
        ? '240px 0px'
        : (container.id === 'cardsContainer' ? '280px 0px' : '80px 0px'));
      observer = new IntersectionObserver(onIntersect, {
        root: scrollRootFor(container) || null,
        rootMargin,
        threshold: 0.01
      });
    }
    const imgs = [...container.querySelectorAll('img.card-img[data-image-ref]')];
    const warehouse = container.id === 'cardsContainer';
    if (warehouse) {
      imgs.slice(0, WAREHOUSE_IMMEDIATE_LOAD).forEach((img) => loadImg(img));
    }
    imgs.forEach((img, idx) => {
      const cur = img.currentSrc || img.src || '';
      if (isReadySrc(cur)) return;
      const ref = img.getAttribute('data-image-ref');
      const cardId = cardIdFromImg(img);
      const hit = cachedUrl(ref, cardId);
      if (hit) {
        applyUrlToImg(img, hit);
        return;
      }
      if (warehouse && idx < WAREHOUSE_IMMEDIATE_LOAD) return;
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
    void warmCards(cardList, capMs ?? 14000);
  }

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
