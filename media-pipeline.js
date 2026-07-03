/**
 * 全站图片统一出口：列表 grid / 预览·灯箱·下载 full
 * 卡片库、生图仓库、社区网格均经此层，避免各模块重复签图逻辑。
 */
(function () {
  'use strict';

  const VARIANT_LIST = 'grid';
  const VARIANT_PREVIEW = 'full';

  function resetOnLogin(opts) {
    if (window.SupabaseSync?.resetMediaSignEnvironment) {
      window.SupabaseSync.resetMediaSignEnvironment(opts || { clearMissing: true });
    }
  }

  function getListCached(image, assetId, extraOpts) {
    if (!window.SupabaseSync?.getListDisplayImageSrc) return '';
    return window.SupabaseSync.getListDisplayImageSrc(image, assetId, extraOpts) || '';
  }

  function getPreviewCached(image, assetId, extraOpts) {
    if (!window.SupabaseSync?.getCachedDisplayUrl) return '';
    return window.SupabaseSync.getCachedDisplayUrl(image, {
      assetId,
      authorId: extraOpts?.authorId,
      variant: VARIANT_PREVIEW
    }) || '';
  }

  async function resolveListUrl(image, opts) {
    if (!image && !opts?.jobId) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    const ownedStorage = image
      && window.SupabaseSync?.isStorageRef?.(image)
      && window.SupabaseSync?.storagePathOwnedByCurrentUser?.(
        window.SupabaseSync.storagePathFromRef(image)
      );
    if (ownedStorage && window.SupabaseSync?.resolveDisplayUrl) {
      const fast = await window.SupabaseSync.resolveDisplayUrl(image, {
        assetId: o.assetId || o.cardId,
        authorId: o.authorId,
        cardId: o.cardId || o.assetId,
        jobId: o.jobId,
        galleryIndex: o.galleryIndex,
        variant: VARIANT_LIST,
        listOnly: true,
        allowFullFallback: false,
        tryAllPaths: o.tryAllPaths === true,
        communityFeed: o.communityFeed === true,
        bypassSignBudget: o.bypassSignBudget
      });
      if (fast) return fast;
    }
    if (o.jobId && !ownedStorage && window.WarehouseThumb?.resolveForCard) {
      const wh = await window.WarehouseThumb.resolveForCard(image || '', {
        jobId: o.jobId,
        assetId: o.assetId || o.cardId,
        cardId: o.cardId || o.assetId,
        galleryIndex: o.galleryIndex || 0
      });
      if (wh) return wh;
    }
    if (!image) return '';
    if (!window.SupabaseSync?.resolveDisplayUrl) return '';
    const url = await window.SupabaseSync.resolveDisplayUrl(image, {
      assetId: o.assetId || o.cardId,
      authorId: o.authorId,
      cardId: o.cardId || o.assetId,
      jobId: o.jobId,
      variant: VARIANT_LIST,
      listOnly: true,
      allowFullFallback: false,
      tryAllPaths: o.tryAllPaths === true,
      communityFeed: o.communityFeed === true,
      bypassSignBudget: o.bypassSignBudget
    });
    return url && typeof url === 'string' ? url : '';
  }

  async function resolvePreviewUrl(image, opts) {
    if (!image) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    if (window.SupabaseSync?.resolvePreviewFullUrl) {
      const url = await window.SupabaseSync.resolvePreviewFullUrl(image, {
        assetId: o.assetId || o.cardId,
        cardId: o.cardId || o.assetId,
        authorId: o.authorId,
        communityFeed: o.communityFeed === true,
        jobId: o.jobId,
        galleryIndex: o.galleryIndex,
        useJobImageApi: o.useJobImageApi,
        gridFallbackUrl: o.gridFallbackUrl || o.fallbackGridUrl,
        allowGridFallback: o.allowGridFallback !== false
      });
      if (url) return url;
    }
    if (!window.SupabaseSync?.resolveDisplayUrl) return '';
    const url = await window.SupabaseSync.resolveDisplayUrl(image, {
      assetId: o.assetId || o.cardId,
      authorId: o.authorId,
      cardId: o.cardId || o.assetId,
      variant: VARIANT_PREVIEW,
      listOnly: false,
      preferFull: true,
      allowFullFallback: true,
      bypassSignBudget: true,
      tryAllPaths: true,
      communityFeed: o.communityFeed === true,
      jobId: o.jobId
    });
    return url && typeof url === 'string' ? url : '';
  }

  function gridUrlFromImgEl(imgEl) {
    if (!imgEl) return '';
    const src = String(imgEl.currentSrc || imgEl.src || '').trim();
    if (!src || src.includes('data:image/svg') || !/^https?:\/\//i.test(src)) return '';
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return '';
    return src;
  }

  async function resolveFeedUrl(image, opts) {
    if (!image) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    const listOnly = o.listOnly === true || o.allowFullFallback === false;
    const wantFull = !listOnly && (o.preferFull === true || o.variant === VARIANT_PREVIEW);
    const pipeOpts = {
      assetId: o.assetId || o.cardId,
      cardId: o.cardId || o.assetId,
      authorId: o.authorId,
      jobId: o.jobId,
      tryAllPaths: o.tryAllPaths === true,
      communityFeed: o.communityFeed === true,
      bypassSignBudget: o.bypassSignBudget,
      gridFallbackUrl: o.gridFallbackUrl || o.fallbackGridUrl || gridUrlFromImgEl(o.imgEl),
      allowGridFallback: o.allowGridFallback !== false
    };
    if (wantFull) return resolvePreviewUrl(image, pipeOpts);
    return resolveListUrl(image, pipeOpts);
  }

  async function prefetchList(cards, capMs, opts) {
    if (!cards?.length) return;
    if (window.SupabaseSync?.prefetchWarehousePage) {
      await window.SupabaseSync.prefetchWarehousePage(cards, capMs, opts);
      return;
    }
    if (window.SupabaseSync?.prefetchCardsImages) {
      await window.SupabaseSync.prefetchCardsImages(cards, capMs, opts);
    }
  }

  async function patchContainerFromCache(container, opts) {
    if (!container || !window.SupabaseSync?.patchImageSrcFromCache) return;
    window.SupabaseSync.patchImageSrcFromCache(container, opts || { visibleFirst: true, max: 24 });
  }

  function safeImgSrc(image) {
    if (!image) return '';
    if (window.SupabaseSync?.safeImgSrc) return window.SupabaseSync.safeImgSrc(image);
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const c = window.SupabaseSync.getCachedDisplayUrl?.(image, { variant: VARIANT_LIST });
      return c && !c.startsWith('storage://') ? c : '';
    }
    return image;
  }

  function isUsableGenRefUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^https?:\/\//i.test(url)) return true;
    if (window.SupabaseSync?.isDataUrl?.(url)) return true;
    if (window.SupabaseSync?.isStorageRef?.(url) || url.startsWith('storage://')) return true;
    return false;
  }

  async function resolveCardListThumb(card) {
    if (!card?.id) return '';
    const meta = window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, { skipEnsure: true });
    if (!meta?.hasImage) return '';
    const ref = meta.ref || card.image || '';
    const cached = getListCached(ref, card.id, { jobId: meta.jobId });
    if (cached) return cached;
    const url = await resolveListUrl(ref, {
      assetId: card.id,
      cardId: card.id,
      jobId: meta.jobId,
      galleryIndex: meta.galleryIndex || 0,
      tryAllPaths: true
    });
    if (url) return url;
    if (window.WarehouseThumb?.resolveForCardModel) {
      return window.WarehouseThumb.resolveForCardModel(card);
    }
    return '';
  }

  window.MediaPipeline = {
    VARIANT_LIST,
    VARIANT_PREVIEW,
    resetOnLogin,
    getListCached,
    getPreviewCached,
    safeImgSrc,
    gridUrlFromImgEl,
    resolveListUrl,
    resolveCardListThumb,
    resolvePreviewUrl,
    resolveFeedUrl,
    prefetchList,
    patchContainerFromCache,
    isUsableGenRefUrl
  };
})();
