/**
 * Feed 图片 URL 解析、hydrate、错误回退（与 features-draft 业务解耦）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  const displayUrlCache = new Map();

  const IMG_LOADING_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="%2318181c" width="16" height="16"/></svg>'
  );

  function d() {
    return deps;
  }

  function isDisplayableImage(v) {
    return d().isDisplayableImage?.(v) ?? false;
  }

  function feedImgStorageAttr(image) {
    if (!image || typeof image !== 'string') return '';
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const esc = d().esc || ((s) => String(s ?? '').replace(/"/g, '&quot;'));
      return ` data-storage-ref="${esc(image)}"`;
    }
    return '';
  }

  function feedAssetIdFromImg(img) {
      if (!img) return undefined;
      return img.dataset?.sourceCardId
        || img.dataset?.postId
        || img.closest?.('.card')?.dataset?.sourceCardId
        || img.closest?.('.card')?.dataset?.id
        || img.closest?.('.card')?.dataset?.postId
        || img.closest?.('.card')?.dataset?.creationId
        || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
    }

    function mergeCollectResolveOpts(assetId, opts = {}) {
      const rawId = String(assetId || '').replace(/^wh_/, '');
      if (!rawId || opts.communityFeed || opts.fromPublicFeed) return opts;
      const card = (window.getWarehouseCardsForImageGen?.() || window.__promptHubCards || [])
        .find((c) => c.id === rawId);
      const collect = card && window.getCommunityCollectImageResolveOpts?.(card);
      if (!collect) return opts;
      return { ...opts, ...collect, fromPublicFeed: true };
    }
  
    async function resolveImageDisplayUrl(image, jobId, assetId, opts = {}) {
      if (!image) return '';
      opts = mergeCollectResolveOpts(assetId, opts);
      if (window.SupabaseSync?.normalizeImageRef) {
        image = window.SupabaseSync.normalizeImageRef(image) || image;
      }
      const publicFeed = opts.fromPublicFeed === true || opts.communityFeed === true;
      const inCommunityGrid = opts.inCommunityGrid === true;
      const authorId = opts.authorId || '';
      const cardId = opts.cardId || assetId || '';
      const cacheKey = (publicFeed ? 'pub:' : '') + (jobId ? `job:${jobId}` : (assetId ? `${assetId}:${image}` : image));
      const listOnly = opts.listOnly === true || opts.allowFullFallback === false;
      const wantFull = !listOnly && opts.preferFull === true;
      if (!publicFeed) {
        const hitKey = wantFull ? `${cacheKey}:f` : cacheKey;
        const hit = displayUrlCache.get(hitKey);
        if (hit) return hit;
      }
      const isStorageLike = window.SupabaseSync?.isStorageRef?.(image) || String(image).startsWith('storage://');
      if (isStorageLike && window.MediaPipeline?.resolveFeedUrl) {
        try {
          const piped = await window.MediaPipeline.resolveFeedUrl(image, {
            assetId,
            cardId: opts.cardId || cardId,
            authorId: authorId || undefined,
            jobId: jobId || undefined,
            listOnly,
            preferFull: wantFull,
            tryAllPaths: opts.tryAllPaths === true || publicFeed || inCommunityGrid,
            communityFeed: publicFeed || inCommunityGrid,
            gridFallbackUrl: opts.gridFallbackUrl || opts.fallbackGridUrl,
            allowGridFallback: opts.allowGridFallback !== false,
            imgEl: opts.imgEl
          });
          if (piped && !piped.startsWith('storage://') && !piped.includes('data:image/svg')) {
            displayUrlCache.set(wantFull ? `${cacheKey}:f` : cacheKey, piped);
            return piped;
          }
        } catch (e) {
          console.warn('[FeedImages] MediaPipeline resolve failed', e);
        }
      }
      let url = '';
      if (!publicFeed) {
        let cached = null;
        if (!listOnly && wantFull) {
          cached = window.SupabaseSync?.getCachedDisplayUrl?.(image, { assetId, variant: 'full' });
        }
        if (!cached) {
          cached = window.SupabaseSync?.getCachedDisplayUrl?.(image, { assetId, variant: 'grid' });
        }
        if (!cached && !listOnly && !wantFull) {
          cached = window.SupabaseSync?.getCachedDisplayUrl?.(image, { assetId, variant: 'full' });
        }
        if (cached && /^https?:\/\//i.test(cached) && !cached.includes('/object/public/')
          && !window.SupabaseSync?.isInvalidMediaUrl?.(cached)) url = cached;
      }
      if (!url && window.SupabaseSync?.resolveDisplayUrl && isStorageLike) {
        try {
          const communityFeed = publicFeed || inCommunityGrid;
          const listOnly = opts.listOnly === true || opts.allowFullFallback === false;
          const ownPath = window.SupabaseSync?.storagePathFromRef?.(image)
            && window.SupabaseSync?.storagePathOwnedByCurrentUser?.(window.SupabaseSync.storagePathFromRef(image));
          const useFull = !listOnly && (opts.preferFull === true || (communityFeed && !inCommunityGrid));
          url = await window.SupabaseSync.resolveDisplayUrl(image, {
            assetId: opts.cardId || assetId,
            authorId: authorId || undefined,
            cardId: opts.cardId || cardId || undefined,
            variant: useFull ? 'full' : 'grid',
            communityFeed,
            tryAllPaths: communityFeed || opts.tryAllPaths === true,
            allowFullFallback: listOnly ? false : undefined,
            listOnly: listOnly || undefined,
            degradedListFull: false
          });
        } catch (e) {
          console.warn('resolve image failed', e);
        }
      }
      const listOnlyResolve = opts.listOnly === true || opts.allowFullFallback === false;
      if (!url && jobId && !listOnlyResolve && window.PromptHubApi?.getGenerationImageUrl) {
        const r = await window.PromptHubApi.getGenerationImageUrl(jobId);
        if (r.ok && r.data?.url) url = r.data.url;
      }
      if (!url && window.SupabaseSync?.resolveDisplayUrl) {
        try {
          const listOnly = opts.listOnly === true || opts.allowFullFallback === false;
          const ownPath = window.SupabaseSync?.storagePathFromRef?.(image)
            && window.SupabaseSync?.storagePathOwnedByCurrentUser?.(window.SupabaseSync.storagePathFromRef(image));
          const useFull = !listOnly && (opts.preferFull === true || (publicFeed && !inCommunityGrid));
          url = await window.SupabaseSync.resolveDisplayUrl(image, {
            assetId,
            authorId: authorId || undefined,
            cardId: cardId || undefined,
            variant: useFull ? 'full' : 'grid',
            communityFeed: opts.fromPublicFeed === true || inCommunityGrid,
            tryAllPaths: opts.fromPublicFeed === true || inCommunityGrid,
            allowFullFallback: listOnly ? false : undefined,
            listOnly: listOnly || undefined,
            degradedListFull: false
          });
        } catch (e) {
          console.warn('resolve image failed', e);
        }
      }
      if (!url && typeof image === 'string' && /^https?:\/\//i.test(image)) {
        const isPrivateBucket = /\/storage\/v1\/object\/(public|sign|authenticated)\/card-images\//i.test(image);
        if (!isPrivateBucket && !window.SupabaseSync?.isInvalidMediaUrl?.(image)) url = image;
      }
      if (url && !url.startsWith('storage://') && !url.startsWith('data:image/svg')
        && (!window.SupabaseSync?.isValidSignedDisplayUrl || window.SupabaseSync.isValidSignedDisplayUrl(url))) {
        displayUrlCache.set(wantFull ? `${cacheKey}:f` : cacheKey, url);
      }
      return url || '';
    }
  

    function imageGenFeedSignOpts(img) {
      const cardEl = img?.closest?.('.imagegen-feed-card[data-feed-id]');
      if (!cardEl || !img.closest('#imageGenFeed')) return null;
      const feedId = cardEl.dataset.feedId || '';
      if (feedId.startsWith('wh_')) {
        const rawId = feedId.slice(3);
        return {
          fromPublicFeed: false,
          authorId: window.SupabaseSync?.getUserId?.() || '',
          cardId: rawId
        };
      }
      const authorId = cardEl.dataset.authorId || img.dataset.authorId || '';
      const postId = feedId;
      if (authorId || postId) {
        return { fromPublicFeed: true, inCommunityGrid: true, authorId, cardId: cardEl.dataset.sourceCardId || postId };
      }
      return null;
    }
  
    function communityImageSignOpts(img) {
      const ig = imageGenFeedSignOpts(img);
      if (ig) return ig;
      const inFeed = !!img?.closest?.(
        '#communityGrid, #creationsGrid, #userProfileGrid, #communitySideBody, #creationsSideBody, .community-side-img-btn'
      );
      if (!inFeed) return { fromPublicFeed: false, authorId: '', cardId: '' };
      const authorId = img.closest('.card')?.dataset?.authorId || '';
      const ref = img.getAttribute('data-image-ref') || '';
      const path = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
      const uid = window.SupabaseSync?.getUserId?.();
      const own = !!(path && uid && path.replace(/^\//, '').startsWith(`${uid}/`));
      const guest = !window.SupabaseSync?.isLoggedIn?.();
      const sidePanel = !!img?.closest?.('#communitySideBody, #creationsSideBody, .community-side-img-btn');
      const inCommunityGrid = !!img?.closest?.('#communityGrid, #creationsGrid, #userProfileGrid');
      return {
        fromPublicFeed: guest || sidePanel || (inCommunityGrid && !own),
        inCommunityGrid,
        authorId:
          img.dataset?.authorId
          || authorId
          || img.closest('.card')?.dataset?.authorId
          || img.closest('[data-author-id]')?.dataset?.authorId
          || '',
        cardId:
          img.dataset?.sourceCardId
          || img.closest('.card')?.dataset?.sourceCardId
          || img.closest('.card')?.dataset?.postId
          || img.dataset?.postId
          || ''
      };
    }
  
    function bindFeedImgErrorFallback(img) {
      if (!img || img.dataset.feedImgErrBound) return;
      img.dataset.feedImgErrBound = '1';
      img.addEventListener('error', () => {
        if (img.dataset.feedImgRetry === '1') return;
        img.dataset.feedImgRetry = '1';
        const ref = img.getAttribute('data-image-ref');
        const jobId = img.getAttribute('data-job-id') || '';
        if (!ref) return;
        const inIgFeed = !!img.closest('#imageGenFeed');
        const ownWhFeed = inIgFeed && !!img.closest('.imagegen-feed-card[data-feed-id^="wh_"]');
        if (ownWhFeed) {
          const cardId = feedAssetIdFromImg(img);
          const card = cardId && (window.__promptHubCards || []).find((c) => c.id === cardId);
          if (card) window.SupabaseSync?.queueGridBackfill?.(card, { force: true });
          return;
        }
        const retryOpts = inIgFeed
          ? { ...communityImageSignOpts(img), listOnly: true, allowFullFallback: false }
          : communityImageSignOpts(img);
        void resolveImageDisplayUrl(ref, jobId || null, feedAssetIdFromImg(img), retryOpts).then((url) => {
          if (url && !url.startsWith('storage://')) {
            img.src = url;
            img.classList.remove('img-load-failed');
            return;
          }
          img.src = IMG_LOADING_PLACEHOLDER;
        });
      });
    }
  
    async function applyFeedImageSrc(img, ref, jobId) {
      const feedMedia = img.closest('.imagegen-feed-media');
      const cardMedia = img.closest('.card-media');
      if (!ref || !isDisplayableImage(ref)) return false;
      bindFeedImgErrorFallback(img);
      const assetId = feedAssetIdFromImg(img);
      const signOpts = communityImageSignOpts(img);
      const fromPublicFeed = signOpts.fromPublicFeed;
      const inImageGenFeed = !!img.closest('#imageGenFeed, .imagegen-mobile-result-track');
      const ownWhFeed = inImageGenFeed && !!img.closest('.imagegen-feed-card[data-feed-id^="wh_"]');
      if (ownWhFeed && window.CardImageLoader?.loadImg) {
        window.CardImageLoader.loadImg(img);
        return true;
      }
      const listOnly = inImageGenFeed || !!cardMedia?.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      let url = fromPublicFeed
        ? ''
        : (displayUrlCache.get(jobId ? `job:${jobId}` : (assetId ? `${assetId}:${ref}` : ref)) || '');
      const inGrid = !!cardMedia?.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      if (!url && !fromPublicFeed) {
        let cached = inGrid
          ? window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId, authorId: signOpts.authorId, variant: 'grid', tryAllPaths: false, listOnly: true })
          : '';
        if (!cached) cached = window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId, variant: 'grid' });
        if (!cached && !listOnly) cached = window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId, variant: 'full' });
        if (cached && typeof cached === 'string' && !cached.startsWith('storage://') && !cached.startsWith('data:image/svg')
          && !cached.includes('/object/public/') && !window.SupabaseSync?.isInvalidMediaUrl?.(cached)) {
          url = cached;
        }
      }
      if (!url) url = await resolveImageDisplayUrl(ref, jobId || null, assetId, {
        ...signOpts,
        cardId: signOpts.cardId || assetId,
        inCommunityGrid: inGrid,
        communityFeed: signOpts.fromPublicFeed || signOpts.communityFeed === true || inGrid,
        listOnly,
        allowFullFallback: listOnly ? false : undefined
      });
      if (!url || url.startsWith('storage://') || url.startsWith('data:image/svg')
        || window.SupabaseSync?.isWarehouseBlockedFullUrl?.(url, img)) {
        if (url && window.SupabaseSync?.isWarehouseBlockedFullUrl?.(url, img)) {
          const card = assetId && (window.__promptHubCards || []).find((c) => c.id === assetId);
          if (card) window.SupabaseSync?.queueGridBackfill?.(card, { force: true });
        }
        feedMedia?.classList.add('is-loading');
        feedMedia?.classList.remove('card-media--missing', 'card-media--load-failed');
        return false;
      }
      const endLoad = () => {
        const media = img.closest('.imagegen-feed-media, .card-media, .community-side-img-btn');
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
        else media?.classList.remove('is-loading');
      };
      const tryFullFallback = () => {
        if (listOnly || inImageGenFeed) {
          const ownWhFeed = inImageGenFeed && !!img.closest('.imagegen-feed-card[data-feed-id^="wh_"]');
          if (ownWhFeed) {
            const card = assetId && (window.__promptHubCards || []).find((c) => c.id === assetId);
            if (card) window.SupabaseSync?.queueGridBackfill?.(card, { force: true });
            feedMedia?.classList.add('is-loading');
            feedMedia?.classList.remove('card-media--load-failed');
            return;
          }
          if (!(cardMedia && removeBrokenCommunityFeedCard(cardMedia))) {
            feedMedia?.classList.add('card-media--load-failed');
            cardMedia?.classList.add('card-media--load-failed');
          }
          endLoad();
          return;
        }
        if (img.dataset.imgFallback === '1' || !window.SupabaseSync?.resolveDisplayUrl) {
          if (!(cardMedia && removeBrokenCommunityFeedCard(cardMedia))) {
            cardMedia?.classList.add('card-media--load-failed');
          }
          endLoad();
          return;
        }
        img.dataset.imgFallback = '1';
        const ownWhFeed = inImageGenFeed && !!img.closest('.imagegen-feed-card[data-feed-id^="wh_"]');
        if (ownWhFeed) {
          const card = assetId && (window.__promptHubCards || []).find((c) => c.id === assetId);
          if (card) {
            window.SupabaseSync?.queueGridBackfill?.(card, { force: true });
            feedMedia?.classList.add('is-loading');
            feedMedia?.classList.remove('card-media--load-failed');
            return;
          }
        }
        const signOpts2 = communityImageSignOpts(img);
        void window.SupabaseSync.resolveDisplayUrl(ref, {
          assetId,
          authorId: signOpts2.authorId || undefined,
          cardId: signOpts2.cardId || assetId || undefined,
          variant: 'full',
          communityFeed: signOpts2.fromPublicFeed || signOpts2.communityFeed === true,
          tryAllPaths: true
        }).then((full) => {
          if (full && /^https?:\/\//i.test(full) && !full.startsWith('storage://')
            && !window.SupabaseSync?.isWarehouseBlockedFullUrl?.(full, img)) {
            img.addEventListener('load', endLoad, { once: true });
            img.src = full;
            if (img.complete && img.naturalWidth > 0) endLoad();
          } else if (!(cardMedia && removeBrokenCommunityFeedCard(cardMedia))) {
            cardMedia?.classList.add('card-media--load-failed');
            endLoad();
          }
        });
      };
      if (img.complete && img.src === url && img.naturalWidth > 0) {
        endLoad();
        return true;
      }
      img.addEventListener('load', endLoad, { once: true });
      img.addEventListener('error', tryFullFallback, { once: true });
      img.src = url;
      img.classList.remove('img-load-failed');
      if (img.complete && img.naturalWidth > 0) endLoad();
      return true;
    }

    /** 社区纯图卡片：仅移除已确认 load-failed 的空壳，勿在 lazy 签名阶段删掉未出图卡片 */
    function removeBrokenCommunityFeedCard(node) {
      if (d().getCommunityFeedPageLoading?.() || window.__PH_FEED_BULK_DRAIN__) return false;
      const media = node?.classList?.contains('card-media') ? node : node?.closest?.('.card-media');
      const card = media?.closest?.('.card.community-post-card') || node?.closest?.('.card.community-post-card');
      if (!card?.closest?.('#communityGrid, #creationsGrid')) return false;
      if (card.querySelector('.card-media img[src^="http"]')) return false;
      const mediaEl = card.querySelector('.card-media');
      if (!mediaEl?.classList.contains('card-media--load-failed')) return false;
      const img = mediaEl.querySelector('img');
      const pending = img?.dataset?.storageRef || img?.dataset?.imageRef
        || mediaEl.classList.contains('is-loading') || mediaEl.classList.contains('card-media--await');
      if (pending) return false;
      card.remove();
      return true;
    }
  
    function pruneEmptyCommunityFeedCards(scope) {
      if (d().getCommunityFeedPageLoading?.() || window.__PH_FEED_BULK_DRAIN__) return;
      const root = scope?.nodeType === 1 ? scope : document.getElementById(String(scope)) || scope;
      if (!root?.querySelectorAll) return;
      const loadingN = root.querySelectorAll(
        '#communityGrid .card-media.is-loading, #creationsGrid .card-media.is-loading, #communityGrid .card-media--await, #creationsGrid .card-media--await'
      ).length;
      if (loadingN > 12) return;
      root.querySelectorAll('#communityGrid .card, #creationsGrid .card').forEach((card) => {
        const media = card.querySelector('.card-media');
        if (!media) return;
        if (!media.classList.contains('card-media--load-failed')) return;
        if (card.offsetHeight >= 32) return;
        const img = media.querySelector('img');
        const src = img?.currentSrc || img?.src || '';
        if (src.startsWith('http') && img?.complete && img.naturalWidth > 8) return;
        if (img?.dataset?.storageRef || img?.dataset?.imageRef) return;
        if (media.classList.contains('is-loading') || media.classList.contains('card-media--await')) return;
        if (img?.dataset?.storageRef || img?.dataset?.imageRef) return;
        card.remove();
      });
    }

    function scrubImageGenFeedCards(wrap) {
      if (!wrap) return;
      wrap.querySelectorAll('.imagegen-feed-card[data-feed-id^="wh_"] .imagegen-feed-media').forEach((media) => {
        const img = media.querySelector('img');
        if (!img) return;
        const src = img.currentSrc || img.src || '';
        const loaded = img.complete
          && img.naturalWidth > 8
          && /^https?:\/\//i.test(src)
          && !src.includes('data:image/svg');
        if (loaded) {
          releaseFeedMediaLoading(media);
          media.style.removeProperty('min-height');
          media.style.removeProperty('height');
          return;
        }
        const ref = img.getAttribute('data-image-ref');
        if (ref && isDisplayableImage(ref) && !img.dataset.igenRetry) {
          img.dataset.igenRetry = '1';
          if (window.CardImageLoader?.loadImg) window.CardImageLoader.loadImg(img);
          else void hydrateFeedImageOne(img);
        }
      });
    }

    function revealCommunityFeedImages(container) {
      if (!container) return;
      container.querySelectorAll('.card-media .card-img, .card-media img').forEach((img) => {
        if (!img.complete || img.naturalWidth < 8) return;
        const src = img.currentSrc || img.src || '';
        if (!src.startsWith('http') || src.includes('data:image/svg')) return;
        const media = img.closest('.card-media, .community-side-img-btn');
        if (!media) return;
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
        else media.classList.remove('is-loading', 'card-media--await');
      });
      if (container.id === 'communityGrid' || container.id === 'creationsGrid') {
        d().scrubCommunityFeedCardMediaHeights?.(container);
      }
    }

    function stripFailedFeedMedia(scope) {
      scope.querySelectorAll('.imagegen-feed-media img.img-load-failed').forEach((img) => {
        const media = img.closest('.imagegen-feed-media');
        const card = img.closest('.imagegen-feed-card');
        if (media?.closest('#imageGenFeed')) {
          media.classList.add('card-media--load-failed');
          card?.classList.remove('imagegen-feed-card--no-media');
          return;
        }
        media?.remove();
        card?.classList.add('imagegen-feed-card--no-media');
      });
      scope.querySelectorAll(
        '#communityGrid .card-media--load-failed, #userProfileGrid .card-media--load-failed'
      ).forEach((media) => {
        if (removeBrokenCommunityFeedCard(media)) return;
        media.classList.add('card-media--load-failed');
        media.classList.remove('is-loading', 'card-media--await');
      });
      pruneEmptyCommunityFeedCards(scope);
    }
  
    async function hydrateFeedImages(root) {
      const scope = root || document;
      const rootEl = scope.nodeType === 1 ? scope : document.getElementById(String(scope)) || scope;
      const isImageGenWarehouseFeed = rootEl?.id === 'imageGenFeed';
      const inCommunity = !!(rootEl?.id === 'communityGrid' || rootEl?.id === 'creationsGrid' || rootEl?.id === 'userProfileGrid'
        || rootEl?.querySelector?.('.community-post-card, .creation-post-card'));
      const inImageGenFeed = isImageGenWarehouseFeed
        || !!rootEl?.closest?.('#pageImageGen');
      if (isImageGenWarehouseFeed) {
        stripFailedFeedMedia(scope);
        if (window.MediaPipeline?.patchContainerFromCache) {
          window.MediaPipeline.patchContainerFromCache(scope, { visibleFirst: true, max: 28 });
        } else {
          window.SupabaseSync?.patchImageSrcFromCache?.(scope, { visibleFirst: true, max: 12 });
        }
        if (window.CardImageLoader?.observeContainer) {
          window.CardImageLoader.observeContainer(scope);
        } else {
          const imgs = [...scope.querySelectorAll('#imageGenFeed img[data-image-ref]')].slice(0, 12);
          void (async () => {
            for (const img of imgs) await hydrateFeedImageOne(img);
          })();
        }
        if (d().isMobileFeedViewport?.()) d().resetMobileFeedGridStyles?.();
        else d().layoutImageGenFeedMasonry?.();
        return;
      }
      if (inCommunity) {
        stripFailedFeedMedia(scope);
        if (window.MediaPipeline?.patchContainerFromCache) {
          window.MediaPipeline.patchContainerFromCache(scope, { visibleFirst: true, max: 24 });
        } else {
          window.SupabaseSync?.patchImageSrcFromCache?.(scope, { visibleFirst: true, max: 24 });
        }
        if (window.CardImageLoader?.observeContainer) {
          window.CardImageLoader.observeContainer(scope);
        }
        revealCommunityFeedImages(scope.nodeType === 1 ? scope : document.getElementById(String(scope)) || scope);
        if (d().isMobileFeedViewport?.()) d().resetMobileFeedGridStyles?.();
        return;
      }
      if (window.SupabaseSync?.hydrateImageElements) {
        window.SupabaseSync.patchImageSrcFromCache?.(scope);
        await window.SupabaseSync.hydrateImageElements(scope, {
          onlyMissing: true,
          communityBoost: inCommunity,
          warehouseBoost: inImageGenFeed && !isImageGenWarehouseFeed
        });
        stripFailedFeedMedia(scope);
        const isFeedGrid = rootEl?.id === 'communityGrid' || rootEl?.id === 'creationsGrid' || rootEl?.id === 'userProfileGrid';
        const isSideOnly = rootEl?.id === 'communitySideBody' || rootEl?.id === 'creationsSideBody';
        if (!isFeedGrid && !isSideOnly) {
          if (d().isMobileFeedViewport?.()) d().resetMobileFeedGridStyles?.();
          else d().layoutImageGenFeedMasonry?.();
        }
        return;
      }
      const imgs = scope.querySelectorAll(
        '.imagegen-feed img[data-image-ref], #imageGenFeed img[data-image-ref], #creationsSideBody img[data-image-ref], #communitySideBody img[data-image-ref], #creationsGrid img[data-image-ref], #communityGrid img[data-image-ref], #userProfileGrid img[data-image-ref]'
      );
      const list = [...imgs];
      const igOnly = list.every((img) => img.closest('#imageGenFeed'));
      const toHydrate = igOnly
        ? list.filter((img) => {
          const r = img.getBoundingClientRect();
          return r.bottom > -480 && r.top < window.innerHeight + 480;
        }).slice(0, 12)
        : list;
      const concurrency = window.matchMedia('(max-width: 900px)').matches ? 4 : 6;
      let cursor = 0;
      async function worker() {
        while (cursor < toHydrate.length) {
          const img = toHydrate[cursor++];
          await hydrateFeedImageOne(img);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, toHydrate.length || 1) }, () => worker()));
      stripFailedFeedMedia(scope);
      if (d().isMobileFeedViewport?.()) d().resetMobileFeedGridStyles?.();
      else d().layoutImageGenFeedMasonry?.();
    }
  
    function releaseFeedMediaLoading(media) {
      if (!media) return;
      if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      else media.classList.remove('is-loading', 'card-media--await', 'media-shine-reveal');
    }
  
    async function hydrateFeedImageOne(img) {
      const ref = img.getAttribute('data-image-ref');
      const jobId = img.getAttribute('data-job-id') || '';
      const sideBtn = img.closest('.community-side-img-btn');
      const media = img.closest('.imagegen-feed-media') || img.closest('.card-media') || sideBtn;
      if (!ref || !isDisplayableImage(ref)) {
        media?.remove();
        img.closest('.imagegen-feed-card')?.classList.add('imagegen-feed-card--no-media');
        return;
      }
      if (media?.classList.contains('imagegen-gen-pending')) return;
      try {
        const cur = img.currentSrc || img.src || '';
        if (cur.startsWith('http') && !cur.includes('data:image/svg') && img.complete && img.naturalWidth > 0) {
          releaseFeedMediaLoading(media);
          return;
        }
        if (media) {
          if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
          media.classList.add('is-loading');
        }
        if (!cur.startsWith('http') || cur.includes('data:image/svg')) {
          img.src = IMG_LOADING_PLACEHOLDER;
        }
        img.classList.remove('img-load-failed');
        const ok = await applyFeedImageSrc(img, ref, jobId || null);
        if (!ok) {
          const feedCard = img.closest('.imagegen-feed-card');
          if (feedCard?.dataset.feedId?.startsWith('wh_')) {
            const assetId = feedAssetIdFromImg(img);
            const card = assetId && (window.__promptHubCards || []).find((c) => c.id === assetId);
            if (card) {
              window.SupabaseSync?.queueGridBackfill?.(card, { force: true });
              media?.classList.add('is-loading');
              media?.classList.remove('card-media--load-failed');
              return;
            }
          }
          if (feedCard) {
            media?.classList.add('card-media--load-failed');
          } else if (media?.classList.contains('card-media')) {
            media.classList.add('card-media--load-failed');
          } else if (sideBtn) {
            img.src = IMG_LOADING_PLACEHOLDER;
            releaseFeedMediaLoading(media);
          }
        }
      } catch (e) {
        releaseFeedMediaLoading(media);
      }
    }

  function init(injected) {
    deps = injected || {};
    return {
      displayUrlCache,
      IMG_LOADING_PLACEHOLDER,
      feedImgStorageAttr,
      feedAssetIdFromImg,
      mergeCollectResolveOpts,
      resolveImageDisplayUrl,
      imageGenFeedSignOpts,
      communityImageSignOpts,
      bindFeedImgErrorFallback,
      applyFeedImageSrc,
      hydrateFeedImages,
      hydrateFeedImageOne,
      releaseFeedMediaLoading,
      stripFailedFeedMedia,
      removeBrokenCommunityFeedCard,
      pruneEmptyCommunityFeedCards,
      revealCommunityFeedImages,
      scrubImageGenFeedCards
    };
  }

  global.FeedImages = { init, IMG_LOADING_PLACEHOLDER };
})(typeof window !== 'undefined' ? window : globalThis);
