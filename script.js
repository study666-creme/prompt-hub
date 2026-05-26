    // ---------- 数据库 ----------
    const DB_NAME = 'PromptRepoDB', DB_VERSION = 1;
    let db = null;
    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e.target.error);
      });
    }
    async function loadCardsFromDB() {
      if (!db) await openDB();
      return new Promise(resolve => {
        const tx = db.transaction(['cards'], 'readonly');
        const req = tx.objectStore('cards').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }
    async function saveCardsToDB(cardsArray) {
      if (!db) await openDB();
      const tx = db.transaction(['cards'], 'readwrite');
      const store = tx.objectStore('cards');
      store.clear();
      cardsArray.forEach(c => store.put(c));
      return new Promise(resolve => { tx.oncomplete = resolve; });
    }

    let cards = [], customGroups = [], globalFields = [], settings = { engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false };
    let currentGroup = 'all', selectedCardId = null, isNewCardMode = true, imageData = null;
    let currentTags = [], tempCustomFields = [];
    let batchMode = false, selectedCardIds = new Set();
    let fileHandle = null, masonryInstance = null;
    let page = 1, allFilteredCards = [];
    const PER_PAGE = 24;
    let sortMode = 'default';
    let floatingPromptActive = false;
    let currentCardCustomFields = {};
    let globalViewActive = false;
    let activeFilters = new Set();
    try {
      const savedFilters = JSON.parse(localStorage.getItem('promptrepo_filters') || '[]');
      if (Array.isArray(savedFilters)) activeFilters = new Set(savedFilters);
    } catch (e) { activeFilters = new Set(); }
    let cardColumns = Number(localStorage.getItem('promptrepo_card_columns') || 4);
    cardColumns = Math.min(5, Math.max(1, cardColumns || 4));

    document.documentElement.style.setProperty('--card-columns', cardColumns);

    function setCardColumns(cols) {
      cardColumns = Math.min(5, Math.max(1, cols));
      document.documentElement.style.setProperty('--card-columns', cardColumns);
      localStorage.setItem('promptrepo_card_columns', String(cardColumns));
      const container = document.getElementById('cardsContainer');
      if (container) container.scrollTop = 0;
      if (typeof renderCards === 'function') renderCards(true);
    }
    function toggleColumnUp() {
      if (cardColumns < 5) setCardColumns(cardColumns + 1);
    }
    function toggleColumnDown() {
      if (cardColumns > 1) setCardColumns(cardColumns - 1);
    }
    window.setCardColumns = setCardColumns;
    window.toggleColumnUp = toggleColumnUp;
    window.toggleColumnDown = toggleColumnDown;

    let imageZoom = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, img: null };

    function applyImageZoom() {
      const img = imageZoom.img;
      if (!img) return;
      img.style.transform = `scale(${imageZoom.scale}) translate(${imageZoom.tx}px, ${imageZoom.ty}px)`;
      img.style.cursor = imageZoom.dragging ? 'grabbing' : 'grab';
    }

    function resetImageZoom(img) {
      imageZoom.scale = 1;
      imageZoom.tx = 0;
      imageZoom.ty = 0;
      imageZoom.dragging = false;
      imageZoom.img = img || null;
      applyImageZoom();
    }

    function attachImageZoom(img) {
      if (!img) return;
      img.style.transformOrigin = 'center center';
      img.onwheel = (e) => {
        e.preventDefault();
        e.stopPropagation();
        imageZoom.scale = Math.min(Math.max(0.5, imageZoom.scale + (e.deltaY > 0 ? -0.1 : 0.1)), 4);
        applyImageZoom();
      };
      img.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        imageZoom.dragging = true;
        imageZoom.startX = e.clientX - imageZoom.tx;
        imageZoom.startY = e.clientY - imageZoom.ty;
        applyImageZoom();
      };
      img.onclick = (e) => e.stopPropagation();
      img.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetImageZoom(img);
      };
    }

    function closeAppreciateViewer(e) {
      const viewer = document.getElementById('appreciateViewer');
      if (!viewer?.classList.contains('active')) return;
      if (e) {
        const t = e.target;
        if (t !== viewer && !t?.classList?.contains('appreciate-viewer-close')) return;
      }
      viewer.classList.remove('active');
      document.body.classList.remove('appreciate-viewing');
      const img = document.getElementById('appreciateViewerImg');
      if (img) {
        img.src = '';
        img.onwheel = null;
        img.onmousedown = null;
        img.ondblclick = null;
      }
      imageZoom.img = null;
    }

    function openAppreciateViewer(cardId) {
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const viewer = document.getElementById('appreciateViewer');
      const img = document.getElementById('appreciateViewerImg');
      const caption = document.getElementById('appreciateViewerCaption');
      const hint = document.querySelector('.appreciate-viewer-hint');
      if (!viewer || !img) return;
      if (card.image) {
        img.style.display = 'block';
        if (hint) hint.style.display = 'block';
        const onReady = () => {
          resetImageZoom(img);
          attachImageZoom(img);
        };
        if (img.src === card.image && img.complete) onReady();
        else {
          img.onload = () => { img.onload = null; onReady(); };
          img.src = card.image;
        }
      } else {
        img.src = '';
        img.style.display = 'none';
        if (hint) hint.style.display = 'none';
        imageZoom.img = null;
      }
      const title = (card.title || '').trim();
      const prompt = (card.prompt || '').trim();
      if (caption) {
        caption.textContent = title || (prompt ? prompt.slice(0, 120) + (prompt.length > 120 ? '…' : '') : '');
        caption.style.display = caption.textContent ? 'block' : 'none';
      }
      viewer.classList.add('active');
      document.body.classList.add('appreciate-viewing');
    }
    window.closeAppreciateViewer = closeAppreciateViewer;

    function forceExitGlobalView(skipRender = false) {
      const wasActive = globalViewActive || document.body.classList.contains('global-view');
      if (!wasActive) return;
      closeAppreciateViewer();
      globalViewActive = false;
      document.body.classList.remove('global-view', 'global-view-entering', 'global-view-exiting', 'appreciate-viewing');
      document.getElementById('globalViewBtn')?.classList.remove('active');
      if (!skipRender && typeof renderCards === 'function') renderCards(true);
    }

    function exitGlobalView() {
      if (!globalViewActive) return;
      closeAppreciateViewer();
      globalViewActive = false;
      document.body.classList.remove('global-view', 'appreciate-viewing');
      document.getElementById('globalViewBtn')?.classList.remove('active');
      document.body.classList.add('global-view-exiting');
      setTimeout(() => {
        document.body.classList.remove('global-view-exiting');
        document.querySelectorAll('.card').forEach(el => { el.draggable = true; });
        scheduleLayoutMasonry();
      }, 420);
    }

    function toggleGlobalView() {
      if (globalViewActive) {
        exitGlobalView();
        return;
      }
      if (typeof switchAppPage === 'function') switchAppPage('warehouse');
      closeEditPanel();
      if (batchMode) cancelBatch();
      globalViewActive = true;
      document.getElementById('globalViewBtn')?.classList.add('active');
      document.body.classList.add('global-view-entering');
      setTimeout(() => {
        document.body.classList.add('global-view');
        document.body.classList.remove('global-view-entering');
        document.querySelectorAll('.card').forEach(el => { el.draggable = false; });
        requestAnimationFrame(() => scheduleLayoutMasonry());
      }, 620);
    }
    window.exitGlobalView = exitGlobalView;
    window.toggleGlobalView = toggleGlobalView;
    window.layoutMasonryGrid = layoutMasonryGrid;
    window.scheduleLayoutMasonry = scheduleLayoutMasonry;

    function generateId() { return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function showCustomModal(title, content, onConfirm, onCancel, isPrompt = false, suggestions = []) {
      const overlay = document.getElementById('customModalOverlay');
      const modal = document.getElementById('customModal');
      let inputHtml = '';
      if (isPrompt) inputHtml = '<input type="text" id="customModalInput" placeholder="">';
      let suggestionsHtml = '';
      if (suggestions.length) {
        suggestionsHtml = '<div class="suggestions">' + suggestions.map(s => `<span onclick="document.getElementById('customModalInput').value='${escapeJsString(s)}'; document.getElementById('customModalConfirm').focus();">${escapeHtml(s)}</span>`).join('') + '</div>';
      }
      modal.innerHTML = `<h3>${title}</h3><p>${content}</p>${inputHtml}${suggestionsHtml}<div class="modal-actions"><button class="btn btn-primary" id="customModalConfirm">确定</button><button class="btn btn-secondary" id="customModalCancel">取消</button></div>`;
      overlay.classList.add('active');
      document.getElementById('customModalCancel').onclick = () => { closeCustomModal(); if(onCancel) onCancel(); };
      document.getElementById('customModalConfirm').onclick = () => { const value = isPrompt ? document.getElementById('customModalInput')?.value : true; closeCustomModal(); if(onConfirm) onConfirm(value); };
      if (isPrompt) document.getElementById('customModalInput').focus();
    }
    function closeCustomModal() { document.getElementById('customModalOverlay').classList.remove('active'); }
    function customConfirm(msg, onConfirm, onCancel) { showCustomModal('确认', msg, onConfirm, onCancel); }
    function customPrompt(msg, defaultText, onConfirm, onCancel, suggestions = []) {
      showCustomModal('输入', msg, (val) => onConfirm(val), onCancel, true, suggestions);
      if (defaultText) setTimeout(() => { const inp = document.getElementById('customModalInput'); if(inp) inp.value = defaultText; }, 50);
    }

    function saveActiveFilters() {
      localStorage.setItem('promptrepo_filters', JSON.stringify([...activeFilters]));
    }

    function getFilterOptions() {
      const base = [
        { value: 'image', label: '有图片' },
        { value: 'text', label: '纯文字' }
      ];
      const tags = [...new Set(cards.flatMap(c => c.tags || []))].map(t => ({ value: 'tag:' + t, label: '#' + t }));
      return base.concat(tags);
    }

    function cardMatchesFilters(card) {
      if (activeFilters.size === 0) return true;
      return [...activeFilters].some(f => {
        if (f === 'image') return !!card.image;
        if (f === 'text') return !card.image;
        if (f.startsWith('tag:')) return (card.tags || []).includes(f.slice(4));
        return false;
      });
    }

    function updateTagFilter() {
      buildFilterMenu();
      syncFilterBtnState();
    }

    function syncFilterBtnState() {
      document.getElementById('filterBtn')?.classList.toggle('active', activeFilters.size > 0);
    }

    function buildFilterMenu() {
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      const valid = new Set(getFilterOptions().map(o => o.value));
      activeFilters.forEach(f => { if (!valid.has(f)) activeFilters.delete(f); });
      dd.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'filter-dropdown-head';
      head.innerHTML = '<span>筛选（可多选）</span><button type="button" class="filter-clear-btn">清除</button>';
      head.querySelector('.filter-clear-btn').onclick = (e) => {
        e.stopPropagation();
        activeFilters.clear();
        saveActiveFilters();
        syncFilterBtnState();
        renderCards(true);
        buildFilterMenu();
      };
      dd.appendChild(head);
      getFilterOptions().forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-option' + (activeFilters.has(opt.value) ? ' active' : '');
        btn.innerHTML = '<span class="filter-check"></span><span class="filter-label">' + escapeHtml(opt.label) + '</span>';
        btn.onclick = (e) => {
          e.stopPropagation();
          if (activeFilters.has(opt.value)) activeFilters.delete(opt.value);
          else activeFilters.add(opt.value);
          saveActiveFilters();
          syncFilterBtnState();
          renderCards(true);
          btn.classList.toggle('active', activeFilters.has(opt.value));
        };
        dd.appendChild(btn);
      });
      if (!getFilterOptions().length) {
        const empty = document.createElement('div');
        empty.className = 'filter-empty';
        empty.textContent = '暂无筛选项';
        dd.appendChild(empty);
      }
    }

    function toggleFilterMenu(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      const willOpen = !dd.classList.contains('open');
      buildFilterMenu();
      if (willOpen) dd.classList.add('open');
      else dd.classList.remove('open');
    }
    window.toggleFilterMenu = toggleFilterMenu;

    function initFilterMenu() {
      const btn = document.getElementById('filterBtn');
      const dd = document.getElementById('filterDropdown');
      if (!btn || !dd) return;
      btn.addEventListener('click', (e) => toggleFilterMenu(e));
      dd.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-menu-wrap')) dd.classList.remove('open');
      });
    }

    function searchByTag(tag) {
      activeFilters.add('tag:' + tag);
      saveActiveFilters();
      syncFilterBtnState();
      document.getElementById('searchInput').value = '';
      renderCards(true);
      showToast('已加入筛选 #' + tag);
    }

    function getMasonryGap() {
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-gap')) || 16;
    }

    function getCardsInnerWidth() {
      const container = document.getElementById('cardsContainer');
      if (!container) return 0;
      const style = getComputedStyle(container);
      return container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }

    let layoutMasonryTimer = null;

    function scheduleLayoutMasonry() {
      clearTimeout(layoutMasonryTimer);
      layoutMasonryTimer = setTimeout(() => layoutMasonryGrid(), 100);
    }

    function resetCardLayoutStyles(container) {
      container.querySelectorAll('.card').forEach(card => {
        card.style.left = '';
        card.style.top = '';
        card.style.right = '';
        card.style.bottom = '';
        card.style.position = '';
        card.style.transform = '';
      });
    }

    function layoutMasonryGrid() {
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (!container || viewMode === 'list') return;
      if (!container.querySelector('.card')) {
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
        return;
      }
      const savedScroll = container.scrollTop;
      const gap = getMasonryGap();
      const innerW = getCardsInnerWidth();
      if (innerW < 80) {
        scheduleLayoutMasonry();
        return;
      }
      const colWidth = Math.max(120, Math.floor((innerW - gap * (cardColumns - 1)) / cardColumns));
      let sizer = container.querySelector('.grid-sizer');
      if (!sizer) {
        sizer = document.createElement('div');
        sizer.className = 'grid-sizer';
        container.insertBefore(sizer, container.firstChild);
      }
      sizer.style.width = colWidth + 'px';
      container.querySelectorAll('.card').forEach(card => { card.style.width = colWidth + 'px'; });
      const msnryOpts = {
        itemSelector: '.card',
        columnWidth: '.grid-sizer',
        gutter: gap,
        percentPosition: false,
        transitionDuration: '0.42s'
      };
      if (masonryInstance) {
        masonryInstance.option(msnryOpts);
        masonryInstance.reloadItems();
        masonryInstance.layout();
      } else {
        resetCardLayoutStyles(container);
        masonryInstance = new Masonry(container, msnryOpts);
        masonryInstance.layout();
      }
      container.scrollTop = savedScroll;
      requestAnimationFrame(() => {
        if (masonryInstance) masonryInstance.layout();
        container.scrollTop = savedScroll;
      });
    }

    function highlightSelectedCard(id) {
      document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
      if (id) document.querySelector(`.card[data-id="${id}"]`)?.classList.add('selected');
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

    function applyFloatingState() {
      const floating = document.getElementById('floatingPrompt');
      const fpToggleBtn = document.getElementById('fpToggleBtn');
      const fpIconFloat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
      const fpIconPin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3.76z"/></svg>';
      if (floatingPromptActive) {
        floating.classList.remove('hidden');
        requestAnimationFrame(() => applyFloatingPromptPosition());
        fpToggleBtn.innerHTML = fpIconPin;
        fpToggleBtn.classList.add('is-active');
        fpToggleBtn.title = '固定到面板';
        document.getElementById('floatingPromptText').value = document.getElementById('cardPrompt').value;
      } else {
        floating.classList.add('hidden');
        fpToggleBtn.innerHTML = fpIconFloat;
        fpToggleBtn.classList.remove('is-active');
        fpToggleBtn.title = '浮动提示词框';
        document.getElementById('cardPrompt').value = document.getElementById('floatingPromptText').value;
      }
    }

    function toggleFloatingPrompt() {
      floatingPromptActive = !floatingPromptActive;
      applyFloatingState();
      settings.floatingPrompt = floatingPromptActive;
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
    }

    function copyPromptFromFloating() {
      const text = document.getElementById('floatingPromptText').value;
      if (text) { navigator.clipboard.writeText(text); showToast('提示词已复制'); }
    }

    function copyPromptFromPanel() {
      const text = document.getElementById('cardPrompt').value;
      if (text) { navigator.clipboard.writeText(text); showToast('提示词已复制'); }
    }

    function clampFloatingPromptPosition(left, top, fp) {
      const el = fp || document.getElementById('floatingPrompt');
      const w = el.offsetWidth || 340;
      const h = el.offsetHeight || 180;
      const maxL = Math.max(8, window.innerWidth - w - 8);
      const maxT = Math.max(8, window.innerHeight - h - 8);
      return {
        left: Math.min(Math.max(8, left), maxL),
        top: Math.min(Math.max(8, top), maxT)
      };
    }

    function getDefaultFloatingPromptPosition() {
      const fp = document.getElementById('floatingPrompt');
      const fpW = fp.offsetWidth || 340;
      const fpH = fp.offsetHeight || 180;
      const panel = document.getElementById('editPanel');
      if (panel && !panel.classList.contains('hidden')) {
        const r = panel.getBoundingClientRect();
        return clampFloatingPromptPosition(r.left - fpW - 20, r.top + 48, fp);
      }
      return clampFloatingPromptPosition(window.innerWidth - fpW - 400, window.innerHeight - fpH - 140, fp);
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

    function applyFloatingPromptPosition() {
      const pos = settings.floatingPromptPos;
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        setFloatingPromptPosition(pos.left, pos.top);
      } else {
        const def = getDefaultFloatingPromptPosition();
        setFloatingPromptPosition(def.left, def.top);
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

    (function initFloatingPromptDrag() {
      const fp = document.getElementById('floatingPrompt');
      const header = document.getElementById('floatingPromptHeader');
      const DRAG_THRESHOLD = 6;
      let offsetX = 0, offsetY = 0, startX = 0, startY = 0, dragging = false;

      header.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
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
    })();

    const APP_PAGE_IDS = { warehouse: 'pageWarehouse', community: 'pageCommunity', creations: 'pageCreations', imagegen: 'pageImageGen' };

    function switchAppPage(app) {
      if (!APP_PAGE_IDS[app]) return;
      if (app !== 'warehouse') {
        forceExitGlobalView(true);
        closeEditPanel();
        if (typeof closeTagSheet === 'function') closeTagSheet();
        const fp = document.getElementById('floatingPrompt');
        if (fp) fp.classList.add('hidden');
      }
      document.querySelectorAll('.app-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.app === app);
      });
      Object.entries(APP_PAGE_IDS).forEach(([key, id]) => {
        document.getElementById(id)?.classList.toggle('active', key === app);
      });
      localStorage.setItem('promptrepo_app_page', app);
      if (app === 'warehouse') {
        applyFloatingState();
        requestAnimationFrame(() => { if (typeof layoutMasonryGrid === 'function') layoutMasonryGrid(); });
      }
    }
    window.switchAppPage = switchAppPage;

    function initAppNav() {
      document.querySelectorAll('.app-nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchAppPage(btn.dataset.app));
      });
      const saved = localStorage.getItem('promptrepo_app_page');
      if (saved && APP_PAGE_IDS[saved]) switchAppPage(saved);
    }

    function initAppNavCollapse() {
      const btn = document.getElementById('appNavCollapseBtn');
      if (!btn) return;
      const apply = (collapsed) => {
        document.body.classList.toggle('app-nav-collapsed', collapsed);
        btn.title = collapsed ? '展开侧栏' : '收起侧栏（仅图标）';
        btn.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
      };
      apply(localStorage.getItem('promptrepo_nav_collapsed') === '1');
      btn.addEventListener('click', () => {
        const collapsed = !document.body.classList.contains('app-nav-collapsed');
        apply(collapsed);
        localStorage.setItem('promptrepo_nav_collapsed', collapsed ? '1' : '0');
        requestAnimationFrame(() => { if (typeof layoutMasonryGrid === 'function') layoutMasonryGrid(); });
      });
    }

    const RIPPLE_BG_OPTS = {
      enableRainbow: false,
      gridColor: '#9ca3af',
      rippleIntensity: 0.055,
      gridSize: 10,
      gridThickness: 14,
      fadeDistance: 1.5,
      vignetteStrength: 1.9,
      glowIntensity: 0.18,
      opacity: 0.42,
      gridRotation: 6,
      mouseInteraction: true,
      mouseInteractionRadius: 1.35
    };

    function initCanvasRippleFallback(container) {
      container.classList.add('ripple-fallback-active');
      const canvas = document.createElement('canvas');
      canvas.className = 'ripple-fallback-canvas';
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      let w = 0;
      let h = 0;
      let dpr = 1;
      const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
      const resize = () => {
        dpr = Math.min(window.devicePixelRatio, 2);
        w = container.clientWidth || window.innerWidth;
        h = container.clientHeight || window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const onMove = (e) => {
        const rect = container.getBoundingClientRect();
        if (!rect.width) return;
        mouse.tx = (e.clientX - rect.left) / rect.width;
        mouse.ty = (e.clientY - rect.top) / rect.height;
      };
      window.addEventListener('mousemove', onMove, { passive: true });
      window.addEventListener('resize', resize);
      resize();
      const gridStep = 44;
      const t0 = performance.now();
      let rafId = 0;
      const draw = (now) => {
        const t = (now - t0) * 0.001;
        mouse.x += (mouse.tx - mouse.x) * 0.12;
        mouse.y += (mouse.ty - mouse.y) * 0.12;
        ctx.fillStyle = '#030508';
        ctx.fillRect(0, 0, w, h);
        const cx = w * 0.5;
        const cy = h * 0.42;
        const mx = mouse.x * w;
        const my = mouse.y * h;
        const warp = (x, y) => {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const wave = Math.sin(dist * 0.011 - t * 2.4) * 10;
          const mdx = x - mx;
          const mdy = y - my;
          const md = Math.hypot(mdx, mdy) || 1;
          const mouseWave = Math.sin(md * 0.022 - t * 4.2) * 32 * Math.exp(-(md * md) / 200000);
          return {
            x: x + (dx / dist) * wave * 0.14 + (mdx / md) * mouseWave * 0.025,
            y: y + (dy / dist) * wave * 0.14 + (mdy / md) * mouseWave * 0.025
          };
        };
        for (let x = 0; x <= w + gridStep; x += gridStep) {
          ctx.beginPath();
          for (let y = 0; y <= h; y += 6) {
            const p = warp(x, y);
            if (y === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = `rgba(156, 163, 175, ${0.1 + 0.06 * Math.sin(x * 0.018 + t)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        for (let y = 0; y <= h + gridStep; y += gridStep) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 6) {
            const p = warp(x, y);
            if (x === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = `rgba(156, 163, 175, ${0.08 + 0.05 * Math.cos(y * 0.018 + t)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        const grd = ctx.createRadialGradient(mx, my, 0, mx, my, 140);
        grd.addColorStop(0, 'rgba(156, 163, 175, 0.1)');
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
        rafId = requestAnimationFrame(draw);
      };
      rafId = requestAnimationFrame(draw);
      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('resize', resize);
      };
    }

    async function initBackgroundEffect() {
      const bg = document.getElementById('rippleGridBg');
      if (!bg || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      try {
        const mod = await import('./ripple-grid.js');
        mod.initRippleGrid(bg, RIPPLE_BG_OPTS);
      } catch {
        initCanvasRippleFallback(bg);
      }
    }

    (async function init() {
      await openDB();
      const savedCards = await loadCardsFromDB();
      cards = savedCards.length ? savedCards : JSON.parse(localStorage.getItem('promptrepo_cards') || '[]');
      customGroups = JSON.parse(localStorage.getItem('promptrepo_groups') || '[]');
      globalFields = JSON.parse(localStorage.getItem('promptrepo_fields') || '[]');
      const savedSettings = JSON.parse(localStorage.getItem('promptrepo_settings') || '{}');
      settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false }, savedSettings);
      floatingPromptActive = settings.floatingPrompt === true;
      if (cards.length && !savedCards.length) await saveCardsToDB(cards);
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      updateTagFilter();
      buildFilterMenu();
      syncFilterBtnState();
      initFilterMenu();
      initAppNav();
      initAppNavCollapse();
      initBackgroundEffect();
      renderGroups(); renderCards(true); createNewCard();
      applyFloatingState();
      const mainArea = document.getElementById('mainContentArea');
      if (mainArea && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => scheduleLayoutMasonry()).observe(mainArea);
      }
    })();

    async function saveAllData() {
      await saveCardsToDB(cards);
      settings.floatingPrompt = floatingPromptActive;
      localStorage.setItem('promptrepo_groups', JSON.stringify(customGroups));
      localStorage.setItem('promptrepo_fields', JSON.stringify(globalFields));
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
      if (fileHandle) { try { const w = await fileHandle.createWritable(); await w.write(JSON.stringify({cards,customGroups,globalFields,settings})); await w.close(); } catch(e) {} }
    }

    function renderGroups() {
      document.getElementById('allCount').textContent = cards.length;
      document.getElementById('uncategorizedCount').textContent = cards.filter(c => !c.group).length;
      document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
      const activeEl = document.querySelector(`.group-item[data-group="${currentGroup}"]`);
      if (activeEl) activeEl.classList.add('active');
      const customContainer = document.getElementById('customGroupList');
      customContainer.innerHTML = '';
      customGroups.forEach(group => {
        const cnt = cards.filter(c => c.group === group).length;
        const item = document.createElement('div');
        item.className = `group-item custom-group ${currentGroup === group ? 'active' : ''}`;
        item.dataset.group = group;
        item.innerHTML = `${group} <span class="count">${cnt}</span>`;
        item.addEventListener('click', () => switchGroup(group));
        item.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, [{label:'删除分组', action:()=>deleteGroup(group)}]); });
        customContainer.appendChild(item);
      });
      document.querySelectorAll('#defaultGroupList .group-item').forEach(item => {
        item.onclick = () => switchGroup(item.dataset.group);
      });
      enableGroupDrop();
    }

    function switchGroup(g) {
      currentGroup = g;
      document.getElementById('currentGroupTitle').textContent = g === 'all' ? '全部提示词' : (g === 'uncategorized' ? '未分类' : g);
      document.getElementById('searchInput').value = '';
      renderGroups(); renderCards(true);
    }

    function inlineAddGroup(event) {
      event.stopPropagation();
      const container = document.getElementById('customGroupList');
      const existing = container.querySelector('.inline-edit-group');
      if (existing) {
        existing.querySelector('.group-name-input')?.focus();
        return;
      }
      const div = document.createElement('div');
      div.className = 'inline-edit-group';
      div.innerHTML = '<input type="text" class="group-name-input" placeholder="输入分组名" maxlength="40">';
      const input = div.querySelector('.group-name-input');
      let done = false;
      const remove = () => div.remove();
      const commit = () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        remove();
        if (!name) return;
        if (customGroups.includes(name)) { showToast('分组已存在'); return; }
        customGroups.push(name);
        saveAllData();
        renderGroups();
        showToast('分组已创建');
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); done = true; remove(); }
      });
      input.addEventListener('blur', commit);
      container.prepend(div);
      input.focus();
    }

    function deleteGroup(g) {
      customConfirm(`确定删除分组"${g}"？卡片将变为未分类。`, () => {
        customGroups = customGroups.filter(x => x !== g);
        cards.forEach(c => { if (c.group === g) c.group = null; });
        if (currentGroup === g) currentGroup = 'all';
        saveAllData(); renderGroups(); renderCards(true);
      });
    }

    // 修复卡片渲染：无标题时不显示标题行，无图片时不生成图片区域
    function formatCardTime(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      if (diff < 3600000) return '刚刚';
      if (diff < 86400000) return '今天';
      if (diff < 172800000) return '昨天';
      if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function looksLikeCodeSnippet(text) {
      return /^\s*(--|\/\*|CREATE|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/im.test(text || '');
    }

    function getCardDisplayTitle(card) {
      const title = (card.title || '').trim();
      if (title) return title;
      const prompt = (card.prompt || '').trim();
      if (!prompt) return '未命名';
      if (looksLikeCodeSnippet(prompt)) return '未命名提示词';
      if (prompt.length <= 36) return prompt;
      return prompt.slice(0, 36) + '…';
    }

    function getCardDisplayDesc(card) {
      const prompt = (card.prompt || '').trim();
      if (!prompt) return '暂无提示词内容';
      if (looksLikeCodeSnippet(prompt)) return '点击编辑查看完整内容';
      return prompt;
    }

    function buildCardTagsHtml(tags) {
      const list = tags || [];
      const max = 3;
      const shown = list.slice(0, max);
      const extra = list.length - max;
      let html = shown.map(t => `<span class="tag" onclick="event.stopPropagation();searchByTag('${escapeJsString(t)}')">${escapeHtml(t)}</span>`).join('');
      if (extra > 0) html += `<span class="tag tag-more">+${extra}</span>`;
      return html;
    }

    function renderCards(reset = false) {
      if (reset) {
        page = 1; allFilteredCards = [];
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
        document.getElementById('cardsContainer').innerHTML = '<div class="grid-sizer"></div>';
      }
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      container.className = 'cards-container';
      if (viewMode === 'list') container.classList.add('list-view');
      if (batchMode) container.classList.add('batch-mode');
      const search = document.getElementById('searchInput').value.toLowerCase();
      sortMode = document.getElementById('sortSelect').value;
      if (reset || allFilteredCards.length === 0) {
        let filtered = [...cards];
        if (currentGroup === 'uncategorized') filtered = filtered.filter(c => !c.group);
        else if (currentGroup !== 'all') filtered = filtered.filter(c => c.group === currentGroup);
        if (search) filtered = filtered.filter(c => (c.title?.toLowerCase().includes(search)) || (c.prompt || '').toLowerCase().includes(search) || (c.tags?.some(t => t.toLowerCase().includes(search))));
        if (activeFilters.size > 0) filtered = filtered.filter(cardMatchesFilters);
        if (sortMode === 'updated-desc') filtered.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        else if (sortMode === 'updated-asc') filtered.sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
        allFilteredCards = filtered;
      }
      const start = (page - 1) * PER_PAGE;
      const pageCards = allFilteredCards.slice(start, start + PER_PAGE);
      if (page === 1 && pageCards.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:60px;">📦 暂无卡片</div>';
        return;
      }
      const fragment = document.createDocumentFragment();
      const isAppend = !reset && page > 1;
      pageCards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = `card card-enter ${card.id === selectedCardId ? 'selected' : ''}`;
        div.style.animationDelay = `${Math.min((isAppend ? idx : idx) * 0.045, 0.36)}s`;
        div.dataset.id = card.id;
        div.draggable = !globalViewActive;
        const checked = selectedCardIds.has(card.id);
        const mediaInner = card.image
          ? `<img class="card-img" src="${card.image}" loading="lazy" draggable="false" alt="" onload="if(typeof scheduleLayoutMasonry==='function') scheduleLayoutMasonry()">`
          : '<div class="card-media-placeholder" aria-hidden="true"></div>';
        const timeLabel = formatCardTime(card.updatedAt || card.createdAt);
        const tagsHtml = buildCardTagsHtml(card.tags);
        div.innerHTML = `
          <div class="card-checkbox ${checked ? 'checked' : ''}" onclick="event.stopPropagation(); toggleSelectCard('${card.id}', this)"></div>
          <div class="card-media">${mediaInner}</div>
          <div class="card-body">
            <div class="card-head">
              <div class="card-title">${escapeHtml(getCardDisplayTitle(card))}</div>
              ${timeLabel ? `<time class="card-time">${escapeHtml(timeLabel)}</time>` : ''}
            </div>
            <div class="card-desc">${escapeHtml(getCardDisplayDesc(card))}</div>
            ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
          </div>`;
        div.addEventListener('click', (e) => {
          if (globalViewActive) {
            e.preventDefault();
            openAppreciateViewer(card.id);
            return;
          }
          if (e.target.closest('.card-checkbox')) return;
          if (batchMode) { const cb = div.querySelector('.card-checkbox'); toggleSelectCard(card.id, cb); }
          else editCard(card.id);
        });
        const img = div.querySelector('.card-img');
        if (img && card.image) {
          img.addEventListener('click', e => {
            e.stopPropagation();
            if (globalViewActive) {
              openAppreciateViewer(card.id);
              return;
            }
            if (batchMode) { const cb = div.querySelector('.card-checkbox'); toggleSelectCard(card.id, cb); }
            else if (settings.imageClickZoom) openLightbox(card.image);
            else editCard(card.id);
          });
        }
        div.addEventListener('dragstart', e => {
          if (globalViewActive) { e.preventDefault(); return; }
          const cardIds = getDragCardIds(div);
          e.dataTransfer.setData('text/plain', JSON.stringify(cardIds));
          e.dataTransfer.effectAllowed = 'move';
          startCardDragVisual(div, e, cardIds);
        });
        div.addEventListener('dragend', () => endCardDragVisual());
        div.addEventListener('contextmenu', e => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [
            { label: '删除', action: () => deleteCardPermanently(card.id) }
          ]);
        });
        fragment.appendChild(div);
      });
      container.appendChild(fragment);
      if (viewMode !== 'list') {
        scheduleLayoutMasonry();
      } else if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
      }
      updateBatchCountLabel();
    }

    document.querySelector('.cards-container')?.addEventListener('scroll', function() {
      if (this.scrollTop + this.clientHeight >= this.scrollHeight - 150 && (page * PER_PAGE) < allFilteredCards.length) { page++; renderCards(); }
    });

    function enableGroupDrop() {
      document.querySelectorAll('.group-item').forEach(item => {
        item.addEventListener('dragenter', e => {
          if (!cardDragVisual) return;
          e.preventDefault();
          item.classList.add('group-drag-over');
        });
        item.addEventListener('dragleave', e => {
          if (!item.contains(e.relatedTarget)) item.classList.remove('group-drag-over');
        });
        item.addEventListener('dragover', e => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('drop', e => {
          e.preventDefault();
          item.classList.remove('group-drag-over');
          const raw = e.dataTransfer.getData('text/plain');
          let cardIds = []; try { cardIds = JSON.parse(raw); } catch (err) { cardIds = [raw]; }
          if (!Array.isArray(cardIds)) cardIds = [cardIds];
          const targetGroup = item.dataset.group;
          cardIds.forEach(id => {
            const c = cards.find(x => x.id === id);
            if (c) { c.group = (targetGroup === 'all' || targetGroup === 'uncategorized') ? null : targetGroup; }
          });
          saveAllData(); renderGroups(); renderCards(true);
          if (batchMode) { selectedCardIds.clear(); cancelBatch(); }
        });
      });
    }

    function updateBatchCountLabel() { document.getElementById('batchCountLabel').textContent = selectedCardIds.size ? `已选 ${selectedCardIds.size} 张` : ''; }
    function toggleBatchMode() { batchMode = !batchMode; selectedCardIds.clear(); const btn = document.getElementById('batchToggleBtn'); btn.classList.toggle('active', batchMode); document.getElementById('batchBar').classList.toggle('active', batchMode); document.getElementById('normalBar').style.display = batchMode ? 'none' : 'flex'; renderCards(true); }
    function cancelBatch() { batchMode = false; selectedCardIds.clear(); document.getElementById('batchToggleBtn').classList.remove('active'); document.getElementById('batchBar').classList.remove('active'); document.getElementById('normalBar').style.display = 'flex'; renderCards(true); }
    function toggleSelectCard(id, el) { if (selectedCardIds.has(id)) { selectedCardIds.delete(id); if(el) el.classList.remove('checked'); } else { selectedCardIds.add(id); if(el) el.classList.add('checked'); } updateBatchCountLabel(); }
    function batchMoveGroup() { if(!selectedCardIds.size) return; const groups = ['all','uncategorized',...customGroups]; customPrompt(`输入目标分组 (${groups.join('/')})`, '', (target) => { if(!target||!groups.includes(target)) return; const gv = (target==='all'||target==='uncategorized')?null:target; selectedCardIds.forEach(id=>{const c=cards.find(x=>x.id===id); if(c)c.group=gv;}); saveAllData(); cancelBatch(); renderGroups(); renderCards(true); }, null, groups); }
    function batchAddTag() { if(!selectedCardIds.size) return; const allTags = [...new Set(cards.flatMap(c=>c.tags||[]))]; customPrompt('输入标签名（不含#）', '', (tag) => { if(!tag) return; selectedCardIds.forEach(id=>{const c=cards.find(x=>x.id===id); if(c){ if(!c.tags) c.tags=[]; if(!c.tags.includes(tag)) c.tags.push(tag); }}); saveAllData(); cancelBatch(); renderCards(true); }, null, allTags); }
    function batchDelete() {
      if(!selectedCardIds.size) return;
      customConfirm(`确定永久删除 ${selectedCardIds.size} 张卡片？此操作不可恢复。`, () => {
        selectedCardIds.forEach(id => deleteCardPermanently(id, false));
        saveAllData();
        cancelBatch();
        renderGroups(); renderCards(true);
        showToast('已删除所选卡片');
      });
    }
    function deleteCardPermanently(id, confirm = true) {
      const doDelete = () => {
        cards = cards.filter(c => c.id !== id);
        saveAllData();
        renderGroups(); renderCards(true);
        if (selectedCardId === id) { selectedCardId = null; createNewCard(); }
      };
      if (confirm) {
        customConfirm('确定永久删除该卡片？此操作不可恢复。', doDelete);
      } else {
        doDelete();
      }
    }

    function editCard(id) {
      const card = cards.find(c => c.id === id); if (!card) return;
      selectedCardId = id; isNewCardMode = false;
      highlightSelectedCard(id);
      document.getElementById('panelTitle').textContent = '编辑卡片';
      document.getElementById('cardTitle').value = card.title || '';
      document.getElementById('cardPrompt').value = card.prompt || '';
      document.getElementById('floatingPromptText').value = card.prompt || '';
      imageData = card.image || null; currentTags = [...(card.tags || [])]; tempCustomFields = [];
      currentCardCustomFields = card.customFields ? { ...card.customFields } : {};
      renderTags(); renderCustomFields(); updatePreview();
      updateDeleteClearButton();
      openEditPanel();
    }

    function createNewCard() {
      selectedCardId = null; isNewCardMode = true;
      highlightSelectedCard(null);
      document.getElementById('panelTitle').textContent = '新建卡片';
      document.getElementById('cardTitle').value = '';
      document.getElementById('cardPrompt').value = '';
      document.getElementById('floatingPromptText').value = '';
      imageData = null; currentTags = []; tempCustomFields = [];
      currentCardCustomFields = {};
      renderTags(); renderCustomFields(); updatePreview();
      updateDeleteClearButton();
      openEditPanel();
    }

    const TRASH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    function updateDeleteClearButton() {
      const btn = document.getElementById('actionDeleteClearBtn');
      if (!btn) return;
      btn.style.display = 'inline-flex';
      if (isNewCardMode) {
        btn.title = '清空表单';
        btn.className = 'btn-icon-muted';
        btn.innerHTML = '✕';
        btn.onclick = () => clearCardForm();
      } else {
        btn.title = '删除卡片';
        btn.className = 'btn-icon-danger';
        btn.innerHTML = TRASH_SVG;
        btn.onclick = () => {
          if (selectedCardId) deleteCardPermanently(selectedCardId, true);
        };
      }
    }

    function clearCardForm() {
      createNewCard();
    }

    function renderTags() {
      const wrap = document.getElementById('tagChipsWrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      currentTags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `#${escapeHtml(t)} <span class="remove-tag" onclick="removeTag('${escapeJsString(t)}')">×</span>`;
        wrap.appendChild(chip);
      });
    }

    function addTag() { const raw = document.getElementById('tagInput').value.trim(); if (!raw) return; const t = raw.replace(/^#/, ''); if (t && !currentTags.includes(t)) { currentTags.push(t); renderTags(); } document.getElementById('tagInput').value = ''; }
    function removeTag(t) { currentTags = currentTags.filter(x => x !== t); renderTags(); }
    
    let tagSheetMultiMode = false;
    const tagSheetPending = new Set();

    function applyTagFromSheet(tag) {
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        renderTags();
      }
    }

    function setTagSheetRowChecked(row, checked) {
      const check = row.querySelector('.tag-sheet-check');
      if (check) check.classList.toggle('checked', checked);
    }

    function toggleTagSheetPending(tag, row) {
      tagSheetMultiMode = true;
      document.getElementById('tagSheetOverlay')?.classList.add('multi');
      if (tagSheetPending.has(tag)) {
        tagSheetPending.delete(tag);
        setTagSheetRowChecked(row, false);
      } else {
        tagSheetPending.add(tag);
        setTagSheetRowChecked(row, true);
      }
    }

    function closeTagSheet() {
      const overlay = document.getElementById('tagSheetOverlay');
      if (!overlay) return;
      overlay.classList.remove('open', 'multi');
      tagSheetMultiMode = false;
      tagSheetPending.clear();
      document.getElementById('tagSheetList').innerHTML = '';
    }

    function confirmTagSheet() {
      tagSheetPending.forEach(tag => applyTagFromSheet(tag));
      if (tagSheetPending.size) showToast('已添加标签');
      closeTagSheet();
    }

    function showExistingTags() {
      const all = [...new Set(cards.flatMap(c => c.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const overlay = document.getElementById('tagSheetOverlay');
      const list = document.getElementById('tagSheetList');
      if (!overlay || !list) return;
      tagSheetMultiMode = false;
      tagSheetPending.clear();
      overlay.classList.remove('multi');
      list.innerHTML = '';
      if (!all.length) {
        list.innerHTML = '<div class="tag-sheet-empty">暂无任何标签</div>';
      } else {
        all.forEach(tag => {
          const row = document.createElement('div');
          row.className = 'tag-sheet-row';
          row.dataset.tag = tag;
          const nameBtn = document.createElement('button');
          nameBtn.type = 'button';
          nameBtn.className = 'tag-sheet-name';
          nameBtn.textContent = tag;
          nameBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (tagSheetMultiMode) {
              toggleTagSheetPending(tag, row);
            } else {
              applyTagFromSheet(tag);
              showToast('已添加标签');
              closeTagSheet();
            }
          });
          const checkBtn = document.createElement('button');
          checkBtn.type = 'button';
          checkBtn.className = 'tag-sheet-check';
          checkBtn.setAttribute('aria-label', '多选 ' + tag);
          checkBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleTagSheetPending(tag, row);
          });
          row.appendChild(nameBtn);
          row.appendChild(checkBtn);
          list.appendChild(row);
        });
      }
      overlay.classList.add('open');
      const onKey = e => { if (e.key === 'Escape') { closeTagSheet(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
    }
    window.closeTagSheet = closeTagSheet;
    window.confirmTagSheet = confirmTagSheet;
    
    document.getElementById('tagInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

    function renderCustomFields() {
      const container = document.getElementById('customFieldsContainer');
      let html = '';
      globalFields.forEach(f => {
        const val = currentCardCustomFields[f.name] || '';
        html += `<label>${f.name}</label>`;
        html += f.type === 'textarea' ? `<textarea class="custom-field-input" data-field-name="${f.name}">${val}</textarea>` : `<input type="text" class="custom-field-input" data-field-name="${f.name}" value="${val}">`;
      });
      const globalNames = globalFields.map(f => f.name);
      Object.keys(currentCardCustomFields).forEach(name => {
        if (!globalNames.includes(name) && !tempCustomFields.some(tf => tf.name === name)) {
          html += `<label>${name} <span style="color:var(--danger); cursor:pointer;" onclick="deleteCardField('${name}')">×</span></label>`;
          const val = currentCardCustomFields[name] || '';
          html += `<textarea class="temp-field" data-field-name="${name}">${val}</textarea>`;
        }
      });
      tempCustomFields.forEach((tf, idx) => {
        html += `<label>${tf.name} <span style="color:var(--danger); cursor:pointer;" onclick="removeTempField(${idx})">×</span></label>`;
        html += tf.type === 'textarea' ? `<textarea class="temp-field" data-temp-idx="${idx}" data-field-name="${tf.name}">${tf.value || ''}</textarea>` : `<input type="text" class="temp-field" data-temp-idx="${idx}" data-field-name="${tf.name}" value="${tf.value || ''}">`;
      });
      html += `<div style="display:flex; gap:6px; align-items:center; margin-top:8px;">
        <input type="text" id="tempFieldName" placeholder="字段名" style="flex:1.5;">
        <select id="tempFieldType" style="width:70px;"><option value="text">文本</option><option value="textarea">文本域</option></select>
        <label class="custom-checkbox" style="white-space:nowrap; gap:4px;"><input type="checkbox" id="tempFieldFixed"><span class="checkmark"></span> 固定</label>
        <button class="btn btn-secondary" style="padding:4px 8px; height:34px; font-size:11px;" onclick="addTempField()">+</button>
      </div>`;
      container.innerHTML = html;
    }

    function deleteCardField(name) {
      delete currentCardCustomFields[name];
      renderCustomFields();
    }

    function addTempField() {
      const n = document.getElementById('tempFieldName').value.trim(); if (!n) return;
      const t = document.getElementById('tempFieldType').value;
      const f = document.getElementById('tempFieldFixed').checked;
      if (f) {
        globalFields.push({ id: generateId(), name: n, type: t });
        saveAllData();
        renderCustomFields();
        if (document.getElementById('settingsOverlay').classList.contains('active')) renderFieldList();
      } else {
        tempCustomFields.push({ name: n, type: t, value: '' });
        renderCustomFields();
      }
      document.getElementById('tempFieldName').value = '';
    }

    function removeTempField(idx) { tempCustomFields.splice(idx, 1); renderCustomFields(); }

    function updatePreview() {
      const img = document.getElementById('previewImage'), p = document.getElementById('dropPlaceholder');
      const removeBtn = document.getElementById('removeImageBtn'), dropArea = document.getElementById('dropArea');
      if (imageData) {
        img.src = imageData;
        img.style.display = 'block';
        p.style.display = 'none';
        removeBtn.style.display = 'flex';
        dropArea.classList.add('has-image');
        dropArea.classList.remove('no-image');
      } else {
        img.style.display = 'none';
        p.style.display = 'block';
        removeBtn.style.display = 'none';
        dropArea.classList.add('no-image');
        dropArea.classList.remove('has-image');
      }
    }

    function removeImage() { imageData = null; updatePreview(); }
    function handleSingleImage(file) { if (!file || !file.type.startsWith('image/')) return; const r = new FileReader(); r.onload = e => { imageData = e.target.result; updatePreview(); }; r.readAsDataURL(file); }
    const dropArea = document.getElementById('dropArea');
    dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', e => { e.preventDefault(); dropArea.classList.remove('dragover'); handleSingleImage(e.dataTransfer.files[0]); });
    dropArea.addEventListener('click', (e) => { if (e.target.tagName !== 'IMG' && e.target.tagName !== 'BUTTON') document.getElementById('fileInput').click(); });
    document.getElementById('fileInput').addEventListener('change', e => handleSingleImage(e.target.files[0]));

    document.addEventListener('paste', e => {
      const ocrModal = document.getElementById('ocrModal');
      const editPanel = document.getElementById('editPanel');
      if (ocrModal.style.display === 'flex') {
        const items = e.clipboardData.items;
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            handleModalImage(i.getAsFile());
            break;
          }
        }
        return;
      }
      if (!editPanel.classList.contains('hidden')) {
        const items = e.clipboardData.items;
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            handleSingleImage(i.getAsFile());
            break;
          }
        }
      }
    });

    async function saveCard() {
      const prompt = floatingPromptActive ? document.getElementById('floatingPromptText').value.trim() : document.getElementById('cardPrompt').value.trim();
      if (!prompt) { document.getElementById('statusMsg').textContent = '❌ 提示词不能为空'; return; }
      const title = document.getElementById('cardTitle').value.trim();
      const customData = {};
      globalFields.forEach(f => {
        const el = document.querySelector(`[data-field-name="${f.name}"]`);
        customData[f.name] = el ? el.value : '';
      });
      document.querySelectorAll('[data-field-name]').forEach(el => {
        const name = el.dataset.fieldName;
        if (!globalFields.some(f => f.name === name)) {
          customData[name] = el.value;
        }
      });
      if (!isNewCardMode && selectedCardId) {
        const card = cards.find(c => c.id === selectedCardId);
        if (card) { card.title = title; card.prompt = prompt; card.image = imageData; card.tags = [...currentTags]; card.customFields = customData; card.updatedAt = Date.now(); }
      } else {
        cards.push({
          id: generateId(), title, prompt, image: imageData,
          group: (currentGroup !== 'all' && currentGroup !== 'uncategorized') ? currentGroup : null,
          tags: [...currentTags], customFields: customData,
          createdAt: Date.now(), updatedAt: Date.now()
        });
        selectedCardId = null; clearCardForm();
      }
      await saveAllData();
      updateTagFilter();
      renderGroups(); renderCards(true);
      showToast('保存成功！');
    }

    function copyCardPrompt(id) { const c = cards.find(x => x.id === id); if (c && c.prompt) { navigator.clipboard.writeText(c.prompt); showToast('提示词已复制'); } }
    function closeEditPanel() {
      document.getElementById('editPanel').classList.add('hidden');
      document.getElementById('fabNewBtn').classList.add('visible');
      document.body.classList.remove('panel-open');
      scheduleLayoutMasonry();
    }
    function openEditPanel() {
      if (globalViewActive) forceExitGlobalView(true);
      document.getElementById('editPanel').classList.remove('hidden');
      document.getElementById('fabNewBtn').classList.remove('visible');
      document.body.classList.add('panel-open');
    }

    function openLightbox(src) {
      const lightbox = document.getElementById('imageLightbox');
      const img = document.getElementById('lightboxImage');
      const onReady = () => {
        resetImageZoom(img);
        attachImageZoom(img);
      };
      lightbox.classList.add('active');
      if (img.src === src && img.complete) onReady();
      else {
        img.onload = () => { img.onload = null; onReady(); };
        img.src = src;
      }
    }
    window.addEventListener('mousemove', (e) => {
      if (!imageZoom.dragging) return;
      imageZoom.tx = e.clientX - imageZoom.startX;
      imageZoom.ty = e.clientY - imageZoom.startY;
      applyImageZoom();
    });
    window.addEventListener('mouseup', () => {
      if (imageZoom.dragging) {
        imageZoom.dragging = false;
        applyImageZoom();
      }
    });
    function closeLightbox(e) {
      if (e && e.target !== document.getElementById('imageLightbox') && e.target !== document.querySelector('.close-lightbox')) return;
      document.getElementById('imageLightbox').classList.remove('active');
      const img = document.getElementById('lightboxImage');
      if (img) {
        img.onwheel = null;
        img.onmousedown = null;
        img.ondblclick = null;
      }
      if (imageZoom.img === document.getElementById('lightboxImage')) imageZoom.img = null;
      imageZoom.dragging = false;
    }

    function showContextMenu(x, y, items) {
      const menu = document.getElementById('contextMenu');
      menu.innerHTML = items.map(i => `<button>${i.label}</button>`).join('');
      menu.style.display = 'block'; menu.style.left = x + 'px'; menu.style.top = y + 'px';
      menu.querySelectorAll('button').forEach((btn, idx) => btn.addEventListener('click', () => { items[idx].action(); menu.style.display = 'none'; }));
      const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    }

    document.getElementById('sidebarArea').addEventListener('contextmenu', e => { if (e.target.closest('.group-item')) return; e.preventDefault(); });
    document.getElementById('mainContentArea').addEventListener('contextmenu', e => { if (e.target.closest('.card') || e.target.closest('.main-header')) return; e.preventDefault(); showContextMenu(e.clientX, e.clientY, [{ label: '新建卡片', action: () => createNewCard() }]); });
    document.getElementById('viewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      document.querySelectorAll('#viewToggle button[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCards(true);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const viewer = document.getElementById('appreciateViewer');
      if (viewer?.classList.contains('active')) {
        closeAppreciateViewer();
        return;
      }
      if (globalViewActive) exitGlobalView();
    });

    let modalImageData = null;
    function openOcrModal() { document.getElementById('ocrModal').style.display = 'flex'; modalImageData = null; document.getElementById('modalPlaceholder').style.display = 'block'; document.getElementById('modalPreview').style.display = 'none'; document.getElementById('ocrProgress').style.display = 'none'; document.getElementById('modalOcrResult').style.display = 'none'; document.getElementById('modalStatus').textContent = ''; }
    function closeOcrModal() { document.getElementById('ocrModal').style.display = 'none'; }
    function handleModalImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => {
        modalImageData = e.target.result;
        document.getElementById('modalPreview').src = modalImageData;
        document.getElementById('modalPreview').style.display = 'block';
        document.getElementById('modalPlaceholder').style.display = 'none';
        runModalOCR();
      };
      r.readAsDataURL(file);
    }
    async function runModalOCR() {
      if (!modalImageData) return;
      const status = document.getElementById('modalStatus');
      const progress = document.getElementById('ocrProgress');
      const progressBar = document.getElementById('ocrProgressBar');
      progress.style.display = 'block'; progressBar.style.width = '0%'; status.textContent = '';
      const engine = settings.engine || 'tesseract';
      let text = '';
      if (engine === 'ocrspace' && settings.apiKey) {
        progressBar.style.width = '30%';
        try {
          const fd = new FormData();
          fd.append('apikey', settings.apiKey);
          fd.append('base64Image', modalImageData);
          fd.append('language', 'chs');
          fd.append('isOverlayRequired', 'false');
          progressBar.style.width = '60%';
          const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
          progressBar.style.width = '90%';
          const d = await resp.json();
          if (d.ParsedResults?.length) text = d.ParsedResults[0].ParsedText.trim();
        } catch (e) { status.textContent = '接口失败'; }
      } else {
        try {
          const result = await Tesseract.recognize(modalImageData, 'chi_sim+eng', {
            tessedit_pageseg_mode: '6',
            logger: m => {
              if (m.status === 'recognizing text' && m.progress) {
                progressBar.style.width = Math.round(m.progress * 100) + '%';
              }
            }
          });
          text = result.data.text.trim();
        } catch (e) { status.textContent = 'Tesseract 失败'; }
      }
      progressBar.style.width = '100%';
      setTimeout(() => { progress.style.display = 'none'; }, 300);
      if (text) {
        document.getElementById('modalOcrText').value = text;
        document.getElementById('modalOcrResult').style.display = 'block';
      } else {
        status.textContent = '未识别到文字';
      }
    }
    function useOcrResult(action) {
      const text = document.getElementById('modalOcrText').value.trim();
      if (!text) return;
      if (action === 'fill') {
        if (floatingPromptActive) {
          document.getElementById('floatingPromptText').value = text;
          document.getElementById('cardPrompt').value = text;
        } else {
          document.getElementById('cardPrompt').value = text;
          document.getElementById('floatingPromptText').value = text;
        }
        closeOcrModal();
        showToast('文字已填入提示词框');
      }
    }
    const modalDrop = document.getElementById('modalDropArea');
    modalDrop.addEventListener('click', () => document.getElementById('modalFileInput').click());
    modalDrop.addEventListener('dragover', e => { e.preventDefault(); modalDrop.classList.add('dragover'); });
    modalDrop.addEventListener('dragleave', () => modalDrop.classList.remove('dragover'));
    modalDrop.addEventListener('drop', e => { e.preventDefault(); modalDrop.classList.remove('dragover'); handleModalImage(e.dataTransfer.files[0]); });
    document.getElementById('modalFileInput').addEventListener('change', e => handleModalImage(e.target.files[0]));

    function openSettings() { document.getElementById('settingsOverlay').classList.add('active'); document.getElementById('ocrEngineSelect').value = settings.engine || 'tesseract'; document.getElementById('ocrApiKey').value = settings.apiKey || ''; document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom; renderFieldList(); }
    function closeSettings() { document.getElementById('settingsOverlay').classList.remove('active'); }
    function saveSettings() { settings.engine = document.getElementById('ocrEngineSelect').value; settings.apiKey = document.getElementById('ocrApiKey').value.trim(); settings.imageClickZoom = document.getElementById('imageClickZoomToggle').checked; saveAllData(); document.getElementById('settingsStatus').textContent = '设置已保存'; setTimeout(() => document.getElementById('settingsStatus').textContent = '', 2000); renderCards(true); }
    function addGlobalField() { const n = document.getElementById('newFieldName').value.trim(); if (!n) return; globalFields.push({ id: generateId(), name: n, type: document.getElementById('newFieldType').value }); saveAllData(); document.getElementById('newFieldName').value = ''; renderFieldList(); }
    function renderFieldList() { document.getElementById('fieldList').innerHTML = globalFields.map(f => `<div style="display:flex; justify-content:space-between; margin:4px 0; padding:4px 12px; background:var(--bg-card); border-radius:6px;"><span>${f.name} (${f.type})</span><button class="btn btn-secondary" style="padding:2px 10px; height:28px;" onclick="deleteGlobalField('${f.id}')">❌</button></div>`).join(''); }
    function deleteGlobalField(id) { globalFields = globalFields.filter(f => f.id !== id); saveAllData(); renderFieldList(); }
    async function saveToFile() { try { const h = await window.showSaveFilePicker({ suggestedName: 'promptrepo_data.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] }); fileHandle = h; const w = await h.createWritable(); await w.write(JSON.stringify({ cards, customGroups, globalFields, settings })); await w.close(); document.getElementById('settingsStatus').textContent = '✅ 文件已保存'; } catch (e) { if (e.name !== 'AbortError') alert('保存失败'); } }
    async function loadFromFile() { try { const [h] = await window.showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] }); fileHandle = h; const f = await h.getFile(); const t = await f.text(); const d = JSON.parse(t); if (d.cards) { cards = d.cards; customGroups = d.customGroups || []; globalFields = d.globalFields || []; settings = d.settings || settings; await saveAllData(); renderGroups(); renderCards(true); createNewCard(); document.getElementById('settingsStatus').textContent = '✅ 文件已加载'; } } catch (e) { if (e.name !== 'AbortError') alert('打开文件失败'); } }
    function exportData() { const d = { cards, customGroups, globalFields, settings }; const b = new Blob([JSON.stringify(d)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'promptrepo_backup.json'; a.click(); }
    function importData(event) { const f = event.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = e => { try { const d = JSON.parse(e.target.result); if (d.cards && confirm('导入将覆盖当前数据，确定？')) { cards = d.cards; customGroups = d.customGroups || []; globalFields = d.globalFields || []; settings = d.settings || settings; saveAllData(); renderGroups(); renderCards(true); createNewCard(); } } catch (err) { alert('无效文件'); } }; r.readAsText(f); event.target.value = ''; }
    function clearAllData() { customConfirm('确定删除所有数据？此操作不可恢复。', () => { cards = []; customGroups = []; globalFields = []; saveAllData(); renderGroups(); renderCards(true); createNewCard(); }); }
    
    function escapeHtml(str) { return String(str).replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }
    function escapeJsString(str) { return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, ''); }
    window.escapeHtml = escapeHtml;
    window.escapeJsString = escapeJsString;
    

