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

  function closeAppreciateViewer(e) {
    const viewer = document.getElementById('appreciateViewer');
    if (!viewer?.classList.contains('active')) return;
    if (e) {
      const t = e.target;
      if (t?.closest?.('.appreciate-viewer-actions button, .appreciate-viewer-gen-btn, .lightbox-actions')) return;
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
      img.src = '';
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
    const navItems = getCards()
      .filter((c) => c.image && hasDisplayImage(c))
      .map((c) => ({ type: 'card', id: c.id, key: `card:${c.id}` }));
    window.setViewerNav?.(navItems, `card:${cardId}`);
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
      img.src = '';
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

  function init(nextDeps) {
    deps = nextDeps || {};
  }

  window.AppAppreciate = { init };
  window.syncAppreciateViewerActions = syncAppreciateViewerActions;
  window.openAppreciateViewer = openAppreciateViewer;
  window.closeAppreciateViewer = closeAppreciateViewer;
  window.forceExitGlobalView = forceExitGlobalView;
  window.exitGlobalView = exitGlobalView;
  window.toggleGlobalView = toggleGlobalView;
})();
