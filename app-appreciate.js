/**
 * 欣赏器 + 全局欣赏（须在 pack-viewer 之后；script.js 启动时 AppAppreciate.init(deps)）
 */
(function () {
  let deps = {};

  function getCards() {
    return typeof deps.getCards === 'function' ? deps.getCards() : [];
  }
  function hasDisplayImage(card) {
    return typeof deps.cardHasDisplayImage === 'function' ? deps.cardHasDisplayImage(card) : !!card?.image;
  }
  function getWarehousePreviewCardId() {
    return typeof deps.getWarehousePreviewCardId === 'function' ? deps.getWarehousePreviewCardId() : null;
  }
  function setWarehousePreviewCardId(id) {
    deps.setWarehousePreviewCardId?.(id);
  }
  function isGlobalViewActive() {
    return typeof deps.isGlobalViewActive === 'function' ? !!deps.isGlobalViewActive() : false;
  }
  function setGlobalViewActive(v) {
    deps.setGlobalViewActive?.(!!v);
  }

  function syncAppreciateViewerActions(mode) {
    const communityActs = document.getElementById('appreciateViewerActions');
    const warehouseActs = document.getElementById('appreciateViewerWarehouseActions');
    const isCommunity = mode === 'community';
    window.__appreciateViewerMode = mode || 'warehouse';
    communityActs?.classList.toggle('hidden', !isCommunity);
    warehouseActs?.classList.toggle('hidden', isCommunity);
  }

  function syncAppreciateGalleryUi(index) {
    const gallery = window.__appreciateCardGallery;
    const urls = gallery?.urls || [];
    const show = urls.length > 1;
    const idx = Math.max(0, Math.min(Number(index) || 0, Math.max(urls.length - 1, 0)));
    ['appreciateGalleryPrev', 'appreciateGalleryNext', 'appreciateGalleryCounter'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
    });
    ['appreciateHitPrev', 'appreciateHitNext'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden', !show);
    });
    const counter = document.getElementById('appreciateGalleryCounter');
    if (counter && show) counter.textContent = `${idx + 1} / ${urls.length}`;
    const prev = document.getElementById('appreciateGalleryPrev');
    const next = document.getElementById('appreciateGalleryNext');
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= urls.length - 1;
  }

  function setupAppreciateCardGallery(card, startIdx = 0) {
    const urls = window.PromptHubCardGallery?.normalizeCardGallery?.(card) || (card?.image ? [card.image] : []);
    if (!urls || urls.length <= 1) {
      window.__appreciateCardGallery = null;
      syncAppreciateGalleryUi(0);
      return false;
    }
    const idx = Math.max(0, Math.min(startIdx, urls.length - 1));
    window.__appreciateCardGallery = {
      urls,
      cardId: card.id,
      jobId: window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
        || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null)
    };
    const navItems = urls.map((_, i) => ({
      type: 'appreciateGalleryTile',
      id: card.id,
      key: `card:${card.id}#g${i}`,
      tileIndex: i
    }));
    window.setViewerNav?.(navItems, `card:${card.id}#g${idx}`);
    syncAppreciateGalleryUi(idx);
    return true;
  }

  async function renderAppreciateGalleryIndex(card, index, gen) {
    const gallery = window.__appreciateCardGallery;
    if (!gallery?.urls?.length || !card) return;
    const idx = Math.max(0, Math.min(index, gallery.urls.length - 1));
    const ref = gallery.urls[idx];
    const img = document.getElementById('appreciateViewerImg');
    if (!img || !ref) return;
    syncAppreciateGalleryUi(idx);
    window.setAppreciateViewerLoading?.(true);
    let displaySrc = ref;
    try {
      if (window.PromptHubCardGallery?.resolveMediaUrl) {
        displaySrc = await window.PromptHubCardGallery.resolveMediaUrl(ref, {
          cardId: card.id,
          jobId: gallery.jobId,
          galleryIndex: idx,
          preferFull: true
        }) || ref;
      } else if (window.MediaPipeline?.resolvePreviewUrl) {
        displaySrc = await window.MediaPipeline.resolvePreviewUrl(ref, {
          assetId: card.id,
          cardId: card.id,
          jobId: window.PromptHubCardGallery?.gallerySlotJobId?.(gallery.jobId, idx) || gallery.jobId,
          galleryIndex: idx
        }) || ref;
      }
    } catch (e) { /* ignore */ }
    if (gen !== window.__appreciateViewerGen) return;
    img.onload = () => {
      if (gen !== window.__appreciateViewerGen) return;
      img.onload = null;
      img.onerror = null;
      window.resetImageZoom?.(img);
      window.attachImageZoom?.(img);
      window.finishAppreciateViewerReveal?.();
    };
    img.onerror = () => {
      if (gen !== window.__appreciateViewerGen) return;
      window.setAppreciateViewerLoading?.(false);
    };
    if (displaySrc === img.src && img.complete && img.naturalWidth > 0) img.onload?.();
    else img.src = displaySrc || ref;
  }

  function navigateAppreciateGallery(delta) {
    const gallery = window.__appreciateCardGallery;
    if (!gallery?.urls?.length) return false;
    const viewerNav = window.getViewerNav?.() || { items: [], index: -1 };
    const nextIdx = viewerNav.index + (delta > 0 ? 1 : -1);
    if (nextIdx < 0 || nextIdx >= viewerNav.items.length) return false;
    const item = viewerNav.items[nextIdx];
    if (item?.type !== 'appreciateGalleryTile') return false;
    viewerNav.index = nextIdx;
    const card = getCards().find((c) => c.id === gallery.cardId);
    if (!card) return false;
    void renderAppreciateGalleryIndex(card, item.tileIndex ?? nextIdx, window.__appreciateViewerGen);
    return true;
  }

  function bindAppreciateGalleryUi() {
    const bindBtn = (id, delta) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateAppreciateGallery(delta);
      });
    };
    bindBtn('appreciateGalleryPrev', -1);
    bindBtn('appreciateGalleryNext', 1);
    bindBtn('appreciateHitPrev', -1);
    bindBtn('appreciateHitNext', 1);
  }

  function closeAppreciateViewer(e) {
    const viewer = document.getElementById('appreciateViewer');
    if (!viewer?.classList.contains('active')) return;
    if (e) {
      const t = e.target;
      if (t?.closest?.('.appreciate-viewer-actions button, .appreciate-viewer-gen-btn, .lightbox-actions')) return;
      if (t?.closest?.('.lightbox-gallery-nav, .lightbox-gallery-hit')) return;
      if (t?.closest?.('#appreciateViewerImg, .viewer-image-shine-wrap, #lightboxImage')) return;
      if (t?.closest?.('button') && !t?.closest?.('.appreciate-viewer-close')) return;
    }
    if (typeof window.FeatureDraft?.bumpAppreciateViewerGen === 'function') {
      window.FeatureDraft.bumpAppreciateViewerGen();
    } else {
      window.__appreciateViewerGen = (window.__appreciateViewerGen || 0) + 1;
    }
    viewer.classList.remove('active');
    document.body.classList.remove('appreciate-viewing');
    document.getElementById('appreciateViewerActions')?.classList.add('hidden');
    document.getElementById('appreciateViewerWarehouseActions')?.classList.add('hidden');
    setWarehousePreviewCardId(null);
    window.__appreciateViewerMode = null;
    window.__appreciateCardGallery = null;
    syncAppreciateGalleryUi(0);
    window.FeatureDraft?.onAppreciateViewerClose?.();
    const img = document.getElementById('appreciateViewerImg');
    const caption = document.getElementById('appreciateViewerCaption');
    window.setAppreciateViewerLoading?.(false);
    if (caption) {
      caption.textContent = '';
      caption.style.display = 'none';
    }
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
    window.resetImageZoom?.(null);
  }

  async function openAppreciateViewer(cardId) {
    const card = getCards().find((c) => c.id === cardId);
    if (!card) return;
    setWarehousePreviewCardId(cardId);
    deps.markQuickPreviewTask?.({ warehouseUsed: true });
    syncAppreciateViewerActions('warehouse');
    const hasGallery = setupAppreciateCardGallery(card, 0);
    if (!hasGallery) {
      const navItems = getCards()
        .filter((c) => c.image && hasDisplayImage(c))
        .map((c) => ({ type: 'card', id: c.id, key: `card:${c.id}` }));
      window.setViewerNav?.(navItems, `card:${cardId}`);
    }
    window.__appreciateViewerGen = (window.__appreciateViewerGen || 0) + 1;
    const gen = window.__appreciateViewerGen;
    const viewer = document.getElementById('appreciateViewer');
    const img = document.getElementById('appreciateViewerImg');
    const caption = document.getElementById('appreciateViewerCaption');
    const hint = document.querySelector('.appreciate-viewer-hint');
    if (!viewer || !img) return;
    viewer.classList.add('active');
    document.body.classList.add('appreciate-viewing');
    const title = (card.title || '').trim();
    const prompt = (card.prompt || '').trim();
    if (caption) {
      caption.textContent = title || (prompt ? prompt.slice(0, 120) + (prompt.length > 120 ? '…' : '') : '');
      caption.style.display = caption.textContent ? 'block' : 'none';
    }
    if (hasGallery) {
      img.style.display = 'block';
      if (hint) hint.style.display = 'block';
      await renderAppreciateGalleryIndex(card, 0, gen);
      return;
    }
    const isPlaceholderSrc = (src) => !src || String(src).includes('data:image/svg');
    let instantSrc = '';
    if (card.image) {
      const gridImg = document.querySelector(`.card[data-id="${CSS.escape(String(cardId))}"] .card-img`);
      const gridSrc = gridImg?.currentSrc || gridImg?.src || '';
      if (!isPlaceholderSrc(gridSrc)) instantSrc = gridSrc;
      if (isPlaceholderSrc(instantSrc) && window.MediaPipeline?.getListCached) {
        instantSrc = window.MediaPipeline.getListCached(card.image, cardId) || '';
      } else if (isPlaceholderSrc(instantSrc) && window.SupabaseSync?.getCachedDisplayUrl) {
        instantSrc = window.SupabaseSync.getCachedDisplayUrl(card.image, {
          assetId: cardId,
          variant: window.SupabaseSync.VARIANT_GRID || 'grid'
        }) || '';
      }
    }
    const hasInstant = !isPlaceholderSrc(instantSrc);
    window.setAppreciateViewerLoading?.(!hasInstant);
    let revealed = false;
    const onReady = () => {
      if (gen !== window.__appreciateViewerGen || revealed) return;
      revealed = true;
      img.onload = null;
      img.onerror = null;
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.objectFit = '';
      window.resetImageZoom?.(img);
      window.attachImageZoom?.(img);
      window.finishAppreciateViewerReveal?.();
    };
    if (card.image) {
      img.style.display = 'block';
      if (hint) hint.style.display = 'block';
      img.onload = null;
      img.onerror = null;
      if (hasInstant) {
        img.src = instantSrc;
        if (img.complete && img.naturalWidth > 0) onReady();
        else img.onload = onReady;
      } else {
        img.removeAttribute('src');
        img.onload = onReady;
      }
      void (async () => {
        let displaySrc = card.image;
        try {
          if (window.MediaPipeline?.resolvePreviewUrl) {
            displaySrc = await window.MediaPipeline.resolvePreviewUrl(card.image, {
              assetId: cardId,
              cardId: cardId,
              jobId: card.genJobId || null,
              gridFallbackUrl: instantSrc || ''
            });
          } else if (window.SupabaseSync?.resolveDisplayUrl) {
            displaySrc = await window.SupabaseSync.resolveDisplayUrl(card.image, {
              assetId: cardId,
              variant: window.SupabaseSync.VARIANT_FULL || 'full'
            });
          }
        } catch (err) { /* ignore */ }
        if (gen !== window.__appreciateViewerGen) return;
        if (isPlaceholderSrc(displaySrc)) {
          if (!hasInstant) img.onerror?.();
          return;
        }
        if (displaySrc === img.src) {
          if (img.complete && img.naturalWidth > 0 && !revealed) onReady();
          return;
        }
        if (hasInstant && revealed) {
          img.onload = () => {
            if (gen !== window.__appreciateViewerGen) return;
            img.onload = null;
            window.resetImageZoom?.(img);
          };
          img.src = displaySrc;
          return;
        }
        img.src = displaySrc;
        if (img.complete && img.naturalWidth > 0) onReady();
      })();
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      if (hint) hint.style.display = 'none';
      window.resetImageZoom?.(null);
      window.setAppreciateViewerLoading?.(false);
    }
  }

  function forceExitGlobalView(skipRender = false) {
    const wasActive = isGlobalViewActive() || document.body.classList.contains('global-view');
    if (!wasActive) return;
    closeAppreciateViewer();
    setGlobalViewActive(false);
    document.body.classList.remove('global-view', 'global-view-entering', 'global-view-exiting', 'appreciate-viewing');
    document.getElementById('globalViewBtn')?.classList.remove('active');
    if (!skipRender && typeof deps.renderCards === 'function') deps.renderCards(true);
  }

  function exitGlobalView() {
    if (document.body.classList.contains('community-appreciate') || window.FeatureDraft?.isCommunityQuickPreviewActive?.()) {
      closeAppreciateViewer();
      if (typeof window.FeatureDraft?.exitCommunityAppreciate === 'function') {
        window.FeatureDraft.exitCommunityAppreciate();
      } else {
        window.FeatureDraft?.toggleCommunityAppreciate?.();
      }
      return;
    }
    if (!isGlobalViewActive()) return;
    closeAppreciateViewer();
    setGlobalViewActive(false);
    document.body.classList.remove('global-view', 'appreciate-viewing');
    document.getElementById('globalViewBtn')?.classList.remove('active');
    document.body.classList.add('global-view-exiting');
    setTimeout(() => {
      document.body.classList.remove('global-view-exiting');
      document.querySelectorAll('.card').forEach((el) => { el.draggable = true; });
      deps.scheduleLayoutMasonry?.();
    }, 420);
  }

  function toggleGlobalView() {
    if (isGlobalViewActive()) {
      exitGlobalView();
      return;
    }
    deps.switchAppPage?.('warehouse');
    deps.closeEditPanel?.();
    if (deps.isBatchMode?.()) deps.cancelBatch?.();
    setGlobalViewActive(true);
    deps.markQuickPreviewTask?.({ warehouseUsed: true });
    document.getElementById('globalViewBtn')?.classList.add('active');
    document.body.classList.add('global-view-entering');
    setTimeout(() => {
      document.body.classList.add('global-view');
      document.body.classList.remove('global-view-entering');
      document.querySelectorAll('.card').forEach((el) => { el.draggable = false; });
      requestAnimationFrame(() => deps.scheduleLayoutMasonry?.());
    }, 620);
  }

  function registerAppreciateGalleryWheel() {
    const prevNavigate = window.__viewerWheelNavigate;
    window.__viewerWheelNavigate = function (item) {
      if (item?.type === 'appreciateGalleryTile') {
        const gallery = window.__appreciateCardGallery;
        if (!gallery) return false;
        const viewerNav = window.getViewerNav?.() || { items: [], index: -1 };
        viewerNav.index = viewerNav.items.findIndex((it) => it.key === item.key);
        const card = getCards().find((c) => c.id === gallery.cardId);
        if (!card) return false;
        void renderAppreciateGalleryIndex(card, item.tileIndex ?? 0, window.__appreciateViewerGen);
        return true;
      }
      if (typeof prevNavigate === 'function') return prevNavigate(item) === true;
      return false;
    };
  }

  function init(nextDeps) {
    deps = nextDeps || {};
    bindAppreciateGalleryUi();
    registerAppreciateGalleryWheel();
  }

  window.AppAppreciate = { init };
  window.syncAppreciateViewerActions = syncAppreciateViewerActions;
  window.openAppreciateViewer = openAppreciateViewer;
  window.closeAppreciateViewer = closeAppreciateViewer;
  window.forceExitGlobalView = forceExitGlobalView;
  window.exitGlobalView = exitGlobalView;
  window.toggleGlobalView = toggleGlobalView;
})();
