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

    let cards = [], customGroups = [], globalFields = [], settings = { engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, defaultImageGenAutoSaveWarehouse: true, autoDayNight: true, themeManualOverride: false };
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
    const GUEST_CARD_LIMIT = 10;

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
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        window.FeatureDraft?.scheduleLayout?.('communityGrid');
      }
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

    async function openAppreciateViewer(cardId) {
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const viewer = document.getElementById('appreciateViewer');
      const img = document.getElementById('appreciateViewerImg');
      const caption = document.getElementById('appreciateViewerCaption');
      const hint = document.querySelector('.appreciate-viewer-hint');
      if (!viewer || !img) return;
      viewer.classList.remove('active');
      document.body.classList.remove('appreciate-viewing');
      const title = (card.title || '').trim();
      const prompt = (card.prompt || '').trim();
      if (caption) {
        caption.textContent = title || (prompt ? prompt.slice(0, 120) + (prompt.length > 120 ? '…' : '') : '');
        caption.style.display = caption.textContent ? 'block' : 'none';
      }
      const reveal = () => {
        viewer.classList.add('active');
        document.body.classList.add('appreciate-viewing');
      };
      if (card.image) {
        img.style.display = 'block';
        if (hint) hint.style.display = 'block';
        img.removeAttribute('src');
        const displaySrc = window.SupabaseSync?.resolveDisplayUrl
          ? await window.SupabaseSync.resolveDisplayUrl(card.image)
          : card.image;
        let revealed = false;
        const onReady = () => {
          if (revealed) return;
          revealed = true;
          img.onload = null;
          resetImageZoom(img);
          attachImageZoom(img);
          reveal();
        };
        img.onload = onReady;
        img.src = displaySrc;
        if (img.complete && img.naturalWidth > 0) onReady();
      } else {
        img.src = '';
        img.style.display = 'none';
        if (hint) hint.style.display = 'none';
        imageZoom.img = null;
        reveal();
      }
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
    window.showToast = showToast;

    function isUserLoggedIn() {
      return !!window.SupabaseSync?.isLoggedIn?.();
    }

    function promptLogin(message) {
      if (message) showToast(message);
      if (typeof openAuthModal === 'function') openAuthModal('login');
    }

    function canGuestCreateCard() {
      if (isUserLoggedIn()) return { ok: true };
      if (cards.length >= GUEST_CARD_LIMIT) {
        return {
          ok: false,
          msg: `未登录最多创建 ${GUEST_CARD_LIMIT} 张卡片，登录后可继续创建并同步到云端`
        };
      }
      return { ok: true, remaining: GUEST_CARD_LIMIT - cards.length };
    }

    function requireAuth(action) {
      if (isUserLoggedIn()) return true;
      const messages = {
        copy: '登录后可复制社区提示词',
        community: '登录后可使用社区互动功能',
        imagegen: '登录后可生成图片（需消耗积分）',
        redeem: '登录后可兑换激活码',
        publish: '登录后可发布到社区'
      };
      promptLogin(messages[action] || '请先登录');
      return false;
    }

    function updateGuestLimitUI() {
      const el = document.getElementById('guestLimitHint');
      if (!el) return;
      if (isUserLoggedIn()) {
        el.classList.add('hidden');
        return;
      }
      el.classList.remove('hidden');
      const left = Math.max(0, GUEST_CARD_LIMIT - cards.length);
      el.textContent = `未登录：还可新建 ${left} / ${GUEST_CARD_LIMIT} 张卡片（登录后无限制并云同步）`;
    }

    window.AuthGate = {
      GUEST_CARD_LIMIT,
      isUserLoggedIn,
      requireAuth,
      canGuestCreateCard,
      promptLogin,
      updateGuestLimitUI
    };

    window.getDefaultPublishCommunity = function () {
      return settings.defaultPublishCommunity !== false;
    };

    window.getDefaultImageGenAutoPublish = function () {
      return settings.defaultImageGenAutoPublish !== false;
    };

    window.getDefaultImageGenAutoSaveWarehouse = function () {
      return settings.defaultImageGenAutoSaveWarehouse !== false;
    };

    window.getWarehouseCardsForImageGen = function (opts) {
      const group = opts?.group || 'all';
      const tag = opts?.tag || 'all';
      let list = cards.filter(c => (c.prompt || '').trim());
      if (group === 'uncategorized') {
        list = list.filter(c => !c.group);
      } else if (group && group !== 'all') {
        list = list.filter(c => c.group === group);
      }
      if (tag && tag !== 'all') {
        list = list.filter(c => (c.tags || []).includes(tag));
      }
      return list
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .map(c => ({
          id: c.id,
          title: (c.title || '').trim() || '',
          prompt: c.prompt || '',
          image: c.image || null,
          tags: c.tags || [],
          group: c.group || null
        }));
    };

    window.getImageGenWarehouseFilterOptions = function () {
      const groups = [
        { value: 'all', label: '全部分组' },
        { value: 'uncategorized', label: '未分类' },
        ...customGroups.map(g => ({ value: g, label: g }))
      ];
      const tagSet = new Set();
      cards.forEach(c => (c.tags || []).forEach(t => tagSet.add(t)));
      const tags = [
        { value: 'all', label: '全部标签' },
        ...[...tagSet].sort().map(t => ({ value: t, label: '#' + t }))
      ];
      return { groups, tags };
    };

    window.redeemActivationCode = async function () {
      if (!requireAuth('redeem')) return;
      const input = document.getElementById('activationCodeInput');
      const code = input?.value?.trim();
      const result = await window.PointsSystem?.redeemActivationCode?.(code);
      if (!result) return;
      const status = document.getElementById('settingsStatus');
      if (result.ok) {
        if (input) input.value = '';
        if (status) status.textContent = result.msg;
        showToast(result.msg);
        if (window.Membership?.isMemberCode?.(code)) {
          enforcePinLimits();
          renderCards(true);
          updatePinToggleUI();
          if (typeof window.FeatureDraft?.refreshImageGenCost === 'function') {
            window.FeatureDraft.refreshImageGenCost();
          }
        }
      } else {
        if (status) status.textContent = result.msg;
        showToast(result.msg);
      }
    };

    window.addCardFromCommunity = function (post) {
      if (!post || !post.prompt) return false;
      if (cards.some(c => c.communitySourceId === post.id)) return false;
      cards.push({
        id: generateId(),
        title: (post.title || '社区收藏') + '',
        prompt: post.prompt,
        image: post.image || null,
        group: null,
        tags: ['社区收藏'],
        customFields: {},
        communitySourceId: post.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      saveAllData();
      renderGroups();
      renderCards(true);
      return true;
    };

    window.addCardFromGenerated = function (payload) {
      const { prompt, image, title, sourceId } = payload || {};
      if (!image && !(prompt || '').trim()) {
        showToast('无内容可保存');
        return { ok: false };
      }
      if (sourceId && cards.some(c => c.genSourceId === sourceId)) {
        showToast('该图已在卡片仓库中');
        return { ok: false, duplicate: true };
      }
      if (!isUserLoggedIn()) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          promptLogin(check.msg);
          return { ok: false };
        }
      }
      const promptText = (prompt || '').trim();
      cards.push({
        id: generateId(),
        title: (title || '').trim(),
        prompt: promptText,
        image: image || null,
        group: null,
        tags: ['图片生成'],
        customFields: {},
        genSourceId: sourceId || null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      saveAllData();
      renderGroups();
      renderCards(true);
      updateGuestLimitUI();
      showToast('已保存到卡片仓库');
      return { ok: true };
    };

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
    window.customConfirm = customConfirm;
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
      if (isMobileViewport()) {
        clearTimeout(layoutMasonryTimer);
        layoutMasonryTimer = setTimeout(() => enforceMobileCardGrid(), 50);
        return;
      }
      clearTimeout(layoutMasonryTimer);
      layoutMasonryTimer = setTimeout(() => layoutMasonryGrid(), 100);
    }

    function resetCardLayoutStyles(container) {
      if (!container) return;
      container.querySelectorAll('.card').forEach(card => {
        card.removeAttribute('style');
      });
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
      container.classList.add('mobile-grid');
      container.removeAttribute('style');
      resetCardLayoutStyles(container);
    }
    window.enforceMobileCardGrid = enforceMobileCardGrid;

    function layoutMasonryGrid() {
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (!container || viewMode === 'list') return;
      if (isMobileViewport()) {
        enforceMobileCardGrid();
        return;
      }
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
        requestAnimationFrame(() => {
          const onWarehouse = document.getElementById('pageWarehouse')?.classList.contains('active');
          if (!onWarehouse) return;
          if (isMobileViewport()) enforceMobileCardGrid();
          else if (masonryInstance && document.querySelector('#cardsContainer .card')) {
            masonryInstance.layout();
          } else if (typeof scheduleLayoutMasonry === 'function') {
            scheduleLayoutMasonry();
          }
        });
      }
      window.FeatureDraft?.onAppChange?.(app);
      window.mobileOnAppPageChange?.(app);
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
      if (window.matchMedia('(max-width: 900px)').matches) {
        bg.style.display = 'none';
        return;
      }
      try {
        const mod = await import('./ripple-grid.js');
        mod.initRippleGrid(bg, RIPPLE_BG_OPTS);
      } catch {
        initCanvasRippleFallback(bg);
      }
    }

    let cloudPushTimer = null;
    let cloudSyncing = false;
    let activeAccountId = null;
    let cloudHydratedUid = null;

    function userStorageKey(name, uid) {
      const id = uid || activeAccountId;
      return id ? `promptrepo_${name}_${id}` : `promptrepo_${name}`;
    }

    const BACKUP_FORMAT = 'prompt-hub-backup';
    const BACKUP_VERSION = 1;

    function getPinLimit() {
      return window.Membership?.getPinLimit?.() ?? 2;
    }

    function countPinnedCards(excludeId) {
      return cards.filter(c => c.pinnedAt && c.id !== excludeId).length;
    }

    function sortCardsWithPins(list) {
      const pinned = list.filter(c => c.pinnedAt).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
      const rest = list.filter(c => !c.pinnedAt);
      if (sortMode === 'updated-desc') {
        rest.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      } else if (sortMode === 'updated-asc') {
        rest.sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
      }
      return [...pinned, ...rest];
    }

    function normalizeCardPins() {
      cards.forEach(c => {
        if (c.pinnedAt != null && c.pinnedAt !== false) c.pinnedAt = Number(c.pinnedAt) || Date.now();
        else delete c.pinnedAt;
      });
      enforcePinLimits();
    }

    function enforcePinLimits() {
      if (window.Membership?.isUnlimitedPins?.()) return;
      const limit = getPinLimit();
      const pinned = cards.filter(c => c.pinnedAt).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
      if (pinned.length <= limit) return;
      pinned.slice(limit).forEach(c => { delete c.pinnedAt; });
    }

    function updatePinToggleUI() {
      const btn = document.getElementById('cardPinToggle');
      if (!btn) return;
      if (!selectedCardId || isNewCardMode) {
        btn.classList.add('hidden');
        return;
      }
      const card = cards.find(c => c.id === selectedCardId);
      if (!card) {
        btn.classList.add('hidden');
        return;
      }
      btn.classList.remove('hidden');
      const pinned = !!card.pinnedAt;
      btn.classList.toggle('is-pinned', pinned);
      btn.textContent = pinned ? '取消置顶' : '置顶';
      const count = countPinnedCards();
      if (window.Membership?.isUnlimitedPins?.()) {
        btn.title = `会员置顶 ${count} 张（不限）`;
      } else {
        const limit = getPinLimit();
        btn.title = `普通用户置顶 ${count}/${limit}`;
      }
    }

    function toggleCardPinById(id) {
      const card = cards.find(c => c.id === id);
      if (!card) return;
      if (card.pinnedAt) {
        delete card.pinnedAt;
        saveAllData();
        renderCards(true);
        updatePinToggleUI();
        showToast('已取消置顶');
        return;
      }
      if (!window.Membership?.isUnlimitedPins?.()) {
        const limit = getPinLimit();
        if (countPinnedCards(id) >= limit) {
          showToast(`普通用户最多置顶 ${limit} 张，请先取消其他置顶`);
          return;
        }
      }
      card.pinnedAt = Date.now();
      saveAllData();
      renderCards(true);
      updatePinToggleUI();
      showToast('已置顶');
    }

    window.toggleCardPin = function () {
      if (!selectedCardId) return;
      toggleCardPinById(selectedCardId);
    };

    function buildBackupPayload() {
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        cards,
        customGroups,
        globalFields,
        settings,
        account: window.Membership?.getAccountPayload?.() || null
      };
    }

    function applyBackupPayload(d) {
      if (!d || !Array.isArray(d.cards)) return false;
      cards = d.cards;
      customGroups = d.customGroups || [];
      globalFields = d.globalFields || [];
      if (d.settings && typeof d.settings === 'object') {
        settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true }, d.settings);
      }
      window.Membership?.syncFromPayload?.(d.account);
      normalizeCardPins();
      return true;
    }

    function getDataPayload() {
      const base = {
        cards: filterTombstonedCards(cards),
        customGroups,
        globalFields,
        settings: {
          ...settings,
          deletedCardTombstones: { ...(settings.deletedCardTombstones || {}) }
        },
        account: window.Membership?.getAccountPayload?.() || null,
        schemaVersion: window.CloudSyncSafety?.SCHEMA_VERSION || 2
      };
      const slice = window.FeatureDraft?.getCloudSlice?.();
      if (slice && typeof slice === 'object') Object.assign(base, slice);
      return base;
    }

    function normalizeCardImages(list) {
      if (!Array.isArray(list) || !window.SupabaseSync?.normalizeImageRef) return list;
      return list.map(c => {
        if (!c?.image) return c;
        return { ...c, image: window.SupabaseSync.normalizeImageRef(c.image) };
      });
    }

    function cardImgSrc(image) {
      if (!image) return '';
      if (window.SupabaseSync?.safeImgSrc) return window.SupabaseSync.safeImgSrc(image);
      const url = window.SupabaseSync?.getCachedDisplayUrl?.(image) || image;
      if (typeof url === 'string' && url.startsWith('storage://')) return '';
      return url;
    }

    function cardImgDataAttr(image) {
      if (!image || typeof image !== 'string') return '';
      if (window.SupabaseSync?.isStorageRef?.(image)) {
        return ` data-storage-ref="${escapeHtml(image)}"`;
      }
      return '';
    }

    function mergeDeletedCardTombstones(a, b) {
      return { ...(a || {}), ...(b || {}) };
    }

    function recordCardDeletion(id) {
      if (id == null) return;
      if (!settings.deletedCardTombstones || typeof settings.deletedCardTombstones !== 'object') {
        settings.deletedCardTombstones = {};
      }
      settings.deletedCardTombstones[String(id)] = Date.now();
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }

    function isCardTombstoned(card) {
      if (!card || card.id == null) return false;
      return Boolean(settings.deletedCardTombstones?.[String(card.id)]);
    }

    function filterTombstonedCards(list) {
      return (list || []).filter(c => c && c.id != null && !isCardTombstoned(c));
    }

    /** 本地列表为准：已删卡片不会从云端“复活”；同 id 取 updatedAt 较新者 */
    function mergeCardsByUpdatedAt(localList, cloudList) {
      const map = new Map();
      for (const c of localList || []) {
        if (c && c.id != null) map.set(String(c.id), c);
      }
      for (const c of cloudList || []) {
        if (!c || c.id == null || isCardTombstoned(c)) continue;
        const id = String(c.id);
        const local = map.get(id);
        if (!local) {
          map.set(id, c);
          continue;
        }
        const localTs = local.updatedAt || local.createdAt || 0;
        const cloudTs = c.updatedAt || c.createdAt || 0;
        if (cloudTs > localTs) map.set(id, c);
      }
      return [...map.values()];
    }

    function scheduleMasonryForMedia(media) {
      if (!media) return;
      if (isMobileViewport()) {
        if (media.closest('#imageGenFeed')) {
          window.FeatureDraft?.resetMobileFeedGridStyles?.();
        }         else if (media.closest('#cardsContainer')) {
          enforceMobileCardGrid();
        }
        return;
      }
      if (media.closest('#creationsGrid')) {
        window.FeatureDraft?.scheduleCreationsLayout?.();
      } else if (media.closest('#communityGrid')) {
        window.FeatureDraft?.scheduleLayout?.('communityGrid');
      } else if (media.closest('#userProfileGrid')) {
        window.FeatureDraft?.scheduleLayout?.('userProfileGrid');
      } else if (media.closest('#imageGenFeed')) {
        window.FeatureDraft?.scheduleImageGenFeedLayout?.();
      } else if (typeof scheduleLayoutMasonry === 'function') {
        scheduleLayoutMasonry();
      }
    }
    window.scheduleMasonryForMedia = scheduleMasonryForMedia;

    function finishCardMediaShine(media) {
      if (!media) return;
      const mobile = isMobileViewport();
      if (!mobile) scheduleMasonryForMedia(media);
      const t0 = Number(media.dataset.shineAt || 0) || Date.now();
      if (!media.dataset.shineAt) media.dataset.shineAt = String(t0);
      const inFeatureGrid = media.closest('#creationsGrid, #communityGrid, #userProfileGrid');
      const minShine = mobile ? 0 : (media.classList?.contains('imagegen-feed-media') ? 520 : (inFeatureGrid ? 360 : 720));
      const wait = Math.max(0, minShine - (Date.now() - t0));
      setTimeout(() => {
        media.classList.remove('is-loading');
        if (!mobile) scheduleMasonryForMedia(media);
        else if (media.closest('#imageGenFeed')) window.FeatureDraft?.resetMobileFeedGridStyles?.();
        else if (media.closest('#cardsContainer')) enforceMobileCardGrid();
      }, wait);
    }
    window.finishCardMediaShine = finishCardMediaShine;

    function cardImgInitialSrc(image) {
      const placeholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect fill="#e4e4ea" width="4" height="3"/></svg>');
      if (!image || !cardHasDisplayImage({ image })) return placeholder;
      const cached = window.SupabaseSync?.getCachedDisplayUrl?.(image);
      if (cached && typeof cached === 'string' && !cached.startsWith('storage://') && !cached.startsWith('data:image/svg')) {
        return cached;
      }
      if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
      if (typeof image === 'string' && image.startsWith('data:image/')) return image;
      return placeholder;
    }

    function applyDataPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      const prevTombstones = { ...(settings.deletedCardTombstones || {}) };
      if (Array.isArray(payload.cards)) {
        cards = filterTombstonedCards(normalizeCardImages(payload.cards));
      }
      if (Array.isArray(payload.customGroups)) customGroups = payload.customGroups;
      if (Array.isArray(payload.globalFields)) globalFields = payload.globalFields;
      if (payload.settings && typeof payload.settings === 'object') {
        settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, autoDayNight: true, themeManualOverride: false }, payload.settings);
        settings.deletedCardTombstones = mergeDeletedCardTombstones(
          prevTombstones,
          payload.settings.deletedCardTombstones
        );
      } else if (Object.keys(prevTombstones).length) {
        settings.deletedCardTombstones = prevTombstones;
      }
      cards = filterTombstonedCards(cards);
      window.Membership?.syncFromPayload?.(payload.account);
      window.FeatureDraft?.applyCloudSlice?.(payload);
      normalizeCardPins();
      floatingPromptActive = settings.floatingPrompt === true;
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      if (settings.autoDayNight !== false) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      } else if (settings.theme && typeof window.applyAppTheme === 'function') {
        window.applyAppTheme(settings.theme);
      }
    }

    function updateAuthUI(session) {
      const openBtn = document.getElementById('authOpenBtn');
      const userBar = document.getElementById('authUserBar');
      const hint = document.getElementById('authSyncHint');
      const emailEl = document.getElementById('authUserEmail');
      const configured = window.SupabaseSync?.isConfigured?.();
      if (!openBtn) return;
      if (!configured) {
        openBtn.textContent = '云同步未配置';
        openBtn.disabled = true;
        userBar?.classList.add('hidden');
        hint?.classList.add('hidden');
        return;
      }
      openBtn.disabled = false;
      if (session?.user) {
        openBtn.classList.add('hidden');
        userBar?.classList.remove('hidden');
        hint?.classList.remove('hidden');
        const label = session.user.email || session.user.phone || '已登录';
        if (emailEl) {
          emailEl.textContent = label;
          emailEl.title = label;
        }
      } else {
        openBtn.classList.remove('hidden');
        openBtn.textContent = '登录 / 注册';
        userBar?.classList.add('hidden');
        hint?.classList.add('hidden');
      }
      updateGuestLimitUI();
    }

    let authMode = 'login';
    let authChannel = 'email';
    let authBusy = false;
    let otpCooldownTimer = null;

    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function setAuthBusy(busy) {
      authBusy = busy;
      const btn = document.getElementById('authSubmitBtn');
      const otpBtn = document.getElementById('authSendOtpBtn');
      if (btn) btn.disabled = busy;
      if (otpBtn && !otpCooldownTimer) otpBtn.disabled = busy;
    }

    function refreshAuthMethodUI() {
      const phoneEnabled = window.SupabaseSync?.isPhoneAuthEnabled?.();
      const phoneTab = document.getElementById('authPhoneMethodTab');
      const methodTabs = document.getElementById('authMethodTabs');
      if (phoneTab) phoneTab.classList.toggle('hidden', !phoneEnabled);
      if (methodTabs && !phoneEnabled) methodTabs.classList.add('hidden');
      const wechatBtn = document.getElementById('authWeChatBtn');
      const social = document.getElementById('authSocial');
      if (wechatBtn) {
        wechatBtn.disabled = !window.SupabaseSync?.isWeChatAuthEnabled?.();
        wechatBtn.title = wechatBtn.disabled ? '需先在 supabase-config.js 配置微信 OAuth' : '使用微信登录';
      }
    }

    function switchAuthChannel(channel) {
      if (channel === 'phone' && !window.SupabaseSync?.isPhoneAuthEnabled?.()) {
        setAuthStatus('请先在 Supabase 开启手机登录，见 docs/SUPABASE-AUTH.md', 'error');
        return;
      }
      authChannel = channel;
      document.querySelectorAll('.auth-method-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authChannel === channel);
      });
      document.getElementById('authEmailPanel')?.classList.toggle('hidden', channel !== 'email');
      document.getElementById('authPhonePanel')?.classList.toggle('hidden', channel !== 'phone');
      document.getElementById('authTabs')?.classList.toggle('hidden', channel !== 'email' || authMode === 'forgot' || authMode === 'reset');
      document.getElementById('authEmailLinks')?.classList.toggle('hidden', channel !== 'email');
      document.getElementById('authSocial')?.classList.toggle('hidden', authMode === 'forgot' || authMode === 'reset');
      const submitBtn = document.getElementById('authSubmitBtn');
      if (channel === 'phone') {
        document.getElementById('authTitle').textContent = '手机验证码登录';
        document.getElementById('authDesc').textContent = '输入手机号获取验证码，未注册将自动创建账号。';
        if (submitBtn) submitBtn.textContent = '登录 / 注册';
        document.getElementById('authPhone')?.focus();
      } else {
        switchAuthMode(authMode || 'login');
      }
      setAuthStatus('');
    }
    window.switchAuthChannel = switchAuthChannel;

    function switchAuthMode(mode) {
      authMode = mode;
      if (authChannel === 'phone' && mode !== 'reset') return;
      const tabs = document.getElementById('authTabs');
      const confirmWrap = document.getElementById('authConfirmWrap');
      const newPwdWrap = document.getElementById('authNewPwdWrap');
      const pwdField = document.querySelector('.auth-field-password');
      const rememberWrap = document.getElementById('authRememberWrap');
      const forgotLink = document.getElementById('authForgotLink');
      const backLink = document.getElementById('authBackLoginLink');
      const title = document.getElementById('authTitle');
      const desc = document.getElementById('authDesc');
      const submitBtn = document.getElementById('authSubmitBtn');
      const pwdLabel = document.getElementById('authPasswordLabel');
      const methodTabs = document.getElementById('authMethodTabs');

      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authMode === mode);
      });

      tabs?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
      methodTabs?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset' || !window.SupabaseSync?.isPhoneAuthEnabled?.());
      document.getElementById('authEmailPanel')?.classList.remove('hidden');
      document.getElementById('authPhonePanel')?.classList.add('hidden');
      authChannel = 'email';
      document.querySelectorAll('.auth-method-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authChannel === 'email');
      });
      confirmWrap?.classList.toggle('hidden', mode !== 'register');
      newPwdWrap?.classList.toggle('hidden', mode !== 'reset');
      pwdField?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
      rememberWrap?.classList.toggle('hidden', mode !== 'login');
      forgotLink?.classList.toggle('hidden', mode !== 'login');
      backLink?.classList.toggle('hidden', mode === 'login');
      document.getElementById('authEmailLinks')?.classList.remove('hidden');
      document.getElementById('authSocial')?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');

      if (mode === 'login') {
        title.textContent = '登录账号';
        desc.textContent = '登录后卡片、分组会同步到云端，换设备也能用。';
        submitBtn.textContent = '登录';
        pwdLabel.textContent = '密码';
        document.getElementById('authPassword')?.setAttribute('autocomplete', 'current-password');
      } else if (mode === 'register') {
        title.textContent = '注册账号';
        desc.textContent = '创建账号后即可在多设备同步你的提示词库。';
        submitBtn.textContent = '注册';
        pwdLabel.textContent = '设置密码';
        document.getElementById('authPassword')?.setAttribute('autocomplete', 'new-password');
      } else if (mode === 'forgot') {
        title.textContent = '找回密码';
        desc.textContent = '输入注册邮箱，我们将发送重置链接（请查收邮件，含垃圾箱）。';
        submitBtn.textContent = '发送重置邮件';
      } else if (mode === 'reset') {
        title.textContent = '设置新密码';
        desc.textContent = '请设置新的登录密码（至少 6 位）。';
        submitBtn.textContent = '更新密码';
        methodTabs?.classList.add('hidden');
        document.getElementById('authSocial')?.classList.add('hidden');
      }
      setAuthStatus('');
    }
    window.switchAuthMode = switchAuthMode;

    function toggleAuthPassword() {
      const input = document.getElementById('authPassword');
      const btn = document.getElementById('authPwdToggle');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      if (btn) btn.textContent = show ? '🙈' : '👁';
    }
    window.toggleAuthPassword = toggleAuthPassword;

    function openAuthModal(mode) {
      if (!window.SupabaseSync?.isConfigured?.()) {
        showToast('请先在 supabase-config.js 填入项目地址和密钥');
        return;
      }
      refreshAuthMethodUI();
      setAuthStatus('');
      setAuthBusy(false);
      authChannel = 'email';
      if (window.location.hash.includes('type=recovery')) {
        switchAuthMode('reset');
      } else {
        switchAuthMode(mode || 'login');
      }
      document.getElementById('authOverlay')?.classList.add('open');
      document.getElementById('authEmail')?.focus();
    }
    function closeAuthModal() {
      document.getElementById('authOverlay')?.classList.remove('open');
      if (window.location.hash.includes('type=recovery')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;

    function setAuthStatus(msg, type) {
      const el = document.getElementById('authStatus');
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'auth-status' + (type ? ' ' + type : '');
    }

    function authErrorMessage(e) {
      return window.SupabaseSync?.formatAuthError?.(e) || e?.message || '操作失败';
    }

    async function authSignIn() {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value;
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('登录中…');
        await window.SupabaseSync.signIn(email, password);
        closeAuthModal();
        showToast('登录成功');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function authSignUp() {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value;
      const confirm = document.getElementById('authPasswordConfirm')?.value;
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      if (password.length < 6) { setAuthStatus('密码至少 6 位', 'error'); return; }
      if (password !== confirm) { setAuthStatus('两次输入的密码不一致', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('注册中…');
        const data = await window.SupabaseSync.signUp(email, password);
        if (data.session) {
          closeAuthModal();
          showToast('注册成功，已自动登录');
        } else {
          setAuthStatus('注册成功！请查收邮件点击确认链接后再登录（若未开启邮箱验证可直接登录）', 'ok');
          switchAuthMode('login');
        }
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function authForgotPassword() {
      const email = document.getElementById('authEmail')?.value?.trim();
      if (!email) { setAuthStatus('请先填写注册邮箱', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('发送中…');
        await window.SupabaseSync.resetPassword(email);
        setAuthStatus('重置邮件已发送，请查收邮箱（含垃圾箱）', 'ok');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function authResetPassword() {
      const pwd = document.getElementById('authNewPassword')?.value;
      if (!pwd || pwd.length < 6) { setAuthStatus('新密码至少 6 位', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('更新中…');
        await window.SupabaseSync.updatePassword(pwd);
        closeAuthModal();
        showToast('密码已更新，请使用新密码登录');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    function startOtpCooldown(seconds) {
      const btn = document.getElementById('authSendOtpBtn');
      if (!btn) return;
      let left = seconds;
      btn.disabled = true;
      btn.textContent = left + 's';
      clearInterval(otpCooldownTimer);
      otpCooldownTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(otpCooldownTimer);
          otpCooldownTimer = null;
          btn.disabled = false;
          btn.textContent = '获取验证码';
        } else {
          btn.textContent = left + 's';
        }
      }, 1000);
    }

    async function authSendPhoneOtp() {
      const phone = document.getElementById('authPhone')?.value?.trim();
      if (!phone) { setAuthStatus('请输入手机号', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('发送中…');
        await window.SupabaseSync.sendPhoneOtp(phone);
        setAuthStatus('验证码已发送，请查收短信', 'ok');
        startOtpCooldown(60);
        document.getElementById('authOtp')?.focus();
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }
    window.authSendPhoneOtp = authSendPhoneOtp;

    async function authPhoneVerify() {
      const phone = document.getElementById('authPhone')?.value?.trim();
      const otp = document.getElementById('authOtp')?.value?.trim();
      if (!phone) { setAuthStatus('请输入手机号', 'error'); return; }
      if (!otp) { setAuthStatus('请输入验证码', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('验证中…');
        await window.SupabaseSync.verifyPhoneOtp(phone, otp);
        closeAuthModal();
        showToast('登录成功');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    function authWeChatLogin() {
      if (window.SupabaseSync?.isWeChatAuthEnabled?.()) {
        const url = window.WECHAT_OAUTH_URL;
        const redirect = encodeURIComponent(window.location.href.split('#')[0]);
        window.location.href = url + (url.includes('?') ? '&' : '?') + 'redirect=' + redirect;
        return;
      }
      setAuthStatus('微信登录需配置开放平台与 OAuth 地址，详见项目 docs/SUPABASE-AUTH.md', 'ok');
    }
    window.authWeChatLogin = authWeChatLogin;

    async function authSubmit() {
      if (authBusy) return;
      if (authChannel === 'phone') {
        await authPhoneVerify();
        return;
      }
      if (authMode === 'login') await authSignIn();
      else if (authMode === 'register') await authSignUp();
      else if (authMode === 'forgot') await authForgotPassword();
      else if (authMode === 'reset') await authResetPassword();
    }
    window.authSubmit = authSubmit;

    async function snapshotLocalForUser(uid) {
      if (!uid) return;
      try {
        localStorage.setItem(userStorageKey('snapshot', uid), JSON.stringify(getDataPayload()));
      } catch (e) { /* quota */ }
    }

    async function clearWorkspace() {
      clearTimeout(cloudPushTimer);
      cards = [];
      customGroups = [];
      await saveCardsToDB([]);
      localStorage.removeItem('promptrepo_groups');
      localStorage.removeItem('promptrepo_fields');
    }

    async function loadLocalSnapshotForUser(uid) {
      const raw = localStorage.getItem(userStorageKey('snapshot', uid));
      if (!raw) return false;
      try {
        applyDataPayload(JSON.parse(raw));
        await saveCardsToDB(cards);
        return true;
      } catch (e) {
        return false;
      }
    }

    async function authSignOut() {
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (uid) await snapshotLocalForUser(uid);
        clearTimeout(cloudPushTimer);
        await window.SupabaseSync.signOut();
        window.PointsSystem?.resetServerCreditsState?.();
        activeAccountId = null;
        cloudHydratedUid = null;
        await clearWorkspace();
        updateAuthUI(null);
        updateTagFilter();
        buildFilterMenu();
        syncFilterBtnState();
        renderGroups();
        renderCards(true);
        createNewCard({ silentMobile: true });
        showToast('已退出登录');
      } catch (e) {
        showToast('退出失败');
      }
    }
    window.authSignIn = authSignIn;
    window.authSignUp = authSignUp;
    window.authSignOut = authSignOut;

    document.getElementById('authOverlay')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.getElementById('authOverlay')?.classList.contains('open')) {
        e.preventDefault();
        authSubmit();
      }
    });

    async function pullFromCloud() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return false;
      const prevTombstones = { ...(settings.deletedCardTombstones || {}) };
      const cloud = await window.SupabaseSync.pullCloudData();
      if (cloud != null && typeof cloud === 'object') {
        const localCards = filterTombstonedCards(cards.slice());
        if ((!cloud.cards || cloud.cards.length === 0) && localCards.length > 0) {
          cloud.cards = localCards;
        } else if (cloud.cards?.length) {
          cloud.cards = localCards.length
            ? mergeCardsByUpdatedAt(localCards, cloud.cards)
            : filterTombstonedCards(cloud.cards);
        }
        if (cloud.settings && typeof cloud.settings === 'object') {
          cloud.settings.deletedCardTombstones = mergeDeletedCardTombstones(
            prevTombstones,
            cloud.settings.deletedCardTombstones
          );
        } else {
          cloud.settings = { ...(cloud.settings || {}), deletedCardTombstones: prevTombstones };
        }
        applyDataPayload(cloud);
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
        await saveAllData({ skipCloud: true });
        return true;
      }
      return false;
    }

    function formatSyncError(e) {
      return window.SupabaseSync?.formatError?.(e) || e?.message || '请稍后重试';
    }

    async function pushToCloud(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.() || cloudSyncing) return { ok: true };
      cloudSyncing = true;
      const status = document.getElementById('statusMsg');
      try {
        const payload = getDataPayload();
        const hasBase64 = payload.cards?.some(c => window.SupabaseSync.isDataUrl(c.image));
        if (hasBase64 && status) status.textContent = '正在上传图片到云端…';
        const result = await window.SupabaseSync.pushCloudData(payload, {
          skipSafety: opts.skipSafety === true,
          allowWithoutCloudCheck: opts.allowWithoutCloudCheck === true
        });
        if (Array.isArray(payload.cards)) cards = payload.cards;
        await saveAllData({ skipCloud: true });
        if (result?.warnings?.length) {
          showToast('文字已同步；图片未上传：' + result.warnings[0]);
          return { ok: true, warnings: result.warnings };
        }
        return { ok: true };
      } finally {
        cloudSyncing = false;
        if (status && !status.textContent.startsWith('❌')) status.textContent = '';
      }
    }

    function scheduleCloudPush() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      clearTimeout(cloudPushTimer);
      cloudPushTimer = setTimeout(() => {
        pushToCloud().catch((e) => showToast('云端同步失败：' + formatSyncError(e)));
      }, 1500);
    }
    window.scheduleCloudPush = scheduleCloudPush;

    async function hydrateWorkspaceFromLocal(uid) {
      const hadSnapshot = await loadLocalSnapshotForUser(uid);
      if (!hadSnapshot) {
        cards = await loadCardsFromDB();
      }
      try {
        const g = localStorage.getItem(userStorageKey('groups', uid)) || localStorage.getItem('promptrepo_groups');
        if (g) customGroups = JSON.parse(g);
      } catch (e) { customGroups = []; }
      try {
        const f = localStorage.getItem(userStorageKey('fields', uid)) || localStorage.getItem('promptrepo_fields');
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem(userStorageKey('settings', uid)) || localStorage.getItem('promptrepo_settings');
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      normalizeCardPins();
      return hadSnapshot || cards.length > 0;
    }

    async function handleCloudAfterLogin(opts = {}) {
      const silent = opts.silent === true;
      const force = opts.force === true;
      const uid = window.SupabaseSync?.getUserId?.();
      if (!uid) return;

      let syncPromise = Promise.resolve();
      if (window.PromptHubApi?.isConfigured?.()) {
        syncPromise = window.PromptHubApi.syncMe({ silent });
      } else if (window.SupabaseSync?.isLoggedIn?.()) {
        window.SubscriptionUI?.refreshOfferUI?.();
      }

      if (!force && cloudHydratedUid === uid && cards.length > 0) {
        activeAccountId = uid;
        try {
          await Promise.race([syncPromise, new Promise(r => setTimeout(r, 6000))]);
        } catch (e) { /* ignore */ }
        refreshWarehouseUI({ softCards: true });
        return;
      }

      const prevUid = activeAccountId;
      if (prevUid && prevUid !== uid) {
        try {
          await snapshotLocalForUser(prevUid);
        } catch (e) { /* ignore */ }
      }

      const guestPayload = opts.migrateGuest ? JSON.parse(JSON.stringify(getDataPayload())) : null;
      const uidChanged = prevUid && prevUid !== uid;
      activeAccountId = uid;
      window.Membership?.onAccountSwitch?.();
      clearTimeout(cloudPushTimer);

      let loaded = false;
      if (!uidChanged && !force) {
        await hydrateWorkspaceFromLocal(uid);
      }

      if (cloudHydratedUid !== uid || uidChanged || force || opts.migrateGuest) {
        try {
          loaded = await pullFromCloud();
        } catch (e) {
          if (!silent && !cards.length) showToast('拉取云端数据失败，已保留本地数据');
        }
      }

      if (uidChanged || force) {
        if (!loaded) await clearWorkspace();
      }

      if (!loaded && !cards.length) {
        const hadSnapshot = await loadLocalSnapshotForUser(uid);
        if (!hadSnapshot && guestPayload?.cards?.length) {
          applyDataPayload(guestPayload);
          await saveCardsToDB(cards);
          try {
            await pushToCloud();
            if (!silent) showToast(`已将 ${guestPayload.cards.length} 张本地卡片同步到云端`);
          } catch (e) {
            if (!silent) showToast('本地卡片已恢复，云端同步失败：' + formatSyncError(e));
          }
        } else if (hadSnapshot && (cards.length > 0 || customGroups.length > 0)) {
          try {
            await pushToCloud();
            if (!silent) showToast('已恢复本账号本地备份并同步到云端');
          } catch (e) {
            if (!silent) showToast('本地已恢复，云端同步失败：' + formatSyncError(e));
          }
        } else if (!silent && !uidChanged && !cloudHydratedUid) {
          showToast('新账号空白开始（不会导入其他账号的数据）');
        }
      } else if (loaded) {
        await snapshotLocalForUser(uid);
        if (!silent && (!cloudHydratedUid || uidChanged || force)) {
          showToast('已从云端加载本账号数据');
        }
      } else if (cards.length && !silent && (!cloudHydratedUid || uidChanged)) {
        await snapshotLocalForUser(uid);
      }

      cloudHydratedUid = uid;
      window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      try {
        await Promise.race([syncPromise, new Promise(r => setTimeout(r, 6000))]);
      } catch (e) { /* ignore */ }
      refreshWarehouseUI({ softCards: silent && !uidChanged && !force });
    }

    function isMobileViewport() {
      return window.MobileUI?.isMobileViewport?.() || window.matchMedia('(max-width: 900px)').matches;
    }

    function refreshWarehouseUI(opts = {}) {
      const soft = opts.softCards === true;
      updateTagFilter();
      buildFilterMenu();
      syncFilterBtnState();
      renderGroups();
      if (soft && document.getElementById('pageWarehouse')?.classList.contains('active')) {
        requestAnimationFrame(() => {
          if (isMobileViewport()) enforceMobileCardGrid();
          else if (masonryInstance) masonryInstance.layout();
          else scheduleLayoutMasonry();
        });
      } else {
        renderCards(true);
      }
      updateGuestLimitUI();
      if (isMobileViewport()) {
        if (typeof closeEditPanel === 'function') closeEditPanel();
        isNewCardMode = false;
      } else if (!selectedCardId && isNewCardMode) {
        createNewCard();
      }
      applyFloatingState();
    }

    function copyCardPromptById(cardId) {
      const card = cards.find(c => c.id === cardId);
      const text = (card?.prompt || '').trim();
      if (!text) {
        showToast('暂无提示词');
        return;
      }
      navigator.clipboard.writeText(text).then(() => showToast('已复制提示词'));
    }

    function fillCardToImageGen(cardId) {
      const card = cards.find(c => c.id === cardId);
      if (!card?.prompt) {
        showToast('暂无提示词');
        return;
      }
      if (typeof switchAppPage === 'function') switchAppPage('imagegen');
      window.FeatureDraft?.fillFormPromptOnly?.(card.prompt);
      window.MobileUI?.setImageGenView?.('form');
    }
    window.copyCardPromptById = copyCardPromptById;
    window.fillCardToImageGen = fillCardToImageGen;

    async function syncCloudNow() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return;
      }
      const btn = document.getElementById('authSyncBtn');
      if (btn) btn.disabled = true;
      try {
        const result = await pushToCloud();
        if (result?.warnings?.length) {
          showToast('已同步文字；图片问题：' + result.warnings[0]);
        } else {
          showToast('已同步到云端');
        }
      } catch (e) {
        showToast('同步失败：' + formatSyncError(e));
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    window.syncCloudNow = syncCloudNow;

    async function initSupabaseAuth() {
      if (!window.SupabaseSync?.isConfigured?.()) {
        updateAuthUI(null);
        return;
      }
      await window.SupabaseSync.init(async (session, event) => {
        updateAuthUI(session);
        if (event === 'PASSWORD_RECOVERY') {
          openAuthModal('reset');
        }
        if (session?.user) {
          if (event === 'SIGNED_IN') {
            await handleCloudAfterLogin({ silent: false, migrateGuest: true });
          } else if (event === 'INITIAL_SESSION') {
            await handleCloudAfterLogin({ silent: true });
          }
        } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        activeAccountId = null;
        cloudHydratedUid = null;
        window.SubscriptionUI?.resetFirstOfferServerState?.();
        window.Membership?.onAccountSwitch?.();
        await clearWorkspace();
          await loadGuestWorkspace();
          renderGroups();
          renderCards(true);
          updateGuestLimitUI();
          createNewCard({ silentMobile: true });
        }
      });
    }

    async function loadGuestWorkspace() {
      cards = await loadCardsFromDB();
      try {
        const g = localStorage.getItem('promptrepo_groups');
        if (g) customGroups = JSON.parse(g);
      } catch (e) { customGroups = []; }
      try {
        const f = localStorage.getItem('promptrepo_fields');
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem('promptrepo_settings');
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      floatingPromptActive = settings.floatingPrompt === true;
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      normalizeCardPins();
    }

    (async function init() {
      await openDB();
      cards = [];
      customGroups = [];
      globalFields = [];
      settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true }, {});
      floatingPromptActive = false;
      initFilterMenu();
      initAppNav();
      initAppNavCollapse();
      initBackgroundEffect();
      if (window.location.hash.includes('type=recovery') && window.SupabaseSync?.isConfigured?.()) {
        setTimeout(() => openAuthModal('reset'), 400);
      }
      await initSupabaseAuth();
      refreshAuthMethodUI();
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        await loadGuestWorkspace();
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
        renderGroups();
        renderCards(true);
        updateGuestLimitUI();
        createNewCard({ silentMobile: true });
      }
      applyFloatingState();
      if (typeof ResizeObserver !== 'undefined') {
        let masonryResizeTimer = null;
        const onWarehouseResize = () => {
          if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return;
          clearTimeout(masonryResizeTimer);
          masonryResizeTimer = setTimeout(() => scheduleLayoutMasonry(), 80);
        };
        const masonryResizeObs = new ResizeObserver(onWarehouseResize);
        const mainArea = document.getElementById('mainContentArea');
        const editPanelEl = document.getElementById('editPanel');
        if (mainArea) masonryResizeObs.observe(mainArea);
        if (editPanelEl) masonryResizeObs.observe(editPanelEl);
      }
    })();

    window.__promptHubCards = cards;

    async function saveAllData(opts = {}) {
      window.__promptHubCards = cards;
      window.persistPromptHubCards = async () => {
        await saveAllData();
        renderGroups();
        renderCards(true);
      };
      cards = filterTombstonedCards(cards);
      await saveCardsToDB(cards);
      settings.floatingPrompt = floatingPromptActive;
      if (typeof window.getAppTheme === 'function') settings.theme = window.getAppTheme();
      try {
        const stored = JSON.parse(localStorage.getItem('promptrepo_settings') || '{}');
        if ('themeManualOverride' in stored) settings.themeManualOverride = stored.themeManualOverride;
        if ('autoDayNight' in stored) settings.autoDayNight = stored.autoDayNight;
        if (stored.deletedCardTombstones) {
          settings.deletedCardTombstones = mergeDeletedCardTombstones(
            stored.deletedCardTombstones,
            settings.deletedCardTombstones
          );
        }
      } catch (e) { /* ignore */ }
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      if (uid) {
        await snapshotLocalForUser(uid);
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      }
      localStorage.setItem('promptrepo_groups', JSON.stringify(customGroups));
      localStorage.setItem('promptrepo_fields', JSON.stringify(globalFields));
      localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
      if (fileHandle) { try { const w = await fileHandle.createWritable(); await w.write(JSON.stringify({cards,customGroups,globalFields,settings})); await w.close(); } catch(e) {} }
      if (!opts.skipCloud) scheduleCloudPush();
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
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
      if (diff < 86400000) return `大约 ${Math.floor(diff / 3600000)} 小时前`;
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
      return (card.title || '').trim();
    }

    function cardHasDisplayImage(card) {
      const image = card?.image;
      if (!image || typeof image !== 'string') return false;
      if (window.FeatureDraft?.isDisplayableImage) return window.FeatureDraft.isDisplayableImage(image);
      return true;
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

    async function renderCards(reset = false) {
      if (reset) {
        page = 1; allFilteredCards = [];
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
        document.getElementById('cardsContainer').innerHTML = isMobileViewport()
          ? ''
          : '<div class="grid-sizer"></div>';
      }
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      const mobileGrid = isMobileViewport();
      container.className = 'cards-container' + (mobileGrid ? ' mobile-grid' : '');
      if (viewMode === 'list') {
        container.classList.add('list-view');
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
      }
      if (batchMode) container.classList.add('batch-mode');
      const searchEl = document.getElementById('searchInputMobile') || document.getElementById('searchInput');
      const search = (searchEl?.value || '').toLowerCase();
      sortMode = document.getElementById('sortSelect').value;
      if (reset || allFilteredCards.length === 0) {
        let filtered = [...cards];
        if (currentGroup === 'uncategorized') filtered = filtered.filter(c => !c.group);
        else if (currentGroup !== 'all') filtered = filtered.filter(c => c.group === currentGroup);
        if (search) filtered = filtered.filter(c => (c.title?.toLowerCase().includes(search)) || (c.prompt || '').toLowerCase().includes(search) || (c.tags?.some(t => t.toLowerCase().includes(search))));
        if (activeFilters.size > 0) filtered = filtered.filter(cardMatchesFilters);
        allFilteredCards = sortCardsWithPins(filtered);
      }
      const start = (page - 1) * PER_PAGE;
      const pageCards = allFilteredCards.slice(start, start + PER_PAGE);
      if (page === 1 && pageCards.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:60px;">📦 暂无卡片</div>';
        return;
      }
      const pageImages = pageCards.map(c => c.image).filter(Boolean);
      const prefetchLimit = mobileGrid ? 12 : 28;
      const prefetchPromise = window.SupabaseSync?.prefetchDisplayUrls
        ? window.SupabaseSync.prefetchDisplayUrls(pageImages.slice(0, prefetchLimit))
        : Promise.resolve();
      const fragment = document.createDocumentFragment();
      const isAppend = !reset && page > 1;
      pageCards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = `card card-enter ${card.id === selectedCardId ? 'selected' : ''}${card.pinnedAt ? ' is-pinned' : ''}`;
        if (!mobileGrid) div.style.animationDelay = `${Math.min((isAppend ? idx : idx) * 0.045, 0.36)}s`;
        div.dataset.id = card.id;
        div.draggable = !globalViewActive;
        const checked = selectedCardIds.has(card.id);
        const showImage = cardHasDisplayImage(card);
        const imgSrc = showImage ? cardImgInitialSrc(card.image) : '';
        const imgLoading = showImage && imgSrc.startsWith('data:image/svg');
        const titleTrim = getCardDisplayTitle(card);
        const timeLabel = formatCardTime(card.updatedAt || card.createdAt);
        const tagsHtml = buildCardTagsHtml(card.tags);
        const pinBadge = card.pinnedAt ? '<span class="card-pin-badge" title="置顶">置顶</span>' : '';
        const imgOnload = mobileGrid
          ? "if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'))"
          : "if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'));if(typeof scheduleLayoutMasonry==='function')scheduleLayoutMasonry()";
        const mediaHtml = showImage
          ? `<div class="card-media${imgLoading ? ' is-loading' : ''}"${imgLoading ? ` data-shine-at="${Date.now()}"` : ''}><img class="card-img" src="${escapeHtml(imgSrc)}"${cardImgDataAttr(card.image)} data-image-ref="${escapeHtml(card.image)}" loading="lazy" draggable="false" alt="" onload="${imgOnload}"></div>`
          : '';
        const headHtml = titleTrim
          ? `<div class="card-head"><div class="card-title">${escapeHtml(titleTrim)}</div>${timeLabel ? `<time class="card-time">${escapeHtml(timeLabel)}</time>` : ''}</div>`
          : (timeLabel ? `<div class="card-head card-head--meta-only"><time class="card-time">${escapeHtml(timeLabel)}</time></div>` : '');
        const mobileActions = window.MobileUI?.isMobile?.()
          ? `<div class="card-mobile-actions mobile-only">
              <button type="button" class="card-mobile-btn" data-mobile-copy="${escapeHtml(card.id)}">复制</button>
              <button type="button" class="card-mobile-btn" data-mobile-fill="${escapeHtml(card.id)}">填入生图</button>
            </div>`
          : '';
        div.innerHTML = `
          <div class="card-checkbox ${checked ? 'checked' : ''}" onclick="event.stopPropagation(); toggleSelectCard('${card.id}', this)"></div>
          ${pinBadge}
          ${mediaHtml}
          <div class="card-body">
            ${headHtml}
            <div class="card-desc">${escapeHtml(getCardDisplayDesc(card))}</div>
            ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
            ${mobileActions}
          </div>`;
        div.addEventListener('click', (e) => {
          if (e.target.closest('.card-mobile-actions')) return;
          if (globalViewActive) {
            e.preventDefault();
            openAppreciateViewer(card.id);
            return;
          }
          if (e.target.closest('.card-checkbox')) return;
          if (batchMode) { const cb = div.querySelector('.card-checkbox'); toggleSelectCard(card.id, cb); }
          else if (window.MobileUI?.isMobile?.()) {
            /* 手机端点卡片不打开全屏编辑，用底部按钮操作 */
          } else {
            editCard(card.id);
          }
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
            else if (settings.imageClickZoom) {
              void (window.SupabaseSync?.resolveDisplayUrl
                ? window.SupabaseSync.resolveDisplayUrl(card.image).then(openLightbox)
                : Promise.resolve(openLightbox(card.image)));
            }
            else if (isMobileViewport()) {
              void (window.SupabaseSync?.resolveDisplayUrl
                ? window.SupabaseSync.resolveDisplayUrl(card.image).then(url => { if (url) openLightbox(url); })
                : Promise.resolve(openLightbox(card.image)));
            }
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
          const pinLabel = card.pinnedAt ? '取消置顶' : '置顶';
          showContextMenu(e.clientX, e.clientY, [
            { label: pinLabel, action: () => toggleCardPinById(card.id) },
            { label: '删除', action: () => deleteCardPermanently(card.id) }
          ]);
        });
        fragment.appendChild(div);
      });
      container.appendChild(fragment);
      const afterImages = () => {
        if (!mobileGrid && viewMode !== 'list') scheduleLayoutMasonry();
        else if (mobileGrid) enforceMobileCardGrid();
      };
      if (!mobileGrid && viewMode !== 'list') scheduleLayoutMasonry();
      void prefetchPromise.then(() => {
        if (window.SupabaseSync?.hydrateImageElements) {
          return window.SupabaseSync.hydrateImageElements(container);
        }
        if (window.FeatureDraft?.hydrateFeedImages) {
          return window.FeatureDraft.hydrateFeedImages(container);
        }
      }).then(afterImages).catch(afterImages);
      if (viewMode === 'list' && masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
      }
      updateBatchCountLabel();
      if (mobileGrid) {
        enforceMobileCardGrid();
        requestAnimationFrame(() => enforceMobileCardGrid());
      }
    }

    document.getElementById('cardsContainer')?.addEventListener('click', (e) => {
      const copyId = e.target.closest('[data-mobile-copy]')?.getAttribute('data-mobile-copy');
      if (copyId) {
        e.stopPropagation();
        copyCardPromptById(copyId);
        return;
      }
      const fillId = e.target.closest('[data-mobile-fill]')?.getAttribute('data-mobile-fill');
      if (fillId) {
        e.stopPropagation();
        fillCardToImageGen(fillId);
      }
    });

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
      const doDelete = async () => {
        const card = cards.find(c => c.id === id);
        if (card?.image && window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync.isStorageRef(card.image)) {
          try { await window.SupabaseSync.deleteCardImageByUrl(card.image); } catch (e) { /* ignore */ }
        }
        recordCardDeletion(id);
        window.FeatureDraft?.removeCommunityByCardId?.(id);
        cards = cards.filter(c => c.id !== id);
        await saveAllData();
        if (window.SupabaseSync?.isLoggedIn?.()) {
          try { await pushToCloud({ skipSafety: true }); } catch (e) { scheduleCloudPush(); }
        }
        renderGroups(); renderCards(true);
        if (selectedCardId === id) { selectedCardId = null; createNewCard({ silentMobile: true }); }
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
      openEditPanel();
      document.getElementById('panelTitle').textContent = '编辑卡片';
      const fillForm = () => {
        document.getElementById('cardTitle').value = card.title || '';
        document.getElementById('cardPrompt').value = card.prompt || '';
        document.getElementById('floatingPromptText').value = card.prompt || '';
        imageData = card.image || null; currentTags = [...(card.tags || [])]; tempCustomFields = [];
        currentCardCustomFields = card.customFields ? { ...card.customFields } : {};
        window.FeatureDraft?.setPublishCheckbox?.(card);
        renderTags(); renderCustomFields();
        updateDeleteClearButton();
        updatePinToggleUI();
        void updatePreview();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fillForm);
      else fillForm();
    }

    function createNewCard(opts) {
      const check = canGuestCreateCard();
      if (!check.ok) {
        promptLogin(check.msg);
        return;
      }
      selectedCardId = null; isNewCardMode = true;
      highlightSelectedCard(null);
      document.getElementById('panelTitle').textContent = '新建卡片';
      document.getElementById('cardTitle').value = '';
      document.getElementById('cardPrompt').value = '';
      document.getElementById('floatingPromptText').value = '';
      imageData = null; currentTags = []; tempCustomFields = [];
      currentCardCustomFields = {};
      window.FeatureDraft?.setPublishCheckbox?.(null);
      renderTags(); renderCustomFields(); updatePreview();
      updateDeleteClearButton();
      updatePinToggleUI();
      const mobile = isMobileViewport();
      const shouldOpenPanel = !mobile || opts?.forceOpenPanel === true;
      if (shouldOpenPanel && !(mobile && opts?.silentMobile)) openEditPanel();
    }

    const TRASH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    function updateDeleteClearButton() {
      const btn = document.getElementById('actionDeleteClearBtn');
      const mobileTop = document.getElementById('actionDeleteClearBtnMobileTop');
      const targets = [btn, mobileTop].filter(Boolean);
      if (!targets.length) return;
      if (isNewCardMode) {
        targets.forEach(el => {
          el.style.display = 'inline-flex';
          el.title = '清空表单';
          el.className = el.id === 'actionDeleteClearBtnMobileTop' ? 'btn-icon-muted mobile-only' : 'btn-icon-muted desktop-only';
          el.innerHTML = '✕';
          el.onclick = () => clearCardForm();
        });
      } else {
        if (mobileTop) mobileTop.style.display = 'none';
        if (!btn) return;
        btn.style.display = 'inline-flex';
        btn.title = '删除卡片';
        btn.className = 'btn-icon-danger desktop-only';
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
      html += `<div class="panel-temp-field-row">
        <input type="text" id="tempFieldName" placeholder="字段名">
        <div class="panel-temp-field-actions">
          <select id="tempFieldType"><option value="text">文本</option><option value="textarea">多行文本</option></select>
          <label class="custom-checkbox panel-temp-fixed-label"><input type="checkbox" id="tempFieldFixed"><span class="checkmark"></span><span class="custom-checkbox-text">固定</span></label>
          <button type="button" class="btn btn-secondary panel-temp-add-btn" onclick="addTempField()" aria-label="添加字段">+</button>
        </div>
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

    async function updatePreview() {
      const img = document.getElementById('previewImage'), p = document.getElementById('dropPlaceholder');
      const removeBtn = document.getElementById('removeImageBtn'), dropArea = document.getElementById('dropArea');
      if (imageData) {
        let src = cardImgInitialSrc(imageData);
        if (src.startsWith('data:image/svg') && window.SupabaseSync?.safeImgSrc) {
          const safe = window.SupabaseSync.safeImgSrc(imageData);
          if (safe && !safe.startsWith('data:image/svg')) src = safe;
        }
        img.src = src;
        img.style.display = 'block';
        p.style.display = 'none';
        removeBtn.style.display = 'flex';
        dropArea.classList.add('has-image');
        dropArea.classList.remove('no-image');
        if (window.SupabaseSync?.resolveDisplayUrl && window.SupabaseSync?.isStorageRef?.(imageData)) {
          const url = await window.SupabaseSync.resolveDisplayUrl(imageData);
          if (url && url !== img.src) img.src = url;
        }
      } else {
        img.style.display = 'none';
        p.style.display = 'block';
        removeBtn.style.display = 'none';
        dropArea.classList.add('no-image');
        dropArea.classList.remove('has-image');
      }
    }

    async function removeImage() {
      const prev = imageData;
      imageData = null;
      updatePreview();
      if (prev && window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync.isStorageRef(prev)) {
        try { await window.SupabaseSync.deleteCardImageByUrl(prev); } catch (e) { /* ignore */ }
      }
    }
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
      const statusEl = document.getElementById('statusMsg');
      if (!prompt) { statusEl.textContent = '❌ 提示词不能为空'; return; }
      if (isNewCardMode) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          statusEl.textContent = '❌ ' + check.msg;
          promptLogin(check.msg);
          return;
        }
      }
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
      let cardId = selectedCardId;
      let previousImage = null;
      if (!isNewCardMode && cardId) {
        previousImage = cards.find(c => c.id === cardId)?.image || null;
      } else {
        cardId = generateId();
      }
      let finalImage = imageData;
      try {
        if (window.SupabaseSync?.isLoggedIn?.()) {
          if (imageData && !window.SupabaseSync.isStorageRef(imageData)) {
            statusEl.textContent = '上传图片中…';
          }
          finalImage = await window.SupabaseSync.resolveCardImageForSave(cardId, imageData, previousImage);
        }
      } catch (e) {
        statusEl.textContent = '❌ ' + (e.message || '图片上传失败');
        return;
      }
      imageData = finalImage;
      if (finalImage && window.SupabaseSync?.prefetchDisplayUrls) {
        await window.SupabaseSync.prefetchDisplayUrls([finalImage]);
      }
      const wantPublish = window.FeatureDraft?.readPublishCheckbox?.() ?? false;
      if (wantPublish && !isUserLoggedIn()) {
        statusEl.textContent = '❌ 发布到社区需先登录';
        requireAuth('publish');
        return;
      }
      let savedCard;
      if (!isNewCardMode && selectedCardId) {
        const card = cards.find(c => c.id === selectedCardId);
        if (card) {
          card.title = title;
          card.prompt = prompt;
          card.image = finalImage;
          card.tags = [...currentTags];
          card.customFields = customData;
          card.updatedAt = Date.now();
          savedCard = card;
        }
      } else {
        savedCard = {
          id: cardId, title, prompt, image: finalImage,
          group: (currentGroup !== 'all' && currentGroup !== 'uncategorized') ? currentGroup : null,
          tags: [...currentTags], customFields: customData,
          createdAt: Date.now(), updatedAt: Date.now()
        };
        cards.push(savedCard);
        selectedCardId = null;
        clearCardForm();
      }
      if (savedCard && window.FeatureDraft?.syncCardToCommunity) {
        window.FeatureDraft.syncCardToCommunity(savedCard, wantPublish);
      }
      window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      await saveAllData();
      updateTagFilter();
      renderGroups();
      renderCards(true);
      updateGuestLimitUI();
      statusEl.textContent = '';
      showToast('保存成功！');
    }

    function copyCardPrompt(id) { const c = cards.find(x => x.id === id); if (c && c.prompt) { navigator.clipboard.writeText(c.prompt); showToast('提示词已复制'); } }
    function closeEditPanel() {
      document.getElementById('editPanel').classList.add('hidden');
      document.getElementById('fabNewBtn').classList.add('visible');
      document.body.classList.remove('panel-open');
      scheduleLayoutMasonry();
    }
    window.closeEditPanel = closeEditPanel;
    function openEditPanel() {
      if (globalViewActive) forceExitGlobalView(true);
      window.MobileUI?.closeDrawers?.();
      document.getElementById('editPanel').classList.remove('hidden');
      document.getElementById('fabNewBtn').classList.remove('visible');
      document.body.classList.add('panel-open');
      requestAnimationFrame(() => {
        scheduleLayoutMasonry();
        setTimeout(scheduleLayoutMasonry, 360);
      });
    }

    function openLightbox(src) {
      if (!src || typeof src !== 'string') return;
      const lightbox = document.getElementById('imageLightbox');
      const img = document.getElementById('lightboxImage');
      if (!lightbox || !img) return;
      let shown = false;
      const onReady = () => {
        if (shown) return;
        shown = true;
        img.onload = null;
        img.onerror = null;
        resetImageZoom(img);
        attachImageZoom(img);
        lightbox.classList.add('active');
      };
      lightbox.classList.remove('active');
      img.onwheel = null;
      img.onmousedown = null;
      img.ondblclick = null;
      img.removeAttribute('src');
      const displaySrc = src;
      if (img.src === displaySrc && img.complete && img.naturalWidth > 0) {
        onReady();
        return;
      }
      img.onerror = () => {
        img.onerror = null;
        img.onload = null;
        lightbox.classList.remove('active');
      };
      img.onload = onReady;
      img.src = displaySrc;
      if (img.complete && img.naturalWidth > 0) onReady();
    }
    window.openLightbox = openLightbox;
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
      const lightbox = document.getElementById('imageLightbox');
      lightbox?.classList.remove('active');
      const img = document.getElementById('lightboxImage');
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
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

    function onOcrEngineChange() {
      const engine = document.getElementById('ocrEngineSelect')?.value;
      document.getElementById('ocrApiKeyWrap')?.classList.toggle('hidden', engine !== 'ocrspace');
    }
    window.onOcrEngineChange = onOcrEngineChange;

    function openAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.add('active');
      const autoDay = document.getElementById('autoDayNightToggle');
      if (autoDay) autoDay.checked = settings.autoDayNight !== false;
      const imgPub = document.getElementById('defaultImageGenAutoPublishToggle');
      if (imgPub) imgPub.checked = settings.defaultImageGenAutoPublish !== false;
      const imgSave = document.getElementById('defaultImageGenAutoSaveToggle');
      if (imgSave) imgSave.checked = settings.defaultImageGenAutoSaveWarehouse !== false;
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '';
    }
    function closeAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.remove('active');
    }
    function saveAppSettings() {
      const autoEl = document.getElementById('autoDayNightToggle');
      const autoOn = autoEl ? autoEl.checked : true;
      const imgPubEl = document.getElementById('defaultImageGenAutoPublishToggle');
      settings.defaultImageGenAutoPublish = imgPubEl ? imgPubEl.checked : true;
      const imgSaveEl = document.getElementById('defaultImageGenAutoSaveToggle');
      settings.defaultImageGenAutoSaveWarehouse = imgSaveEl ? imgSaveEl.checked : true;
      const wasAuto = settings.autoDayNight !== false;
      settings.autoDayNight = autoOn;
      if (autoOn && !wasAuto) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.clearThemeManualOverride?.();
      } else if (autoOn) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      }
      saveAllData();
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '已保存';
      showToast('全局设置已保存');
      setTimeout(() => { if (status) status.textContent = ''; }, 2000);
    }
    window.openAppSettings = openAppSettings;
    window.closeAppSettings = closeAppSettings;
    window.saveAppSettings = saveAppSettings;

    function openWarehouseSettings() {
      document.getElementById('settingsOverlay')?.classList.add('active');
      document.getElementById('ocrEngineSelect').value = settings.engine || 'tesseract';
      document.getElementById('ocrApiKey').value = settings.apiKey || '';
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      if (pubToggle) pubToggle.checked = settings.defaultPublishCommunity !== false;
      window.PointsSystem?.updateCreditsUI?.();
      document.getElementById('settingsStatus').textContent = '';
      onOcrEngineChange();
      renderFieldList();
    }
    function closeWarehouseSettings() {
      document.getElementById('settingsOverlay')?.classList.remove('active');
    }
    window.openWarehouseSettings = openWarehouseSettings;
    window.closeWarehouseSettings = closeWarehouseSettings;
    window.openSettings = openWarehouseSettings;
    window.closeSettings = closeWarehouseSettings;

    function saveSettings() {
      settings.engine = document.getElementById('ocrEngineSelect').value;
      settings.apiKey = document.getElementById('ocrApiKey').value.trim();
      settings.imageClickZoom = document.getElementById('imageClickZoomToggle').checked;
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      settings.defaultPublishCommunity = pubToggle ? pubToggle.checked : true;
      saveAllData();
      const status = document.getElementById('settingsStatus');
      if (status) status.textContent = '设置已保存';
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      renderCards(true);
      showToast('设置已保存');
    }
    window.saveSettings = saveSettings;

    function openHelpPanel() {
      document.getElementById('helpOverlay')?.classList.add('active');
    }
    function closeHelpPanel() {
      document.getElementById('helpOverlay')?.classList.remove('active');
    }
    function openFeedbackPanel() {
      document.getElementById('feedbackOverlay')?.classList.add('active');
      const ta = document.getElementById('feedbackText');
      if (ta) setTimeout(() => ta.focus(), 80);
    }
    function closeFeedbackPanel() {
      document.getElementById('feedbackOverlay')?.classList.remove('active');
    }
    function submitFeedback() {
      const text = (document.getElementById('feedbackText')?.value || '').trim();
      if (!text) {
        showToast('请先填写反馈内容');
        return;
      }
      const payload = `[提示词仓库反馈]\n${text}\n\n---\n${new Date().toLocaleString()}`;
      navigator.clipboard.writeText(payload).then(() => {
        showToast('反馈内容已复制，可粘贴发送给我们');
        closeFeedbackPanel();
      }).catch(() => showToast('复制失败，请手动复制'));
    }
    function openContactPanel() {
      document.getElementById('contactOverlay')?.classList.add('active');
    }
    function closeContactPanel() {
      document.getElementById('contactOverlay')?.classList.remove('active');
    }
    function copyWechatId() {
      const id = document.getElementById('contactWechatId')?.textContent?.trim() || 'bz4jx3jp2li1';
      navigator.clipboard.writeText(id).then(() => showToast('微信号已复制')).catch(() => showToast('复制失败'));
    }
    window.openHelpPanel = openHelpPanel;
    window.closeHelpPanel = closeHelpPanel;
    window.openFeedbackPanel = openFeedbackPanel;
    window.closeFeedbackPanel = closeFeedbackPanel;
    window.submitFeedback = submitFeedback;
    window.openContactPanel = openContactPanel;
    window.closeContactPanel = closeContactPanel;
    window.copyWechatId = copyWechatId;

    function addGlobalField() {
      const n = document.getElementById('newFieldName').value.trim();
      if (!n) { showToast('请输入字段名称'); return; }
      if (globalFields.some(f => f.name === n)) { showToast('字段名称已存在'); return; }
      globalFields.push({ id: generateId(), name: n, type: document.getElementById('newFieldType').value });
      saveAllData();
      document.getElementById('newFieldName').value = '';
      renderFieldList();
    }
    window.addGlobalField = addGlobalField;

    function renderFieldList() {
      const list = document.getElementById('fieldList');
      const empty = document.getElementById('fieldListEmpty');
      if (!list) return;
      const typeLabel = { text: '文本', textarea: '多行' };
      if (!globalFields.length) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }
      empty?.classList.add('hidden');
      list.innerHTML = globalFields.map(f => `
        <div class="settings-field-item">
          <span class="settings-field-item-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <span class="settings-field-item-type">${typeLabel[f.type] || f.type}</span>
          <button type="button" class="btn btn-ghost settings-field-item-del" onclick="deleteGlobalField('${escapeJsString(f.id)}')">删除</button>
        </div>
      `).join('');
    }

    function deleteGlobalField(id) {
      globalFields = globalFields.filter(f => f.id !== id);
      saveAllData();
      renderFieldList();
    }
    window.deleteGlobalField = deleteGlobalField;
    function backupFileName() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `prompt-hub-backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    }

    function exportBackup() {
      const payload = buildBackupPayload();
      const b = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = backupFileName();
      a.click();
      URL.revokeObjectURL(a.href);
      const status = document.getElementById('settingsStatus');
      if (status) status.textContent = `✅ 已导出 ${payload.cards.length} 张卡片`;
      showToast('备份已下载');
    }
    window.exportBackup = exportBackup;

    function importBackup(event) {
      const f = event.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = e => {
        try {
          const d = JSON.parse(e.target.result);
          if (!Array.isArray(d.cards)) {
            alert('无效的备份文件');
            return;
          }
          const when = d.exportedAt ? new Date(d.exportedAt).toLocaleString() : '未知时间';
          const msg = `将用备份（${when}，${d.cards.length} 张卡片）覆盖当前数据，确定恢复？`;
          if (!confirm(msg)) return;
          if (!applyBackupPayload(d)) {
            alert('恢复失败');
            return;
          }
          saveAllData();
          renderGroups();
          renderCards(true);
          createNewCard();
          const status = document.getElementById('settingsStatus');
          if (status) status.textContent = '✅ 备份已恢复';
          showToast('已恢复备份');
        } catch (err) {
          alert('无法读取备份文件');
        }
      };
      r.readAsText(f);
      event.target.value = '';
    }
    window.importBackup = importBackup;

    async function saveToFile() {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: backupFileName(),
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        fileHandle = h;
        const w = await h.createWritable();
        await w.write(JSON.stringify(buildBackupPayload(), null, 2));
        await w.close();
        document.getElementById('settingsStatus').textContent = '✅ 备份已保存到本地文件';
      } catch (e) {
        if (e.name !== 'AbortError') alert('保存失败');
      }
    }
    window.saveToFile = saveToFile;

    async function loadFromFile() {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        fileHandle = h;
        const f = await h.getFile();
        const d = JSON.parse(await f.text());
        if (!Array.isArray(d.cards)) {
          alert('无效的备份文件');
          return;
        }
        if (!confirm(`从文件恢复 ${d.cards.length} 张卡片，将覆盖当前数据，确定？`)) return;
        applyBackupPayload(d);
        await saveAllData();
        renderGroups();
        renderCards(true);
        createNewCard();
        document.getElementById('settingsStatus').textContent = '✅ 已从本地文件恢复';
      } catch (e) {
        if (e.name !== 'AbortError') alert('打开文件失败');
      }
    }
    window.loadFromFile = loadFromFile;

    function clearAllData() {
      customConfirm('确定清除所有本地卡片、分组与字段？此操作不可恢复，建议先备份导出。', () => {
        cards = [];
        customGroups = [];
        globalFields = [];
        saveAllData();
        renderGroups();
        renderCards(true);
        createNewCard();
        const status = document.getElementById('settingsStatus');
        if (status) status.textContent = '已清除本地数据';
      });
    }
    window.clearAllData = clearAllData;
    
    function escapeHtml(str) { return String(str).replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }
    function escapeJsString(str) { return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, ''); }
    window.escapeHtml = escapeHtml;
    window.escapeJsString = escapeJsString;
    

