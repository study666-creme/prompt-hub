/**
 * 灯箱业务层（须在 pack-viewer 之后；script.js 启动时 AppLightbox.init(deps)）
 */
(function () {
  let deps = {};
  let lightboxLoadSeq = 0;
  let uiBound = false;

  function getCards() {
    return typeof deps.getCards === 'function' ? deps.getCards() : [];
  }
  function getSelectedCardId() {
    return typeof deps.getSelectedCardId === 'function' ? deps.getSelectedCardId() : null;
  }
  function getWarehousePreviewCardId() {
    return typeof deps.getWarehousePreviewCardId === 'function' ? deps.getWarehousePreviewCardId() : null;
  }
  function isGlobalViewActive() {
    return typeof deps.isGlobalViewActive === 'function' ? !!deps.isGlobalViewActive() : false;
  }
  function hasDisplayImage(card) {
    return typeof deps.cardHasDisplayImage === 'function' ? deps.cardHasDisplayImage(card) : !!card?.image;
  }

  function getCardGalleryUrls(opts) {
    return opts?.cardGalleryUrls || opts?.mjGalleryUrls || null;
  }

  function syncLightboxGalleryUi(index) {
    const gallery = window.__lightboxCardGallery;
    const urls = gallery?.urls || [];
    const show = urls.length > 1;
    const idx = Math.max(0, Math.min(Number(index) || 0, urls.length - 1));
    ['lightboxGalleryPrev', 'lightboxGalleryNext', 'lightboxGalleryCounter'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
    });
    ['lightboxHitPrev', 'lightboxHitNext'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
    });
    const counter = document.getElementById('lightboxGalleryCounter');
    if (counter && show) counter.textContent = `${idx + 1} / ${urls.length}`;
    const prev = document.getElementById('lightboxGalleryPrev');
    const next = document.getElementById('lightboxGalleryNext');
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= urls.length - 1;
  }

  function setupCardGalleryNav(opts) {
    const urls = getCardGalleryUrls(opts)?.filter(Boolean).slice(0, window.PromptHubCardGallery?.MAX || 5);
    if (!urls?.length || urls.length <= 1 || !opts.feedKey) {
      window.__lightboxCardGallery = null;
      syncLightboxGalleryUi(0);
      return false;
    }
    const startIdx = Math.max(0, Math.min(Number(opts.cardGalleryIndex ?? opts.mjGalleryIndex) || 0, urls.length - 1));
    const navItems = urls.map((_, i) => ({
      type: 'cardGalleryTile',
      kind: opts.cardId ? 'warehouse' : 'community',
      id: opts.cardId || opts.postId || '',
      key: `${opts.feedKey}#g${i}`,
      tileIndex: i
    }));
    window.__lightboxCardGallery = {
      urls,
      feedKey: opts.feedKey,
      assetId: opts.cardId || null,
      jobId: opts.cardJobId || opts.mjJobId || null,
      imageGen: !!opts.imageGen,
      fallbackSrc: opts.fallbackSrc || '',
      preferFull: opts.preferFull !== false
    };
    window.__lightboxMjGallery = window.__lightboxCardGallery;
    window.__lightboxImageGenNav = true;
    window.setViewerNav?.(navItems, `${opts.feedKey}#g${startIdx}`);
    syncLightboxGalleryUi(startIdx);
    return true;
  }

  function navigateLightboxGallery(delta) {
    const gallery = window.__lightboxCardGallery;
    if (!gallery?.urls?.length) return false;
    const viewerNav = window.getViewerNav?.() || { items: [], index: -1 };
    const nextIdx = viewerNav.index + (delta > 0 ? 1 : -1);
    if (nextIdx < 0 || nextIdx >= viewerNav.items.length) return false;
    const item = viewerNav.items[nextIdx];
    if (item?.type !== 'cardGalleryTile') return false;
    return window.__viewerWheelNavigate?.(item) === true;
  }

  function syncLightboxActions(opts) {
    opts = opts || {};
    const ap = opts.assetPack;
    const isCommunity = !!opts.community;
    const isAssetPack = !!ap;
    window.__lightboxCommunityMode = isCommunity;
    window.__lightboxAssetPackMode = isAssetPack;
    window.__lightboxAssetPackOpts = isAssetPack ? ap : null;
    window.__lightboxCommunityPostId = opts.postId || null;
    window.__lightboxWarehouseCardId = isCommunity || isAssetPack ? null : (opts.cardId || null);
    const showCollect = (isCommunity && opts.postId) || (isAssetPack && ap.allowCollect);
    const showGen = !isCommunity && !isAssetPack && !!opts.cardId;
    const showDownload = !isCommunity && (!isAssetPack || ap.allowSave);
    const dlBtn = document.getElementById('lightboxDownloadBtn');
    if (dlBtn) {
      dlBtn.classList.toggle('hidden', !showDownload);
      dlBtn.style.display = '';
    }
    const collectBtn = document.getElementById('lightboxCollectBtn');
    if (collectBtn) {
      if (showCollect) {
        collectBtn.classList.remove('hidden');
        collectBtn.style.display = '';
        if (isCommunity) {
          const faved = window.FeatureDraft?.isPostFavorited?.(opts.postId);
          collectBtn.disabled = !!faved;
          const label = collectBtn.querySelector('span');
          const text = faved ? '已收藏' : '收藏到卡片库';
          if (label) label.textContent = text;
          else collectBtn.textContent = text;
        } else {
          collectBtn.disabled = false;
          const label = collectBtn.querySelector('span');
          const text = '收藏到卡片库';
          if (label) label.textContent = text;
          else collectBtn.textContent = text;
        }
      } else {
        collectBtn.classList.add('hidden');
      }
    }
    const genBtn = document.getElementById('lightboxGenBtn');
    if (genBtn) genBtn.classList.toggle('hidden', !showGen);
  }

  function loadLightboxImage(displaySrc, opts) {
    opts = opts || {};
    const seq = ++lightboxLoadSeq;
    const lightbox = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    const frame = window.getLightboxFrame?.();
    const dlBtn = document.getElementById('lightboxDownloadBtn');
    if (!lightbox || !img) return;
    const loadStale = () => seq !== lightboxLoadSeq;
    if (opts.assetPack) {
      syncLightboxActions({ assetPack: opts.assetPack });
    } else if (opts.community || opts.cardId) {
      syncLightboxActions({
        community: !!opts.community,
        postId: opts.postId || window.__lightboxCommunityPostId,
        cardId: opts.cardId
      });
    }
    if (dlBtn) dlBtn.disabled = true;
    lightbox.classList.add('active');
    window.setViewerFrameLoading?.(frame, true);
    const upgradeImageGenFull = () => {
      if (!opts.imageGen || !opts.feedKey || !window.FeatureDraft?.resolveImageGenFullUrl) return;
      if ((getCardGalleryUrls(opts)?.length || 0) > 1) return;
      const viewerNav = window.getViewerNav?.() || { items: [], index: -1 };
      const navItem = viewerNav.items[viewerNav.index];
      const kind = navItem?.kind || (opts.community ? 'community' : opts.cardId ? 'warehouse' : null);
      const navId = navItem?.id || opts.postId || opts.cardId;
      if (!kind || !navId) return;
      const cardEl = document.querySelector(
        `.imagegen-feed-card[data-feed-id="${CSS.escape(opts.feedKey)}"]`
      );
      const feedImg = cardEl?.querySelector('.imagegen-feed-thumb-btn img');
      void window.FeatureDraft.resolveImageGenFullUrl(kind, navId, opts.feedKey, feedImg).then((full) => {
        if (loadStale() || !full || full === displaySrc) return;
        if (/data:image\/svg/i.test(full)) return;
        const looksGrid = /_grid\.|width=\d+&quality=/i.test(displaySrc) || /_grid\.|width=\d+&quality=/i.test(img.src || '');
        const small = img.naturalWidth > 0 && img.naturalWidth < 720;
        if (!looksGrid && !small && img.src === full) return;
        img.onload = onReady;
        img.onerror = onFail;
        if (/^https?:\/\//i.test(full)) img.crossOrigin = 'anonymous';
        img.src = full;
      });
    };
    let shown = false;
    const onReady = () => {
      if (shown || loadStale()) return;
      shown = true;
      img.onload = null;
      img.onerror = null;
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.objectFit = '';
      if (window.__lightboxCommunityMode) window.fitLightboxDisplaySize?.(img);
      window.resetImageZoom?.(img);
      window.attachImageZoom?.(img);
      window.finishViewerFrameReveal?.(frame);
      if (window.__lightboxCommunityMode) window.layoutViewerBorderSvg?.(frame);
      if (dlBtn && !window.__lightboxCommunityMode) {
        const ap = window.__lightboxAssetPackOpts;
        const canSave = !ap || ap.allowSave;
        dlBtn.disabled = !canSave || !(img.src && !img.src.includes('data:image/svg'));
      }
    };
    const onFail = () => {
      if (loadStale()) return;
      img.onerror = null;
      img.onload = null;
      if (!opts.fallbackTried && opts.fallbackSrc && opts.fallbackSrc !== displaySrc
        && !opts.fallbackSrc.includes('data:image/svg')) {
        loadLightboxImage(opts.fallbackSrc, {
          ...opts,
          preferFull: false,
          fallbackSrc: '',
          fallbackTried: true,
          silentFail: true
        });
        deps.showToast?.('原图暂不可用，已显示预览图', 4000);
        return;
      }
      window.setViewerFrameLoading?.(frame, false);
      lightbox.classList.remove('active');
      if (!opts.silentFail) deps.showToast?.('图片加载失败，请稍后重试');
    };
    img.removeAttribute('src');
    if (!displaySrc || displaySrc.includes('data:image/svg')) {
      if (opts.pending) {
        img.onwheel = null;
        img.onmousedown = null;
        img.ondblclick = null;
        img.removeAttribute('src');
        return;
      }
      onFail();
      return;
    }
    frame?.classList.remove('viewer-glow-active');
    frame?.querySelector('.viewer-image-shine-wrap')?.classList.remove('viewer-glow-active', 'media-shine-reveal', 'viewer-shine-active');
    img.onwheel = null;
    img.onmousedown = null;
    img.ondblclick = null;
    let corsRetried = false;
    if (/^https?:\/\//i.test(displaySrc)) img.crossOrigin = 'anonymous';
    else img.removeAttribute('crossorigin');
    if (img.src === displaySrc && img.complete && img.naturalWidth > 0) {
      onReady();
      if (opts.imageGen || opts.preferFull) upgradeImageGenFull();
      return;
    }
    img.onerror = () => {
      if (!corsRetried && img.hasAttribute('crossorigin')) {
        corsRetried = true;
        img.removeAttribute('crossorigin');
        img.onload = onReady;
        img.onerror = onFail;
        img.src = displaySrc;
        if (img.complete && img.naturalWidth > 0) onReady();
        return;
      }
      onFail();
    };
    img.onload = () => {
      onReady();
      if (opts.imageGen || opts.preferFull) upgradeImageGenFull();
    };
    img.src = displaySrc;
    if (img.complete && img.naturalWidth > 0) {
      onReady();
      if (opts.imageGen || opts.preferFull) upgradeImageGenFull();
    }
  }

  function openLightbox(src, opts) {
    opts = opts || {};
    if (!opts.pending && (!src || typeof src !== 'string')) return;
    if (opts.assetPack) {
      const ap = opts.assetPack;
      window.__packLightboxCollect =
        ap.allowCollect && ap.packageId && ap.cardId
          ? {
              packageId: ap.packageId,
              cardId: ap.cardId,
              packageTitle: ap.packageTitle || ''
            }
          : null;
      window.__lightboxFromAssetPack = !!ap.allowCollect;
      syncLightboxActions({ assetPack: ap });
    } else {
      if (!window.__lightboxFromAssetPack) {
        window.__packLightboxCollect = null;
      }
      window.__lightboxFromAssetPack = false;
      window.__lightboxAssetPackMode = null;
      window.__lightboxAssetPackOpts = null;
      if (opts.community) {
        syncLightboxActions({ community: true, postId: opts.postId || null });
      } else if (opts.imageGen) {
        syncLightboxActions({
          community: !!opts.community,
          postId: opts.postId || null,
          cardId: opts.cardId || null
        });
      } else {
        syncLightboxActions({ cardId: opts.cardId || getSelectedCardId() || null });
      }
    }
    if (setupCardGalleryNav(opts)) {
      /* gallery nav enabled */
    } else if (opts.imageGen && opts.feedKey && window.FeatureDraft?.getImageGenFeedNavItems) {
      const navItems = window.FeatureDraft.getImageGenFeedNavItems().map((it) => ({
        type: 'imageGen',
        kind: it.kind,
        id: it.id,
        key: it.key
      }));
      window.__lightboxImageGenNav = navItems.length > 1;
      window.setViewerNav?.(navItems, opts.feedKey);
    } else {
      window.__lightboxImageGenNav = false;
      window.__lightboxCardGallery = null;
      window.__lightboxMjGallery = null;
      syncLightboxGalleryUi(0);
      const navCardId = opts.cardId || getSelectedCardId();
      if (isGlobalViewActive() && navCardId) {
        const navItems = getCards()
          .filter((c) => c.image && hasDisplayImage(c))
          .map((c) => ({ type: 'card', id: c.id, key: `card:${c.id}` }));
        window.setViewerNav?.(navItems, `card:${navCardId}`);
      } else {
        window.setViewerNav?.([], '');
      }
    }
    loadLightboxImage(src || '', opts);
  }

  function setLightboxSrc(src, opts) {
    if (!src || typeof src !== 'string') return;
    const lightbox = document.getElementById('imageLightbox');
    if (!lightbox?.classList.contains('active')) {
      openLightbox(src, opts || (window.__lightboxImageGenNav ? { imageGen: true } : {}));
      return;
    }
    if (getCardGalleryUrls(opts)?.length > 1 && opts?.feedKey) setupCardGalleryNav(opts);
    loadLightboxImage(src, opts);
  }

  function closeLightbox(e) {
    const lightbox = document.getElementById('imageLightbox');
    if (!lightbox?.classList.contains('active')) return;
    if (e) {
      const t = e.target;
      if (t?.closest?.('.lightbox-actions, #lightboxImage, .viewer-image-shine-wrap, .lightbox-gallery-nav, .lightbox-gallery-hit, .lightbox-gallery-counter')) return;
      if (t?.closest?.('.close-lightbox')) { /* fall through */ }
      else if (t !== lightbox && !t?.closest?.('.lightbox-container')) return;
    }
    lightbox?.classList.remove('active');
    syncLightboxActions({});
    const frame = window.getLightboxFrame?.();
    frame?.classList.remove('is-loading', 'viewer-glow-active');
    frame?.querySelector('.viewer-image-shine-wrap')?.classList.remove('viewer-glow-active', 'media-shine-reveal', 'viewer-shine-active');
    const img = document.getElementById('lightboxImage');
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      img.onwheel = null;
      img.onmousedown = null;
      img.ondblclick = null;
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.objectFit = '';
    }
    window.setViewerNav?.([], '');
    window.__lightboxImageGenNav = false;
    window.__lightboxCardGallery = null;
    window.__lightboxMjGallery = null;
    syncLightboxGalleryUi(0);
    window.resetImageZoom?.(null);
  }

  async function downloadLightboxImage() {
    const img = document.getElementById('lightboxImage');
    const dlBtn = document.getElementById('lightboxDownloadBtn');
    if (dlBtn?.disabled && !dlBtn.classList.contains('is-downloading')) {
      deps.showToast?.('图片加载中，请稍后再下载');
      return;
    }
    let cardId = window.__lightboxWarehouseCardId || getWarehousePreviewCardId() || null;
    const viewerNav = window.getViewerNav?.() || { items: [], index: -1 };
    const gallery = window.__lightboxCardGallery;
    let imageRef = null;
    let galleryIndex = null;
    let slotJobId = gallery?.jobId || null;

    if (gallery?.urls?.length && viewerNav.index >= 0) {
      const item = viewerNav.items[viewerNav.index];
      if (item?.type === 'cardGalleryTile' && Number.isFinite(item.tileIndex)) {
        galleryIndex = item.tileIndex;
        imageRef = gallery.urls[galleryIndex] || null;
        const baseJob = slotJobId ? String(slotJobId).replace(/#\d+$/, '') : null;
        if (baseJob && window.PromptHubCardGallery?.gallerySlotJobId) {
          slotJobId = window.PromptHubCardGallery.gallerySlotJobId(baseJob, galleryIndex);
        }
      }
    }

    if (!cardId && !window.__lightboxCommunityMode && window.__lightboxImageGenNav) {
      if (viewerNav.index >= 0) {
        const item = viewerNav.items[viewerNav.index];
        if (item?.type === 'imageGen' && item.kind === 'warehouse') cardId = item.id;
      }
    }
    if (!cardId && gallery?.assetId) cardId = gallery.assetId;
    if (!cardId && !window.__lightboxCommunityMode) cardId = getSelectedCardId();

    const card = cardId ? getCards().find((c) => c.id === cardId) : null;
    const ref = imageRef || card?.image;
    if (ref && deps.downloadCardImageFile) {
      await deps.downloadCardImageFile(ref, card?.id || cardId, null, {
        triggerBtn: dlBtn,
        galleryIndex,
        jobId: slotJobId,
        previewImg: img
      });
      return;
    }
    const url = img?.src || '';
    if (!url || String(url).includes('data:image/svg')) {
      deps.showToast?.('图片尚未加载完成');
      return;
    }
    const filename = `prompt-hub-${Date.now()}.png`;
    deps.setDownloadTriggerBusy?.(dlBtn, true);
    deps.showToast?.('正在准备下载…', 2500);
    try {
      await deps.promptHubSaveImage?.(url, filename, img);
      deps.showToast?.('下载完成');
    } catch (err) {
      deps.showToast?.('下载失败，请稍后重试');
      console.warn('[download] lightbox image failed', err);
    } finally {
      deps.setDownloadTriggerBusy?.(dlBtn, false);
    }
  }

  function bindLightboxUi() {
    if (uiBound) return;
    uiBound = true;
    document.getElementById('lightboxDownloadBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void downloadLightboxImage();
    });
    document.getElementById('lightboxGenBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const cardId = window.__lightboxWarehouseCardId || getWarehousePreviewCardId() || getSelectedCardId();
      const card = getCards().find((c) => c.id === cardId);
      if (!card) return;
      deps.markQuickPreviewTask?.({ warehouseGotoGen: true });
      closeLightbox();
      void window.FeatureDraft?.fillCardToImageGen?.(card);
    });
    const bindGalleryNavBtn = (id, delta) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateLightboxGallery(delta);
      });
    };
    bindGalleryNavBtn('lightboxGalleryPrev', -1);
    bindGalleryNavBtn('lightboxGalleryNext', 1);
    bindGalleryNavBtn('lightboxHitPrev', -1);
    bindGalleryNavBtn('lightboxHitNext', 1);
  }

  function applyCardGalleryTileToLightbox(item) {
    const gallery = window.__lightboxCardGallery;
    const url = gallery?.urls?.[item.tileIndex ?? 0];
    if (!url) return false;
    const resolve = window.PromptHubCardGallery?.resolveMediaUrl;
    const apply = (src) => {
      syncLightboxGalleryUi(item.tileIndex ?? 0);
      const fallbackUrl = /^https?:\/\//i.test(url)
        && window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(url)
        ? ''
        : url;
      const tileFallback = /^(https?:|blob:|data:image\/)/i.test(fallbackUrl || '')
        && !String(fallbackUrl).includes('data:image/svg')
        ? fallbackUrl
        : '';
      setLightboxSrc(src || tileFallback, {
        imageGen: !!gallery.imageGen,
        feedKey: gallery.feedKey,
        cardId: gallery.assetId,
        cardGalleryUrls: gallery.urls,
        mjGalleryUrls: gallery.urls,
        cardGalleryIndex: item.tileIndex ?? 0,
        mjGalleryIndex: item.tileIndex ?? 0,
        cardJobId: gallery.jobId,
        mjJobId: gallery.jobId,
        fallbackSrc: tileFallback,
        preferFull: gallery.preferFull !== false
      });
    };
    if (resolve) {
      void resolve(url, {
        cardId: gallery.assetId,
        jobId: gallery.jobId || null,
        galleryIndex: item.tileIndex ?? 0,
        preferFull: true
      }).then(apply);
    } else {
      apply(url);
    }
    return true;
  }

  function registerViewerWheelNavigate() {
    const prevNavigate = window.__viewerWheelNavigate;
    window.__viewerWheelNavigate = function (item) {
      if (item.type === 'cardGalleryTile' || item.type === 'imageGenMjTile') {
        return applyCardGalleryTileToLightbox(item);
      }
      if (item.type === 'card') {
        if (!isGlobalViewActive()) return false;
        void deps.openAppreciateViewer?.(item.id);
        return true;
      }
      if (item.type === 'post' && window.FeatureDraft?.openCommunityAppreciateById) {
        void window.FeatureDraft.openCommunityAppreciateById(item.id);
        return true;
      }
      if (item.type === 'imageGen' && window.FeatureDraft?.openImageGenLightboxAt) {
        void window.FeatureDraft.openImageGenLightboxAt(item.kind, item.id, item.key);
        return true;
      }
      if (typeof prevNavigate === 'function') return prevNavigate(item) === true;
      return false;
    };
  }

  function init(nextDeps) {
    deps = nextDeps || {};
    bindLightboxUi();
    registerViewerWheelNavigate();
  }

  window.AppLightbox = { init };
  window.syncLightboxActions = syncLightboxActions;
  window.openLightbox = openLightbox;
  window.setLightboxSrc = setLightboxSrc;
  window.closeLightbox = closeLightbox;
  window.downloadLightboxImage = downloadLightboxImage;
})();
