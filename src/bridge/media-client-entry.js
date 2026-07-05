/**
 * Phase 2 生产门面：列表 grid / 预览 full / prefetch / 缓存统一入口
 * 签名 batch 仍由 SupabaseSync 执行；结果经 ingestSignedBatch 写入 MediaCache
 */
import { MediaCache } from '../../packages/media-client/src/cache.ts';
import { isDisplayableImage, normalizeGenJobBaseId } from '../../packages/shared/src/utils.ts';

const VARIANT_LIST = 'grid';
const VARIANT_PREVIEW = 'full';

const CardSchema = {
  safeParse(value) {
    const issues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ path: [], message: 'Expected card object' });
    } else {
      if (typeof value.id !== 'string' || !value.id) {
        issues.push({ path: ['id'], message: 'Expected non-empty string' });
      }
      if (typeof value.prompt !== 'string') {
        issues.push({ path: ['prompt'], message: 'Expected string' });
      }
      if (value.image != null && typeof value.image !== 'string') {
        issues.push({ path: ['image'], message: 'Expected string' });
      }
      if (value.cardImages != null && !Array.isArray(value.cardImages)) {
        issues.push({ path: ['cardImages'], message: 'Expected array' });
      }
    }
    if (!issues.length) return { success: true, data: value };
    return {
      success: false,
      error: {
        issues,
        message: issues.map((issue) => issue.message).join('; ')
      }
    };
  },
  parse(value) {
    const result = this.safeParse(value);
    if (result.success) return result.data;
    throw new Error(result.error.message || 'Invalid card');
  }
};

