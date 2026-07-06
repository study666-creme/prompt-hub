      container.querySelectorAll('.card').forEach(card => {
        card.style.width = colWidth + 'px';
      });
    }

    function markCardsGridPriming(container) {
      if (!container || isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') return;
      container.classList.add('cards-grid-priming');
      container.classList.remove('masonry-ready', 'cards-grid-primed');
      primeDesktopCardGrid(container);
    }

    function markCardsGridMasonryReady(container) {
      if (!container) return;
      container.classList.remove('cards-grid-priming');
      container.classList.add('masonry-ready', 'cards-grid-primed');
    }

    function preserveCardsContainerScroll(run) {
      const container = document.getElementById('cardsContainer');
      if (!container || typeof run !== 'function') return;
      const st = container.scrollTop;
      run();
      container.scrollTop = st;
      requestAnimationFrame(() => {
        container.scrollTop = st;
      });
    }

    /** 图片尺寸变化等：只增量排版，不切换 priming 模式，避免滚动条跳顶 */
    function relayoutMasonryGrid() {
      layoutMasonryGrid();
    }
    window.relayoutMasonryGrid = relayoutMasonryGrid;

    function scheduleLayoutMasonry() {
      if (!isMobileViewport()) return;
      clearTimeout(layoutMasonryTimer);
      layoutMasonryTimer = setTimeout(() => enforceMobileCardGrid(), 80);
    }

    function shouldSkipWarehouseImageLayout(img, windowMs = 1100) {
      if (!img) return false;
      const key = img.currentSrc || img.src || img.dataset.imageRef || '';
      const now = Date.now();
      const lastKey = img.dataset.whLayoutKey || '';
      const lastAt = Number(img.dataset.whLayoutAt || 0);
      if (key && lastKey === key && now - lastAt < windowMs) return true;
      img.dataset.whLayoutKey = key || String(now);
      img.dataset.whLayoutAt = String(now);
      return false;
    }

    function bindCardGridImageRelayout(container) {
      if (!container || container.dataset.masonryLoadBound) return;
      container.dataset.masonryLoadBound = '1';
      container.addEventListener('load', (e) => {
        if (!e.target?.classList?.contains('card-img')) return;
        if (isPlaceholderCardImg(e.target)) return;
        if (isMobileViewport()) return;
        if (shouldSkipWarehouseImageLayout(e.target)) return;
        const media = e.target.closest('.card-media');
        if (media && !cardMediaAffectsViewport(media)) return;
        const cardEl = e.target.closest('.card[data-id]');
        if (cardEl?.dataset?.communityCollect === '1') {
          scheduleWarehouseMasonryForCard(cardEl.dataset.id);
        } else {
          scheduleWarehouseMasonryLightLayout();
        }
      }, true);
    }

    let warehouseMasonryTimer = null;
    let warehouseMasonryPending = 0;
    const warehouseMasonryCardCooldown = new Map();
    function scheduleWarehouseMasonryLayout(immediate = false) {
      if (isMobileViewport()) return;
      if (immediate) {
        clearTimeout(warehouseMasonryTimer);
        warehouseMasonryPending = 0;
        layoutMasonryGrid();
        return;
      }
      warehouseMasonryPending += 1;
      const delay = document.body.classList.contains('panel-open')
        ? 48
        : (warehouseMasonryPending > 4 ? 520 : 380);
      clearTimeout(warehouseMasonryTimer);
      warehouseMasonryTimer = setTimeout(() => {
        warehouseMasonryPending = 0;
        layoutMasonryGrid();
      }, delay);
    }
    function scheduleWarehouseMasonryForCard(cardId) {
      if (!cardId) {
        scheduleWarehouseMasonryLayout();
        return;
      }
      const now = Date.now();
      const last = warehouseMasonryCardCooldown.get(cardId) || 0;
      if (now - last < 900) return;
      warehouseMasonryCardCooldown.set(cardId, now);
      scheduleWarehouseMasonryLightLayout();
    }

    /** 图加载后仅 layout()，避免 reloadItems 整网格重排 */
    function scheduleWarehouseMasonryLightLayout() {
      if (isMobileViewport()) return;
      warehouseMasonryPending += 1;
      const delay = document.body.classList.contains('panel-open')
        ? 64
        : (warehouseMasonryPending > 6 ? 640 : 420);
      clearTimeout(warehouseMasonryTimer);
      warehouseMasonryTimer = setTimeout(() => {
        warehouseMasonryPending = 0;
        if (masonryInstance) {
          try {
            masonryInstance.layout();
            return;
          } catch (e) { /* fallback */ }
        }
        layoutMasonryGrid();
      }, delay);
    }

    function resetCardLayoutStyles(container) {
      if (!container) return;
      container.querySelectorAll('.card').forEach((card) => {
        card.removeAttribute('style');
        card.style.position = 'relative';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
      });
    }

    function resetWarehouseGridLayout(container) {
      if (!container) return;
      resetCardLayoutStyles(container);
      container.classList.remove('cards-grid-priming', 'mobile-grid');
      container.classList.add('cards-grid-primed', 'masonry-ready');
    }

    function enforceMobileCardGrid() {
      if (!isMobileViewport()) return;
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      if (masonryInstance) {
        try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
        masonryInstance = null;
      }
      container.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
      container.classList.add('mobile-grid', 'cards-grid-primed');
      container.removeAttribute('style');
      resetCardLayoutStyles(container);
    }
    window.enforceMobileCardGrid = enforceMobileCardGrid;

    function layoutMasonryGrid() {
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (!container || viewMode === 'list') return;
      if (isMobileViewport()) {
        if (masonryInstance) {
          try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
          masonryInstance = null;
        }
        enforceMobileCardGrid();
        return;
      }
      const cardEls = [...container.querySelectorAll('.card')];
      if (!cardEls.length) {
        if (masonryInstance) {
          try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
          masonryInstance = null;
        }
        return;
      }
      const gap = getMasonryGap();
      const innerW = getCardsInnerWidth();
      if (innerW < 200) {
        scheduleWarehouseMasonryLayout();
        return;
      }
      const cols = Math.max(1, cardColumns);
      const colWidth = Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
      let sizer = container.querySelector('.grid-sizer');
      if (!sizer) {
        sizer = document.createElement('div');
        sizer.className = 'grid-sizer';
        container.insertBefore(sizer, container.firstChild);
      }
      sizer.style.width = colWidth + 'px';
      cardEls.forEach((card) => {
        card.style.width = colWidth + 'px';
      });
      const opts = {
        itemSelector: '.card',
        columnWidth: '.grid-sizer',
        gutter: gap,
        percentPosition: false,
        horizontalOrder: true,
        transitionDuration: 0
      };
      container.style.removeProperty('height');
      const scrollTop = container.scrollTop;
      const runLayout = () => {
        if (masonryInstance) {
          masonryInstance.option(opts);
          masonryInstance.reloadItems();
          masonryInstance.layout();
        } else if (typeof Masonry !== 'undefined') {
          masonryInstance = new Masonry(container, opts);
        }
        container.scrollTop = scrollTop;
        container.classList.add('masonry-ready', 'cards-grid-primed');
        if (typeof repositionWarehouseScrollSentinel === 'function') {
          repositionWarehouseScrollSentinel(container);
        }
      };
      if (typeof Masonry !== 'undefined') {
        runLayout();
      } else if (typeof ensureMasonryScript === 'function') {
        void ensureMasonryScript().then(runLayout);
      }
    }

    function highlightSelectedCard(id) {
      document.querySelectorAll('#cardsContainer .card.selected').forEach((el) => {
        el.classList.remove('selected', 'card-selected-bloom');
      });
      if (!id) return;
      const el = document.querySelector(`#cardsContainer .card[data-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.classList.add('selected');
      pulseWarehouseCard(el, 'select');
    }

    function pulseWarehouseCard(cardEl, kind) {
      if (!cardEl?.closest?.('#cardsContainer')) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
      const cls = kind === 'select' ? 'card-selected-bloom' : 'card-press-pop';
      cardEl.classList.remove('card-press-pop', 'card-selected-bloom');
      void cardEl.offsetWidth;
      cardEl.classList.add(cls);
      cardEl.addEventListener('animationend', () => cardEl.classList.remove(cls), { once: true });
    }

    function rippleWarehouseCard(cardEl, clientX, clientY) {
      if (!cardEl?.closest?.('#cardsContainer')) return;
      const rect = cardEl.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      cardEl.style.setProperty('--card-ripple-x', `${(x / rect.width) * 100}%`);
      cardEl.style.setProperty('--card-ripple-y', `${(y / rect.height) * 100}%`);
    }

    function pulseFabButton() {
      const fab = document.getElementById('fabNewBtn');
      if (!fab || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
      fab.classList.remove('fab-new--ripple');
      void fab.offsetWidth;
      fab.classList.add('fab-new--ripple');
      fab.addEventListener('animationend', () => fab.classList.remove('fab-new--ripple'), { once: true });
    }

    const CARD_DRAG_BLANK_IMG = (() => {
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      return img;
    })();
    let cardDragVisual = null;

    function getDragLayer() {
      let root = document.getElementById('dragLayerRoot');
      if (!root) {
        root = document.createElement('div');
        root.id = 'dragLayerRoot';
        root.className = 'drag-layer-root';
        root.setAttribute('aria-hidden', 'true');
        document.documentElement.appendChild(root);
      }
      return root;
    }

    function onDocCardDrag(e) {
      if (!cardDragVisual) return;
      moveCardDragVisual(e);
    }

    function onDocCardDragOver(e) {
      if (!cardDragVisual) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      moveCardDragVisual(e);
    }

    function getDragCardIds(cardEl) {
      const id = cardEl.dataset.id;
      if (batchMode && selectedCardIds.size > 0 && selectedCardIds.has(id)) {
        return [...selectedCardIds];
      }
      return [id];
    }

    function createCardDragPreview(cardEl, stackIndex) {
      const preview = document.createElement('div');
      preview.className = 'card-drag-preview';
      preview.style.setProperty('--stack-i', stackIndex);
      const imgEl = cardEl.querySelector('.card-img');
      if (imgEl?.src) {
        const im = document.createElement('img');
        im.src = imgEl.src;
        im.alt = '';
        im.draggable = false;
        preview.appendChild(im);
      }
      const titleEl = document.createElement('span');
      titleEl.className = 'card-drag-preview-title';
      const titleText = cardEl.querySelector('.card-title')?.textContent?.trim();
      const promptText = cardEl.querySelector('.card-prompt')?.textContent?.trim();
      titleEl.textContent = titleText || (promptText ? promptText.slice(0, 24) + (promptText.length > 24 ? '…' : '') : '无标题提示词');
      preview.appendChild(titleEl);
      return preview;
    }

    function startCardDragVisual(cardEl, e, cardIds) {
      endCardDragVisual();
      const rect = cardEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const ids = cardIds?.length ? cardIds : [cardEl.dataset.id];
      const sourceEls = [];
      ids.forEach(cid => {
        const el = document.querySelector(`.card[data-id="${cid}"]`);
        if (el) {
          el.classList.add('card-dragging-source');
          sourceEls.push(el);
        }
      });
      const stack = document.createElement('div');
      stack.className = 'card-drag-stack';
      const previewIds = ids.slice(0, 3);
      previewIds.forEach((cid, i) => {
        const el = document.querySelector(`.card[data-id="${cid}"]`);
        if (el) stack.appendChild(createCardDragPreview(el, i));
      });
      if (ids.length > 3) {
        const more = document.createElement('span');
        more.className = 'card-drag-more';
        more.textContent = '+' + (ids.length - 3);
        stack.appendChild(more);
      }
      stack.style.left = rect.left + 'px';
      stack.style.top = rect.top + 'px';
      getDragLayer().appendChild(stack);
      document.body.classList.add('is-card-dragging');
      e.dataTransfer.setDragImage(CARD_DRAG_BLANK_IMG, 0, 0);
      document.addEventListener('drag', onDocCardDrag, true);
      document.addEventListener('dragover', onDocCardDragOver, true);
      cardDragVisual = { sourceEls, stack, offsetX, offsetY };
    }

    function moveCardDragVisual(e) {
      if (!cardDragVisual || (e.clientX === 0 && e.clientY === 0)) return;
      const { stack, offsetX, offsetY } = cardDragVisual;
      stack.style.left = (e.clientX - offsetX) + 'px';
      stack.style.top = (e.clientY - offsetY) + 'px';
    }

    function endCardDragVisual() {
      if (!cardDragVisual) return;
      document.removeEventListener('drag', onDocCardDrag, true);
      document.removeEventListener('dragover', onDocCardDragOver, true);
      cardDragVisual.sourceEls.forEach(el => el.classList.remove('card-dragging-source'));
      cardDragVisual.stack.remove();
      document.body.classList.remove('is-card-dragging');
      document.querySelectorAll('.group-item.group-drag-over').forEach(el => el.classList.remove('group-drag-over'));
      cardDragVisual = null;
    }

    function canShowFloatingPrompt() {
      return document.getElementById('pageWarehouse')?.classList.contains('active') === true;
    }

    function floatingPromptOverlapsPanel() {
      const fp = document.getElementById('floatingPrompt');
      const panel = document.getElementById('editPanel');
      if (!fp || fp.classList.contains('hidden') || !panel || panel.classList.contains('hidden')) return false;
      const fpR = fp.getBoundingClientRect();
      const panelR = panel.getBoundingClientRect();
      return fpR.right > panelR.left + 8 && fpR.left < panelR.right - 8
        && fpR.bottom > panelR.top + 8 && fpR.top < panelR.bottom - 8;
    }

    function floatingPromptOffScreen() {
      const fp = document.getElementById('floatingPrompt');
      if (!fp) return false;
      const r = fp.getBoundingClientRect();
      return r.right < 24 || r.bottom < 24
        || r.left > window.innerWidth - 24 || r.top > window.innerHeight - 24;
    }

    function applyFloatingState() {
      const floating = document.getElementById('floatingPrompt');
      const fpToggleBtn = document.getElementById('fpToggleBtn');
      const show = floatingPromptActive && canShowFloatingPrompt();
      document.body.classList.toggle('floating-prompt-active', show);
      const fpIconFloat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
      const fpIconPin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3.76z"/></svg>';
      if (show) {
        floating.classList.remove('hidden');
        if (settings.floatingPromptMaximized) {
          floating.classList.add('floating-prompt--maximized');
          floating.style.left = '0';
          floating.style.top = '0';
          floating.style.width = '';
          floating.style.height = '';
        } else {
          floating.classList.remove('floating-prompt--maximized');
          applyFloatingPromptSize();
          requestAnimationFrame(() => applyFloatingPromptPosition());
        }
        updateFloatingPromptMaximizeUI();
        if (fpToggleBtn) {
          fpToggleBtn.innerHTML = fpIconPin;
          fpToggleBtn.classList.add('is-active');
          fpToggleBtn.title = '固定到面板';
        }
        document.getElementById('floatingPromptText').value = document.getElementById('cardPrompt').value;
      } else {
        floating.classList.add('hidden');
        if (fpToggleBtn) {
          fpToggleBtn.innerHTML = fpIconFloat;
          fpToggleBtn.classList.remove('is-active');
          fpToggleBtn.title = '浮动提示词框';
        }
        if (floatingPromptActive) {
          document.getElementById('cardPrompt').value = document.getElementById('floatingPromptText').value;
        }
      }
    }

    function toggleFloatingPrompt() {
      floatingPromptActive = !floatingPromptActive;
      applyFloatingState();
      settings.floatingPrompt = floatingPromptActive;
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
    }
    window.toggleFloatingPrompt = toggleFloatingPrompt;
    Object.defineProperty(window, 'floatingPromptActive', {
      get() { return floatingPromptActive; },
      configurable: true
    });

    function copyPromptFromFloating() {
      const text = document.getElementById('floatingPromptText').value;
      if (text) { navigator.clipboard.writeText(text); showToast('提示词已复制'); }
    }

    function copyPromptFromPanel() {
      const text = document.getElementById('cardPrompt').value;
      if (text) { navigator.clipboard.writeText(text); showToast('提示词已复制'); }
    }

    function fillPromptToImageGenFromPanel() {
      const prompt = (document.getElementById('cardPrompt')?.value || '').trim();
      if (!prompt) {
        showToast('请先填写提示词');
        return;
      }
      const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
      const payload = card
        ? { ...card, prompt }
        : { id: selectedCardId || '', prompt, image: imageData || null };
      void window.FeatureDraft?.fillCardToImageGen?.(payload);
    }
    window.fillPromptToImageGenFromPanel = fillPromptToImageGenFromPanel;

    function clampFloatingPromptPosition(left, top, fp) {
      const el = fp || document.getElementById('floatingPrompt');
      const w = el.offsetWidth || 380;
      const h = el.offsetHeight || 340;
      const maxL = Math.max(8, window.innerWidth - w - 8);
      const maxT = Math.max(8, window.innerHeight - h - 8);
      return {
        left: Math.min(Math.max(8, left), maxL),
        top: Math.min(Math.max(8, top), maxT)
      };
    }

    function getDefaultFloatingPromptPosition() {
      const fp = document.getElementById('floatingPrompt');
      const fpW = fp.offsetWidth || 380;
      const fpH = fp.offsetHeight || 340;
      const panel = document.getElementById('editPanel');
      if (panel && !panel.classList.contains('hidden')) {
        const r = panel.getBoundingClientRect();
        if (isMobileViewport()) {
          return clampFloatingPromptPosition(12, Math.min(r.top + 56, window.innerHeight - fpH - 12), fp);
        }
        const left = Math.max(12, r.left - fpW - 16);
        return clampFloatingPromptPosition(left, r.top + 48, fp);
      }
      return clampFloatingPromptPosition(window.innerWidth - fpW - 380, Math.max(72, window.innerHeight - fpH - 120), fp);
    }

    function setFloatingPromptPosition(left, top) {
      const fp = document.getElementById('floatingPrompt');
      const pos = clampFloatingPromptPosition(left, top, fp);
      fp.style.left = pos.left + 'px';
      fp.style.top = pos.top + 'px';
      fp.style.right = 'auto';
      fp.style.bottom = 'auto';
      return pos;
    }

    function anchorFloatingPromptBox() {
      const fp = document.getElementById('floatingPrompt');
      const rect = fp.getBoundingClientRect();
      return setFloatingPromptPosition(rect.left, rect.top);
    }

    function applyFloatingPromptPosition(opts = {}) {
      const fp = document.getElementById('floatingPrompt');
      if (!fp) return;
      const pos = settings.floatingPromptPos;
      const forceDefault = opts.forceDefault === true;
      if (!forceDefault && pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        setFloatingPromptPosition(pos.left, pos.top);
        if (floatingPromptOverlapsPanel() || floatingPromptOffScreen()) {
          const def = getDefaultFloatingPromptPosition();
          settings.floatingPromptPos = setFloatingPromptPosition(def.left, def.top);
          localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        }
        return;
      }
      const def = getDefaultFloatingPromptPosition();
      const saved = setFloatingPromptPosition(def.left, def.top);
      if (opts.save !== false) {
        settings.floatingPromptPos = saved;
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
      }
    }

    function saveFloatingPromptPosition() {
      const fp = document.getElementById('floatingPrompt');
      const left = parseFloat(fp.style.left);
      const top = parseFloat(fp.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      settings.floatingPromptPos = clampFloatingPromptPosition(left, top, fp);
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
    }

    const FLOATING_PROMPT_MIN_W = 280;
    const FLOATING_PROMPT_MIN_H = 280;

    function isFloatingPromptMaximized() {
      const fp = document.getElementById('floatingPrompt');
      return !!(fp && fp.classList.contains('floating-prompt--maximized'));
    }

    function getFloatingPromptViewportLimits() {
      return {
        maxW: Math.max(FLOATING_PROMPT_MIN_W, window.innerWidth - 16),
        maxH: Math.max(FLOATING_PROMPT_MIN_H, window.innerHeight - 16)
      };
    }

    function clampFloatingPromptSize(w, h) {
      const { maxW, maxH } = getFloatingPromptViewportLimits();
      return {
        width: Math.min(Math.max(FLOATING_PROMPT_MIN_W, Math.round(w)), maxW),
        height: Math.min(Math.max(FLOATING_PROMPT_MIN_H, Math.round(h)), maxH)
      };
    }

    function getDefaultFloatingPromptSize() {
      const margin = 20;
      const panel = document.getElementById('editPanel');
      let w = Math.round(window.innerWidth * 0.52);
      let h = Math.round(window.innerHeight * 0.88);
      if (panel && !panel.classList.contains('hidden')) {
        const pr = panel.getBoundingClientRect();
        if (pr.width > 80 && pr.left < window.innerWidth - 40) {
          w = Math.max(FLOATING_PROMPT_MIN_W, Math.floor(pr.left - margin * 2));
        }
      }
      return clampFloatingPromptSize(
        Math.min(w, window.innerWidth - margin * 2),
        Math.min(h, window.innerHeight - margin * 2)
      );
    }

    function effectiveFloatingPromptSize() {
      const saved = settings.floatingPromptSize;
      if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
        if (saved.width === 380 && saved.height === 340) return getDefaultFloatingPromptSize();
        return { width: saved.width, height: saved.height };
      }
      return getDefaultFloatingPromptSize();
    }

    function applyFloatingPromptSize() {
      const fp = document.getElementById('floatingPrompt');
      if (!fp || isFloatingPromptMaximized()) return;
      const size = clampFloatingPromptSize(
        effectiveFloatingPromptSize().width,
        effectiveFloatingPromptSize().height
      );
      fp.style.width = size.width + 'px';
      fp.style.height = size.height + 'px';
      fp.style.maxWidth = 'none';
      fp.style.maxHeight = 'none';
    }

    function saveFloatingPromptSize() {
      if (isFloatingPromptMaximized()) return;
      const fp = document.getElementById('floatingPrompt');
      if (!fp) return;
      settings.floatingPromptSize = clampFloatingPromptSize(fp.offsetWidth, fp.offsetHeight);
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
    }

    function updateFloatingPromptMaximizeUI() {
      const fp = document.getElementById('floatingPrompt');
      const btn = document.getElementById('floatingPromptMaxBtn');
      if (!fp || !btn) return;
      const maxed = isFloatingPromptMaximized();
      const label = maxed ? '还原大小' : '拉满屏幕';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      const maxIcon = btn.querySelector('.fp-maximize-icon');
      const restoreIcon = btn.querySelector('.fp-restore-icon');
      if (maxIcon) maxIcon.classList.toggle('hidden', maxed);
      if (restoreIcon) restoreIcon.classList.toggle('hidden', !maxed);
      const header = document.getElementById('floatingPromptHeader');
      if (header) header.style.cursor = maxed ? 'default' : '';
    }

    function toggleFloatingPromptMaximize() {
      const fp = document.getElementById('floatingPrompt');
      if (!fp || fp.classList.contains('hidden')) return;

      if (isFloatingPromptMaximized()) {
        fp.classList.remove('floating-prompt--maximized');
        settings.floatingPromptMaximized = false;
        const restore = settings.floatingPromptRestore;
        if (restore && restore.size) settings.floatingPromptSize = restore.size;
        applyFloatingPromptSize();
        if (restore && restore.pos) {
          const pos = setFloatingPromptPosition(restore.pos.left, restore.pos.top);
          settings.floatingPromptPos = pos;
        } else {
          applyFloatingPromptPosition();
        }
      } else {
        const rect = fp.getBoundingClientRect();
        settings.floatingPromptRestore = {
          size: clampFloatingPromptSize(rect.width, rect.height),
          pos: clampFloatingPromptPosition(rect.left, rect.top, fp)
        };
        fp.classList.add('floating-prompt--maximized');
        settings.floatingPromptMaximized = true;
        fp.style.left = '0';
        fp.style.top = '0';
        fp.style.width = '';
        fp.style.height = '';
      }

      updateFloatingPromptMaximizeUI();
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
    }
    window.toggleFloatingPromptMaximize = toggleFloatingPromptMaximize;

    (function initFloatingPromptDrag() {
      const fp = document.getElementById('floatingPrompt');
      const header = document.getElementById('floatingPromptHeader');
      const DRAG_THRESHOLD = 6;
      let offsetX = 0, offsetY = 0, startX = 0, startY = 0, dragging = false;

      header.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button') || isFloatingPromptMaximized()) return;
        const anchored = anchorFloatingPromptBox();
        offsetX = anchored.left;
        offsetY = anchored.top;
        startX = e.clientX;
        startY = e.clientY;
        dragging = false;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      function onMouseMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          dragging = true;
        }
        setFloatingPromptPosition(offsetX + dx, offsetY + dy);
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (dragging) saveFloatingPromptPosition();
        dragging = false;
      }

      window.addEventListener('resize', () => {
        if (!floatingPromptActive || !canShowFloatingPrompt()) return;
        if (isFloatingPromptMaximized()) return;
        applyFloatingPromptSize();
        applyFloatingPromptPosition();
      });

      const resizeHandle = document.getElementById('floatingPromptResize');
      if (resizeHandle) {
        const RESIZE_THRESHOLD = 4;
        let startX = 0, startY = 0, startW = 0, startH = 0, startLeft = 0, startTop = 0, resizing = false;

        function beginResize(clientX, clientY) {
          if (isFloatingPromptMaximized()) return;
          const rect = fp.getBoundingClientRect();
          startX = clientX;
          startY = clientY;
          startW = rect.width;
          startH = rect.height;
          startLeft = rect.left;
          startTop = rect.top;
          resizing = false;
          fp.classList.add('floating-prompt--resizing');
        }

        function onResizeMove(e) {
          const clientX = e.clientX ?? e.touches?.[0]?.clientX;
          const clientY = e.clientY ?? e.touches?.[0]?.clientY;
          if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
          const dx = clientX - startX;
          const dy = clientY - startY;
          if (!resizing && Math.abs(dx) < RESIZE_THRESHOLD && Math.abs(dy) < RESIZE_THRESHOLD) return;
          resizing = true;
          const size = clampFloatingPromptSize(startW + dx, startH + dy);
          fp.style.width = size.width + 'px';
          fp.style.height = size.height + 'px';
          fp.style.maxWidth = 'none';
          fp.style.maxHeight = 'none';
          const left = Number.isFinite(parseFloat(fp.style.left)) ? parseFloat(fp.style.left) : startLeft;
          const top = Number.isFinite(parseFloat(fp.style.top)) ? parseFloat(fp.style.top) : startTop;
          setFloatingPromptPosition(left, top);
        }

        function onResizeUp() {
          document.removeEventListener('mousemove', onResizeMove);
          document.removeEventListener('mouseup', onResizeUp);
          document.removeEventListener('touchmove', onResizeMove);
          document.removeEventListener('touchend', onResizeUp);
          fp.classList.remove('floating-prompt--resizing');
          if (resizing) saveFloatingPromptSize();
          resizing = false;
        }

        resizeHandle.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || isFloatingPromptMaximized()) return;
          e.preventDefault();
          e.stopPropagation();
          beginResize(e.clientX, e.clientY);
          document.addEventListener('mousemove', onResizeMove);
          document.addEventListener('mouseup', onResizeUp);
        });

        resizeHandle.addEventListener('touchstart', (e) => {
          if (isFloatingPromptMaximized()) return;
          e.preventDefault();
          e.stopPropagation();
          const t = e.touches?.[0];
          if (!t) return;
          beginResize(t.clientX, t.clientY);
          document.addEventListener('touchmove', onResizeMove, { passive: false });
          document.addEventListener('touchend', onResizeUp);
        }, { passive: false });
      }

      const panel = document.getElementById('editPanel');
      if (panel && typeof ResizeObserver !== 'undefined') {
        const panelObs = new ResizeObserver(() => {
          if (!floatingPromptActive || !canShowFloatingPrompt()) return;
          if (panel.classList.contains('hidden')) return;
          applyFloatingPromptPosition({ forceDefault: floatingPromptOverlapsPanel() });
        });
        panelObs.observe(panel);
      }
    })();

    const APP_PAGE_IDS = {
      warehouse: 'pageWarehouse',
      devlab: 'pageDevLab',
      community: 'pageCommunity',
      creations: 'pageCreations',
      imagegen: 'pageImageGen'
    };

    const DEVLAB_PANEL_KEY = 'promptrepo_devlab_panel';
    let featureAssetsLoadPromise = null;

    function scriptSrcWithBuild(file) {
      const build = window.__APP_BUILD__ || '';
      return build ? `${file}?v=${encodeURIComponent(build)}` : file;
    }

    function loadScriptOnce(src, key) {
      const attr = `script[data-ph-dynamic="${key}"]`;
      const existing = document.querySelector(attr);
      if (existing?.dataset.loaded === '1') return Promise.resolve();
      if (existing?.__phLoadPromise) return existing.__phLoadPromise;
      const script = existing || document.createElement('script');
      script.dataset.phDynamic = key;
      if (!existing) {
        script.src = src;
        script.async = false;
        document.body.appendChild(script);
      }
      script.__phLoadPromise = new Promise((resolve, reject) => {
        script.addEventListener('load', () => {
          script.dataset.loaded = '1';
          resolve();
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      });
      return script.__phLoadPromise;
    }

    function initFeatureAssetsOnce() {
      if (!window.FeatureAssets?.init || window.__featureAssetsInitialized) return;
      window.FeatureAssets.init();
      window.__featureAssetsInitialized = true;
    }

    function ensureFeatureAssets() {
      if (window.FeatureAssets?.init) {
        initFeatureAssetsOnce();
        return Promise.resolve(window.FeatureAssets);
      }
      if (!featureAssetsLoadPromise) {
        featureAssetsLoadPromise = loadScriptOnce(scriptSrcWithBuild('features-assets.js'), 'features-assets')
          .then(() => {
            initFeatureAssetsOnce();
            return window.FeatureAssets;
          })
          .catch((e) => {
            featureAssetsLoadPromise = null;
            throw e;
          });
      }
      return featureAssetsLoadPromise;
    }
    window.ensureFeatureAssets = ensureFeatureAssets;

    function getDevLabPanel() {
      const p = localStorage.getItem(DEVLAB_PANEL_KEY);
      return p === 'assetstudio' ? 'assetstudio' : 'assetmarket';
    }

    function switchDevLabPanel(panel) {
      const key = panel === 'assetstudio' ? 'assetstudio' : 'assetmarket';
      localStorage.setItem(DEVLAB_PANEL_KEY, key);
      document.querySelectorAll('#devLabFolderList .group-item[data-devlab-panel]').forEach((el) => {
        el.classList.toggle('active', el.dataset.devlabPanel === key);
      });
      document.querySelectorAll('.devlab-panel[data-devlab-panel]').forEach((el) => {
        el.classList.toggle('active', el.dataset.devlabPanel === key);
      });
      document.querySelectorAll('.devlab-mobile-tab[data-devlab-panel]').forEach((el) => {
        el.classList.toggle('active', el.dataset.devlabPanel === key);
      });
      const render = () => {
        if (key === 'assetmarket') void window.FeatureAssets?.renderMarketplace?.();
        if (key === 'assetstudio') window.FeatureAssets?.renderStudio?.();
        window.FeatureAssets?.onAppChange?.('devlab', key);
      };
      if (window.FeatureAssets) render();
      else void ensureFeatureAssets().then(render).catch((e) => {
        console.warn('[assets] failed to load', e);
        showToast('资产模块加载失败，请刷新后重试', 5000);
      });
    }
    window.switchDevLabPanel = switchDevLabPanel;

    function initDevLabNav() {
      const activate = (panel) => {
        if (document.getElementById('pageDevLab')?.classList.contains('active')) {
          switchDevLabPanel(panel);
        }
      };
      document.querySelectorAll('#devLabFolderList .group-item[data-devlab-panel]').forEach((el) => {
        el.addEventListener('click', () => activate(el.dataset.devlabPanel));
