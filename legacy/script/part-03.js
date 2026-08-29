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
        // 仓库媒体框已用占位高，图片加载不改变卡片高度，无需任何重排；
        // CSS multi-column（聚焦）/稳定 Grid（非聚焦）会自动布局。
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
      const container = document.getElementById('cardsContainer');
      // 聚焦瀑布流（列式）需要随图片加载重新分列，不能被 stable-grid 早退跳过。
      const focusedColumns = container?.classList?.contains('warehouse-focus-columns');
      if (container?.classList.contains('warehouse-stable-grid') && !focusedColumns) return;
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
        card.style.position = 'relative';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.right = '';
        card.style.bottom = '';
      });
    }

    function resetWarehouseGridLayout(container) {
      if (!container) return;
      resetCardLayoutStyles(container);
      container.classList.remove('cards-grid-priming', 'mobile-grid');
      container.classList.add('cards-grid-primed', 'masonry-ready', 'warehouse-stable-grid');
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
      container.classList.remove('warehouse-stable-grid');
      container.style.removeProperty('--warehouse-grid-columns');
      container.style.removeProperty('--warehouse-grid-gap');
      container.classList.add('mobile-grid', 'cards-grid-primed');
      container.removeAttribute('style');
      resetCardLayoutStyles(container);
    }
    window.enforceMobileCardGrid = enforceMobileCardGrid;

    /* ===== 列容器瀑布流 =====
     * 卡片由 JS 分发到固定数量的 .warehouse-focus-col 列容器，DOM 顺序不变但归属固定。
     * 相比 CSS multi-column：浏览器不会在图片加载时 balance 重排把卡片在列之间搬来搬去
     * （那种搬移就是"其他几列疯狂被替换/闪动"的来源）。图片加载只改变该卡片在自己列
     * 内的高度，其他列已有的卡片不会被挤走。 */
    function warehouseFocusColumnCount(columns) {
      const raw = Number.isFinite(columns) && Number(columns) > 0 ? Number(columns) : Number(cardColumns);
      const n = Number.isFinite(raw) ? raw : 4;
      return Math.min(5, Math.max(1, n));
    }

    /** 卡片在网格里的稳定序号：首次分发时按文档顺序写入，之后重排都按它还原次序。
     * 列容器会把卡片按"列0整列、列1整列…"的文档顺序串起来，不还原就会打乱卡片次序。 */
    function warehouseCardOrder(card) {
      const raw = Number(card?.dataset?.whOrder);
      return Number.isFinite(raw) && raw >= 0 ? raw : Number.MAX_SAFE_INTEGER;
    }

    /** 给缺少序号的卡片按当前文档顺序补号；已编号的卡片沿用原号以保持次序。 */
    function ensureWarehouseCardOrders(cardEls) {
      let maxOrder = -1;
      cardEls.forEach((card) => {
        const raw = Number(card.dataset.whOrder);
        if (Number.isFinite(raw) && raw > maxOrder) maxOrder = raw;
      });
      cardEls.forEach((card) => {
        const raw = Number(card.dataset.whOrder);
        if (!Number.isFinite(raw)) card.dataset.whOrder = String(maxOrder += 1);
      });
    }

    /** 取回列容器里的所有卡片回到容器直属，并移除列容器。
     * 首次分发时卡片仍是容器直属子元素，必须一并收集；只从列容器里取会导致
     * 首次调用返回空数组、分发函数早退，列容器永远建不起来（卡片退化成单列堆叠）。 */
    function flattenWarehouseFocusColumns(container) {
      if (!container) return [];
      const cards = [];
      container.querySelectorAll(':scope > .warehouse-focus-col').forEach((col) => {
        while (col.firstChild) {
          const node = col.firstChild;
          container.appendChild(node);
          if (node.nodeType === 1 && node.classList?.contains('card')) cards.push(node);
        }
        col.remove();
      });
      container.querySelectorAll(':scope > .card').forEach((card) => cards.push(card));
      container.classList.remove('warehouse-focus-columns');
      return cards.sort((a, b) => warehouseCardOrder(a) - warehouseCardOrder(b));
    }
    window.flattenWarehouseFocusColumns = flattenWarehouseFocusColumns;

    /** 确保列容器存在且数量正确；已有且数量一致时直接复用（不搬动卡片） */
    function ensureWarehouseFocusColumns(container, columns) {
      if (!container) return [];
      const cols = warehouseFocusColumnCount(columns);
      const existing = [...container.querySelectorAll(':scope > .warehouse-focus-col')];
      if (existing.length === cols) {
        container.classList.add('warehouse-focus-columns');
        return existing;
      }
      flattenWarehouseFocusColumns(container);
      const colEls = [];
      for (let i = 0; i < cols; i += 1) {
        const col = document.createElement('div');
        col.className = 'warehouse-focus-col';
        container.appendChild(col);
        colEls.push(col);
      }
      container.classList.add('warehouse-focus-columns');
      return colEls;
    }
    window.ensureWarehouseFocusColumns = ensureWarehouseFocusColumns;

    /** 图片未加载时用宽高比估算高度，使首次分发的列高尽量均衡 */
    function estimateWarehouseFocusCardHeight(card, colWidth) {
      if (!card) return 200;
      const actual = card.offsetHeight;
      if (actual > 40) return actual;
      const img = card.querySelector('.card-img');
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const w = colWidth || card.clientWidth || 300;
        return Math.round(w * (img.naturalHeight / img.naturalWidth)) + 96;
      }
      return card.classList.contains('card--text-only') ? 150 : 320;
    }

    function warehouseFocusColumnLoads(colEls, colWidth, gap) {
      return colEls.map((col) => {
        let h = 0;
        col.querySelectorAll(':scope > .card').forEach((card) => {
          h += estimateWarehouseFocusCardHeight(card, colWidth) + gap;
        });
        return h;
      });
    }

    /** 全量重排：重置列表、切列数或窗口尺寸变化时使用 */
    function distributeWarehouseFocusColumns(container, columns) {
      if (!container || isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') return;
      const cardEls = flattenWarehouseFocusColumns(container);
      if (!cardEls.length) return;
      ensureWarehouseCardOrders(cardEls);
      const colEls = ensureWarehouseFocusColumns(container, columns);
      if (!colEls.length) return;
      const gap = getMasonryGap();
      const colWidth = colEls[0].clientWidth || (container.clientWidth / colEls.length) || 300;
      const loads = new Array(colEls.length).fill(0);
      const lastWasText = new Array(colEls.length).fill(false);
      cardEls.forEach((card) => {
        const isText = card.classList.contains('card--text-only');
        let target = 0;
        for (let i = 1; i < loads.length; i += 1) if (loads[i] < loads[target]) target = i;
        // 若最矮列末尾也是文字卡且当前是文字卡，改放次矮列，避免文字卡堆叠。
        if (isText && lastWasText[target]) {
          let best = -1;
          for (let i = 0; i < loads.length; i += 1) {
            if (i === target || lastWasText[i]) continue;
            if (best < 0 || loads[i] < loads[best]) best = i;
          }
          if (best >= 0 && loads[best] - loads[target] < 260) target = best;
        }
        colEls[target].appendChild(card);
        loads[target] += estimateWarehouseFocusCardHeight(card, colWidth) + gap;
        lastWasText[target] = isText;
      });
    }
    window.distributeWarehouseFocusColumns = distributeWarehouseFocusColumns;

    /** 增量追加：分页加载新卡时只把新卡放进当前最矮列，已有卡片原地不动 */
    function appendWarehouseFocusCards(container, cardEls) {
      if (!container || !cardEls?.length || isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') return;
      const pending = cardEls.filter((card) => card?.parentElement === container);
      if (!pending.length) return;
      const colEls = ensureWarehouseFocusColumns(container);
      if (!colEls.length) return;
      const gap = getMasonryGap();
      const colWidth = colEls[0].clientWidth || (container.clientWidth / colEls.length) || 300;
      const loads = warehouseFocusColumnLoads(colEls, colWidth, gap);
      pending.forEach((card) => {
        let target = 0;
        for (let i = 1; i < loads.length; i += 1) if (loads[i] < loads[target]) target = i;
        colEls[target].appendChild(card);
        loads[target] += estimateWarehouseFocusCardHeight(card, colWidth) + gap;
      });
    }
    window.appendWarehouseFocusCards = appendWarehouseFocusCards;

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
        flattenWarehouseFocusColumns(container);
        container.classList.remove('warehouse-stable-grid', 'warehouse-focus-columns');
        return;
      }
      if (masonryInstance) {
        try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
        masonryInstance = null;
      }
      container.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
      container.style.removeProperty('height');
      container.style.setProperty('--warehouse-grid-columns', String(Math.max(1, cardColumns)));
      container.style.setProperty('--warehouse-grid-gap', `${getMasonryGap()}px`);
      resetCardLayoutStyles(container);
      // 列容器瀑布流：卡片按最矮列分发到 .warehouse-focus-col（见 styles/base/part-09.css）。
      // 卡片位置由 JS 固定，图片加载不会把卡片在列之间搬动，避免闪动。
      container.classList.remove('warehouse-stable-grid');
      container.classList.add('masonry-ready', 'cards-grid-primed');
      container.classList.remove('cards-grid-priming');
      const existingCols = [...container.querySelectorAll(':scope > .warehouse-focus-col')];
      if (existingCols.length === warehouseFocusColumnCount(cardColumns) && existingCols.length) {
        // 列结构一致：只补发新增的直属卡片，已有卡片原地不动。
        appendWarehouseFocusCards(container, [...container.querySelectorAll(':scope > .card')]);
      } else {
        distributeWarehouseFocusColumns(container, cardColumns);
      }
      if (typeof repositionWarehouseScrollSentinel === 'function') {
        repositionWarehouseScrollSentinel(container);
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

    /* 一键回顶：监听卡片库当前滚动容器（非聚焦=网格自身，聚焦=main-content），
     * 滚动超过一屏后显示按钮，点击平滑回顶。 */
    (function initBackToTop() {
      const btn = document.getElementById('backToTopBtn');
      if (!btn) return;
      const scrollRoot = () => {
        if (document.body?.classList?.contains('warehouse-content-focus')) {
          return document.getElementById('mainContentArea');
        }
        return document.getElementById('cardsContainer') || document.getElementById('mainContentArea');
      };
      const update = () => {
        const root = scrollRoot();
        const show = !!root && root.scrollTop > Math.max(300, (root.clientHeight || 600) * 0.6);
        btn.classList.toggle('visible', show);
        btn.hidden = false;
      };
      ['cardsContainer', 'mainContentArea'].forEach((id) => {
        document.getElementById(id)?.addEventListener('scroll', update, { passive: true });
      });
      window.addEventListener('resize', update);
      btn.addEventListener('click', () => {
        const root = scrollRoot();
        if (root) root.scrollTo({ top: 0, behavior: 'smooth' });
      });
      update();
    })();

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
      landing: 'pageLanding',
      warehouse: 'pageWarehouse',
      devlab: 'pageDevLab',
      community: 'pageCommunity',
      creations: 'pageCreations',
      canvas: 'pageCanvas',
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