function storageRefFromPath(path) {
  const clean = String(path || '').replace(/^\//, '');
  if (!clean) return '';
  return clean.startsWith('storage://') ? clean : `storage://card-images/${clean}`;
}

function createProductionFacade() {
  const cache = new MediaCache();

  function ingestSignedBatch(urlMap, variant) {
    if (!urlMap || typeof urlMap !== 'object') return;
    const v = variant === VARIANT_PREVIEW ? VARIANT_PREVIEW : VARIANT_LIST;
    for (const [key, url] of Object.entries(urlMap)) {
      if (!url || typeof url !== 'string') continue;
      const ref = storageRefFromPath(key);
      if (ref) cache.set(ref, url, v);
    }
  }

  function resetOnLogin(opts) {
    cache.clear();
    window.SupabaseSync?.resetMediaSignEnvironment?.(opts || { clearMissing: true });
  }

  function clearMediaCache() {
    cache.clear();
    window.SupabaseSync?.clearSignedUrlCache?.();
    window.SupabaseSync?.clearListImageMissMarks?.();
  }

  function getListCached(image, assetId, extraOpts) {
    if (image && cache.get(image, VARIANT_LIST)) return cache.get(image, VARIANT_LIST);
    if (!window.SupabaseSync?.getListDisplayImageSrc) return '';
    return window.SupabaseSync.getListDisplayImageSrc(image, assetId, extraOpts) || '';
  }

  function getPreviewCached(image, assetId, extraOpts) {
    if (image && cache.get(image, VARIANT_PREVIEW)) return cache.get(image, VARIANT_PREVIEW);
    if (!window.SupabaseSync?.getCachedDisplayUrl) return '';
    return window.SupabaseSync.getCachedDisplayUrl(image, {
      assetId,
      authorId: extraOpts?.authorId,
      variant: VARIANT_PREVIEW
    }) || '';
  }

  function safeImgSrc(image) {
    if (!image) return '';
    if (window.SupabaseSync?.safeImgSrc) return window.SupabaseSync.safeImgSrc(image);
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const c = getListCached(image, '', {});
      return c && !c.startsWith('storage://') ? c : '';
    }
    return image;
  }

  function gridUrlFromImgEl(imgEl) {
    if (!imgEl) return '';
    const src = String(imgEl.currentSrc || imgEl.src || '').trim();
    if (!src || src.includes('data:image/svg') || !/^https?:\/\//i.test(src)) return '';
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return '';
    return src;
  }

  function isUsableGenRefUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^https?:\/\//i.test(url)) return true;
    if (window.SupabaseSync?.isDataUrl?.(url)) return true;
    if (window.SupabaseSync?.isStorageRef?.(url) || url.startsWith('storage://')) return true;
    return false;
  }

  async function resolveListUrl(image, opts) {
    if (!image && !opts?.jobId) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    const cached = image ? cache.get(image, VARIANT_LIST) : null;
    if (cached) return cached;

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
      if (fast) {
        cache.set(image, fast, VARIANT_LIST);
        return fast;
      }
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
    const out = url && typeof url === 'string' ? url : '';
    if (out && image) cache.set(image, out, VARIANT_LIST);
    return out;
  }

  async function resolvePreviewUrl(image, opts) {
    if (!image) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    const cached = cache.get(image, VARIANT_PREVIEW);
    if (cached) return cached;

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
      if (url) {
        cache.set(image, url, VARIANT_PREVIEW);
        return url;
      }
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
    const out = url && typeof url === 'string' ? url : '';
    if (out) cache.set(image, out, VARIANT_PREVIEW);
    return out;
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

  async function prefetchWarehouseCards(cards, opts = {}) {
    const sync = typeof window !== 'undefined' ? window.SupabaseSync : null;
    if (!sync?.isLoggedIn?.()) return { ok: false, reason: 'not_logged_in' };
    const list = Array.isArray(cards) ? cards : [];
    if (!list.length) return { ok: true, count: 0 };
    const capMs = opts.capMs != null ? opts.capMs : 2600;
    if (sync.prefetchWarehousePage && (opts.maxCards || opts.usePage !== false)) {
      await sync.prefetchWarehousePage(list, capMs, opts);
      return { ok: true, count: list.length, mode: 'page' };
    }
    if (sync.prefetchCardsImages) {
      await sync.prefetchCardsImages(list, capMs, opts);
      return { ok: true, count: list.length, mode: 'batch' };
    }
    return { ok: false, reason: 'sync_missing' };
  }

  async function prefetchList(cards, capMs, opts) {
    if (!cards?.length) return { ok: true, count: 0 };
    return prefetchWarehouseCards(cards, { ...(opts || {}), capMs });
  }

  async function resolveCardRefs(cards, opts = {}) {
    await prefetchWarehouseCards(cards, opts);
    const sync = typeof window !== 'undefined' ? window.SupabaseSync : null;
    const out = new Map();
    if (!sync) return out;
    const variant = opts.variant === 'full' ? VARIANT_PREVIEW : VARIANT_LIST;
    for (const card of cards || []) {
      const ref = card?.image;
      if (!ref || !isDisplayableImage(ref)) continue;
      const url = getListCached(ref, card.id)
        || sync.getCachedDisplayUrl?.(ref, { assetId: card.id, variant })
        || '';
      if (url) {
        cache.set(ref, url, variant);
        out.set(ref, { ref, url, cached: false, needsWarehouse: false });
      }
    }
    return out;
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

  async function patchContainerFromCache(container, opts) {
    if (!container || !window.SupabaseSync?.patchImageSrcFromCache) return;
    window.SupabaseSync.patchImageSrcFromCache(container, opts || { visibleFirst: true, max: 24 });
  }

  function exportPipeline() {
    return {
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
  }

  return {
    cache,
    VARIANT_LIST,
    VARIANT_PREVIEW,
    ingestSignedBatch,
    resetOnLogin,
    clearMediaCache,
    getListCached,
    getPreviewCached,
    safeImgSrc,
    gridUrlFromImgEl,
    resolveListUrl,
    resolvePreviewUrl,
    resolveFeedUrl,
    resolveCardListThumb,
    prefetchWarehouseCards,
    prefetchList,
    resolveCardRefs,
    patchContainerFromCache,
    isUsableGenRefUrl,
    exportPipeline
  };
}

function boot() {
  const facade = createProductionFacade();
  const api = {
    version: '2.0.0',
    phase: '2-complete',
    MediaCache,
    CardSchema,
    isDisplayableImage,
    normalizeGenJobBaseId,
    ingestSignedBatch: facade.ingestSignedBatch,
    resetOnLogin: facade.resetOnLogin,
    clearMediaCache: facade.clearMediaCache,
    getListCached: facade.getListCached,
    getPreviewCached: facade.getPreviewCached,
    safeImgSrc: facade.safeImgSrc,
    resolveListUrl: facade.resolveListUrl,
    resolvePreviewUrl: facade.resolvePreviewUrl,
    resolveFeedUrl: facade.resolveFeedUrl,
    resolveCardListThumb: facade.resolveCardListThumb,
    prefetchWarehouseCards: facade.prefetchWarehouseCards,
    prefetchList: facade.prefetchList,
    resolveCardRefs: facade.resolveCardRefs,
    patchContainerFromCache: facade.patchContainerFromCache,
    exportPipeline: facade.exportPipeline,
    facade
  };
  if (typeof window !== 'undefined') {
    window.PromptHubMedia = api;
    console.info('[PromptHubMedia] Phase 2 media facade ready');
  }
  return api;
}

boot();
