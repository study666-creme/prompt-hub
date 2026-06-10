    /** mobile.js 未加载时的兜底（断点与 MobileUI 一致：900px） */
    (function ensureMobileUI() {
      if (typeof window.MobileUI?.isMobileViewport === 'function') return;
      const mq = window.matchMedia('(max-width: 900px)');
      window.MobileUI = Object.assign(window.MobileUI || {}, {
        isMobile: () => mq.matches,
        isMobileViewport: () => mq.matches,
        MOBILE_MQ: mq
      });
    })();

    // ---------- 数据库 ----------
    const DB_NAME = 'PromptRepoDB', DB_VERSION = 3;
    const EMERGENCY_BACKUP_MAX = 12;
    const LS_IDB_OWNER = 'promptrepo_idb_owner_uid';
    let db = null;
    let lastEmergencyBackupAt = 0;

    function getIdbOwnerUid() {
      try {
        return localStorage.getItem(LS_IDB_OWNER) || '';
      } catch (e) {
        return '';
      }
    }
    function setIdbOwnerUid(uid) {
      try {
        if (uid) localStorage.setItem(LS_IDB_OWNER, String(uid));
        else localStorage.removeItem(LS_IDB_OWNER);
      } catch (e) { /* ignore */ }
    }
    function currentIdbOwnerUid() {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      if (uid) return uid;
      return window.SupabaseSync?.isLoggedIn?.() ? '' : 'guest';
    }
    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('card_image_backups')) {
            db.createObjectStore('card_image_backups', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('data_backups')) {
            db.createObjectStore('data_backups', { keyPath: 'id' });
          }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e.target.error);
      });
    }

    async function pruneEmergencyBackups(store) {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result || []).sort((a, b) => (b.at || 0) - (a.at || 0));
          const drop = list.slice(EMERGENCY_BACKUP_MAX);
          drop.forEach((row) => store.delete(row.id));
          resolve();
        };
        req.onerror = () => resolve();
      });
    }

    async function writeEmergencyBackup(label, payloadOverride) {
      if (!db) await openDB();
      if (!db.objectStoreNames.contains('data_backups')) return;
      const payload = payloadOverride || getDataPayload();
      const cardsN = Array.isArray(payload.cards) ? payload.cards.length : 0;
      if (!cardsN && !payload.customGroups?.length) return;
      const ownerUid = window.SupabaseSync?.getUserId?.() || activeAccountId || getIdbOwnerUid() || '';
      const entry = {
        id: `${Date.now()}_${label}`,
        at: Date.now(),
        label: String(label || 'backup'),
        cardsCount: cardsN,
        ownerUid,
        payload: { ...payload, ownerUid }
      };
      return new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readwrite');
        const store = tx.objectStore('data_backups');
        store.put(entry);
        tx.oncomplete = () => {
          lastEmergencyBackupAt = entry.at;
          resolve();
          void (async () => {
            try {
              if (!db) await openDB();
              const tx2 = db.transaction(['data_backups'], 'readwrite');
              await pruneEmergencyBackups(tx2.objectStore('data_backups'));
            } catch (e) { /* ignore */ }
          })();
        };
        tx.onerror = () => resolve();
      });
    }
    window.writeEmergencyBackup = writeEmergencyBackup;
    async function loadCardsFromDB(opts = {}) {
      if (!db) await openDB();
      const rows = await new Promise(resolve => {
        const tx = db.transaction(['cards'], 'readonly');
        const req = tx.objectStore('cards').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      if (opts.ignoreOwner) return rows;
      const expected = opts.ownerUid != null ? String(opts.ownerUid || '') : (window.SupabaseSync?.getUserId?.() || activeAccountId || '');
      const idbOwner = getIdbOwnerUid();
      if (expected && idbOwner && idbOwner !== expected) return [];
      if (!expected && idbOwner && idbOwner !== 'guest') return [];
      return rows;
    }
    async function saveCardsToDB(cardsArray, opts = {}) {
      if (!db) await openDB();
      const ownerUid = opts.ownerUid != null
        ? String(opts.ownerUid || '')
        : (window.SupabaseSync?.getUserId?.() || activeAccountId || getIdbOwnerUid() || '');
      if (!cardsArray.length) {
        const existing = await loadCardsFromDB({ ignoreOwner: true });
        if (existing.length > 0) {
          await writeEmergencyBackup('pre_db_clear', {
            cards: existing,
            customGroups,
            globalFields,
            settings: { ...settings },
            ownerUid: getIdbOwnerUid() || ownerUid
          });
        }
      }
      const tx = db.transaction(['cards'], 'readwrite');
      const store = tx.objectStore('cards');
      store.clear();
      cardsArray.forEach(c => store.put(c));
      await new Promise(resolve => { tx.oncomplete = resolve; });
      if (ownerUid) setIdbOwnerUid(ownerUid);
      else if (!cardsArray.length) setIdbOwnerUid('');
    }

    async function saveCardImageBackup(cardId, imageData) {
      if (!cardId || !imageData) return;
      const ok = window.SupabaseSync?.isDataUrl?.(imageData)
        || (typeof imageData === 'string' && /^https?:\/\//i.test(imageData));
      if (!ok) return;
      if (!db) await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['card_image_backups'], 'readwrite');
        tx.objectStore('card_image_backups').put({ id: String(cardId), image: imageData, at: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function getCardImageBackup(cardId) {
      if (!cardId) return null;
      if (!db) await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(['card_image_backups'], 'readonly');
        const req = tx.objectStore('card_image_backups').get(String(cardId));
        req.onsuccess = () => resolve(req.result?.image || null);
        req.onerror = () => resolve(null);
      });
    }

    async function clearCardImageBackup(cardId) {
      if (!cardId || !db) return;
      return new Promise((resolve) => {
        const tx = db.transaction(['card_image_backups'], 'readwrite');
        tx.objectStore('card_image_backups').delete(String(cardId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    window.getCardImageBackup = getCardImageBackup;
    window.saveCardImageBackup = saveCardImageBackup;

    let cards = [], customGroups = [], globalFields = [], settings = { engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, autoPromptOcr: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, defaultImageGenAutoSaveWarehouse: true, communityNotificationsEnabled: true, communityNotifyBadge: true, autoDayNight: false, themeManualOverride: false, showTrimBlackBorderTool: false, preserveOriginalCardImage: false };
    let pendingUploadFile = null;
    let pendingUploadBytes = 0;
    let currentGroup = 'all', selectedCardId = null, isNewCardMode = false, imageData = null;
    let imageRemovalPending = false;
    let editPanelStashedDraft = null;
    let cardOriginalReuploadRequired = false;
    let mobileEditPanelHistory = false;
    let currentTags = [], tempCustomFields = [];
    let batchMode = false, selectedCardIds = new Set();
    let fileHandle = null, masonryInstance = null;
    let page = 1, allFilteredCards = [];
    const PER_PAGE = 24;
    const CARD_SORT_KEY = 'promptrepo_card_sort';
    let sortMode = 'updated-desc';
    try {
      const savedSort = localStorage.getItem(CARD_SORT_KEY);
      if (['default', 'created-desc', 'updated-desc', 'updated-asc', 'random'].includes(savedSort)) {
        sortMode = savedSort;
      }
    } catch (e) { /* ignore */ }
    let cardRandomSig = '';
    let cardRandomOrder = new Map();
    let floatingPromptActive = false;
    let currentCardCustomFields = {};
    let globalViewActive = false;
    let activeFilters = new Set();
    try {
      const savedFilters = JSON.parse(localStorage.getItem('promptrepo_filters') || '[]');
      if (Array.isArray(savedFilters)) activeFilters = new Set(savedFilters);
    } catch (e) { activeFilters = new Set(); }
    const GUEST_CARD_LIMIT = 10;

    let cardColumns = Number(localStorage.getItem('promptrepo_card_columns'));
    if (!Number.isFinite(cardColumns) || cardColumns < 1) cardColumns = 3;
    cardColumns = Math.min(5, Math.max(1, cardColumns));
    try {
      localStorage.setItem('promptrepo_card_columns', String(cardColumns));
      localStorage.setItem('promptrepo_card_columns_v4', '1');
    } catch (e) { /* ignore */ }

    let communityColumns = Number(localStorage.getItem('promptrepo_community_columns'));
    if (!Number.isFinite(communityColumns) || communityColumns < 1) communityColumns = 4;
    communityColumns = Math.min(5, Math.max(1, communityColumns));
    let myHomeColumns = Number(localStorage.getItem('promptrepo_myhome_columns'));
    if (!Number.isFinite(myHomeColumns) || myHomeColumns < 2) myHomeColumns = 3;
    myHomeColumns = Math.min(5, Math.max(2, myHomeColumns));
    try {
      localStorage.setItem('promptrepo_myhome_columns', String(myHomeColumns));
    } catch (e) { /* ignore */ }

    document.documentElement.style.setProperty('--card-columns', String(cardColumns));
    document.documentElement.style.setProperty('--community-columns', String(communityColumns));

    function isCommunityPageActive() {
      return document.getElementById('pageCommunity')?.classList.contains('active');
    }

    function runCardsLayoutTransition(applyChange) {
      const container = document.getElementById('cardsContainer');
      if (!container || isMobileViewport()) {
        applyChange();
        return;
      }
      container.classList.add('cards-view-transitioning');
      requestAnimationFrame(() => {
        container.classList.add('cards-view-fade-out');
        setTimeout(() => {
          applyChange();
          container.classList.remove('cards-view-fade-out');
          container.classList.add('cards-view-fade-in');
          requestAnimationFrame(() => {
            setTimeout(() => {
              container.classList.remove('cards-view-fade-in', 'cards-view-transitioning');
            }, 300);
          });
        }, 200);
      });
    }

    function setCardColumns(cols) {
      runCardsLayoutTransition(() => {
        cardColumns = Math.min(5, Math.max(1, cols));
        document.documentElement.style.setProperty('--card-columns', String(cardColumns));
        localStorage.setItem('promptrepo_card_columns', String(cardColumns));
        localStorage.setItem('promptrepo_card_columns_v4', '1');
        const container = document.getElementById('cardsContainer');
        if (container) container.scrollTop = 0;
        if (typeof renderCards === 'function') renderCards(true);
        if (document.getElementById('pageCreations')?.classList.contains('active')) {
          window.FeatureDraft?.scheduleLayout?.('creationsGrid', { force: true, immediate: true, recalcCols: true });
        }
      });
    }

    function setCommunityColumns(cols) {
      communityColumns = Math.min(5, Math.max(1, cols));
      document.documentElement.style.setProperty('--community-columns', String(communityColumns));
      localStorage.setItem('promptrepo_community_columns', String(communityColumns));
      const grid = document.getElementById('communityGrid');
      if (grid) grid.scrollTop = 0;
      window.FeatureDraft?.scheduleLayout?.('communityGrid', { force: true, immediate: true, recalcCols: true });
    }

    function toggleColumnUp() {
      if (isCommunityPageActive()) {
        if (communityColumns < 5) setCommunityColumns(communityColumns + 1);
      } else if (cardColumns < 5) {
        setCardColumns(cardColumns + 1);
      }
    }
    function toggleColumnDown() {
      if (isCommunityPageActive()) {
        if (communityColumns > 1) setCommunityColumns(communityColumns - 1);
      } else if (cardColumns > 1) {
        setCardColumns(cardColumns - 1);
      }
    }
    window.setCardColumns = setCardColumns;
    window.setCommunityColumns = setCommunityColumns;
    window.toggleColumnUp = toggleColumnUp;
    window.toggleColumnDown = toggleColumnDown;

    function restoreDesktopCardColumns() {
      if (isMobileViewport()) return;
      let cols = Number(localStorage.getItem('promptrepo_card_columns'));
      if (!Number.isFinite(cols) || cols < 1) cols = 3;
      cols = Math.min(5, Math.max(1, cols));
      cardColumns = cols;
      document.documentElement.style.setProperty('--card-columns', String(cols));
      let commCols = Number(localStorage.getItem('promptrepo_community_columns'));
      if (!Number.isFinite(commCols) || commCols < 1) commCols = 4;
      commCols = Math.min(5, Math.max(1, commCols));
      communityColumns = commCols;
      document.documentElement.style.setProperty('--community-columns', String(commCols));
      const container = document.getElementById('cardsContainer');
      container?.classList.remove('mobile-grid');
      layoutMasonryGrid();
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        window.FeatureDraft?.scheduleLayout?.('communityGrid', { force: true, immediate: true, recalcCols: true });
      }
      if (document.getElementById('pageCreations')?.classList.contains('active')) {
        window.FeatureDraft?.scheduleLayout?.('creationsGrid', { force: true, immediate: true, recalcCols: true });
      }
    }
    window.restoreDesktopCardColumns = restoreDesktopCardColumns;

    let imageZoom = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, img: null };

    window.__phQuickPreviewTask = window.__phQuickPreviewTask || {
      warehouseUsed: false,
      warehouseGotoGen: false,
      communityUsed: false,
      communityFavorited: false
    };

    function markQuickPreviewTask(patch) {
      if (!patch || typeof patch !== 'object') return;
      window.__phQuickPreviewTask = { ...window.__phQuickPreviewTask, ...patch };
      window.TrialTasks?.scheduleSyncTaskProgress?.();
    }
    window.markQuickPreviewTask = markQuickPreviewTask;

    let warehousePreviewCardId = null;

    function syncAppreciateViewerActions(mode) {
      const communityActs = document.getElementById('appreciateViewerActions');
      const warehouseActs = document.getElementById('appreciateViewerWarehouseActions');
      const isCommunity = mode === 'community';
      window.__appreciateViewerMode = mode || 'warehouse';
      communityActs?.classList.toggle('hidden', !isCommunity);
      warehouseActs?.classList.toggle('hidden', isCommunity);
    }

    function getAppreciateViewerFrame() {
      return document.getElementById('appreciateViewerFrame')
        || document.querySelector('#appreciateViewerMedia .viewer-image-frame');
    }

    function getLightboxFrame() {
      return document.getElementById('lightboxFrame');
    }

    /** 灯箱至少不比社区网格预览小（竖图按高度缩放时易缩成「小图」） */
    function getLightboxMinDisplaySize() {
      const grid = document.getElementById('communityGrid');
      const selected = grid?.querySelector('.community-post-card.selected');
      const media = selected?.querySelector('.card-media');
      if (media) {
        const r = media.getBoundingClientRect();
        if (r.width > 8 && r.height > 8) return { minW: r.width, minH: r.height };
      }
      const colRaw = grid && getComputedStyle(grid).getPropertyValue('--feed-col-width').trim();
      const colW = parseFloat(colRaw) || selected?.offsetWidth || 0;
      if (colW > 8) return { minW: colW, minH: colW * 1.25 };
      return { minW: 240, minH: 300 };
    }

    function fitLightboxDisplaySize(img) {
      if (!img?.naturalWidth || !img?.naturalHeight) return;
      const { minW, minH } = getLightboxMinDisplaySize();
      const maxW = Math.min(window.innerWidth * 0.96, 960);
      const maxH = window.innerHeight * 0.94 - 100;
      const ar = img.naturalWidth / img.naturalHeight;
      let w = maxW;
      let h = w / ar;
      if (h > maxH) {
        h = maxH;
        w = h * ar;
      }
      if (w < minW) {
        w = Math.min(minW, maxW);
        h = w / ar;
      }
      if (h < minH && h < maxH) {
        h = Math.min(minH, maxH);
        w = h * ar;
        if (w > maxW) {
          w = maxW;
          h = w / ar;
        }
      }
      img.style.width = `${Math.round(w)}px`;
      img.style.height = `${Math.round(h)}px`;
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.objectFit = 'contain';
    }

    function setViewerFrameLoading(frame, loading) {
      if (!frame) return;
      frame.classList.toggle('is-loading', !!loading);
      frame.classList.remove('viewer-glow-active');
      frame.querySelector('.viewer-image-shine-wrap')?.classList.remove('viewer-glow-active', 'media-shine-reveal', 'viewer-shine-active');
    }

    function finishViewerFrameReveal(frame) {
      if (!frame) return;
      frame.classList.remove('is-loading', 'viewer-glow-active');
      const shineWrap = frame.querySelector('.viewer-image-shine-wrap');
      if (!shineWrap) return;
      shineWrap.classList.remove('viewer-glow-active');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      shineWrap.classList.remove('media-shine-reveal');
      void shineWrap.offsetWidth;
      shineWrap.classList.add('media-shine-reveal');
      shineWrap.classList.add('viewer-shine-active');
    }

    function layoutViewerBorderSvg(frame) {
      const border = frame?.querySelector('.viewer-frame-border');
      const wrap = frame?.querySelector('.viewer-image-shine-wrap');
      const svg = border?.querySelector('.viewer-border-svg');
      if (!border || !wrap || !svg) return;
      const w = wrap.offsetWidth;
      const h = wrap.offsetHeight;
      if (w < 8 || h < 8) return;
      const pad = 1.5;
      const r = 12;
      const attrs = {
        x: pad,
        y: pad,
        width: Math.max(0, w - pad * 2),
        height: Math.max(0, h - pad * 2),
        rx: r,
        ry: r
      };
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      ['track', 'sweep'].forEach((kind) => {
        const rect = svg.querySelector(`.viewer-border-${kind}`);
        if (!rect) return;
        Object.entries(attrs).forEach(([key, val]) => rect.setAttribute(key, String(val)));
      });
      const sweep = svg.querySelector('.viewer-border-sweep');
      if (!sweep) return;
      const perimeter = 2 * (attrs.width + attrs.height - 4 * r) + 2 * Math.PI * r;
      const dashLen = Math.max(40, Math.min(110, perimeter * 0.07));
      sweep.style.strokeDasharray = `${dashLen} ${Math.max(perimeter, dashLen + 1)}`;
      sweep.style.strokeDashoffset = '0';
    }

    function applyViewerAdaptiveGlow(frame, img) {
      const border = frame?.querySelector('.viewer-frame-border');
      if (!border || !img?.naturalWidth) return;
      let r = 160;
      let g = 195;
      let b = 255;
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        const pick = (x, y) => {
          const i = (y * size + x) * 4;
          const a = data[i + 3];
          if (a < 24) return;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          n += 1;
        };
        for (let x = 0; x < size; x += 1) {
          pick(x, 0);
          pick(x, size - 1);
        }
        for (let y = 1; y < size - 1; y += 1) {
          pick(0, y);
          pick(size - 1, y);
        }
        if (n > 0) {
          r = Math.round(sr / n);
          g = Math.round(sg / n);
          b = Math.round(sb / n);
        }
      } catch (e) { /* CORS 或采样失败时用默认 */ }
      const mix = (c) => Math.min(255, Math.round(c * 0.72 + 255 * 0.28));
      border.style.setProperty('--viewer-edge-r', String(r));
      border.style.setProperty('--viewer-edge-g', String(g));
      border.style.setProperty('--viewer-edge-b', String(b));
      border.style.setProperty('--viewer-edge-light-r', String(mix(r)));
      border.style.setProperty('--viewer-edge-light-g', String(mix(g)));
      border.style.setProperty('--viewer-edge-light-b', String(mix(b)));
      frame.classList.add('viewer-edge-glow-ready');
      layoutViewerBorderSvg(frame);
    }
    window.applyViewerAdaptiveGlow = applyViewerAdaptiveGlow;
    window.layoutViewerBorderSvg = layoutViewerBorderSvg;

    function setAppreciateViewerLoading(loading) {
      setViewerFrameLoading(getAppreciateViewerFrame(), loading);
      document.getElementById('appreciateViewerMedia')?.classList.remove('media-shine-reveal', 'viewer-glow-active');
    }

    function finishAppreciateViewerReveal() {
      finishViewerFrameReveal(getAppreciateViewerFrame());
    }
    window.setAppreciateViewerLoading = setAppreciateViewerLoading;
    window.finishAppreciateViewerReveal = finishAppreciateViewerReveal;
    window.finishViewerFrameReveal = finishViewerFrameReveal;

    let viewerNav = { items: [], index: -1 };
    let viewerWheelNavAt = 0;
    const VIEWER_WHEEL_NAV_GAP_MS = 420;

    function setViewerNav(items, currentKey) {
      viewerNav.items = Array.isArray(items) ? items : [];
      viewerNav.index = viewerNav.items.findIndex((it) => it.key === currentKey);
    }

    function lightboxWheelNavEnabled() {
      return !!window.__lightboxImageGenNav || !!globalViewActive;
    }

    function navigateViewerByWheel(delta) {
      if (!viewerNav.items.length || viewerNav.index < 0) return false;
      const next = viewerNav.index + (delta > 0 ? 1 : -1);
      if (next < 0 || next >= viewerNav.items.length) return false;
      const item = viewerNav.items[next];
      viewerNav.index = next;
      if (item.type === 'card') {
        if (!globalViewActive) return false;
        void openAppreciateViewer(item.id);
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
      return false;
    }

    function navigateViewerByWheelThrottled(delta) {
      const now = performance.now();
      if (now - viewerWheelNavAt < VIEWER_WHEEL_NAV_GAP_MS) return false;
      if (!navigateViewerByWheel(delta)) return false;
      viewerWheelNavAt = now;
      return true;
    }

    function onViewerShellWheel(e) {
      const t = e.target;
      const onLightbox = !!t?.closest?.('#imageLightbox');
      if (onLightbox && !lightboxWheelNavEnabled()) return;
      if (t?.id === 'appreciateViewerImg' || t?.id === 'lightboxImage') return;
      if (!viewerNav.items.length) return;
      if (onLightbox && !lightboxWheelNavEnabled()) return;
      e.preventDefault();
      navigateViewerByWheelThrottled(e.deltaY);
    }

    function bindViewerShellWheelNav() {
      ['appreciateViewer', 'imageLightbox'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.viewerWheelBound) return;
        el.dataset.viewerWheelBound = '1';
        el.addEventListener('wheel', onViewerShellWheel, { passive: false });
      });
    }
    bindViewerShellWheelNav();
    window.setViewerNav = setViewerNav;

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
    window.attachImageZoom = attachImageZoom;
    window.resetImageZoom = resetImageZoom;

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
      warehousePreviewCardId = null;
      window.__appreciateViewerMode = null;
      window.FeatureDraft?.onAppreciateViewerClose?.();
      const img = document.getElementById('appreciateViewerImg');
      const caption = document.getElementById('appreciateViewerCaption');
      setAppreciateViewerLoading(false);
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
      imageZoom.img = null;
    }

    async function openAppreciateViewer(cardId) {
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      warehousePreviewCardId = cardId;
      markQuickPreviewTask({ warehouseUsed: true });
      syncAppreciateViewerActions('warehouse');
      const navItems = cards
        .filter((c) => c.image && cardHasDisplayImage(c))
        .map((c) => ({ type: 'card', id: c.id, key: `card:${c.id}` }));
      setViewerNav(navItems, `card:${cardId}`);
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
        if (isPlaceholderSrc(instantSrc) && window.SupabaseSync?.getCachedDisplayUrl) {
          instantSrc = window.SupabaseSync.getCachedDisplayUrl(card.image, {
            assetId: cardId,
            variant: window.SupabaseSync.VARIANT_GRID || 'grid'
          }) || '';
        }
      }
      const hasInstant = !isPlaceholderSrc(instantSrc);
      setAppreciateViewerLoading(!hasInstant);
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
        resetImageZoom(img);
        attachImageZoom(img);
        finishAppreciateViewerReveal();
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
            if (window.SupabaseSync?.resolveDisplayUrl) {
              displaySrc = await window.SupabaseSync.resolveDisplayUrl(card.image, {
                assetId: cardId,
                variant: window.SupabaseSync.VARIANT_FULL || 'full'
              });
            }
          } catch (e) { /* ignore */ }
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
              resetImageZoom(img);
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
        imageZoom.img = null;
        setAppreciateViewerLoading(false);
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
      if (document.body.classList.contains('community-appreciate') || window.FeatureDraft?.isCommunityQuickPreviewActive?.()) {
        closeAppreciateViewer();
        if (typeof window.FeatureDraft?.exitCommunityAppreciate === 'function') {
          window.FeatureDraft.exitCommunityAppreciate();
        } else {
          window.FeatureDraft?.toggleCommunityAppreciate?.();
        }
        return;
      }
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
      markQuickPreviewTask({ warehouseUsed: true });
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

    function syncToastStacking() {
      const toast = document.getElementById('toast');
      if (!toast) return;
      const overSheet =
        document.body.classList.contains('trial-tasks-open') ||
        document.body.classList.contains('subscribe-open') ||
        document.getElementById('trialTasksOverlay')?.classList.contains('active') ||
        document.getElementById('subscribeOverlay')?.classList.contains('active');
      toast.classList.toggle('toast--stack-top', overSheet);
    }
    window.syncToastStacking = syncToastStacking;

    function showToast(msg, durationMs) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.remove('toast--achievement');
      syncToastStacking();
      toast.classList.add('show');
      clearTimeout(toast._timeout);
      const ms = Number(durationMs) > 0 ? Number(durationMs) : 2000;
      toast._timeout = setTimeout(() => toast.classList.remove('show'), ms);
    }
    window.showToast = showToast;
    document.addEventListener('ph-api-unauthorized', () => {
      showToast('登录已过期，请退出后重新登录，卡片库图片才能恢复显示', 9000);
    });

    async function promptHubSaveImage(url, filename, imgEl) {
      const name = filename || `prompt-hub-${Date.now()}.png`;
      const saveBlob = (blob) => {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
      };
      if (!url || String(url).includes('data:image/svg')) {
        throw new Error('no_url');
      }
      if (String(url).startsWith('blob:')) {
        saveBlob(await (await fetch(url)).blob());
        return;
      }
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        saveBlob(await res.blob());
        return;
      } catch (e) { /* try canvas / proxy */ }
      const img = imgEl || document.getElementById('lightboxImage');
      if (img?.complete && img.naturalWidth > 0 && !String(img.src).includes('data:image/svg')) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d')?.drawImage(img, 0, 0);
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png', 0.92);
          });
          saveBlob(blob);
          return;
        } catch (e) { /* fall through */ }
      }
      if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
        const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
        if (blobUrl) {
          try {
            saveBlob(await (await fetch(blobUrl)).blob());
            URL.revokeObjectURL(blobUrl);
            return;
          } catch (e) {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }
      throw new Error('download_fetch_failed');
    }
    window.promptHubSaveImage = promptHubSaveImage;

    function showAchievementToast(msg, durationMs) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      syncToastStacking();
      toast.classList.add('show', 'toast--achievement');
      clearTimeout(toast._timeout);
      const ms = Number(durationMs) > 0 ? Number(durationMs) : 5200;
      toast._timeout = setTimeout(() => toast.classList.remove('show', 'toast--achievement'), ms);
    }
    window.showAchievementToast = showAchievementToast;

    function showSuccessModal(title, content) {
      const overlay = document.getElementById('customModalOverlay');
      const modal = document.getElementById('customModal');
      if (!overlay || !modal) {
        showToast(content || title, 4500);
        return;
      }
      modal.innerHTML = `<h3>${escapeHtml(title)}</h3><p class="success-modal-body">${escapeHtml(content || '')}</p><div class="modal-actions"><button type="button" class="btn btn-primary" id="customModalConfirm">太好了</button></div>`;
      overlay.classList.add('active');
      document.getElementById('customModalConfirm').onclick = () => closeCustomModal();
    }
    window.showSuccessModal = showSuccessModal;

    function isUserLoggedIn() {
      return !!window.SupabaseSync?.isLoggedIn?.();
    }

    function promptLogin(message) {
      if (message) showToast(message);
      if (typeof openAuthModal === 'function') openAuthModal('login');
    }

    function canGuestCreateCard() {
      if (isUserLoggedIn()) {
        return { ok: true };
      }
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
        el.textContent = '';
        window.SubscriptionUI?.refreshOfferUI?.();
        return;
      }
      el.classList.remove('hidden');
      const left = Math.max(0, GUEST_CARD_LIMIT - cards.length);
      el.textContent = `未登录：还可新建 ${left} / ${GUEST_CARD_LIMIT} 张卡片`;
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
    window.getCommunityNotificationsEnabled = function () {
      return settings.communityNotificationsEnabled !== false;
    };
    window.getCommunityNotifyBadgeEnabled = function () {
      return settings.communityNotifyBadge !== false;
    };

    window.getDefaultImageGenAutoSaveWarehouse = function () {
      return settings.defaultImageGenAutoSaveWarehouse !== false;
    };

    function warehouseVisibleCards(list) {
      const base = cardsForActiveWarehouse(filterTombstonedCards(list || cards));
      return base.filter((c) => window.SupabaseSync?.shouldShowCardInWarehouse?.(c) !== false);
    }

    window.getWarehouseCardsForImageGen = function (opts) {
      const group = opts?.group || 'all';
      const tag = opts?.tag || 'all';
      const base = warehouseVisibleCards(cards);
      let list = base.filter((c) => {
        if (!cardHasDisplayImage(c)) return false;
        const prompt = (c.prompt || '').trim();
        const title = (c.title || '').trim();
        return !!(prompt || title);
      });
      if (group === 'uncategorized') {
        list = list.filter(c => !c.group);
      } else if (group && group !== 'all') {
        list = list.filter(c => c.group === group);
      }
      if (tag && tag !== 'all') {
        list = list.filter(c => (c.tags || []).includes(tag));
      }
      return list
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .map(c => ({
          id: c.id,
          title: (c.title || '').trim() || '',
          prompt: (c.prompt || '').trim() || (c.title || '').trim() || '',
          image: c.image || null,
          tags: c.tags || [],
          group: c.group || null,
          genJobId: c.genJobId || null
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
      const input = document.getElementById('activationCodeInputSubscribe');
      const code = input?.value?.trim();
      const result = await window.PointsSystem?.redeemActivationCode?.(code);
      if (!result) return;
      const status = document.getElementById('settingsStatus');
      if (result.ok) {
        const el = document.getElementById('activationCodeInputSubscribe');
        if (el) el.value = '';
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

    window.COMMUNITY_COLLECT_TAG = '社区收藏';
    window.INSPIRE_DRAW_TAG = '灵感抽卡';
    window.isCommunityCollectTagName = function (tag) {
      const name = String(tag || '').replace(/^#+/, '').trim();
      return name === window.COMMUNITY_COLLECT_TAG;
    };
    window.getSelectableCardTags = function (sourceCards) {
      const src = sourceCards || cards;
      return [...new Set(src.flatMap(c => c.tags || []))]
        .filter(t => t && !window.isCommunityCollectTagName(t))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    };
    window.isCommunityCollectCard = (card) =>
      window.FeatureDraft?.isCommunityCollectCard?.(card)
      || !!(card && (card.tags || []).includes(window.COMMUNITY_COLLECT_TAG));

    window.addCardFromCommunity = async function (post, opts) {
      opts = opts || {};
      if (!post || !post.prompt) return { ok: false };
      const COLLECT_TAG = window.COMMUNITY_COLLECT_TAG;
      if (cards.some(c =>
        (c.tags || []).includes(COLLECT_TAG)
        && (c.favoritedFromPostId === post.id || c.communitySourceId === post.id)
      )) {
        return { ok: false, duplicate: true };
      }
      const cardId = generateId();
      let image = null;
      const imageRef = window.FeatureDraft?.communityPostDisplayImageRef?.(post)
        || window.FeatureDraft?.canonicalCommunityImageRef?.(post)
        || (post.image && window.SupabaseSync?.normalizeImageRef?.(post.image))
        || post.image
        || null;
      const signOpts = {
        assetId: post.sourceCardId || post.id,
        authorId: post.authorId || undefined,
        cardId: post.sourceCardId || undefined,
        communityFeed: true,
        tryAllPaths: true,
        variant: 'full'
      };
      function pickStorageRef(ref) {
        if (!ref) return null;
        const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
        if (typeof normalized === 'string' && normalized.startsWith('storage://')) return normalized;
        return null;
      }
      function altStorageRefs() {
        if (!post.authorId || !post.sourceCardId) return [];
        const uid = String(post.authorId);
        const base = String(post.sourceCardId).replace(/[^a-zA-Z0-9_-]/g, '_');
        return [
          `storage://card-images/${uid}/${base}.jpg`,
          `storage://card-images/${uid}/${post.sourceCardId}.jpg`,
          `storage://card-images/${uid}/${base}.webp`
        ];
      }
      async function blobFromRef(ref) {
        if (!ref) return null;
        if (window.SupabaseSync?.isDataUrl?.(ref) || String(ref).startsWith('blob:')) {
          try {
            const res = await fetch(ref);
            if (res.ok) return await res.blob();
          } catch (e) { /* ignore */ }
          return null;
        }
        const url = await window.SupabaseSync?.resolveDisplayUrl?.(ref, signOpts);
        if (!url) return null;
        try {
          const res = await fetch(url);
          if (res.ok) return await res.blob();
        } catch (e) { /* ignore */ }
        if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
          try {
            const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
            if (blobUrl) {
              const res = await fetch(blobUrl);
              if (res.ok) {
                const blob = await res.blob();
                try { URL.revokeObjectURL(blobUrl); } catch (e2) { /* ignore */ }
                return blob;
              }
            }
          } catch (e) { /* ignore */ }
        }
        return null;
      }
      if (imageRef && window.SupabaseSync?.isLoggedIn?.()) {
        image = pickStorageRef(imageRef);
        if (!image) {
          for (const alt of altStorageRefs()) {
            image = pickStorageRef(alt);
            if (image) break;
          }
        }
        if (!image && !opts.skipBlobCopy) {
        try {
          let source = await blobFromRef(imageRef);
          if (!source && post.authorId && post.sourceCardId) {
            for (const alt of altStorageRefs()) {
              source = await blobFromRef(alt);
              if (source) break;
            }
          }
          if (source && window.SupabaseSync.uploadCardImage) {
            image = await window.SupabaseSync.uploadCardImage(cardId, source);
          }
        } catch (e) {
          console.warn('[addCardFromCommunity] image copy failed', e);
        }
        }
      }
      const newCard = {
        id: cardId,
        title: (post.title || '社区收藏') + '',
        prompt: post.prompt,
        image: image || null,
        group: null,
        tags: [COLLECT_TAG],
        customFields: {},
        favoritedFromPostId: post.id,
        communitySourceAuthorId: String(post.authorId || ''),
        communitySourceCardId: post.sourceCardId ? String(post.sourceCardId) : '',
        publishedToCommunity: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      cards.push(newCard);
      if (image && !String(image).startsWith('storage://') && window.SupabaseSync?.ensureCardImageOnCloud) {
        try {
          const up = await window.SupabaseSync.ensureCardImageOnCloud(newCard);
          if (up?.image) newCard.image = up.image;
        } catch (e) { /* ignore */ }
      }
      await saveAllData({ skipCloud: true });
      if (window.SupabaseSync?.isLoggedIn?.()) {
        scheduleCloudPush();
      }
      const refreshCards = () => {
        renderGroups();
        renderCards(true);
      };
      if (opts.deferRender) {
        setTimeout(refreshCards, 0);
      } else {
        refreshCards();
      }
      return { ok: true, imageCopied: !!image };
    };

    window.addCardFromGenerated = async function (payload) {
      const { prompt, image, title, sourceId, jobId } = payload || {};
      if (!image && !(prompt || '').trim()) {
        showToast('无内容可保存');
        return { ok: false };
      }
      if (jobId && window.getDeletedGenerationJobTombstones?.()?.[String(jobId)]) {
        return { ok: false, duplicate: true, skipped: true };
      }
      if (jobId && cards.some(c => c.genJobId === jobId)) {
        const existing = cards.find(c => c.genJobId === jobId);
        if (existing && image) {
          const needsRepair = !existing.image
            || /^https?:\/\//i.test(existing.image)
            || (window.SupabaseSync?.isDataUrl?.(existing.image))
            || (window.SupabaseSync?.isStorageRef?.(existing.image)
              && window.SupabaseSync.storagePathFromRef?.(existing.image)
              && window.SupabaseSync.isPathKnownMissing?.(window.SupabaseSync.storagePathFromRef(existing.image)));
          if (needsRepair) {
            let stored = image;
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.archiveGeneratedCardImage) {
              try {
                stored = await window.SupabaseSync.archiveGeneratedCardImage(existing.id, image, {
                  jobId: jobId || existing.genJobId || null
                }) || image;
              } catch (e) {
                console.warn('[addCardFromGenerated] duplicate repair archive failed', e);
              }
            }
            existing.image = stored;
            existing.updatedAt = Date.now();
            await saveAllData({ skipCloud: true });
            renderGroups();
            renderCards(true);
            if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
            window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
            return { ok: true, cardId: existing.id, repaired: true };
          }
        }
        if (existing && image && !existing.image) {
          existing.image = image;
          existing.updatedAt = Date.now();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
          window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
          return { ok: true, cardId: existing.id, repaired: true };
        }
        window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
        return { ok: false, duplicate: true, cardId: existing?.id };
      }
      if (sourceId && cards.some(c => c.genSourceId === sourceId)) {
        const existing = cards.find(c => c.genSourceId === sourceId);
        window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
        return { ok: false, duplicate: true, cardId: existing?.id };
      }
      if (!isUserLoggedIn()) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          promptLogin(check.msg);
          return { ok: false };
        }
      }
      const promptText = (prompt || '').trim();
      const tags = ['图片生成'];
      if (payload.fromInspirationDraw) tags.push(window.INSPIRE_DRAW_TAG || '灵感抽卡');
      const card = {
        id: payload.cardId || generateId(),
        title: (title || '').trim(),
        prompt: promptText,
        image: image || null,
        group: null,
        tags,
        customFields: {},
        genSourceId: sourceId || null,
        genJobId: jobId || null,
        resolution: payload.resolution || null,
        model: payload.model || null,
        genQuality: payload.quality || null,
        genSize: payload.size || null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      cards.push(card);
      if (image) void saveCardImageBackup(card.id, image).catch(() => {});
      if (image && window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.archiveGeneratedCardImage) {
        try {
          const archived = await window.SupabaseSync.archiveGeneratedCardImage(card.id, image, {
            jobId: jobId || null
          });
          if (archived && archived !== card.image) {
            card.image = archived;
            card.updatedAt = Date.now();
          }
        } catch (e) {
          console.warn('[addCardFromGenerated] image archive failed', e);
        }
      }
      if (payload.publishToCommunity && window.FeatureDraft?.syncCardToCommunity) {
        if (window.FeatureDraft?.isCommunityPublishEligible?.(card)) {
          await window.FeatureDraft.syncCardToCommunity(card, true);
        } else if (!payload.silentToast) {
          showToast('已保存到仓库；配图归档中，请稍后在卡片库手动公开到社区');
        }
      }
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      updateGuestLimitUI();
      if (window.SupabaseSync?.isLoggedIn?.() && payload.deferCloudPush !== true) {
        scheduleCloudPush({ urgent: true });
      }
      if (!payload.silentToast) {
        showToast(payload.publishToCommunity ? '已保存到仓库并公开到社区' : '已保存到卡片仓库');
      }
      window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
      return { ok: true, cardId: card.id };
    };

    let genCardImageRepairInflight = null;
    async function repairGeneratedCardImagesQuiet() {
      if (!window.SupabaseSync?.isLoggedIn?.() || !window.SupabaseSync?.archiveGeneratedCardImage) return;
      if (genCardImageRepairInflight) return genCardImageRepairInflight;
      const targets = cards.filter((c) => {
        if (!c?.id || !c?.image) return false;
        if (!c.genJobId && !(c.tags || []).includes('图片生成')) return false;
        if (window.SupabaseSync.isDataUrl?.(c.image)) return true;
        if (/^https?:\/\//i.test(c.image)) return true;
        if (window.SupabaseSync.isStorageRef?.(c.image)) {
          const path = window.SupabaseSync.storagePathFromRef?.(c.image);
          return !!(path && window.SupabaseSync.isPathKnownMissing?.(path));
        }
        return false;
      }).slice(0, 12);
      if (!targets.length) return;
      genCardImageRepairInflight = (async () => {
        let changed = false;
        for (const c of targets) {
          try {
            let src = c.image;
            if (typeof getCardImageBackup === 'function') {
              const backup = await getCardImageBackup(c.id);
              if (backup && String(backup).startsWith('data:')) src = backup;
            }
            const ref = await window.SupabaseSync.archiveGeneratedCardImage(c.id, src);
            if (ref && ref !== c.image) {
              c.image = ref;
              c.updatedAt = Date.now();
              changed = true;
            }
          } catch (e) {
            console.warn('[repairGeneratedCardImages] skipped', c.id, e);
          }
        }
        if (changed) {
          await saveAllData({ skipCloud: true });
          if (document.getElementById('pageWarehouse')?.classList.contains('active')) renderCards(true);
          if (document.getElementById('pageImageGen')?.classList.contains('active')) {
            window.FeatureDraft?.renderImageGenFeed?.({ preserveScroll: true });
          }
          scheduleCloudPush({ urgent: true });
        }
      })().finally(() => { genCardImageRepairInflight = null; });
      return genCardImageRepairInflight;
    }
    window.repairGeneratedCardImagesQuiet = repairGeneratedCardImagesQuiet;

    function showCustomModal(title, content, onConfirm, onCancel, isPrompt = false, suggestions = [], opts = {}) {
      const overlay = document.getElementById('customModalOverlay');
      const modal = document.getElementById('customModal');
      let inputHtml = '';
      if (isPrompt) inputHtml = '<input type="text" id="customModalInput" placeholder="">';
      let suggestionsHtml = '';
      if (suggestions.length) {
        suggestionsHtml = '<div class="suggestions">' + suggestions.map(s => `<span onclick="document.getElementById('customModalInput').value='${escapeJsString(s)}'; document.getElementById('customModalConfirm').focus();">${escapeHtml(s)}</span>`).join('') + '</div>';
      }
      const bodyHtml = escapeHtml(String(content || '')).replace(/\n/g, '<br>');
      const confirmLabel = opts.confirmLabel || '确定';
      const confirmClass = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
      modal.innerHTML = `<h3>${escapeHtml(title)}</h3><p class="custom-modal-body">${bodyHtml}</p>${inputHtml}${suggestionsHtml}<div class="modal-actions"><button type="button" class="${confirmClass}" id="customModalConfirm">${escapeHtml(confirmLabel)}</button><button type="button" class="btn btn-secondary" id="customModalCancel">取消</button></div>`;
      overlay.classList.add('active');
      document.body.classList.add('custom-modal-open');
      document.getElementById('customModalCancel').onclick = () => { closeCustomModal(); if(onCancel) onCancel(); };
      document.getElementById('customModalConfirm').onclick = () => { const value = isPrompt ? document.getElementById('customModalInput')?.value : true; closeCustomModal(); if(onConfirm) onConfirm(value); };
      if (isPrompt) document.getElementById('customModalInput').focus();
    }
    function closeCustomModal() {
      document.getElementById('customModalOverlay')?.classList.remove('active');
      document.body.classList.remove('custom-modal-open');
    }
    window.closeCustomModal = closeCustomModal;
    function customConfirm(msg, onConfirm, onCancel, opts) {
      showCustomModal('确认', msg, onConfirm, onCancel, false, [], opts || {});
    }
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
      const tags = (window.getSelectableCardTags?.(cards) || []).map(t => ({
        value: 'tag:' + String(t).replace(/^#+/, ''),
        label: '#' + String(t).replace(/^#+/, '')
      }));
      return base.concat(tags);
    }

    function cardMatchesFilters(card) {
      if (activeFilters.size === 0) return true;
      return [...activeFilters].some(f => {
        if (f === 'image') return !!card.image;
        if (f === 'text') return !card.image;
        if (f.startsWith('tag:')) {
          const needle = f.slice(4);
          return (card.tags || []).some(t => String(t).replace(/^#+/, '') === needle);
        }
        return false;
      });
    }

    function updateTagFilter() {
      buildFilterMenu();
      syncFilterBtnState();
    }

    function clearWarehouseFilters(opts = {}) {
      if (activeFilters.size === 0 && !opts.force) return;
      activeFilters.clear();
      saveActiveFilters();
      syncFilterBtnState();
      document.getElementById('searchInput') && (document.getElementById('searchInput').value = '');
      const mobileSearch = document.getElementById('searchInputMobile');
      if (mobileSearch) mobileSearch.value = '';
      renderCards(true);
      buildFilterMenu();
      if (opts.toast !== false) showToast('已清除筛选');
    }
    window.clearWarehouseFilters = clearWarehouseFilters;

    function syncFilterBtnState() {
      const n = activeFilters.size;
      document.getElementById('filterBtn')?.classList.toggle('active', n > 0);
      document.getElementById('warehouseFilterClearBtn')?.classList.toggle('hidden', n === 0);
    }

    function portalDropdownToBody(dd, homeParent) {
      if (!dd) return;
      if (!dd.dataset.portalHomeId && homeParent?.id) {
        dd.dataset.portalHomeId = homeParent.id;
      }
      if (dd.parentElement !== document.body) {
        document.body.appendChild(dd);
      }
    }

    function restoreDropdownPortal(dd) {
      if (!dd?.dataset.portalHomeId) return;
      const home = document.getElementById(dd.dataset.portalHomeId);
      if (home && dd.parentElement === document.body) {
        home.appendChild(dd);
      }
    }

    function positionAnchoredDropdown(dd, btn, minWidth) {
      if (!dd || !btn) return;
      const r = btn.getBoundingClientRect();
      const width = Math.max(minWidth || 132, Math.round(r.width));
      let left = Math.round(r.left);
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      dd.style.position = 'fixed';
      dd.style.top = `${Math.round(r.bottom + 6)}px`;
      dd.style.left = `${left}px`;
      dd.style.right = 'auto';
      dd.style.width = `${width}px`;
      dd.style.minWidth = `${width}px`;
      dd.style.zIndex = '13050';
    }

    function positionFilterDropdown() {
      const dd = document.getElementById('filterDropdown');
      const btn = document.getElementById('filterBtn');
      if (!dd || !btn) return;
      portalDropdownToBody(dd, document.querySelector('.filter-menu-wrap'));
      positionAnchoredDropdown(dd, btn, 220);
    }

    function positionSortDropdown() {
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (!dd || !btn) return;
      portalDropdownToBody(dd, document.getElementById('sortMenuWrap'));
      positionAnchoredDropdown(dd, btn, 132);
    }

    function resetSortDropdownPosition() {
      const dd = document.getElementById('sortDropdown');
      if (!dd) return;
      dd.style.position = '';
      dd.style.top = '';
      dd.style.left = '';
      dd.style.right = '';
      dd.style.width = '';
      dd.style.minWidth = '';
      dd.style.zIndex = '';
      restoreDropdownPortal(dd);
    }

    function resetFilterDropdownPosition() {
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      dd.style.position = '';
      dd.style.top = '';
      dd.style.right = '';
      dd.style.left = '';
      dd.style.width = '';
      dd.style.minWidth = '';
      dd.style.zIndex = '';
      restoreDropdownPortal(dd);
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
        clearWarehouseFilters({ toast: false });
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
      if (willOpen) {
        positionFilterDropdown();
        dd.classList.add('open');
        closeSortMenu();
      } else {
        dd.classList.remove('open');
        resetFilterDropdownPosition();
      }
    }
    window.toggleFilterMenu = toggleFilterMenu;

    function initFilterMenu() {
      const btn = document.getElementById('filterBtn');
      const dd = document.getElementById('filterDropdown');
      const clearBtn = document.getElementById('warehouseFilterClearBtn');
      if (!btn || !dd) return;
      btn.addEventListener('click', (e) => toggleFilterMenu(e));
      clearBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearWarehouseFilters();
      });
      dd.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-menu-wrap')) {
          dd.classList.remove('open');
          resetFilterDropdownPosition();
        }
        if (!e.target.closest('.sort-menu-wrap')) {
          closeSortMenu();
        }
      });
      window.addEventListener('resize', () => {
        if (dd.classList.contains('open')) positionFilterDropdown();
        if (!document.getElementById('sortDropdown')?.hidden) positionSortDropdown();
      });
      window.addEventListener('scroll', () => {
        if (dd.classList.contains('open')) positionFilterDropdown();
        if (!document.getElementById('sortDropdown')?.hidden) positionSortDropdown();
      }, true);
    }

    const SORT_OPTIONS = [
      { value: 'default', label: '默认' },
      { value: 'created-desc', label: '最近生成' },
      { value: 'updated-desc', label: '最近更新' },
      { value: 'updated-asc', label: '最远' },
      { value: 'random', label: '随机' }
    ];

    function getSortLabel(value) {
      return SORT_OPTIONS.find(o => o.value === value)?.label || '默认';
    }

    function setSortMode(value, opts = {}) {
      const v = SORT_OPTIONS.some(o => o.value === value) ? value : 'updated-desc';
      if (v === 'random') cardRandomSig = '';
      sortMode = v;
      try { localStorage.setItem(CARD_SORT_KEY, v); } catch (e) { /* ignore */ }
      const hidden = document.getElementById('sortSelect');
      if (hidden) hidden.value = v;
      const label = document.getElementById('sortMenuLabel');
      if (label) label.textContent = getSortLabel(v);
      document.querySelectorAll('#sortDropdown .sort-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === v);
        btn.setAttribute('aria-selected', btn.dataset.value === v ? 'true' : 'false');
      });
      if (opts.render !== false) renderCards(true);
    }

    function buildSortMenu() {
      const dd = document.getElementById('sortDropdown');
      if (!dd) return;
      dd.innerHTML = '';
      SORT_OPTIONS.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sort-option' + (sortMode === opt.value ? ' active' : '');
        btn.dataset.value = opt.value;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', sortMode === opt.value ? 'true' : 'false');
        btn.textContent = opt.label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setSortMode(opt.value);
          closeSortMenu();
        });
        dd.appendChild(btn);
      });
    }

    function closeSortMenu() {
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (dd) {
        dd.hidden = true;
        resetSortDropdownPosition();
      }
      btn?.setAttribute('aria-expanded', 'false');
    }

    function toggleSortMenu(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (!dd || !btn) return;
      const willOpen = dd.hidden;
      buildSortMenu();
      if (willOpen) {
        dd.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        positionSortDropdown();
        document.getElementById('filterDropdown')?.classList.remove('open');
        resetFilterDropdownPosition();
      } else {
        closeSortMenu();
      }
    }

    function initSortMenu() {
      const btn = document.getElementById('sortMenuBtn');
      const dd = document.getElementById('sortDropdown');
      if (!btn || !dd) return;
      let saved = sortMode;
      try {
        const ls = localStorage.getItem(CARD_SORT_KEY);
        if (ls && SORT_OPTIONS.some((o) => o.value === ls)) saved = ls;
      } catch (e) { /* ignore */ }
      if (!saved || saved === 'default') saved = 'updated-desc';
      setSortMode(saved, { render: false });
      buildSortMenu();
      btn.addEventListener('click', toggleSortMenu);
      dd.addEventListener('click', (e) => e.stopPropagation());
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

    function getDesktopCardColumnWidth() {
      const gap = getMasonryGap();
      const innerW = getCardsInnerWidth();
      if (innerW < 280) return 0;
      const cols = Math.max(1, cardColumns);
      return Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    }

    function primeDesktopCardGrid(container) {
      if (!container || isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') return;
      const colWidth = getDesktopCardColumnWidth();
      if (!colWidth) return;
      let sizer = container.querySelector('.grid-sizer');
      if (!sizer) {
        sizer = document.createElement('div');
        sizer.className = 'grid-sizer';
        container.insertBefore(sizer, container.firstChild);
      }
      sizer.style.width = colWidth + 'px';
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

    function bindCardGridImageRelayout(container) {
      if (!container || container.dataset.masonryLoadBound) return;
      container.dataset.masonryLoadBound = '1';
      container.addEventListener('load', (e) => {
        if (!e.target?.classList?.contains('card-img')) return;
        if (isPlaceholderCardImg(e.target)) return;
        if (isMobileViewport()) return;
        const media = e.target.closest('.card-media');
        if (media && !cardMediaAffectsViewport(media)) return;
        const cardEl = e.target.closest('.card[data-id]');
        if (cardEl?.dataset?.communityCollect === '1') {
          scheduleWarehouseMasonryForCard(cardEl.dataset.id);
        } else {
          scheduleWarehouseMasonryLayout();
        }
      }, true);
    }

    let warehouseMasonryTimer = null;
    let warehouseMasonryPending = 0;
    const warehouseMasonryCardCooldown = new Map();
    function scheduleWarehouseMasonryLayout() {
      if (isMobileViewport()) return;
      warehouseMasonryPending += 1;
      clearTimeout(warehouseMasonryTimer);
      warehouseMasonryTimer = setTimeout(() => {
        warehouseMasonryPending = 0;
        layoutMasonryGrid();
      }, warehouseMasonryPending > 4 ? 200 : 120);
    }
    function scheduleWarehouseMasonryForCard(cardId) {
      if (!cardId) {
        scheduleWarehouseMasonryLayout();
        return;
      }
      const now = Date.now();
      const last = warehouseMasonryCardCooldown.get(cardId) || 0;
      if (now - last < 520) return;
      warehouseMasonryCardCooldown.set(cardId, now);
      scheduleWarehouseMasonryLayout();
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
        horizontalOrder: false,
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
        requestAnimationFrame(() => applyFloatingPromptPosition());
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

      window.addEventListener('resize', () => {
        if (!floatingPromptActive || !canShowFloatingPrompt()) return;
        applyFloatingPromptPosition();
      });

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
      if (key === 'assetmarket') void window.FeatureAssets?.renderMarketplace?.();
      if (key === 'assetstudio') window.FeatureAssets?.renderStudio?.();
      window.FeatureAssets?.onAppChange?.('devlab', key);
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
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(el.dataset.devlabPanel);
          }
        });
      });
      document.querySelectorAll('.devlab-mobile-tab[data-devlab-panel]').forEach((btn) => {
        btn.addEventListener('click', () => activate(btn.dataset.devlabPanel));
      });
    }

    function pauseRippleBackground() {
      window.__rippleGridBg?.setPaused?.(true);
    }
    function isRippleHeavyApp(app) {
      return app === 'community' || app === 'creations' || app === 'imagegen';
    }

    function resumeRippleBackground(app) {
      if (settings.efficiencyMode) return;
      const activeApp = app || document.querySelector('.app-nav-item.active')?.dataset?.app || 'warehouse';
      if (isRippleHeavyApp(activeApp)) {
        pauseRippleBackground();
        return;
      }
      const bg = document.getElementById('rippleGridBg');
      if (!bg) return;
      bg.style.display = '';
      if (!window.__rippleGridBg && !bg.classList.contains('ripple-fallback-active')) {
        void initBackgroundEffect();
        return;
      }
      window.__rippleGridBg?.setPaused?.(false);
    }
    window.resumeRippleBackground = resumeRippleBackground;

    function applyEfficiencyMode() {
      const on = settings.efficiencyMode === true;
      document.body.classList.toggle('efficiency-mode', on);
      const bg = document.getElementById('rippleGridBg');
      const vig = document.querySelector('.ui-vignette');
      if (bg) bg.style.display = on ? 'none' : '';
      if (vig) vig.style.display = on ? 'none' : '';
      if (on) pauseRippleBackground();
      else resumeRippleBackground();
      window.FeatureDraft?.relayoutCommunityFeeds?.();
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
      }
    }
    window.applyEfficiencyMode = applyEfficiencyMode;

    function deferAfterPagePaint(fn, timeoutMs) {
      const run = () => {
        try { fn(); } catch (e) { console.warn('[nav]', e); }
      };
      requestAnimationFrame(() => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(run, { timeout: timeoutMs || 200 });
        } else {
          setTimeout(run, 16);
        }
      });
    }

    function switchAppPage(app) {
      if (app === 'assetmarket' || app === 'assetstudio') {
        switchDevLabPanel(app);
        app = 'devlab';
      }
      if (!APP_PAGE_IDS[app]) return;
      if (app !== 'warehouse' && activeFilters.size > 0) {
        clearWarehouseFilters({ toast: false });
      }
      if (app !== 'warehouse') {
        forceExitGlobalView(true);
        closeEditPanel();
        if (typeof closeTagSheet === 'function') closeTagSheet();
      }
      if (app === 'warehouse') {
        const searchDesktop = document.getElementById('searchInput');
        const searchMobile = document.getElementById('searchInputMobile');
        const hadSearch = !!(searchDesktop?.value?.trim() || searchMobile?.value?.trim());
        if (searchDesktop) searchDesktop.value = '';
        if (searchMobile) searchMobile.value = '';
        const mobileBar = document.getElementById('mobileSearchBar');
        if (mobileBar) mobileBar.hidden = true;
        if (hadSearch) {
          deferAfterPagePaint(() => {
            if (document.getElementById('pageWarehouse')?.classList.contains('active')) renderCards(true);
          }, 200);
        }
      }
      document.querySelectorAll('.app-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.app === app);
      });
      Object.entries(APP_PAGE_IDS).forEach(([key, id]) => {
        document.getElementById(id)?.classList.toggle('active', key === app);
      });
      localStorage.setItem('promptrepo_app_page', app);
      window.MobileUI?.closeAllMobileOverlays?.();
      if (app === 'devlab') {
        switchDevLabPanel(getDevLabPanel());
      }
      if (app === 'warehouse') {
        if (floatingPromptActive) {
          floatingPromptActive = false;
          settings.floatingPrompt = false;
          try { localStorage.setItem('promptrepo_settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
        }
        applyFloatingState();
        deferAfterPagePaint(() => {
          if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return;
          if (isMobileViewport()) enforceMobileCardGrid();
          else scheduleWarehouseMasonryLayout();
        }, 220);
      }
      deferAfterPagePaint(() => {
        window.FeatureDraft?.onAppChange?.(app);
        resumeRippleBackground(app);
      }, 280);
      window.mobileOnAppPageChange?.(app);
    }
    window.switchAppPage = switchAppPage;

    function initAppNav() {
      document.querySelectorAll('.app-nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchAppPage(btn.dataset.app));
      });
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
      if (!bg || settings.efficiencyMode || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (isMobileViewport()) {
        bg.style.display = 'none';
        return;
      }
      try {
        const build = window.__APP_BUILD__ || '1';
        const mod = await import(`./ripple-grid.js?v=${encodeURIComponent(build)}`);
        window.__rippleGridBg = mod.initRippleGrid(bg, RIPPLE_BG_OPTS);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) pauseRippleBackground();
          else resumeRippleBackground();
        });
      } catch {
        initCanvasRippleFallback(bg);
      }
    }

    let cloudPushTimer = null;
    let localSnapshotTimer = null;
    let cloudSyncing = false;
    let cloudPushRunId = 0;
    let activeAccountId = null;
    let cloudHydratedUid = null;
    let cloudSyncPhase = 'idle';
    let cloudSyncPhaseAt = 0;
    let cloudSyncPhaseDetail = '';
    let cloudSyncStatusHideTimer = null;

    function clearCloudSyncStatusHideTimer() {
      if (cloudSyncStatusHideTimer) {
        clearTimeout(cloudSyncStatusHideTimer);
        cloudSyncStatusHideTimer = null;
      }
    }

    function scheduleCloudSyncStatusHide(delayMs) {
      clearCloudSyncStatusHideTimer();
      cloudSyncStatusHideTimer = setTimeout(() => {
        cloudSyncStatusHideTimer = null;
        if (cloudSyncPhase === 'saved' || cloudSyncPhase === 'error') {
          cloudSyncPhase = 'idle';
          cloudSyncPhaseDetail = '';
        }
        updateCloudSyncStatusUI();
      }, delayMs);
    }
    let bgCloudSyncTimer = null;
    let lastBgCloudSyncAt = 0;

    function userStorageKey(name, uid) {
      const id = uid || activeAccountId;
      return id ? `promptrepo_${name}_${id}` : `promptrepo_${name}`;
    }

    function warehouseGroupsKey(warehouseId, uid) {
      const id = uid || activeAccountId;
      const wid = warehouseId || getActiveWarehouseId();
      return id ? `promptrepo_groups_${id}_${wid}` : `promptrepo_groups_${wid}`;
    }

    function persistWarehouseGroups(warehouseId) {
      const wid = warehouseId || getActiveWarehouseId();
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      try {
        localStorage.setItem(warehouseGroupsKey(wid, uid), JSON.stringify(customGroups));
        if (wid === 'default' && uid) {
          localStorage.setItem(userStorageKey('groups', uid), JSON.stringify(customGroups));
        }
      } catch (e) { /* ignore */ }
    }

    function mergeWarehouseGroupsFromList(names, warehouseId) {
      const list = Array.isArray(names) ? names : [];
      if (!list.length) return false;
      loadWarehouseGroups(warehouseId);
      let changed = false;
      list.forEach((name) => {
        const g = String(name || '').trim();
        if (g && g !== '未分类' && !customGroups.includes(g)) {
          customGroups.push(g);
          changed = true;
        }
      });
      if (changed) {
        persistWarehouseGroups(warehouseId);
        renderGroups();
      }
      return changed;
    }
    window.mergeWarehouseGroupsFromList = mergeWarehouseGroupsFromList;

    function loadWarehouseGroups(warehouseId) {
      const wid = warehouseId || getActiveWarehouseId();
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      try {
        const key = warehouseGroupsKey(wid, uid);
        let raw = localStorage.getItem(key);
        if (!raw && wid === 'default') {
          raw = localStorage.getItem(userStorageKey('groups', uid)) || localStorage.getItem('promptrepo_groups');
          if (raw) localStorage.setItem(key, raw);
        }
        customGroups = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(customGroups)) customGroups = [];
      } catch (e) {
        customGroups = [];
      }
    }

    window.onWarehouseSwitched = function onWarehouseSwitched(prevId, nextId) {
      if (prevId && prevId !== nextId) persistWarehouseGroups(prevId);
      loadWarehouseGroups(nextId);
      currentGroup = 'all';
      window.currentGroup = 'all';
      renderGroups();
    };

    const BACKUP_FORMAT = 'prompt-hub-backup';
    const BACKUP_VERSION = 1;

    function getPinLimit() {
      return window.Membership?.getPinLimit?.() ?? 2;
    }

    function countPinnedCards(excludeId) {
      return cards.filter(c => c.pinnedAt && c.id !== excludeId).length;
    }

    function shuffleCardRest(rest) {
      if (!rest.length) return rest;
      const sig = rest.map((c) => String(c.id)).sort().join('|');
      if (cardRandomSig !== sig) {
        cardRandomSig = sig;
        const ids = rest.map((c) => c.id);
        for (let i = ids.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        cardRandomOrder = new Map(ids.map((id, idx) => [id, idx]));
      }
      return [...rest].sort((a, b) => {
        const ai = cardRandomOrder.get(a.id) ?? 0;
        const bi = cardRandomOrder.get(b.id) ?? 0;
        return ai - bi;
      });
    }

    function sortCardsWithPins(list) {
      const pinned = list.filter(c => c.pinnedAt).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
      const rest = list.filter(c => !c.pinnedAt);
      if (sortMode === 'updated-asc') {
        rest.sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
      } else if (sortMode === 'created-desc') {
        rest.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
      } else if (sortMode === 'random') {
        return [...pinned, ...shuffleCardRest(rest)];
      } else if (sortMode === 'updated-desc') {
        rest.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      } else {
        rest.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
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
        const tier = window.Membership?.getMemberTier?.();
        const label = tier === 'basic' ? '基础会员' : '免费用户';
        btn.title = `${label}置顶 ${count}/${limit}`;
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
          const tier = window.Membership?.getMemberTier?.();
          const label = tier === 'basic' ? '基础会员' : '免费用户';
          showToast(`${label}最多置顶 ${limit} 张，请先取消其他置顶`);
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
          deletedCardTombstones: { ...(settings.deletedCardTombstones || {}) },
          deletedCreationTombstones: { ...(settings.deletedCreationTombstones || {}) },
          deletedGenerationJobTombstones: { ...(settings.deletedGenerationJobTombstones || {}) },
          deletedCommunityPostTombstones: { ...(settings.deletedCommunityPostTombstones || {}) }
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

    function mergeDeletedCreationTombstones(a, b) {
      return { ...(a || {}), ...(b || {}) };
    }

    function mergeDeletedGenerationJobTombstones(a, b) {
      return { ...(a || {}), ...(b || {}) };
    }

    function recordGenerationJobDeletion(jobId) {
      if (jobId == null) return;
      if (!settings.deletedGenerationJobTombstones || typeof settings.deletedGenerationJobTombstones !== 'object') {
        settings.deletedGenerationJobTombstones = {};
      }
      settings.deletedGenerationJobTombstones[String(jobId)] = Date.now();
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }
    window.recordGenerationJobDeletion = recordGenerationJobDeletion;

    function recordCreationDeletionGlobal(id, jobId) {
      if (id == null) return;
      if (!settings.deletedCreationTombstones || typeof settings.deletedCreationTombstones !== 'object') {
        settings.deletedCreationTombstones = {};
      }
      settings.deletedCreationTombstones[String(id)] = Date.now();
      if (jobId) {
        if (!settings.deletedGenerationJobTombstones || typeof settings.deletedGenerationJobTombstones !== 'object') {
          settings.deletedGenerationJobTombstones = {};
        }
        settings.deletedGenerationJobTombstones[String(jobId)] = Date.now();
      }
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }

    function filterTombstonedCreations(list) {
      const t = settings.deletedCreationTombstones || {};
      return (list || []).filter((c) => c && c.id != null && !t[String(c.id)]);
    }

    window.recordCreationDeletionGlobal = recordCreationDeletionGlobal;
    window.getDeletedCreationTombstones = () => ({ ...(settings.deletedCreationTombstones || {}) });
    window.getDeletedGenerationJobTombstones = () => ({ ...(settings.deletedGenerationJobTombstones || {}) });
    window.getDeletedCardTombstones = () => ({ ...(settings.deletedCardTombstones || {}) });
    window.getDeletedCommunityPostTombstones = () => ({ ...(settings.deletedCommunityPostTombstones || {}) });
    window.recordCommunityPostDeletion = recordCommunityPostDeletion;

    function recordCommunityPostDeletion(id) {
      if (id == null) return;
      if (!settings.deletedCommunityPostTombstones || typeof settings.deletedCommunityPostTombstones !== 'object') {
        settings.deletedCommunityPostTombstones = {};
      }
      settings.deletedCommunityPostTombstones[String(id)] = Date.now();
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }

    function clearCardDeletionTombstone(id) {
      if (id == null || !settings.deletedCardTombstones) return;
      delete settings.deletedCardTombstones[String(id)];
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
    }
    window.clearCardDeletionTombstone = clearCardDeletionTombstone;

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
        if (cloudTs > localTs) {
          map.set(id, window.CloudSyncSafety?.mergeCardPair
            ? window.CloudSyncSafety.mergeCardPair(local, c)
            : c);
        } else if (window.CloudSyncSafety?.mergeCardPair) {
          map.set(id, window.CloudSyncSafety.mergeCardPair(local, c));
        }
      }
      return [...map.values()].filter(c => !isCardTombstoned(c));
    }

    function cardMediaAffectsViewport(media) {
      const card = media?.closest?.('.card');
      if (!card) return true;
      const container = card.closest('#cardsContainer');
      if (!container) return true;
      const cardR = card.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      return cardR.bottom > cr.top - 40 && cardR.top < cr.bottom + 80;
    }

    function scheduleMasonryForMedia(media) {
      if (!media) return;
      if (isMobileViewport()) {
        if (media.closest('#communityGrid, #creationsGrid, #imageGenFeed')) return;
        if (media.closest('#cardsContainer')) {
          enforceMobileCardGrid();
        }
        return;
      }
      if (media.closest('#creationsGrid') || media.closest('#communityGrid')) {
        /* flex 多列瀑布流：图片加载后不再重排，避免卡片跳动 */
      } else if (media.closest('#userProfileGrid')) {
        window.FeatureDraft?.scheduleCommunityLayout?.('userProfileGrid', { fromImage: true });
      } else if (media.closest('#imageGenFeed')) {
        window.FeatureDraft?.scheduleImageGenFeedLayout?.();
      } else if (typeof scheduleLayoutMasonry === 'function') {
        scheduleLayoutMasonry();
      }
    }
    window.scheduleMasonryForMedia = scheduleMasonryForMedia;
    window.ensureMasonryScript = ensureMasonryScript;

    function markCardImageLoadFailed(img) {
      const media = img?.closest('.card-media');
      if (!media) return;
      const card = img.closest('.card[data-id]');
      const inWarehouse = !!card?.closest('#cardsContainer');
      if (inWarehouse) {
        media.classList.remove('is-loading');
        media.classList.add('card-media--await');
        if (img.dataset.warehouseFinalFail === '1') {
          media.classList.add('card-media--load-failed');
          img.style.visibility = 'visible';
          img.style.opacity = '1';
          scheduleWarehouseMasonryForCard(card?.dataset?.id);
          return;
        }
        img.dataset.warehouseFinalFail = '1';
        const cardId = card?.dataset?.id;
        const ref = img.getAttribute('data-image-ref');
        const cardModel = cardId ? cards.find((c) => c.id === cardId) : null;
        const collectOpts = cardModel ? getCommunityCollectImageResolveOpts(cardModel) : null;
        void (async () => {
          if (!ref || !window.SupabaseSync?.resolveDisplayUrl) return;
          try {
            window.SupabaseSync.invalidateSignedCacheForRef?.(ref, cardId);
            if (collectOpts) {
              const url = await window.SupabaseSync.resolveDisplayUrl(ref, {
                ...collectOpts,
                variant: window.SupabaseSync.VARIANT_GRID || 'grid',
                tryAllPaths: true,
                listOnly: true,
                allowFullFallback: false,
                degradedListFull: false
              });
              if (url && window.CardImageLoader?.applyUrlToImg?.(img, url)) {
                delete img.dataset.warehouseFinalFail;
                media.classList.remove('card-media--load-failed', 'card-media--await');
                scheduleWarehouseMasonryForCard(cardId);
                return;
              }
            } else if (cardModel) {
              window.SupabaseSync?.queueGridBackfill?.(cardModel, { force: true });
              await new Promise((r) => setTimeout(r, 1200));
              const gridUrl = window.SupabaseSync?.getListDisplayImageSrc?.(ref, cardId)
                || window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant: 'grid' });
              if (gridUrl && window.CardImageLoader?.applyUrlToImg?.(img, gridUrl)) {
                delete img.dataset.warehouseFinalFail;
                media.classList.remove('card-media--load-failed', 'card-media--await');
                scheduleWarehouseMasonryForCard(cardId);
                return;
              }
            }
          } catch (e) { /* ignore */ }
          media.classList.add('card-media--load-failed');
          img.style.visibility = 'visible';
          img.style.opacity = '1';
          scheduleWarehouseMasonryForCard(cardId);
        })();
        return;
      }
      media.classList.remove('is-loading');
      media.remove();
      scheduleMasonryForMedia(card || media);
    }

    async function handleCardImageError(img) {
      if (!img) {
        return;
      }
      const cardId = img.closest('.card[data-id]')?.dataset?.id;
      const ref = img.getAttribute('data-image-ref');
      if (ref && img.dataset.resignTried !== '1') {
        img.dataset.resignTried = '1';
        window.SupabaseSync?.invalidateSignedCacheForRef?.(ref, cardId);
        const cardModel = cards.find((c) => c.id === cardId);
        const collectOpts = cardModel ? getCommunityCollectImageResolveOpts(cardModel) : null;
        try {
          const url = await window.SupabaseSync?.resolveDisplayUrl?.(ref, collectOpts ? {
            ...collectOpts,
            variant: window.SupabaseSync.VARIANT_GRID || 'grid',
            tryAllPaths: true,
            listOnly: true,
            allowFullFallback: false,
            degradedListFull: false
          } : {
            assetId: cardId,
            variant: window.SupabaseSync.VARIANT_GRID || 'grid',
            tryAllPaths: false,
            listOnly: true,
            allowFullFallback: false,
            degradedListFull: false
          });
          if (url && /^https?:\/\//i.test(url) && !String(url).includes('data:image/svg')) {
            const media = img.closest('.card-media');
            if (media) media.classList.remove('card-media--load-failed');
            if (window.CardImageLoader?.applyUrlToImg?.(img, url)) return;
            img.src = url;
            img.style.visibility = 'visible';
            img.style.opacity = '1';
            return;
          }
          if (!collectOpts && cardModel) {
            window.SupabaseSync?.queueGridBackfill?.(cardModel, { force: true });
            return;
          }
        } catch (e) { /* ignore */ }
      }
      if (img.dataset.repairTried === '1') {
        markCardImageLoadFailed(img);
        return;
      }
      if (!cardId) {
        markCardImageLoadFailed(img);
        return;
      }
      img.dataset.repairTried = '1';
      try {
        const backup = await getCardImageBackup(cardId);
        if (backup && String(backup).startsWith('data:')) {
          img.onerror = () => markCardImageLoadFailed(img);
          img.src = backup;
          return;
        }
        const card = cards.find((c) => c.id === cardId);
        if (card?.image && window.SupabaseSync?.repairCardImageIfMissing) {
          const fixed = await window.SupabaseSync.repairCardImageIfMissing(cardId, card.image);
          if (fixed && fixed !== card.image) {
            card.image = fixed;
            await saveAllData({ skipCloud: true });
            scheduleCloudPush();
            const url = await window.SupabaseSync.resolveDisplayUrl?.(fixed, { assetId: cardId });
            if (url && !String(url).includes('data:image/svg')) {
              img.onerror = () => markCardImageLoadFailed(img);
              img.src = url;
              return;
            }
          }
        }
      } catch (e) {
        console.warn('[cards] image repair failed', cardId, e);
      }
      markCardImageLoadFailed(img);
    }

    function bindCardGridImageErrors(root) {
      root?.querySelectorAll('.card-img').forEach((img) => {
        if (img.dataset.errBound) return;
        img.dataset.errBound = '1';
        img.addEventListener('error', () => { void handleCardImageError(img); });
      });
    }

    function isPlaceholderCardImg(img) {
      const src = img?.currentSrc || img?.src || '';
      return !src || (typeof src === 'string' && src.includes('data:image/svg'));
    }

    function clearMediaShineWatchdog(media) {
      if (!media?.__shineWatch) return;
      clearTimeout(media.__shineWatch);
      media.__shineWatch = null;
    }

    function armMediaShineWatchdog(media) {
      if (!media) return;
      clearMediaShineWatchdog(media);
      media.__shineWatch = setTimeout(() => {
        media.__shineWatch = null;
        if (!media.classList.contains('is-loading')) return;
        const im = media.querySelector('img');
        const loaded = im && im.complete && im.naturalWidth > 0 && !isPlaceholderCardImg(im);
        if (loaded) {
          finishCardMediaShine(media);
          return;
        }
        const visualCard = media.closest('#communityGrid .community-post-card--visual');
        if (visualCard) {
          visualCard.remove();
          return;
        }
        media.classList.remove('is-loading', 'media-shine-reveal');
        media.classList.add('media-revealed');
        if (im) {
          im.style.visibility = 'visible';
          im.style.opacity = '1';
        }
      }, 14000);
    }

    function finishCardMediaShine(media) {
      if (!media) return;
      const mobile = isMobileViewport();
      const sideBtn = media.classList?.contains('community-side-img-btn')
        ? media
        : media.closest?.('.community-side-img-btn');
      const shineTarget = sideBtn || media;
      const img = shineTarget.querySelector('img');
      const loaded = img && img.complete && img.naturalWidth > 0 && !isPlaceholderCardImg(img);
      if (!loaded) {
        armMediaShineWatchdog(shineTarget);
        return;
      }
      clearMediaShineWatchdog(shineTarget);
      const cardEl = media.closest('.card[data-id], .card[data-post-id]');
      shineTarget.classList.remove('is-loading', 'card-media--await');
      if (sideBtn) {
        if (img) {
          img.style.removeProperty('opacity');
          img.style.removeProperty('visibility');
        }
      } else {
        media.classList.remove('is-loading', 'card-media--await');
        media.classList.add('media-revealed');
        media.classList.remove('media-shine-reveal');
        void media.offsetWidth;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const cardId = cardEl?.dataset?.id || cardEl?.dataset?.postId || '';
          let stagger = 0;
          for (let i = 0; i < cardId.length; i++) stagger = (stagger + cardId.charCodeAt(i) * 13) % 200;
          setTimeout(() => {
            media.classList.add('media-shine-reveal');
            setTimeout(() => media.classList.remove('media-shine-reveal'), 1250);
          }, stagger);
        }
        media.style.removeProperty('min-height');
      }
      if (cardEl?.dataset?.id) {
        try { sessionStorage.setItem('ph_card_shine_' + cardEl.dataset.id, '1'); } catch (e) { /* ignore */ }
      }
      if (!mobile) {
        if (sideBtn) { /* 侧栏不参与 Masonry */ }
        else if (media.closest('#creationsGrid')) {
          window.FeatureDraft?.scheduleCommunityLayout?.('creationsGrid', { fromImage: true });
        }
        else if (media.closest('#communityGrid')) {
          window.FeatureDraft?.scheduleFeedMasonryRelayout?.('communityGrid');
        }
        else if (media.closest('#cardsContainer')) {
          if (cardMediaAffectsViewport(media)) {
            const cid = cardEl?.dataset?.id;
            if (cardEl?.dataset?.communityCollect === '1') scheduleWarehouseMasonryForCard(cid);
            else scheduleWarehouseMasonryLayout();
          }
        }
        else scheduleMasonryForMedia(media);
      } else if (media.closest('#imageGenFeed')) window.FeatureDraft?.resetMobileFeedGridStyles?.();
      else if (media.closest('#cardsContainer')) enforceMobileCardGrid();
    }
    window.finishCardMediaShine = finishCardMediaShine;

    let masonryScriptPromise = null;
    function ensureMasonryScript() {
      if (typeof Masonry !== 'undefined') return Promise.resolve();
      if (masonryScriptPromise) return masonryScriptPromise;
      const urls = [
        'vendor/masonry.pkgd.min.js',
        'https://cdn.jsdelivr.net/npm/masonry-layout@4.2.2/dist/masonry.pkgd.min.js',
        'https://unpkg.com/masonry-layout@4.2.2/dist/masonry.pkgd.min.js'
      ];
      masonryScriptPromise = new Promise((resolve, reject) => {
        let i = 0;
        const tryNext = () => {
          if (typeof Masonry !== 'undefined') {
            resolve();
            return;
          }
          if (i >= urls.length) {
            reject(new Error('Masonry load failed'));
            return;
          }
          const s = document.createElement('script');
          s.src = urls[i++];
          s.async = true;
          s.onload = () => resolve();
          s.onerror = tryNext;
          document.head.appendChild(s);
        };
        tryNext();
      });
      return masonryScriptPromise;
    }

    let tesseractScriptPromise = null;
    function ensureTesseractScript() {
      if (typeof Tesseract !== 'undefined') return Promise.resolve();
      if (tesseractScriptPromise) return tesseractScriptPromise;
      tesseractScriptPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Tesseract load failed'));
        document.head.appendChild(s);
      });
      return tesseractScriptPromise;
    }

    async function openCardImageLightbox(card) {
      if (!card?.image) return;
      const isPlaceholderSrc = (src) => !src || String(src).includes('data:image/svg');
      let url = '';
      syncLightboxActions({ cardId: card.id });
      try {
        if (window.SupabaseSync?.resolveCardDownloadUrl) {
          url = await window.SupabaseSync.resolveCardDownloadUrl(card.image, {
            assetId: card.id,
            jobId: card.genJobId || null
          });
        } else if (window.SupabaseSync?.resolveDisplayUrl) {
          url = await window.SupabaseSync.resolveDisplayUrl(card.image, {
            assetId: card.id,
            variant: window.SupabaseSync.VARIANT_FULL || 'full',
            tryAllPaths: true
          });
        }
      } catch (e) { /* ignore */ }
      if (isPlaceholderSrc(url) && window.SupabaseSync?.getCachedDisplayUrl) {
        url = window.SupabaseSync.getCachedDisplayUrl(card.image, {
          assetId: card.id,
          variant: window.SupabaseSync.VARIANT_FULL || 'full'
        }) || '';
      }
      if (!isPlaceholderSrc(url) && typeof openLightbox === 'function') {
        openLightbox(url, { cardId: card.id });
        return;
      }
      if (typeof openLightbox === 'function') openLightbox('', { pending: true, cardId: card.id });
      showToast('图片加载中，请稍候再试');
    }

    async function hydrateWarehouseBackupsFromIdb(container, list) {
      if (!container || typeof getCardImageBackup !== 'function') return;
      for (const card of (list || []).slice(0, PER_PAGE)) {
        if (!card?.id || !card?.image) continue;
        const img = container.querySelector(`.card[data-id="${card.id}"] .card-img`);
        if (!img) continue;
        const cur = img.currentSrc || img.src || '';
        if (window.SupabaseSync?.isFreshSignedDisplayUrl?.(cur, 60000)) continue;
        try {
          const backup = await getCardImageBackup(card.id);
          if (backup && String(backup).startsWith('data:') && window.CardImageLoader?.applyUrlToImg) {
            window.CardImageLoader.applyUrlToImg(img, backup);
          }
        } catch (e) { /* ignore */ }
      }
    }

    function cardImgInitialSrc(image) {
      const placeholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect fill="%2318181c" width="4" height="3"/></svg>');
      if (!image || !cardHasDisplayImage({ image })) return placeholder;
      if (typeof image === 'string' && image.startsWith('data:image/')) return image;
      if (typeof image === 'string' && /^https?:\/\//i.test(image) && !window.SupabaseSync?.isInvalidMediaUrl?.(image)) {
        return image;
      }
      return placeholder;
    }

    function getCommunityCollectImageResolveOpts(card) {
      if (!card || !window.isCommunityCollectCard?.(card)) return null;
      let authorId = String(card.communitySourceAuthorId || '');
      let sourceCardId = String(card.communitySourceCardId || card.communitySourceId || '');
      if ((!authorId || !sourceCardId) && card.favoritedFromPostId) {
        const post = window.FeatureDraft?.findPost?.(card.favoritedFromPostId);
        if (post) {
          if (!authorId) authorId = String(post.authorId || '');
          if (!sourceCardId) sourceCardId = String(post.sourceCardId || '');
        }
      }
      const ref = card.image;
      const uid = window.SupabaseSync?.getUserId?.();
      if (ref && window.SupabaseSync?.storagePathFromRef && uid) {
        const path = window.SupabaseSync.storagePathFromRef(ref) || '';
        const owner = path.replace(/^\//, '').split('/')[0] || '';
        if (owner === uid) {
          return null;
        }
        if (!authorId && owner) authorId = owner;
      }
      if (!authorId) return null;
      return {
        communityFeed: true,
        authorId,
        assetId: sourceCardId || card.id,
        cardId: sourceCardId || undefined,
        tryAllPaths: true,
        variant: window.SupabaseSync?.VARIANT_FULL || 'full'
      };
    }
    window.getCommunityCollectImageResolveOpts = getCommunityCollectImageResolveOpts;

    function migrateCommunityCollectCards() {
      const tag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
      let changed = false;
      cards.forEach((c) => {
        if (!c || typeof c !== 'object') return;
        if (c.communitySourceId) {
          if (!(c.tags || []).includes(tag)) {
            c.tags = [...(c.tags || []), tag];
            changed = true;
          }
          if (!c.communitySourceCardId) {
            c.communitySourceCardId = String(c.communitySourceId);
            changed = true;
          }
          delete c.communitySourceId;
          changed = true;
        }
        if ((c.tags || []).includes(tag)) {
          if (c.publishedToCommunity) {
            c.publishedToCommunity = false;
            changed = true;
          }
          if (!c.tags.includes(tag)) {
            c.tags = [tag, ...(c.tags || []).filter(t => t !== tag)];
            changed = true;
          }
          if (!c.communitySourceAuthorId && c.favoritedFromPostId) {
            const post = window.FeatureDraft?.findPost?.(c.favoritedFromPostId);
            if (post?.authorId) {
              c.communitySourceAuthorId = String(post.authorId);
              changed = true;
            }
            if (!c.communitySourceCardId && post?.sourceCardId) {
              c.communitySourceCardId = String(post.sourceCardId);
              changed = true;
            }
          }
        }
      });
      return changed;
    }

    function applyDataPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      const prevTombstones = { ...(settings.deletedCardTombstones || {}) };
      const prevCreTombstones = { ...(settings.deletedCreationTombstones || {}) };
      if (Array.isArray(payload.cards)) {
        cards = filterTombstonedCards(normalizeCardImages(payload.cards));
      }
      if (Array.isArray(payload.customGroups)) customGroups = payload.customGroups;
      if (Array.isArray(payload.globalFields)) globalFields = payload.globalFields;
      if (payload.settings && typeof payload.settings === 'object') {
        settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, autoDayNight: false, themeManualOverride: false }, payload.settings);
        settings.deletedCardTombstones = mergeDeletedCardTombstones(
          prevTombstones,
          payload.settings.deletedCardTombstones
        );
        settings.deletedCreationTombstones = mergeDeletedCreationTombstones(
          prevCreTombstones,
          payload.settings.deletedCreationTombstones
        );
      } else {
        if (Object.keys(prevTombstones).length) settings.deletedCardTombstones = prevTombstones;
        if (Object.keys(prevCreTombstones).length) settings.deletedCreationTombstones = prevCreTombstones;
      }
      if (Array.isArray(payload.creations)) {
        payload.creations = filterTombstonedCreations(payload.creations);
      }
      cards = filterTombstonedCards(cards);
      migrateCommunityCollectCards();
      window.Membership?.syncFromPayload?.(payload.account);
      window.FeatureDraft?.applyCloudSlice?.(payload);
      loadWarehouseGroups(getActiveWarehouseId());
      normalizeCardPins();
      floatingPromptActive = false;
      settings.floatingPrompt = false;
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      applyEfficiencyMode();
      if (settings.autoDayNight === true) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      } else if (settings.theme && typeof window.applyAppTheme === 'function') {
        window.applyAppTheme(settings.theme);
      }
    }

    function setCloudSyncPhase(phase, detail) {
      cloudSyncPhase = phase || 'idle';
      cloudSyncPhaseAt = Date.now();
      cloudSyncPhaseDetail = detail ? String(detail) : '';
      updateCloudSyncStatusUI();
    }
    window.setCloudSyncPhase = setCloudSyncPhase;

    function updateCloudSyncStatusUI() {
      const el = document.getElementById('authCloudStatus');
      const loggedIn = window.SupabaseSync?.isLoggedIn?.();
      if (!el) return;
      if (!loggedIn || cloudSyncPhase === 'idle') {
        el.classList.add('hidden');
        el.classList.remove('is-syncing', 'is-error');
        return;
      }
      el.classList.remove('hidden');
      el.classList.remove('is-syncing', 'is-error');
      let text = '正在保存到云端…';
      if (cloudSyncPhase === 'pending') text = cloudSyncPhaseDetail || '即将保存到云端…';
      else if (cloudSyncPhase === 'syncing') text = cloudSyncPhaseDetail || '正在保存到云端…';
      else if (cloudSyncPhase === 'saved') text = '已保存到云端';
      else if (cloudSyncPhase === 'error') {
        text = cloudSyncPhaseDetail ? `保存异常：${cloudSyncPhaseDetail}` : '保存异常，请稍后重试或重新登录';
        el.classList.add('is-error');
      }
      if (cloudSyncPhase === 'syncing' || cloudSyncPhase === 'pending') el.classList.add('is-syncing');
      el.textContent = text;
      if (cloudSyncPhase === 'saved') scheduleCloudSyncStatusHide(2500);
      else if (cloudSyncPhase === 'error') scheduleCloudSyncStatusHide(6000);
      else clearCloudSyncStatusHideTimer();
    }

    function refreshAppBuildLabel() {
      const build = window.__APP_BUILD__ || '未知';
      const el = document.getElementById('appBuildLabel');
      if (el) el.textContent = '版本 ' + build;
      updateCloudSyncStatusUI();
    }
    window.refreshAppBuildLabel = refreshAppBuildLabel;

    function updateAuthUI(session) {
      const openBtn = document.getElementById('authOpenBtn');
      const userBar = document.getElementById('authUserBar');
      const emailEl = document.getElementById('authUserEmail');
      const configured = window.SupabaseSync?.isConfigured?.();
      if (!openBtn) return;
      if (!configured) {
        openBtn.textContent = '云同步未配置';
        openBtn.disabled = true;
        userBar?.classList.add('hidden');
        updateCloudSyncStatusUI();
        return;
      }
      openBtn.disabled = false;
      if (session?.user) {
        openBtn.classList.add('hidden');
        userBar?.classList.remove('hidden');
        const label = session.user.email || session.user.phone || '已登录';
        if (emailEl) {
          emailEl.textContent = label;
          emailEl.title = label;
        }
        updateCloudSyncStatusUI();
      } else {
        openBtn.classList.remove('hidden');
        openBtn.textContent = '登录 / 注册';
        userBar?.classList.add('hidden');
        cloudSyncPhase = 'idle';
        updateCloudSyncStatusUI();
      }
      updateGuestLimitUI();
      const syncBtn = document.getElementById('communitySyncLibraryBtn');
      if (syncBtn) syncBtn.classList.toggle('hidden', !session?.user);
    }

    let loginFlowPromise = null;

    function isPostLogoutBlocked() {
      return localStorage.getItem('promptrepo_post_logout') === '1';
    }

    async function completeAuthSession(opts = {}) {
      const session = window.SupabaseSync?.getSession?.();
      if (!session?.user) {
        if (isPostLogoutBlocked()) {
          updateAuthUI(null);
          try {
            await window.SupabaseSync?.signOut?.();
          } catch (e) { /* ignore */ }
        } else {
          updateAuthUI(null);
        }
        return;
      }
      localStorage.removeItem('promptrepo_post_logout');
      updateAuthUI(session);
      if (loginFlowPromise) {
        await loginFlowPromise;
        return;
      }
      loginFlowPromise = handleCloudAfterLogin(opts).finally(() => {
        loginFlowPromise = null;
      });
      await loginFlowPromise;
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
      const displayNameWrap = document.getElementById('authDisplayNameWrap');
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
      displayNameWrap?.classList.toggle('hidden', mode !== 'register');
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
      if (!e) return '操作失败，请稍后重试';
      if (window.SupabaseSync?.formatAuthError) {
        const msg = window.SupabaseSync.formatAuthError(e);
        if (msg && msg !== '操作失败') return msg;
      }
      const m = String(e.message || e.error_description || '').trim();
      if (m && m !== '{}' && m !== '[object Object]') return m;
      return '登录失败，请检查网络后重试';
    }

    async function authSignIn() {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value;
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('登录中…');
        localStorage.removeItem('promptrepo_post_logout');
        await window.SupabaseSync.signIn(email, password);
        await completeAuthSession({ silent: false, migrateGuest: true });
        if (!window.SupabaseSync?.isLoggedIn?.()) {
          setAuthStatus('登录未完成，请关闭弹窗后按 Ctrl+F5 强刷再试', 'error');
          return;
        }
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
      const nickRaw = document.getElementById('authDisplayName')?.value?.trim() || '';
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      if (password.length < 6) { setAuthStatus('密码至少 6 位', 'error'); return; }
      if (password !== confirm) { setAuthStatus('两次输入的密码不一致', 'error'); return; }
      if (nickRaw && !/^[\u4e00-\u9fa5a-zA-Z0-9_\-]{2,20}$/.test(nickRaw)) {
        setAuthStatus('昵称需 2～20 字，仅支持中文、字母、数字、下划线或连字符', 'error');
        return;
      }
      try {
        setAuthBusy(true);
        setAuthStatus('注册中…');
        const data = await window.SupabaseSync.signUp(email, password);
        if (data.session) {
          closeAuthModal();
          await completeAuthSession({ silent: false, migrateGuest: true });
          if (nickRaw && window.PromptHubApi?.setDisplayName) {
            const nr = await window.PromptHubApi.setDisplayName(nickRaw);
            if (!nr.ok) showToast(nr.message || '昵称设置失败，已自动生成昵称');
          }
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
        localStorage.removeItem('promptrepo_post_logout');
        await window.SupabaseSync.verifyPhoneOtp(phone, otp);
        await completeAuthSession({ silent: false, migrateGuest: true });
        if (!window.SupabaseSync?.isLoggedIn?.()) {
          setAuthStatus('登录未完成，请关闭弹窗后按 Ctrl+F5 强刷再试', 'error');
          return;
        }
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

    async function snapshotLocalForUser(uid, opts = {}) {
      if (!uid) return;
      const payload = getDataPayload();
      const cardN = Array.isArray(payload.cards) ? payload.cards.length : 0;
      const groupN = Array.isArray(payload.customGroups) ? payload.customGroups.length : 0;
      if (!opts.allowEmpty && cardN === 0 && groupN === 0) {
        try {
          const prev = JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null');
          if (Array.isArray(prev?.cards) && prev.cards.length > 0) return;
        } catch (e) { /* ignore */ }
      }
      try {
        localStorage.setItem(userStorageKey('snapshot', uid), JSON.stringify(payload));
      } catch (e) { /* quota */ }
    }

    async function clearIdbObjectStore(storeName) {
      if (!db) await openDB();
      if (!db?.objectStoreNames?.contains(storeName)) return;
      return new Promise((resolve) => {
        const tx = db.transaction([storeName], 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    async function clearWorkspace() {
      clearTimeout(cloudPushTimer);
      if (cards.length > 0 || customGroups.length > 0) {
        await writeEmergencyBackup('pre_clear_workspace');
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) await snapshotLocalForUser(uid);
      }
      cards = [];
      customGroups = [];
      globalFields = [];
      selectedCardIds.clear();
      selectedCardId = null;
      window.__promptHubCards = [];
      window.CardImageLoader?.disconnect?.();
      window.FeatureDraft?.clearSensitiveLocalStateOnSignOut?.();
      await saveCardsToDB([], { ownerUid: '' });
      await clearIdbObjectStore('data_backups');
      await clearIdbObjectStore('card_image_backups');
      setIdbOwnerUid('');
      localStorage.removeItem('promptrepo_groups');
      localStorage.removeItem('promptrepo_fields');
      localStorage.removeItem('promptrepo_settings');
      localStorage.removeItem('promptrepo_autosave_snapshot');
      try {
        sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      } catch (e) { /* ignore */ }
    }

    /** 退出后清私人卡片库；社区/创作本地缓存一并清空，由全站 API 重新加载 */
    async function purgeSignedOutLocalData() {
      flushPrivateWarehouseUI();
      await clearWorkspace();
      window.FeatureDraft?.clearAllLocalFeatureData?.();
      window.FeatureDraft?.renderCommunity?.({ immediate: true, skipFeedFetch: true });
      void window.FeatureDraft?.renderCreations?.();
    }

    function flushPrivateWarehouseUI() {
      cards = [];
      customGroups = [];
      globalFields = [];
      selectedCardIds.clear();
      selectedCardId = null;
      isNewCardMode = false;
      window.__promptHubCards = [];
      window.CardImageLoader?.disconnect?.();
      const box = document.getElementById('cardsContainer');
      if (box) {
        box.innerHTML = '<div class="feature-empty" style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--text-muted)"><p>请先登录查看你的卡片库</p><button type="button" class="btn btn-primary" style="margin-top:12px" onclick="openAuthModal(\'login\')">登录</button></div>';
      }
      renderGroups();
      renderCards(true);
      window.FeatureDraft?.renderCommunity?.();
    }

    function hadLoggedInAccountLocally() {
      return !!localStorage.getItem('promptrepo_last_uid');
    }

    async function bootstrapWhenLoggedOut() {
      const postLogout = localStorage.getItem('promptrepo_post_logout') === '1';
      window.Membership?.clearLocalState?.();
      window.SubscriptionUI?.refreshOfferUI?.();
      if (postLogout || hadLoggedInAccountLocally()) {
        if (postLogout) localStorage.removeItem('promptrepo_post_logout');
        await purgeSignedOutLocalData();
        cards = [];
        customGroups = [];
        window.__promptHubCards = [];
      } else {
        await loadGuestWorkspace();
        window.FeatureDraft?.reloadStores?.();
        window.FeatureDraft?.scheduleGenJobsSync?.(500);
      }
      window.__promptHubCards = cards;
      renderGroups();
      renderCards(true);
      updateGuestLimitUI();
      window.FeatureDraft?.renderCommunity?.();
    }

    function finishAppBootstrap() {
      restoreDesktopCardColumns();
      const page = localStorage.getItem('promptrepo_app_page') || 'community';
      switchAppPage(page);
      if (window.MobileUI.isMobile()) {
        const mobileTab = page === 'community' ? 'community' : page === 'imagegen' ? 'imagegen' : 'cards';
        document.querySelectorAll('.mobile-tab').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.mobileTab === mobileTab);
        });
      }
      if (cards.length > 0) {
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      }
      if (page === 'community') {
        window.FeatureDraft?.renderCommunity?.();
      }
      const refreshFeeds = () => window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
      if (window.MobileUI?.isMobile?.() && page !== 'community') {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(refreshFeeds, { timeout: 8000 });
        else setTimeout(refreshFeeds, 2500);
      } else {
        refreshFeeds();
      }
      if (window.SupabaseSync?.isLoggedIn?.()) {
        void repairGeneratedCardImagesQuiet();
      }
    }
    function bindQuickPreviewButtons() {
      document.getElementById('appreciateViewerGenBtn')?.addEventListener('click', () => {
        const card = cards.find((c) => c.id === warehousePreviewCardId);
        if (!card) return;
        markQuickPreviewTask({ warehouseGotoGen: true });
        closeAppreciateViewer();
        forceExitGlobalView(true);
        void window.FeatureDraft?.fillCardToImageGen?.(card);
      });
    }
    window.syncAppreciateViewerActions = syncAppreciateViewerActions;

    window.finishAppBootstrap = finishAppBootstrap;

    async function tryRestoreFromEmergencyBackup(uid) {
      if (!uid || !db) await openDB();
      if (!uid || !db?.objectStoreNames?.contains('data_backups')) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readonly');
        const req = tx.objectStore('data_backups').getAll();
        req.onsuccess = () => {
          const list = (req.result || []).sort((a, b) => (b.at || 0) - (a.at || 0));
          const hit = list.find((row) => {
            if (!row?.payload?.cards?.length) return false;
            if (!/pre_(db_clear|clear_workspace|pull)|auto_save|page_hide/.test(String(row.label || ''))) return false;
            const owner = row.ownerUid || row.payload?.ownerUid || '';
            return owner === uid;
          });
          if (!hit?.payload) {
            resolve(false);
            return;
          }
          applyDataPayload(hit.payload);
          void saveCardsToDB(cards, { ownerUid: uid }).then(() => resolve(true));
        };
        req.onerror = () => resolve(false);
      });
    }

    function groupNamesFromCards(list) {
      const names = new Set();
      (list || []).forEach((c) => {
        const g = String(c?.group || '').trim();
        if (g && g !== '未分类') names.add(g);
      });
      return [...names];
    }

    function ensureGroupsFromCards() {
      if (customGroups.length) return false;
      const names = groupNamesFromCards(cardsForActiveWarehouse(filterTombstonedCards(cards)));
      if (!names.length) return false;
      return mergeWarehouseGroupsFromList(names);
    }

    async function readEmergencyBackupRows(uid) {
      if (!db) await openDB();
      if (!db?.objectStoreNames?.contains('data_backups')) return [];
      return new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readonly');
        const req = tx.objectStore('data_backups').getAll();
        req.onsuccess = () => {
          const list = (req.result || [])
            .filter((row) => {
              if (!row?.payload?.cards?.length) return false;
              if (!uid) return true;
              const owner = row.ownerUid || row.payload?.ownerUid || '';
              return !owner || owner === uid;
            })
            .sort((a, b) => (b.at || 0) - (a.at || 0))
            .map((row) => ({
              label: row.label,
              at: row.at,
              cards: row.payload.cards.length,
              groups: Array.isArray(row.payload.customGroups) ? row.payload.customGroups.length : 0,
              payload: row.payload
            }));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      });
    }

    async function inspectCardLibraryRecovery() {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || localStorage.getItem('promptrepo_last_uid') || '';
      let autosaveN = 0;
      let snapshotN = 0;
      let autosaveGroups = 0;
      let snapshotGroups = 0;
      try {
        const auto = JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null');
        autosaveN = auto?.cards?.length || 0;
        autosaveGroups = auto?.customGroups?.length || 0;
      } catch (e) { /* ignore */ }
      try {
        const snap = JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null');
        snapshotN = snap?.cards?.length || 0;
        snapshotGroups = snap?.customGroups?.length || 0;
      } catch (e) { /* ignore */ }
      const idbAll = await loadCardsFromDB({ ignoreOwner: true });
      const idbOwned = uid ? await loadCardsFromDB({ ownerUid: uid }) : idbAll;
      const emergency = await readEmergencyBackupRows(uid);
      let cloudN = 0;
      let cloudGroups = 0;
      if (window.SupabaseSync?.isLoggedIn?.()) {
        try {
          const cloud = await window.SupabaseSync.pullCloudData();
          cloudN = cloud?.cards?.length || 0;
          cloudGroups = cloud?.customGroups?.length || 0;
        } catch (e) { /* ignore */ }
      }
      const tombN = Object.keys(settings.deletedCardTombstones || {}).length;
      const groupsInCards = groupNamesFromCards(cards).length;
      return {
        build: window.__APP_BUILD__,
        uid,
        currentUi: cards.length,
        idbOwned: idbOwned.length,
        idbAll: idbAll.length,
        autosave: autosaveN,
        autosaveGroups,
        snapshot: snapshotN,
        snapshotGroups,
        cloud: cloudN,
        cloudGroups,
        tombstones: tombN,
        groupsInCards,
        customGroupsNow: customGroups.length,
        emergencyBackups: emergency.map((row) => ({
          label: row.label,
          at: new Date(row.at).toLocaleString(),
          cards: row.cards,
          groups: row.groups
        }))
      };
    }

    async function restoreBestCardLibraryBackup(opts = {}) {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || localStorage.getItem('promptrepo_last_uid') || '';
      const currentN = cards.length;
      const candidates = [];
      const pushCandidate = (source, payload) => {
        if (!payload?.cards?.length) return;
        candidates.push({
          source,
          cards: payload.cards.length,
          groups: Array.isArray(payload.customGroups) ? payload.customGroups.length : 0,
          payload
        });
      };
      try {
        pushCandidate('autosave', JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null'));
      } catch (e) { /* ignore */ }
      try {
        pushCandidate('snapshot', JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null'));
      } catch (e) { /* ignore */ }
      const idbAll = await loadCardsFromDB({ ignoreOwner: true });
      if (idbAll.length) {
        pushCandidate('indexeddb', { cards: idbAll, customGroups });
      }
      const emergency = await readEmergencyBackupRows(uid);
      emergency.forEach((row) => pushCandidate(`emergency:${row.label}`, row.payload));
      if (!candidates.length) {
        return { ok: false, reason: 'no_backup_found', current: currentN };
      }
      candidates.sort((a, b) => b.cards - a.cards || b.groups - a.groups);
      const best = candidates[0];
      if (!opts.force && best.cards <= currentN) {
        return {
          ok: false,
          reason: 'no_better_backup',
          current: currentN,
          best: { source: best.source, cards: best.cards, groups: best.groups },
          candidates: candidates.slice(0, 6).map((c) => ({ source: c.source, cards: c.cards, groups: c.groups }))
        };
      }
      await writeEmergencyBackup('pre_manual_restore');
      applyDataPayload(best.payload);
      ensureGroupsFromCards();
      window.__promptHubCards = cards;
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
      return {
        ok: true,
        restoredFrom: best.source,
        cards: cards.length,
        groups: customGroups.length,
        previous: currentN
      };
    }

    window.inspectCardLibraryRecovery = inspectCardLibraryRecovery;
    window.restoreBestCardLibraryBackup = restoreBestCardLibraryBackup;

    function cardMetaFromCommunityPosts(cardId) {
      const posts = window.FeatureDraft?.getCommunityPosts?.()
        || (() => {
          try {
            return JSON.parse(localStorage.getItem('promptrepo_community_posts') || '[]');
          } catch (e) {
            return [];
          }
        })();
      const post = (posts || []).find((p) => String(p?.sourceCardId || p?.cardId || '') === String(cardId));
      if (!post) return null;
      return {
        title: post.title || '',
        prompt: post.prompt || post.content || '',
        group: post.group || null,
        tags: Array.isArray(post.tags) ? post.tags.slice() : [],
        image: post.image || post.coverImage || null
      };
    }

    function cardMetaFromCreations(cardId, jobId) {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]');
      } catch (e) { /* ignore */ }
      const byCard = list.find((c) => String(c?.sourceCardId || c?.cardId || c?.id || '') === String(cardId));
      if (byCard) {
        return {
          title: byCard.title || '',
          prompt: byCard.prompt || '',
          group: byCard.group || null,
          tags: Array.isArray(byCard.tags) ? byCard.tags.slice() : [],
          image: byCard.image || null,
          jobId: byCard.jobId || jobId || null
        };
      }
      if (jobId) {
        const byJob = list.find((c) => String(c?.jobId || '') === String(jobId));
        if (byJob) {
          return {
            title: byJob.title || '',
            prompt: byJob.prompt || '',
            group: byJob.group || null,
            tags: Array.isArray(byJob.tags) ? byJob.tags.slice() : [],
            image: byJob.image || null,
            jobId: byJob.jobId || jobId
          };
        }
      }
      return null;
    }

    async function classifyStorageBlob(blob) {
      if (!blob || (blob.size || 0) < 512) return 'missing';
      const ok = await window.SupabaseSync?.blobLooksLikeUsableImage?.(blob);
      return ok ? 'ok' : 'black';
    }

    async function probeCardStoragePaths(cardId, opts = {}) {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || '';
      const hintImage = opts.hintImage || null;
      const paths = new Set();
      if (hintImage && window.SupabaseSync?.isStorageRef?.(hintImage)) {
        window.SupabaseSync.listImagePathCandidates(
          window.SupabaseSync.normalizeImageRef(hintImage),
          cardId,
          uid
        ).forEach((p) => paths.add(p.replace(/^\//, '')));
      }
      const primary = window.SupabaseSync?.cardImageStoragePath?.(cardId, uid);
      const grid = window.SupabaseSync?.gridImageStoragePath?.(cardId, uid);
      if (primary) paths.add(primary.replace(/^\//, ''));
      if (grid) paths.add(grid.replace(/^\//, ''));
      paths.add(`${uid}/generated/${String(cardId).replace(/^wh_/, '')}.jpg`);
      paths.add(`${uid}/generated/${String(cardId).replace(/^wh_/, '')}_grid.jpg`);

      let primaryState = 'missing';
      let gridState = 'missing';
      let primaryPath = null;
      let gridPath = null;
      let primaryBytes = 0;
      let gridBytes = 0;

      for (const p of paths) {
        if (!p || !window.SupabaseSync?.storagePathOwnedByCurrentUser?.(p)) continue;
        const isGrid = /_grid\.(jpe?g|webp|png)$/i.test(p);
        const blob = await window.SupabaseSync?.downloadOwnedStorageBlob?.(p, {
          ignoreMissingCache: true,
          cardId
        });
        const state = await classifyStorageBlob(blob);
        if (isGrid) {
          if (state !== 'missing' && (gridState === 'missing' || state === 'ok')) {
            gridState = state;
            gridPath = p;
            gridBytes = blob?.size || 0;
          }
        } else if (state !== 'missing' && (primaryState === 'missing' || state === 'ok')) {
          primaryState = state;
          primaryPath = p;
          primaryBytes = blob?.size || 0;
        }
      }

      if (primary && primaryState === 'missing') {
        const pb = await window.SupabaseSync?.downloadOwnedStorageBlob?.(primary.replace(/^\//, ''), {
          ignoreMissingCache: true,
          cardId
        });
        primaryState = await classifyStorageBlob(pb);
        if (primaryState !== 'missing') {
          primaryPath = primary.replace(/^\//, '');
          primaryBytes = pb?.size || 0;
        }
      }
      if (grid && gridState === 'missing') {
        const gb = await window.SupabaseSync?.downloadOwnedStorageBlob?.(grid.replace(/^\//, ''), {
          ignoreMissingCache: true,
          cardId
        });
        gridState = await classifyStorageBlob(gb);
        if (gridState !== 'missing') {
          gridPath = grid.replace(/^\//, '');
          gridBytes = gb?.size || 0;
        }
      }

      let verdict = 'missing';
      if (primaryState === 'ok') verdict = 'recoverable_primary';
      else if (gridState === 'ok') verdict = 'recoverable_grid_only';
      else if (primaryState === 'black' || gridState === 'black') verdict = 'black';

      const imageRef = primaryPath
        ? window.SupabaseSync.toStorageRef(primaryPath)
        : (gridPath ? window.SupabaseSync.toStorageRef(gridPath) : null);

      return {
        cardId: String(cardId),
        verdict,
        primaryState,
        gridState,
        primaryPath,
        gridPath,
        primaryBytes,
        gridBytes,
        imageRef
      };
    }

    async function inspectTombstoneStorageRecovery(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        return { ok: false, error: '请先登录' };
      }
      const max = Math.min(500, Math.max(1, Number(opts.max) || 60));
      const delayMs = Math.max(0, Number(opts.delayMs) || 120);
      const uid = window.SupabaseSync.getUserId();
      const tombstones = { ...(settings.deletedCardTombstones || {}) };
      const currentIds = new Set(cards.map((c) => String(c.id)));
      const ids = Object.keys(tombstones).filter((id) => !currentIds.has(String(id)));
      const report = {
        build: window.__APP_BUILD__,
        uid,
        tombstones: ids.length,
        scanned: 0,
        recoverablePrimary: [],
        recoverableGridOnly: [],
        black: [],
        missing: [],
        samples: []
      };
      for (let i = 0; i < Math.min(max, ids.length); i += 1) {
        const id = ids[i];
        try {
          const meta = cardMetaFromCommunityPosts(id) || cardMetaFromCreations(id);
          window.SupabaseSync?.clearPathMissingForCard?.(id, meta?.image || null);
          const probe = await probeCardStoragePaths(id, { hintImage: meta?.image });
          report.scanned += 1;
          const row = {
            id,
            title: (meta?.title || meta?.prompt || id).toString().slice(0, 48),
            prompt: (meta?.prompt || '').toString().slice(0, 120),
            tombAt: tombstones[id] ? new Date(tombstones[id]).toLocaleString() : '',
            ...probe
          };
          if (probe.verdict === 'recoverable_primary') report.recoverablePrimary.push(row);
          else if (probe.verdict === 'recoverable_grid_only') report.recoverableGridOnly.push(row);
          else if (probe.verdict === 'black') report.black.push(row);
          else report.missing.push(row);
          if (i < 8) report.samples.push(row);
          if ((i + 1) % 10 === 0) {
            console.log('[Recovery] tombstone scan progress', i + 1, '/', Math.min(max, ids.length));
          }
        } catch (e) {
          report.missing.push({ id, title: id, verdict: 'error', error: String(e?.message || e) });
        }
        if (delayMs && i < ids.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      report.summary = {
        recoverablePrimary: report.recoverablePrimary.length,
        recoverableGridOnly: report.recoverableGridOnly.length,
        black: report.black.length,
        missing: report.missing.length,
        remaining: Math.max(0, ids.length - report.scanned)
      };
      window.__lastTombScan = report;
      window.__lastTombstoneScan = report;
      console.log('[Recovery] tombstone storage scan done', report.summary, '→ window.__lastTombScan');
      return report;
    }

    async function planApimartRecovery(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        return { ok: false, error: '请先登录' };
      }
      const days = Math.min(365, Math.max(1, Number(opts.days) || 90));
      const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
      const currentIds = new Set(cards.map((c) => String(c.id)));
      const jobIdsInCards = new Set(cards.filter((c) => c?.genJobId).map((c) => String(c.genJobId)));
      const tombstones = settings.deletedCardTombstones || {};

      let creations = [];
      try {
        creations = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]');
      } catch (e) { /* ignore */ }

      let cloudCreations = [];
      try {
        const cloud = await window.SupabaseSync.pullCloudData();
        if (Array.isArray(cloud?.creations)) cloudCreations = cloud.creations;
      } catch (e) { /* ignore */ }

      let apiJobs = [];
      if (window.PromptHubApi?.listGenerationJobsHistory) {
        try {
          const res = await window.PromptHubApi.listGenerationJobsHistory({ days, limit });
          if (res?.ok && Array.isArray(res.data?.jobs)) apiJobs = res.data.jobs;
        } catch (e) {
          console.warn('[Recovery] jobs history', e);
        }
      }

      const urlRows = [];
      const pushUrl = (row) => {
        if (!row.url) return;
        const key = `${row.jobId || ''}:${row.url}`;
        if (urlRows.some((r) => `${r.jobId || ''}:${r.url}` === key)) return;
        urlRows.push(row);
      };

      for (const job of apiJobs) {
        if (job.status && job.status !== 'completed') continue;
        const urls = [job.imageUrl, ...(job.extraImageUrls || [])].filter(Boolean);
        urls.forEach((url, idx) => {
          pushUrl({
            source: 'api_job',
            jobId: job.id,
            apimartTaskId: job.apimartTaskId || null,
            status: job.status,
            provider: job.provider || null,
            url,
            prompt: (job.prompt || '').slice(0, 120),
            createdAt: job.createdAt,
            variant: idx
          });
        });
      }

      for (const c of [...creations, ...cloudCreations]) {
        if (!c?.image) continue;
        pushUrl({
          source: 'creation',
          jobId: c.jobId || null,
          cardId: c.sourceCardId || c.cardId || c.id,
          url: c.image,
          prompt: (c.prompt || '').slice(0, 120),
          createdAt: c.createdAt || c.updatedAt
        });
      }

      const recoverableUrls = urlRows.filter((row) => {
        const cid = row.cardId ? String(row.cardId) : '';
        const inLib = cid && currentIds.has(cid);
        const jobKnown = row.jobId && jobIdsInCards.has(String(row.jobId));
        return !inLib && !jobKnown;
      });

      const apimartHosts = /apimart\.ai|upload\.apimart|filesystem\.site/i;
      const apimartRows = recoverableUrls.filter((r) => apimartHosts.test(String(r.url)));

      const tombstoneJobHints = apiJobs.filter((j) => {
        const linked = creations.find((c) => String(c.jobId) === String(j.id));
        const cardId = linked?.sourceCardId || linked?.cardId;
        return cardId && tombstones[String(cardId)] && !currentIds.has(String(cardId));
      });

      const result = {
        build: window.__APP_BUILD__,
        days,
        apiJobs: apiJobs.length,
        urlCandidates: urlRows.length,
        recoverableUrls: recoverableUrls.length,
        apimartUrls: apimartRows.length,
        tombstoneJobHints: tombstoneJobHints.length,
        recoverableList: recoverableUrls,
        apimartList: apimartRows,
        apimartSample: apimartRows.slice(0, 12),
        recoverableSample: recoverableUrls.slice(0, 12),
        note: '结果已存 window.__lastApPlan；Storage 恢复用 restoreFromTombstoneStorageScan；Apimart 用 importApimartRecoveryFromPlan'
      };
      window.__lastApPlan = result;
      window.__lastAppPlan = result;
      console.log('[Recovery] apimart plan', {
        recoverableUrls: result.recoverableUrls,
        apimartUrls: result.apimartUrls
      }, '→ window.__lastApPlan');
      return result;
    }

    async function restoreCardsFromRecoveryPlan(entries, opts = {}) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) return { ok: false, reason: 'empty_plan' };
      await writeEmergencyBackup('pre_tombstone_restore');
      let restored = 0;
      let skipped = 0;
      const restoredIds = [];
      for (const entry of list) {
        const id = String(entry.id || entry.cardId || '');
        if (!id) { skipped += 1; continue; }
        if (cards.some((c) => String(c.id) === id)) { skipped += 1; continue; }
        const image = entry.image || entry.imageRef;
        if (!image) { skipped += 1; continue; }
        if (opts.storageOnly !== false && !window.SupabaseSync?.isStorageRef?.(image)) {
          skipped += 1;
          continue;
        }
        clearCardDeletionTombstone(id);
        window.SupabaseSync?.clearPathMissingForCard?.(id, image);
        const meta = entry.meta || cardMetaFromCommunityPosts(id) || cardMetaFromCreations(id, entry.jobId) || {};
        cards.push({
          id,
          title: entry.title || meta.title || (meta.prompt || '').slice(0, 40) || '',
          prompt: entry.prompt || meta.prompt || '',
          image: window.SupabaseSync?.isStorageRef?.(image)
            ? window.SupabaseSync.normalizeImageRef(image)
            : image,
          group: entry.group ?? meta.group ?? null,
          tags: Array.isArray(entry.tags) ? entry.tags : (meta.tags || []),
          customFields: entry.customFields || meta.customFields || {},
          genJobId: entry.jobId || meta.jobId || null,
          createdAt: entry.createdAt || meta.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        restored += 1;
        restoredIds.push(id);
      }
      window.__promptHubCards = cards;
      ensureGroupsFromCards();
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
      if (opts.pushCloud === true && window.SupabaseSync?.isLoggedIn?.()) {
        await pushToCloud({ silent: true, skipSafety: false, deferImageUpload: true });
      }
      return { ok: true, restored, skipped, restoredIds, total: cards.length };
    }

    async function restoreFromTombstoneStorageScan(scanReport, opts = {}) {
      const report = scanReport || await inspectTombstoneStorageRecovery(opts);
      const pick = [
        ...(report.recoverablePrimary || []),
        ...(opts.includeGridOnly ? (report.recoverableGridOnly || []) : [])
      ];
      const entries = pick.map((row) => ({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        image: row.imageRef,
        meta: cardMetaFromCommunityPosts(row.id) || cardMetaFromCreations(row.id)
      })).filter((e) => e.image);
      return restoreCardsFromRecoveryPlan(entries, opts);
    }

    async function runFullRecoveryDiagnosis(opts = {}) {
      console.log('[Recovery] 开始完整诊断…（404 为探测缺失路径，属正常）');
      const base = await inspectCardLibraryRecovery();
      const tombScan = await inspectTombstoneStorageRecovery({
        max: opts.tombMax || 60,
        delayMs: opts.delayMs || 120
      });
      const apPlan = await planApimartRecovery({
        days: opts.days || 90,
        limit: opts.limit || 200
      });
      const out = { base, tombScan, apPlan };
      window.__lastRecoveryDiagnosis = out;
      console.table([
        { 项: '当前卡片', 值: base.currentUi },
        { 项: 'tombstones', 值: base.tombstones },
        { 项: 'Storage可救(主图)', 值: tombScan.summary?.recoverablePrimary ?? 0 },
        { 项: 'Storage仅grid', 值: tombScan.summary?.recoverableGridOnly ?? 0 },
        { 项: 'Storage黑图', 值: tombScan.summary?.black ?? 0 },
        { 项: 'Apimart可导入URL', 值: apPlan.recoverableUrls ?? 0 }
      ]);
      return out;
    }

    async function fetchRecoveryImageBlob(url, opts = {}) {
      if (!url) return null;
      const cardId = opts.cardId || opts.jobId || null;
      if (window.SupabaseSync?.isStorageRef?.(url)) {
        const blob = await window.SupabaseSync.downloadCardStorageBlob(
          window.SupabaseSync.normalizeImageRef(url),
          cardId
        );
        if (blob && await window.SupabaseSync.blobLooksLikeUsableImage(blob)) {
          return { blob, resolvedUrl: url };
        }
        return null;
      }
      if (!/^https?:\/\//i.test(url)) return null;
      let blob = null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
        if (tmp) {
          try {
            const res = await fetch(tmp);
            if (res.ok) blob = await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      if (!blob) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) blob = await res.blob();
        } catch (e) { /* ignore */ }
      }
      if (!blob || !(await window.SupabaseSync?.blobLooksLikeUsableImage?.(blob))) return null;
      return { blob, resolvedUrl: url };
    }

    async function resolveRecoveryRowUrl(row) {
      if (!row) return null;
      if (row.jobId && window.PromptHubApi?.getGenerationImageUrl) {
        try {
          const res = await window.PromptHubApi.getGenerationImageUrl(row.jobId);
          if (res?.ok && res.data?.url) return res.data.url;
        } catch (e) { /* ignore */ }
      }
      return row.url || null;
    }

    async function preflightApimartRecovery(plan, opts = {}) {
      const src = plan || window.__lastApPlan || window.__lastRecoveryDiagnosis?.apPlan;
      if (!src) return { ok: false, error: 'no_plan' };
      const rows = (opts.apimartOnly === true
        ? (src.apimartList || [])
        : (src.recoverableList || []))
        .filter((r) => !r.status || r.status === 'completed');
      const max = Math.min(30, Math.max(1, Number(opts.max) || 10));
      const batch = rows.slice(0, max);
      const good = [];
      const bad = [];
      for (const row of batch) {
        const resolved = await resolveRecoveryRowUrl(row);
        const got = await fetchRecoveryImageBlob(resolved, { jobId: row.jobId, cardId: row.cardId });
        if (got) good.push({ ...row, resolvedUrl: got.resolvedUrl });
        else bad.push({ ...row, resolvedUrl: resolved, reason: '404_or_black' });
        await new Promise((r) => setTimeout(r, 200));
      }
      window.__lastApimartPreflight = { good, bad, at: Date.now() };
      console.log('[Recovery] preflight', { good: good.length, bad: bad.length });
      return { ok: true, good, bad };
    }

    async function importApimartRecoveryFromPlan(plan, opts = {}) {
      const src = plan || window.__lastApPlan || window.__lastAppPlan || window.__lastRecoveryDiagnosis?.apPlan;
      if (!src) return { ok: false, error: 'no_plan' };
      let rows = (opts.apimartOnly === true
        ? (src.apimartList || [])
        : (src.recoverableList || src.recoverableSample || []))
        .filter((r) => !r.status || r.status === 'completed');
      if (opts.usePreflight === true && window.__lastApimartPreflight?.good?.length) {
        rows = window.__lastApimartPreflight.good;
      }
      const max = Math.min(30, Math.max(1, Number(opts.max) || 5));
      const batch = rows.slice(0, max);
      if (!batch.length) return { ok: false, error: 'no_rows' };
      const ok = window.confirm(
        `将验证并导入最多 ${batch.length} 张（先拉取图片、跳过 404/黑图，新 ID 不覆盖旧 Storage）。\n继续？`
      );
      if (!ok) return { ok: false, cancelled: true };
      await writeEmergencyBackup('pre_apimart_import');
      let imported = 0;
      let skipped = 0;
      const ids = [];
      const failures = [];
      for (const row of batch) {
        if (!row?.url && !row?.resolvedUrl) { skipped += 1; continue; }
        if (row.jobId && cards.some((c) => String(c.genJobId) === String(row.jobId))) {
          skipped += 1;
          continue;
        }
        try {
          const resolved = row.resolvedUrl || await resolveRecoveryRowUrl(row);
          const got = await fetchRecoveryImageBlob(resolved, { jobId: row.jobId, cardId: row.cardId });
          if (!got) {
            skipped += 1;
            failures.push({ jobId: row.jobId, url: resolved, reason: '404_or_black' });
            continue;
          }
          let imageRef = got.resolvedUrl;
          let presetCardId = null;
          if (window.SupabaseSync?.isLoggedIn?.()) {
            if (row.jobId && window.SupabaseSync.persistGenerationImage) {
              imageRef = await window.SupabaseSync.persistGenerationImage(row.jobId, got.blob);
            } else if (window.SupabaseSync.uploadCardImage) {
              presetCardId = generateId();
              imageRef = await window.SupabaseSync.uploadCardImage(presetCardId, got.blob, { original: false });
            }
          }
          const r = await window.addCardFromGenerated?.({
            cardId: presetCardId || undefined,
            prompt: row.prompt || '',
            image: imageRef,
            jobId: row.jobId || null,
            title: (row.prompt || '').slice(0, 40),
            silentToast: true,
            deferCloudPush: true
          });
          if (r?.ok) {
            imported += 1;
            if (r.cardId) ids.push(r.cardId);
          } else {
            skipped += 1;
            failures.push({ jobId: row.jobId, reason: r?.duplicate ? 'duplicate' : 'add_failed' });
          }
        } catch (e) {
          skipped += 1;
          failures.push({ jobId: row.jobId, reason: String(e?.message || e) });
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      renderGroups();
      renderCards(true);
      if (imported > 0) showToast(`已导入 ${imported} 张（跳过 ${skipped} 张无效/重复）`, 6000);
      return { ok: true, imported, skipped, ids, failures, total: cards.length };
    }

    window.runFullRecoveryDiagnosis = runFullRecoveryDiagnosis;
    window.importApimartRecoveryFromPlan = importApimartRecoveryFromPlan;
    window.preflightApimartRecovery = preflightApimartRecovery;

    /** 服务端一键恢复（推荐）：不经过浏览器拉 Apimart，避免 401/404 */
    async function runServerApimartImport(opts = {}) {
      if (!window.PromptHubApi?.recoverWarehouseFromJobs) {
        showToast('请先 Ctrl+Shift+R 强刷到最新版', 6000);
        return { ok: false, error: 'api_missing' };
      }
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return { ok: false, error: 'not_logged_in' };
      }
      const mode = opts.mode || 'import';
      const max = Math.min(80, Math.max(1, Number(opts.max) || (mode === 'repair' ? 30 : 20)));
      await writeEmergencyBackup('pre_server_recover');
      const modeLabel =
        mode === 'repair' ? '修复图片' : mode === 'extras' ? '导入多图' : '导入新卡';
      setCloudSyncPhase('syncing', `服务端${modeLabel}中…`);
      showToast(`正在服务端${modeLabel}（最多 ${max} 条）…`, 5000);
      try {
        const providerScope = opts.providerScope || (mode === 'import' ? 'grs' : 'all');
        const recoverBody = { max, mode, providerScope };
        if (providerScope === 'apimart') {
          recoverBody.days = Math.min(365, Math.max(1, Number(opts.days) || 7));
        } else if (providerScope === 'grs' || opts.hours != null) {
          recoverBody.hours = Math.min(168, Math.max(1, Number(opts.hours) || 2));
        } else if (opts.days != null) {
          recoverBody.days = Math.min(365, Math.max(1, Number(opts.days)));
        } else if (mode !== 'import') {
          recoverBody.days = 365;
        }
        const res = await window.PromptHubApi.recoverWarehouseFromJobs(recoverBody);
        if (!res?.ok) {
          setCloudSyncPhase('error', res.message || res.code);
          showToast('操作失败：' + (res.message || res.code || '未知错误'), 9000);
          return res;
        }
        const d = res.data || {};
        window.SupabaseSync?.clearSignedUrlCache?.();
        await pullFromCloud();
        window.__promptHubCards = cards;
        renderGroups();
        renderCards(true);
        window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
        if (document.getElementById('pageImageGen')?.classList.contains('active')) {
          window.FeatureDraft?.renderImageGenFeed?.({ preserveScroll: true });
        }
        setCloudSyncPhase('saved');
        const msg =
          mode === 'repair'
            ? `已修复 ${d.repaired || 0} 张图片，跳过 ${d.skipped || 0} 张`
            : `已导入 ${d.imported || 0} 张，跳过 ${d.skipped || 0} 张`;
        showToast(
          d.hint
            ? `${msg}。${d.hint}`
            : `${msg}。若侧栏仍打不开，请再点一次该图或强刷`,
          10000
        );
        console.log('[Recovery] server', mode, d);
        return { ok: true, ...d };
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('导入失败：' + formatSyncError(e), 9000);
        return { ok: false, error: formatSyncError(e) };
      }
    }
    window.runServerApimartImport = runServerApimartImport;
    window.inspectTombstoneStorageRecovery = inspectTombstoneStorageRecovery;
    window.planApimartRecovery = planApimartRecovery;
    window.restoreCardsFromRecoveryPlan = restoreCardsFromRecoveryPlan;
    window.restoreFromTombstoneStorageScan = restoreFromTombstoneStorageScan;

    async function resetIdbForAccountSwitch(nextUid) {
      cards = [];
      customGroups = [];
      globalFields = [];
      window.__promptHubCards = [];
      await saveCardsToDB([], { ownerUid: '' });
      await clearIdbObjectStore('data_backups');
      await clearIdbObjectStore('card_image_backups');
      setIdbOwnerUid('');
      if (nextUid) setIdbOwnerUid(nextUid);
    }

    async function restoreAccountPrivateData(uid) {
      if (!uid) return false;
      const tombstones = settings.deletedCardTombstones || {};
      const idbCards = await loadCardsFromDB({ ownerUid: uid });
      let autoPayload = null;
      let snapshotPayload = null;
      try {
        autoPayload = JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null');
      } catch (e) { /* ignore */ }
      if (!autoPayload?.cards?.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem('promptrepo_autosave_snapshot') || 'null');
          const lastUid = localStorage.getItem('promptrepo_last_uid');
          if (legacy?.cards?.length && lastUid === uid) {
            autoPayload = legacy;
            localStorage.setItem(userStorageKey('autosave', uid), JSON.stringify(legacy));
            localStorage.removeItem('promptrepo_autosave_snapshot');
          }
        } catch (e) { /* ignore */ }
      }
      try {
        const raw = localStorage.getItem(userStorageKey('snapshot', uid));
        if (raw) snapshotPayload = JSON.parse(raw);
      } catch (e) { /* ignore */ }

      const mergeLists = window.CloudSyncSafety?.mergeCardsList;
      let mergedCards = idbCards;
      if (mergeLists && autoPayload?.cards?.length) {
        mergedCards = mergeLists(mergedCards, autoPayload.cards, tombstones);
      }
      if (mergeLists && snapshotPayload?.cards?.length) {
        mergedCards = mergeLists(mergedCards, snapshotPayload.cards, tombstones);
      }

      let restored = false;
      if (mergedCards.length > 0) {
        cards = filterTombstonedCards(normalizeCardImages(mergedCards));
        restored = true;
        await saveCardsToDB(cards, { ownerUid: uid });
        setIdbOwnerUid(uid);
      }
      if (!restored) restored = await tryRestoreFromEmergencyBackup(uid);

      const metaPayload = autoPayload?.cards?.length ? autoPayload : snapshotPayload;
      if (metaPayload && typeof metaPayload === 'object') {
        if (Array.isArray(metaPayload.customGroups) && metaPayload.customGroups.length) {
          customGroups = metaPayload.customGroups;
        }
        if (Array.isArray(metaPayload.globalFields) && metaPayload.globalFields.length) {
          globalFields = metaPayload.globalFields;
        }
        if (metaPayload.settings && typeof metaPayload.settings === 'object') {
          settings = Object.assign(settings, metaPayload.settings);
        }
      }
      try {
        loadWarehouseGroups(getActiveWarehouseId());
      } catch (e) { customGroups = []; }
      try {
        const f = localStorage.getItem(userStorageKey('fields', uid));
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem(userStorageKey('settings', uid));
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      normalizeCardPins();
      window.__promptHubCards = cards;
      window.FeatureDraft?.reloadStores?.();
      window.FeatureDraft?.scheduleGenJobsSync?.(500);
      return restored;
    }

    async function loadLocalSnapshotForUser(uid) {
      const raw = localStorage.getItem(userStorageKey('snapshot', uid));
      if (!raw) return false;
      try {
        const snapshotPayload = JSON.parse(raw);
        const idbCards = await loadCardsFromDB({ ownerUid: uid });
        const tombstones = settings.deletedCardTombstones || {};
        let mergedCards = idbCards;
        if (window.CloudSyncSafety?.mergeCardsList && snapshotPayload?.cards?.length) {
          mergedCards = window.CloudSyncSafety.mergeCardsList(mergedCards, snapshotPayload.cards, tombstones);
        }
        if (!mergedCards.length && !snapshotPayload?.cards?.length) return false;
        applyDataPayload({
          ...snapshotPayload,
          cards: mergedCards.length ? mergedCards : snapshotPayload.cards
        });
        await saveCardsToDB(cards, { ownerUid: uid });
        setIdbOwnerUid(uid);
        return cards.length > 0;
      } catch (e) {
        return false;
      }
    }

    async function authSignOut() {
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (uid) await snapshotLocalForUser(uid);
        clearTimeout(cloudPushTimer);
        clearTimeout(bgCloudSyncTimer);
        localStorage.setItem('promptrepo_post_logout', '1');
        activeAccountId = null;
        cloudHydratedUid = null;
        window.Membership?.clearLocalState?.();
        window.PointsSystem?.resetServerCreditsState?.();
        window.__userDisplayName = '';
        window.SubscriptionUI?.refreshOfferUI?.();
        await window.SupabaseSync.signOut();
        await purgeSignedOutLocalData();
        updateAuthUI(null);
        updateTagFilter();
        buildFilterMenu();
        syncFilterBtnState();
        switchAppPage('warehouse');
        renderGroups();
        renderCards(true);
        if (isMobileViewport()) window.resetMobileEditPanelState?.();
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
      if (cloudSyncing) await waitForCloudSyncIdle(120000);
      const localPayload = getDataPayload();
      await writeEmergencyBackup('pre_pull');
      const cloud = await window.SupabaseSync.pullCloudData();
      if (cloud == null || typeof cloud !== 'object') return false;

      const merged = window.CloudSyncSafety?.mergePayload
        ? window.CloudSyncSafety.mergePayload(localPayload, cloud)
        : cloud;
      const pullCheck = window.CloudSyncSafety?.validatePull?.(localPayload, cloud, merged);
      let finalPayload = pullCheck?.payload || merged;
      if (window.CloudSyncSafety?.preferLocalCardsImages) {
        finalPayload = window.CloudSyncSafety.preferLocalCardsImages(localPayload, finalPayload);
      }
      if (pullCheck && pullCheck.allow === false) {
        console.warn('[sync] pull blocked:', pullCheck.reason);
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) await snapshotLocalForUser(uid);
        const preserve = window.CloudSyncSafety?.pullPreserveLocalWarehouse?.(localPayload, finalPayload);
        const localCardN = window.CloudSyncSafety?.cardCount?.(localPayload)
          ?? (Array.isArray(localPayload?.cards) ? localPayload.cards.length : 0);
        if (preserve && localCardN > 0) {
          finalPayload = preserve;
          showToast('已合并云端社区等数据，卡片库保留本机图片（未用云端空图覆盖）', 9000);
        } else {
          const warnKey = 'ph_pull_block_' + uid;
          if (!sessionStorage.getItem(warnKey)) {
            sessionStorage.setItem(warnKey, '1');
            showToast(pullCheck.reason || '为保护本地数据，已跳过云端覆盖', 9000);
          }
          return false;
        }
      }

      if (Array.isArray(finalPayload.cards) && window.SupabaseSync?.getUserId) {
        const uid = window.SupabaseSync.getUserId();
        for (const c of finalPayload.cards) {
          if (c?.image || !c?.id || !uid) continue;
          const guesses = [
            `${uid}/generated/${String(c.id).replace(/^wh_/, '')}.jpg`,
            `${uid}/generated/${String(c.id).replace(/^wh_/, '')}.webp`
          ];
          for (const p of guesses) {
            if (window.SupabaseSync?.isPathKnownMissing?.(p)) continue;
            try {
              const ref = window.SupabaseSync?.toStorageRef?.(p) || `storage://card-images/${p}`;
              const ok = await window.SupabaseSync.verifyStorageRef?.(ref, c.id, {
                quick: true,
                noDownload: true
              });
              if (ok) {
                c.image = ref;
                break;
              }
            } catch (e) { /* ignore */ }
          }
        }
      }
      if (Array.isArray(finalPayload.cards) && window.CloudSyncSafety?.dedupeWarehouseCards) {
        finalPayload.cards = window.CloudSyncSafety.dedupeWarehouseCards(finalPayload.cards);
      }
      if (Array.isArray(finalPayload.creations)) {
        finalPayload.creations = filterTombstonedCreations(finalPayload.creations);
      }
      applyDataPayload(finalPayload);
      cards = window.FeatureDraft?.reconcileCommunityWithCards?.(cards) || cards;
      window.__promptHubCards = cards;
      window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
      window.FeatureDraft?.syncPublishToggleForOpenCard?.();
      await saveAllData({ skipCloud: true });
      return true;
    }

    async function runDeferredCloudPull(opts = {}) {
      const silent = opts.silent !== false;
      const light = opts.light === true;
      if (cloudSyncing) {
        await waitForCloudSyncIdle(120000);
      }
      setCloudSyncPhase('syncing', light ? '后台同步…' : '正在拉取云端…');
      try {
        const pulled = await pullFromCloud();
        if (pulled) {
          const uid = window.SupabaseSync?.getUserId?.();
          if (uid) await snapshotLocalForUser(uid);
          refreshWarehouseUI();
          window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
          if (!light) {
            void window.FeatureDraft?.resumePendingGenerationJobs?.().then((changed) => {
              if (changed) window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
            });
          }
        }
        setCloudSyncPhase(cards.length ? 'saved' : 'idle');
        lastBgCloudSyncAt = Date.now();
        return pulled;
      } catch (e) {
        if (!silent) showToast('拉取云端数据失败，已保留本地数据');
        else setCloudSyncPhase('error', '拉取失败，将重试');
        setCloudSyncPhase('error', formatSyncError(e));
        return false;
      }
    }

    function formatSyncError(e) {
      return window.SupabaseSync?.formatError?.(e) || e?.message || '请稍后重试';
    }

    window.pushToCloud = pushToCloud;

    async function pushToCloud(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) return { ok: false, reason: 'not_logged_in' };
      if (cloudSyncing) return { ok: false, busy: true };
      const myRun = ++cloudPushRunId;
      const stillCurrent = () => myRun === cloudPushRunId;
      const silent = opts.silent === true;
      if (silent && opts.skipSafety !== false) opts.skipSafety = true;
      cloudSyncing = true;
      if (!silent) setCloudSyncPhase('syncing', '正在保存到云端');
      const status = document.getElementById('statusMsg');
      const localImages = new Map(cards.map((c) => [String(c.id), c.image]));
      const isMobileNet = isMobileViewport();
      const timeoutMs = silent
        ? (isMobileNet ? 120000 : 70000)
        : (isMobileNet ? 180000 : 90000);
      const work = async () => {
        const payload = getDataPayload();
        const hasBase64 = payload.cards?.some(c => window.SupabaseSync.isDataUrl(c.image));
        const needsImagePass = hasBase64
          || (window.SupabaseSync.payloadNeedsImageUpload?.(payload.cards) === true);
        if (hasBase64 && status) status.textContent = '正在上传图片到云端…';
        const pushOpts = {
          skipSafety: opts.skipSafety === true,
          allowWithoutCloudCheck: opts.allowWithoutCloudCheck === true,
          strictImageCheck: opts.strictImageCheck === true,
          concurrency: isMobileNet ? 2 : 4
        };
        let metaResult = null;
        try {
          metaResult = await window.SupabaseSync.pushCloudData(payload, {
            ...pushOpts,
            deferImageUpload: true
          });
        } catch (metaErr) {
          console.warn('[cloud] metadata push failed', metaErr);
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        let result = metaResult || { warnings: [] };
        if (silent && !needsImagePass) {
          if (result?.data && window.FeatureDraft?.applyCloudSlice) {
            window.FeatureDraft.applyCloudSlice(result.data);
          }
          if (Array.isArray(payload.cards)) {
            const uploadedById = new Map(payload.cards.map((c) => [String(c.id), c]));
            cards = cards.map((c) => {
              const up = uploadedById.get(String(c.id));
              if (!up) return c;
              const prev = localImages.get(String(c.id)) || c.image;
              if (window.CloudSyncSafety?.mergeCardPair) {
                return window.CloudSyncSafety.mergeCardPair({ ...c, image: prev }, up);
              }
              if (prev && !up.image) return { ...c, image: prev };
              return { ...c, ...up, image: up.image || prev || c.image };
            });
          }
          await saveAllData({ skipCloud: true });
          return result;
        }
        try {
          result = await window.SupabaseSync.pushCloudData(payload, pushOpts);
        } catch (imgErr) {
          console.warn('[cloud] image upload pass failed', imgErr);
          scheduleCloudPush({ urgent: true });
          if (!metaResult) throw imgErr;
          result = {
            warnings: ['图片仍在后台上传，请保持联网；其他设备可先看到卡片信息'],
            data: metaResult.data
          };
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (result?.data && window.FeatureDraft?.applyCloudSlice) {
          window.FeatureDraft.applyCloudSlice(result.data);
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (Array.isArray(payload.cards)) {
          const uploadedById = new Map(payload.cards.map((c) => [String(c.id), c]));
          cards = cards.map((c) => {
            const up = uploadedById.get(String(c.id));
            if (!up) return c;
            const prev = localImages.get(String(c.id)) || c.image;
            if (window.CloudSyncSafety?.mergeCardPair) {
              return window.CloudSyncSafety.mergeCardPair({ ...c, image: prev }, up);
            }
            if (prev && !up.image) return { ...c, image: prev };
            return { ...c, ...up, image: up.image || prev || c.image };
          });
        }
        await saveAllData({ skipCloud: true });
        return result;
      };
      try {
        const result = await Promise.race([
          work(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('云端上传超时，已保留在本机')), timeoutMs);
          })
        ]);
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (result?.cancelled) return { ok: false, cancelled: true };
        if (result?.warnings?.length) {
          console.warn('[cloud] image warnings', result.warnings);
          if (silent) {
            setCloudSyncPhase('saved');
          } else {
            const msg = result.warnings[0].includes('后台上传')
              ? result.warnings[0]
              : '文字已同步；部分图片未上传：' + result.warnings[0];
            setCloudSyncPhase('error', result.warnings[0]);
            showToast(msg, 8000);
          }
          return { ok: true, warnings: result.warnings };
        }
        setCloudSyncPhase('saved');
        return { ok: true };
      } catch (e) {
        cloudPushRunId++;
        const msg = String(e?.message || '');
        if (msg.includes('云端上传超时')) {
          setCloudSyncPhase('pending', '图片后台上传中…');
          scheduleCloudPush({ urgent: true });
          if (!silent) {
            showToast('卡片已在本机，图片正在后台上传', 6000);
          }
          return { ok: true, warnings: ['上传超时，后台重试中'] };
        }
        if (silent) {
          setCloudSyncPhase('pending', '将在后台重试保存');
          scheduleCloudPush({ urgent: true });
          return { ok: false, error: e };
        }
        setCloudSyncPhase('error', formatSyncError(e));
        throw e;
      } finally {
        cloudSyncing = false;
        if (status && !status.textContent.startsWith('❌')) status.textContent = '';
      }
    }

    function scheduleCloudPush(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      clearTimeout(cloudPushTimer);
      const delay = opts.urgent === true ? 350 : 45000;
      cloudPushTimer = setTimeout(() => {
        if (!opts.urgent && document.hidden) {
          scheduleCloudPush(opts);
          return;
        }
        pushToCloud({ silent: true }).catch((e) => {
          console.warn('[cloud] silent push failed', e);
        });
      }, delay);
    }
    window.scheduleCloudPush = scheduleCloudPush;

    function waitForCloudSyncIdle(maxMs = 90000) {
      return new Promise((resolve) => {
        if (!cloudSyncing) {
          resolve(true);
          return;
        }
        const start = Date.now();
        const tick = () => {
          if (!cloudSyncing || Date.now() - start > maxMs) {
            resolve(!cloudSyncing);
            return;
          }
          setTimeout(tick, 250);
        };
        tick();
      });
    }
    window.waitForCloudSyncIdle = waitForCloudSyncIdle;

    async function hydrateWorkspaceFromLocal(uid) {
      const hadSnapshot = await loadLocalSnapshotForUser(uid);
      if (!hadSnapshot) {
        cards = await loadCardsFromDB();
      }
      try {
        loadWarehouseGroups(getActiveWarehouseId());
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

    function scheduleDeferredImageAudit() {
      const uid = window.SupabaseSync?.getUserId?.() || 'guest';
      const key = 'ph_img_audit_' + uid;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      const run = () => void runCardImageIntegrityAudit();
      const auditDelay = window.SupabaseSync?.isLegacyImageRestorePhase?.() ? 1500 : 60000;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: window.SupabaseSync?.isLegacyImageRestorePhase?.() ? 4000 : 120000 });
      } else {
        setTimeout(run, auditDelay);
      }
    }

    /** 已禁用：登录后自动删卡曾误删大量卡片（首屏未加载即 markPathMissing → 误判幽灵） */
    function scheduleQuietGhostPurge() { /* disabled — use purgeGhostDataFromSettings with confirm */ }

    function hydrateWarehouseGridImages(container, pageCards) {
      if (!container) return;
      window.CardImageLoader?.bindWarehouse?.(container, pageCards);
      if (!isMobileViewport()) scheduleWarehouseMasonryLayout();
    }

    async function runCardImageIntegrityAudit() {
      if (!window.SupabaseSync?.auditBrokenCardImages || !window.SupabaseSync?.isLoggedIn?.()) return;
      if (!cards.length) return;
      try {
        const { broken, repaired } = await window.SupabaseSync.auditBrokenCardImages(cards, {
          capMs: 5000,
          skipStorageList: true
        });
        if (repaired.length) {
          await saveAllData({ skipCloud: true });
          scheduleCloudPush({ urgent: true });
          showToast(`已自动修复 ${repaired.length} 张卡片图片`);
          refreshWarehouseUI({ softCards: true });
        }
        if (broken.length) {
          for (const b of broken) {
            const card = cards.find((c) => c.id === b.id);
            if (card?.publishedToCommunity && window.FeatureDraft?.syncCardToCommunity) {
              window.FeatureDraft.syncCardToCommunity(card, false);
            }
          }
          renderGroups();
          renderCards(true);
          if (document.getElementById('pageImageGen')?.classList.contains('active')) {
            window.FeatureDraft?.renderImageGenFeed?.();
          }
          if (document.getElementById('pageCreations')?.classList.contains('active')) {
            window.FeatureDraft?.renderCreations?.();
          }
          const key = 'ph_img_audit_warn_' + (window.SupabaseSync?.getUserId?.() || 'guest');
          const last = Number(sessionStorage.getItem(key) || 0);
          if (Date.now() - last > 600000) {
            sessionStorage.setItem(key, String(Date.now()));
            const sample = broken.slice(0, 2).map((b) => b.title || b.id).join('、');
            const extra = broken.length > 2 ? ` 等 ${broken.length} 张` : '';
            showToast(`已隐藏无图发布；卡片库中「${sample}」${extra}可手动删除`, 9000);
          }
        }
      } catch (e) {
        console.warn('[cards] image audit failed', e);
      }
    }

    async function handleCloudAfterLogin(opts = {}) {
      const silent = opts.silent === true;
      const force = opts.force === true;
      if (isPostLogoutBlocked()) return;
      const uid = window.SupabaseSync?.getUserId?.();
      if (!uid) return;
      const idbOwner = getIdbOwnerUid();
      const idbMismatch = !!(idbOwner && idbOwner !== uid);

      let syncPromise = Promise.resolve();
      if (window.PromptHubApi?.isConfigured?.() && !window.PromptHubApi?.isApiUnreachable?.()) {
        syncPromise = window.PromptHubApi.syncMe({ silent }).catch(() => ({}));
      } else if (window.SupabaseSync?.isLoggedIn?.()) {
        window.SubscriptionUI?.refreshOfferUI?.();
      }
      void window.FeatureDraft?.refreshImageGenModelCatalog?.();

      if (!force && !idbMismatch && cloudHydratedUid === uid && cards.length > 0) {
        activeAccountId = uid;
        void syncPromise.catch(() => {});
        refreshWarehouseUI({ softCards: true });
        return;
      }

      const prevUid = activeAccountId;
      if (prevUid && prevUid !== uid) {
        try {
          await snapshotLocalForUser(prevUid);
        } catch (e) { /* ignore */ }
      }

      const uidChanged = !!(prevUid && prevUid !== uid);
      const accountSwitch = uidChanged || idbMismatch;
      activeAccountId = uid;
      localStorage.setItem('promptrepo_last_uid', uid);
      localStorage.removeItem('promptrepo_post_logout');
      window.Membership?.onAccountSwitch?.();
      clearTimeout(cloudPushTimer);

      if (accountSwitch) {
        cards = [];
        customGroups = [];
        globalFields = [];
        window.__promptHubCards = [];
        window.FeatureDraft?.clearAllLocalFeatureData?.();
        await resetIdbForAccountSwitch(uid);
        localStorage.removeItem('promptrepo_autosave_snapshot');
        try {
          sessionStorage.removeItem('promptrepo_pending_guest_migrate');
        } catch (e) { /* ignore */ }
      }

      setCloudSyncPhase('syncing', '正在加载账号数据');
      await restoreAccountPrivateData(uid);
      let guestPayload = null;
      const allowGuestMigrate = sessionStorage.getItem('promptrepo_guest_session') === '1';
      if (opts.migrateGuest && allowGuestMigrate && !uidChanged && cards.length === 0) {
        try {
          const raw = sessionStorage.getItem('promptrepo_pending_guest_migrate');
          if (raw) guestPayload = JSON.parse(raw);
        } catch (e) { guestPayload = null; }
      }

      let loaded = false;
      let paintedFromLocal = false;
      if (cards.length > 0) {
        refreshWarehouseUI();
        paintedFromLocal = true;
      }

      const shouldPull = cloudHydratedUid !== uid || accountSwitch || force || opts.migrateGuest;
      if (shouldPull) {
        if (paintedFromLocal && cards.length > 0 && !force) {
          cloudHydratedUid = uid;
          window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
          window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
          void runDeferredCloudPull({ silent: true });
          void syncPromise.catch(() => {});
          scheduleDeferredImageAudit();
          scheduleQuietGhostPurge();
          setCloudSyncPhase('saved');
          return;
        }
        try {
          loaded = await pullFromCloud();
        } catch (e) {
        }
      }

      if (loaded && cards.length === 0) {
        await restoreAccountPrivateData(uid);
      }

      if ((accountSwitch || force) && !loaded && cards.length === 0) {
        await restoreAccountPrivateData(uid);
      }

      if (!loaded && !cards.length) {
        const hadSnapshot = cards.length > 0 || await restoreAccountPrivateData(uid);
        if (!hadSnapshot && guestPayload?.cards?.length) {
          applyDataPayload(guestPayload);
          await saveCardsToDB(cards, { ownerUid: uid });
          try {
            await pushToCloud();
            if (!silent) showToast(`已将 ${guestPayload.cards.length} 张本地卡片同步到云端`);
          } catch (e) {
            if (!silent) showToast('本地卡片已恢复，云端同步失败：' + formatSyncError(e));
          }
          try {
            sessionStorage.removeItem('promptrepo_pending_guest_migrate');
          } catch (e) { /* ignore */ }
        } else if (hadSnapshot && (cards.length > 0 || customGroups.length > 0)) {
          try {
            await pushToCloud();
            if (!silent) showToast('已恢复本账号本地备份并同步到云端');
          } catch (e) {
            if (!silent) showToast('本地已恢复，云端同步失败：' + formatSyncError(e));
          }
        } else if (!silent && !accountSwitch && !cloudHydratedUid) {
          showToast('新账号空白开始（不会导入其他账号的数据）');
        }
      } else if (loaded) {
        await snapshotLocalForUser(uid, { allowEmpty: true });
        await saveCardsToDB(cards, { ownerUid: uid });
        refreshWarehouseUI();
        if (!silent && (!cloudHydratedUid || accountSwitch || force)) {
          showToast('已从云端加载本账号数据');
        }
      } else if (cards.length && !silent && (!cloudHydratedUid || accountSwitch)) {
        await snapshotLocalForUser(uid, { allowEmpty: true });
      }

      cloudHydratedUid = uid;
      window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
      window.TrialTasksUI?.onAuthReady?.();
      void syncPromise.catch(() => {});
      scheduleDeferredImageAudit();
      scheduleQuietGhostPurge();
      refreshWarehouseUI({
        softCards: !loaded && paintedFromLocal && silent && !accountSwitch && !force
      });
      setCloudSyncPhase(cards.length ? 'saved' : 'idle');
      lastBgCloudSyncAt = Date.now();
      try {
        sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      } catch (e) { /* ignore */ }
    }

    function isMobileViewport() {
      return window.MobileUI?.isMobileViewport?.() ?? window.matchMedia('(max-width: 900px)').matches;
    }

    function refreshWarehouseUI(opts = {}) {
      window.currentGroup = currentGroup;
      window.FeatureAssets?.updateWarehouseTitle?.();
      const soft = opts.softCards === true;
      updateTagFilter();
      buildFilterMenu();
      syncFilterBtnState();
      renderGroups();
      if (soft && document.getElementById('pageWarehouse')?.classList.contains('active')) {
        requestAnimationFrame(() => {
          if (isMobileViewport()) enforceMobileCardGrid();
          else layoutMasonryGrid();
        });
      } else {
        renderCards(true);
      }
      updateGuestLimitUI();
      if (!isMobileViewport() && !selectedCardId && isNewCardMode) {
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

    async function backupVisibleCardImages() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return 0;
      let n = 0;
      for (const c of cards) {
        if (!c?.id) continue;
        if (c.image && window.SupabaseSync.isDataUrl(c.image)) {
          await saveCardImageBackup(c.id, c.image);
          n += 1;
          continue;
        }
        const existing = await getCardImageBackup(c.id);
        if (existing) continue;
        const img = document.querySelector(`.card[data-id="${CSS.escape(String(c.id))}"] .card-img`);
        if (!img?.src || !/^https?:\/\//i.test(img.src) || img.naturalWidth < 8) continue;
        try {
          const res = await fetch(img.src, { mode: 'cors' });
          if (!res.ok) continue;
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
            await saveCardImageBackup(c.id, dataUrl);
            n += 1;
          }
        } catch (e) { /* ignore */ }
      }
      return n;
    }

    async function syncCloudNow(opts = {}) {
      const quiet = opts.quiet === true;
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        if (!quiet) openAuthModal();
        return;
      }
      if (cloudSyncing) {
        if (!quiet) showToast('保存进行中，请稍候…', 2500);
        return;
      }
      const status = document.getElementById('statusMsg');
      setCloudSyncPhase('syncing', quiet ? '正在同步云端…' : '正在与云端对齐');
      if (!quiet) showToast('正在与云端对齐…', 2000);
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (!cards.length && uid) {
          await restoreAccountPrivateData(uid);
          window.__promptHubCards = cards;
          if (cards.length) {
            renderGroups();
            renderCards(true);
            showToast(`已从本地备份恢复 ${cards.length} 张卡片`, 3500);
          }
        }
        if (cards.length) {
          await Promise.race([
            backupVisibleCardImages(),
            new Promise((r) => setTimeout(r, 4000))
          ]);
          if (window.SupabaseSync?.repairMissingCardImages) {
            if (status) status.textContent = '正在补传缺失图片…';
            const repair = await window.SupabaseSync.repairMissingCardImages(cards, {
              capMs: 60000,
              fullCheck: true
            });
            if (repair.fixed > 0) {
              window.__promptHubCards = cards;
              await saveAllData({ skipCloud: true });
              renderCards(true);
            }
            if (repair.failed?.length) {
              console.warn('[sync] image repair', repair.failed);
            }
          }
        }
        let pulled = false;
        let pushResult = null;
        try {
          pushResult = await pushToCloud({ strictImageCheck: true });
          if (pushResult?.busy) {
            showToast('同步进行中，请稍后再试', 3500);
            return;
          }
        } catch (e) {
          console.warn('[sync] push before pull failed', e);
        }
        try {
          pulled = await pullFromCloud();
          if (pulled) {
            renderGroups();
            renderCards(true);
            updateTagFilter();
            window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
          }
        } catch (e) {
          console.warn('[sync] pull after push failed', e);
        }
        if (pulled) {
          try {
            await pushToCloud({ silent: true, skipSafety: true });
          } catch (e) {
            console.warn('[sync] merge push after pull failed', e);
          }
        }
        const result = pushResult || { ok: true };
        const repairWarn = result?.warnings?.length ? result.warnings.slice(0, 2).join('；') : '';
        if (!quiet && !cards.length) {
          showToast(
            repairWarn
              ? '卡片库为空，无法同步；' + repairWarn
              : '卡片库为空。请先在电脑登录恢复，或设置里导入备份',
            9000
          );
        } else if (!quiet && repairWarn) {
          showToast((pulled ? '已合并云端；' : '') + '部分图片未上传：' + repairWarn, 8000);
        } else if (!quiet) {
          if (pulled) {
            showToast(`已与云端对齐（${cards.length} 张卡片）`);
          } else {
            showToast(`已上传到云端（${cards.length} 张卡片）`);
          }
        } else {
          setCloudSyncPhase('saved');
        }
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        if (!quiet) showToast('对齐失败：' + formatSyncError(e), 8000);
      } finally {
        if (status && !status.textContent.startsWith('❌')) status.textContent = '';
      }
    }
    window.syncCloudNow = syncCloudNow;
    window.runDeferredCloudPull = runDeferredCloudPull;

    async function syncCloudNowFromSettings() {
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在与云端对齐…';
      try {
        await syncCloudNow();
      } finally {
        if (st && !String(st.textContent).includes('失败')) st.textContent = '';
      }
    }
    window.syncCloudNowFromSettings = syncCloudNowFromSettings;

    async function repairMissingCardImagesFromSettings() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return;
      }
      if (cloudSyncing) {
        showToast('云端保存进行中，请稍候…', 3000);
        return;
      }
      if (!cards.length) {
        showToast('卡片库为空', 3000);
        return;
      }
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在补传缺失图片…';
      setCloudSyncPhase('syncing', '补传图片中');
      try {
        const result = await window.SupabaseSync.repairMissingCardImages(cards, {
          capMs: 120000,
          fullCheck: true
        });
        if (result.fixed > 0) {
          window.__promptHubCards = cards;
          window.FeatureDraft?.invalidateCommunityReconcileCache?.();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          void pushToCloud({ silent: true }).catch((e) => {
            setCloudSyncPhase('error', formatSyncError(e));
          });
        }
        if (result.failed?.length) {
          const sample = result.failed
            .filter((f) => f.id !== '_timeout')
            .slice(0, 2)
            .map((f) => f.title || f.id)
            .join('、');
          const extra = result.failed.length > 2 ? ` 等 ${result.failed.length} 张` : '';
          showToast(
            result.fixed > 0
              ? `已补传 ${result.fixed} 张；仍有失败：${sample}${extra}`
              : `补传失败：${sample}${extra}（请重新编辑卡片添加图片）`,
            9000
          );
          if (st) st.textContent = '部分图片未能补传';
        } else if (result.fixed > 0) {
          showToast(`已补传 ${result.fixed} 张图片到云端`, 5000);
          if (st) st.textContent = `已补传 ${result.fixed} 张`;
          setCloudSyncPhase('saved');
        } else {
          showToast('没有需要从本机补传的图片', 4000);
          if (st) st.textContent = '云端图片已齐全';
          setCloudSyncPhase('saved');
        }
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('补传失败：' + formatSyncError(e), 8000);
        if (st) st.textContent = '补传失败';
      }
    }
    window.repairMissingCardImagesFromSettings = repairMissingCardImagesFromSettings;

    async function purgeGhostDataFromSettings() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return;
      }
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在扫描…';
      setCloudSyncPhase('syncing', '扫描中');
      try {
        const candidates = [];
        for (const c of [...cards]) {
          if (!c?.id || !c.image || !window.SupabaseSync?.isStorageRef?.(c.image)) continue;
          window.SupabaseSync?.clearPathMissingForCard?.(c.id, c.image);
          let ok = false;
          try {
            ok = await window.SupabaseSync?.verifyStorageRef?.(c.image, c.id, { quick: false });
          } catch (e) { /* ignore */ }
          if (ok) continue;
          const blob = await window.SupabaseSync?.downloadCardStorageBlob?.(c.image, c.id);
          if (blob && (blob.size || 0) >= 512) continue;
          let hasBackup = false;
          if (typeof getCardImageBackup === 'function') {
            const backup = await getCardImageBackup(c.id);
            hasBackup = !!(backup && String(backup).startsWith('data:'));
          }
          if (!hasBackup) candidates.push(c);
        }
        if (!candidates.length) {
          const ghostOnly = window.FeatureDraft?.purgeGhostCommunityData?.() || { removedPosts: 0 };
          if (ghostOnly.removedPosts) {
            window.FeatureDraft?.invalidateCommunityReconcileCache?.();
            await saveAllData({ skipCloud: true });
            window.FeatureDraft?.renderCommunity?.();
          }
          setCloudSyncPhase('saved');
          const msg = ghostOnly.removedPosts
            ? `已清理 ${ghostOnly.removedPosts} 条社区残留（未删卡片）`
            : '未发现可删的无效卡片';
          showToast(msg, 6000);
          if (st) st.textContent = msg;
          return;
        }
        const sample = candidates.slice(0, 3).map((c) => c.title || c.id).join('、');
        const extra = candidates.length > 3 ? ` 等 ${candidates.length} 张` : '';
        const ok = window.confirm(
          `将永久删除 ${candidates.length} 张卡片（Storage 已确认无图且无本地备份）。\n`
          + `示例：${sample}${extra}\n\n`
          + '此操作不可撤销，且不会自动同步云端。确定继续？'
        );
        if (!ok) {
          setCloudSyncPhase('saved');
          if (st) st.textContent = `已取消（扫描到 ${candidates.length} 张候选）`;
          showToast(`已取消删除（${candidates.length} 张候选仍保留）`, 5000);
          return;
        }
        let removedCards = 0;
        for (const c of candidates) {
          recordCardDeletion(c.id);
          await window.FeatureDraft?.unpublishCommunityByCardId?.(c.id, { silent: true });
          cards = cards.filter((x) => x.id !== c.id);
          removedCards += 1;
        }
        const ghost = window.FeatureDraft?.purgeGhostCommunityData?.() || { removedPosts: 0 };
        window.__promptHubCards = cards;
        window.FeatureDraft?.invalidateCommunityReconcileCache?.();
        await saveAllData({ skipCloud: true });
        renderGroups();
        renderCards(true);
        window.FeatureDraft?.renderCommunity?.();
        setCloudSyncPhase('saved');
        const msg = `已从本地删除 ${removedCards} 张无效卡片`
          + (ghost.removedPosts ? `、${ghost.removedPosts} 条社区残留` : '')
          + '（未自动上传云端，请确认后再点「与云端对齐」）';
        showToast(msg, 9000);
        if (st) st.textContent = msg;
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('清理失败：' + formatSyncError(e), 8000);
        if (st) st.textContent = '清理失败';
      }
    }
    window.purgeGhostDataFromSettings = purgeGhostDataFromSettings;

    let communityHydrateInflight = false;

    async function requestCloudHydrate() {
      if (!window.SupabaseSync?.isLoggedIn?.() || cloudSyncing || communityHydrateInflight) return;
      communityHydrateInflight = true;
      setCloudSyncPhase('syncing', '正在加载社区数据');
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (!cards.length && uid) await restoreAccountPrivateData(uid);
        await pullFromCloud();
        window.__promptHubCards = cards;
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
        window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
        renderGroups();
        renderCards(true);
        setCloudSyncPhase('saved');
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        console.warn('[sync] requestCloudHydrate failed', e);
      } finally {
        communityHydrateInflight = false;
      }
    }
    window.requestCloudHydrate = requestCloudHydrate;

    function scheduleBackgroundCloudSync() {
      if (isPostLogoutBlocked()) return;
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      if (Date.now() - lastBgCloudSyncAt < 180000) return;
      clearTimeout(bgCloudSyncTimer);
      bgCloudSyncTimer = setTimeout(async () => {
        if (!window.SupabaseSync?.isLoggedIn?.() || cloudSyncing) return;
        lastBgCloudSyncAt = Date.now();
        try {
          if (!cards.length) {
            const uid = window.SupabaseSync?.getUserId?.();
            if (uid) await restoreAccountPrivateData(uid);
          }
          await runDeferredCloudPull({ silent: true });
        } catch (e) {
          console.warn('[sync] background sync failed', e);
        }
      }, 2500);
    }

    async function initSupabaseAuth() {
      if (!window.SupabaseSync?.isConfigured?.()) {
        updateAuthUI(null);
        await bootstrapWhenLoggedOut();
        return;
      }
      await window.SupabaseSync.init(async (session, event) => {
        updateAuthUI(session);
        if (event === 'PASSWORD_RECOVERY') {
          openAuthModal('reset');
        }

        const runAuthSideEffects = async () => {
          if (session?.user) {
            if (event === 'SIGNED_IN') {
              const guestMigrate = sessionStorage.getItem('promptrepo_guest_session') === '1';
              await completeAuthSession({ silent: false, migrateGuest: guestMigrate });
            } else if (event === 'INITIAL_SESSION') {
              await completeAuthSession({ silent: true });
            }
          } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
            activeAccountId = null;
            cloudHydratedUid = null;
            window.SubscriptionUI?.resetFirstOfferServerState?.();
            window.Membership?.onAccountSwitch?.();
            if (event === 'SIGNED_OUT') {
              localStorage.setItem('promptrepo_post_logout', '1');
              window.Membership?.clearLocalState?.();
              window.SubscriptionUI?.refreshOfferUI?.();
              await purgeSignedOutLocalData();
              updateAuthUI(null);
              renderGroups();
              renderCards(true);
              updateGuestLimitUI();
              switchAppPage('warehouse');
              if (isMobileViewport()) window.resetMobileEditPanelState?.();
            } else if (event === 'INITIAL_SESSION' && !session?.user) {
              await bootstrapWhenLoggedOut();
            }
          }
        };

        // Supabase 建议在 onAuthStateChange 内 defer 异步 auth/DB 调用，避免死锁导致 UI 不刷新
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          setTimeout(() => { void runAuthSideEffects(); }, 0);
        } else {
          await runAuthSideEffects();
        }
      });
      return true;
    }

    async function loadGuestWorkspace() {
      cards = await loadCardsFromDB({ ownerUid: 'guest' });
      if (!cards.length && getIdbOwnerUid() && getIdbOwnerUid() !== 'guest') {
        cards = [];
      }
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
      floatingPromptActive = false;
      settings.floatingPrompt = false;
      applyEfficiencyMode();
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      normalizeCardPins();
      if (cards.length > 0) {
        try {
          sessionStorage.setItem('promptrepo_guest_session', '1');
          sessionStorage.setItem('promptrepo_pending_guest_migrate', JSON.stringify(getDataPayload()));
        } catch (e) { /* ignore */ }
      }
    }

    (async function init() {
      await openDB();
      cards = [];
      customGroups = [];
      globalFields = [];
      settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, autoPromptOcr: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, efficiencyMode: false }, {});
      floatingPromptActive = false;
      try {
        const s = localStorage.getItem('promptrepo_settings');
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      updatePanelOcrBoxVisibility();
      applyEfficiencyMode();
      initFilterMenu();
      initSortMenu();
      bindWarehouseSearchInputs();
      initBatchMarqueeSelect();
      bindPanelOcrDrop();
      initCardUploadOriginalToggle();
      initAppNav();
      initDevLabNav();
      initAppNavCollapse();
      window.FeatureAssets?.init?.();
      initBackgroundEffect();
      if (window.location.hash.includes('type=recovery') && window.SupabaseSync?.isConfigured?.()) {
        setTimeout(() => openAuthModal('reset'), 400);
      }
      await initSupabaseAuth();
      refreshAuthMethodUI();
      refreshAppBuildLabel();
      finishAppBootstrap();
      if (/[?&]panel=recharge(?:&|$)/.test(location.search || '')) {
        setTimeout(() => window.openRechargePanel?.(), 600);
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
      }
      bindQuickPreviewButtons();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void window.SupabaseSync?.healSessionOnResume?.();
          scheduleBackgroundCloudSync();
          return;
        }
        if (document.visibilityState === 'hidden') {
          const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
          if (uid) void snapshotLocalForUser(uid);
          else if (cards.length) void writeEmergencyBackup('page_hide');
        }
      });
      window.addEventListener('pagehide', () => {
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid && cards.length) void snapshotLocalForUser(uid);
      });
      applyFloatingState();
      if (typeof ResizeObserver !== 'undefined') {
        let masonryResizeTimer = null;
        const onWarehouseResize = () => {
          if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return;
          clearTimeout(masonryResizeTimer);
          masonryResizeTimer = setTimeout(() => {
            if (isMobileViewport()) scheduleLayoutMasonry();
            else layoutMasonryGrid();
          }, 200);
        };
        const masonryResizeObs = new ResizeObserver(onWarehouseResize);
        const mainArea = document.getElementById('mainContentArea');
        const editPanelEl = document.getElementById('editPanel');
        if (mainArea) masonryResizeObs.observe(mainArea);
        if (editPanelEl) masonryResizeObs.observe(editPanelEl);
      }
    })();

    window.__promptHubCards = cards;
    window.__promptHubIsNewCard = () => isNewCardMode;
    window.__promptHubGetEditingCard = () => {
      if (isNewCardMode || !selectedCardId) return null;
      return cards.find((c) => c.id === selectedCardId) || null;
    };

    /** 社区恢复等外部写入卡片列表时，必须同步 script.js 内的 cards */
    window.importPromptHubCards = function importPromptHubCards(list) {
      if (!Array.isArray(list)) return;
      cards = list;
      window.__promptHubCards = cards;
    };

    function scheduleLocalSnapshot(uid) {
      if (!uid) return;
      clearTimeout(localSnapshotTimer);
      localSnapshotTimer = setTimeout(() => {
        void snapshotLocalForUser(uid, { allowEmpty: true });
      }, 600);
    }

    async function saveAllData(opts = {}) {
      if (Array.isArray(window.__promptHubCards) && window.__promptHubCards.length > cards.length) {
        cards = window.__promptHubCards;
      }
      window.__promptHubCards = cards;
      cards = filterTombstonedCards(cards);
      await saveCardsToDB(cards, { ownerUid: currentIdbOwnerUid() });
      const now = Date.now();
      if (cards.length > 0 && now - lastEmergencyBackupAt > 45000) {
        void writeEmergencyBackup('auto_save');
      }
      settings.floatingPrompt = floatingPromptActive;
      if (typeof window.getAppTheme === 'function') settings.theme = window.getAppTheme();
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
      } catch (e) { /* ignore */ }
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      if (uid && window.SupabaseSync?.isLoggedIn?.()) {
        await snapshotLocalForUser(uid, { allowEmpty: true });
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        try {
          localStorage.setItem(userStorageKey('autosave', uid), JSON.stringify(getDataPayload()));
        } catch (e) { /* quota */ }
      }
      if (uid) {
        persistWarehouseGroups(getActiveWarehouseId());
        localStorage.setItem(userStorageKey('fields', uid), JSON.stringify(globalFields));
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        scheduleLocalSnapshot(uid);
      }
      if (fileHandle) { try { const w = await fileHandle.createWritable(); await w.write(JSON.stringify({cards,customGroups,globalFields,settings})); await w.close(); } catch(e) {} }
      if (!opts.skipCloud) scheduleCloudPush();
      window.FeatureDraft?.invalidateCommunityReconcileCache?.();
    }

    window.savePromptHubCardsNow = async function savePromptHubCardsNow(opts = {}) {
      if (Array.isArray(window.__promptHubCards) && window.__promptHubCards.length >= cards.length) {
        cards = window.__promptHubCards;
      }
      await saveAllData(opts);
      renderGroups();
      renderCards(true);
    };
    window.persistPromptHubCards = window.savePromptHubCardsNow;

    function renderGroups() {
      ensureGroupsFromCards();
      const visible = warehouseVisibleCards(cards);
      document.getElementById('allCount').textContent = visible.length;
      document.getElementById('uncategorizedCount').textContent = visible.filter(c => !c.group).length;
      document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
      const activeEl = document.querySelector(`.group-item[data-group="${currentGroup}"]`);
      if (activeEl) activeEl.classList.add('active');
      const customContainer = document.getElementById('customGroupList');
      customContainer.innerHTML = '';
      customGroups.forEach(group => {
        const cnt = visible.filter(c => c.group === group).length;
        const item = document.createElement('div');
        item.className = `group-item custom-group ${currentGroup === group ? 'active' : ''}`;
        item.dataset.group = group;
        item.title = '双击或右键重命名';
        item.innerHTML = `${group} <span class="count">${cnt}</span>`;
        item.addEventListener('click', () => switchGroup(group));
        item.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          inlineRenameGroup(group);
        });
        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [
            { label: '重命名', action: () => inlineRenameGroup(group) },
            { label: '删除分组', action: () => deleteGroup(group) }
          ]);
        });
        customContainer.appendChild(item);
      });
      document.querySelectorAll('#defaultGroupList .group-item').forEach(item => {
        item.onclick = () => switchGroup(item.dataset.group);
      });
      enableGroupDrop();
    }

    function switchGroup(g) {
      currentGroup = g;
      window.currentGroup = g;
      window.FeatureAssets?.updateWarehouseTitle?.();
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

    function renameGroup(oldName, newName) {
      const oldN = String(oldName || '').trim();
      const newN = String(newName || '').trim();
      if (!oldN || !newN || oldN === newN) return false;
      if (!customGroups.includes(oldN)) return false;
      if (customGroups.includes(newN)) {
        showToast('分组已存在');
        return false;
      }
      customGroups[customGroups.indexOf(oldN)] = newN;
      cards.forEach((c) => {
        if (c.group === oldN) c.group = newN;
      });
      if (currentGroup === oldN) {
        currentGroup = newN;
        window.currentGroup = newN;
      }
      window.__promptHubCards = cards;
      persistWarehouseGroups();
      saveAllData();
      renderGroups();
      renderCards(true);
      showToast('分组已重命名');
      return true;
    }
    window.renameGroup = renameGroup;

    function inlineRenameGroup(groupName) {
      const container = document.getElementById('customGroupList');
      if (!container) return;
      const item = [...container.querySelectorAll('.group-item.custom-group')].find(
        (el) => el.dataset.group === groupName
      );
      if (!item || item.querySelector('.group-name-input')) return;
      const oldName = groupName;
      item.classList.add('inline-edit-group');
      item.innerHTML = '<input type="text" class="group-name-input" maxlength="40">';
      const input = item.querySelector('.group-name-input');
      input.value = oldName;
      let done = false;
      const restore = () => {
        item.classList.remove('inline-edit-group');
        renderGroups();
      };
      const commit = () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!name || name === oldName) {
          restore();
          return;
        }
        if (!renameGroup(oldName, name)) restore();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          restore();
        }
      });
      input.addEventListener('blur', commit);
      input.focus();
      input.select();
    }
    window.inlineRenameGroup = inlineRenameGroup;

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
      if (window.SupabaseSync?.shouldShowCardInWarehouse?.(card) === false) return false;
      const image = card?.image;
      if (!image || typeof image !== 'string') return false;
      if (window.FeatureDraft?.isDisplayableImage && !window.FeatureDraft.isDisplayableImage(image)) return false;
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
      const max = 2;
      const shown = list.slice(0, max);
      const extra = list.length - max;
      let html = shown.map(t => `<span class="tag" onclick="event.stopPropagation();searchByTag('${escapeJsString(t)}')">${escapeHtml(t)}</span>`).join('');
      if (extra > 0) html += `<span class="tag tag-more">+${extra}</span>`;
      return html;
    }

    function syncWarehouseSearchFields(fromEl) {
      const desktop = document.getElementById('searchInput');
      const mobile = document.getElementById('searchInputMobile');
      if (!desktop && !mobile) return;
      const val = fromEl?.value ?? desktop?.value ?? mobile?.value ?? '';
      if (desktop) desktop.value = val;
      if (mobile) mobile.value = val;
    }

    function commitWarehouseSearch(fromEl) {
      syncWarehouseSearchFields(fromEl);
      renderCards(true);
      window.closeMobileSearch?.();
      if (fromEl?.blur) fromEl.blur();
      else document.getElementById('searchInput')?.blur();
    }
    window.commitWarehouseSearch = commitWarehouseSearch;

    function bindWarehouseSearchInputs() {
      const bind = (el) => {
        if (!el || el.dataset.searchBound) return;
        el.dataset.searchBound = '1';
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          commitWarehouseSearch(el);
        });
        if (el.type === 'search') {
          el.addEventListener('search', (e) => {
            e.preventDefault();
            commitWarehouseSearch(el);
          });
        }
      };
      bind(document.getElementById('searchInput'));
      bind(document.getElementById('searchInputMobile'));
    }

    async function renderCards(reset = false) {
      if (reset) {
        page = 1; allFilteredCards = [];
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
        const container = document.getElementById('cardsContainer');
        container.innerHTML = '';
        delete container?.dataset?.masonryLoadBound;
        window.CardImageLoader?.disconnect?.();
        container?.classList.remove('cards-grid-primed', 'masonry-ready', 'cards-grid-priming');
      }
      const container = document.getElementById('cardsContainer');
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      const mobileGrid = isMobileViewport();
      container.className = 'cards-container' + (mobileGrid ? ' mobile-grid' : '');
      if (viewMode === 'list') {
        container.classList.add('list-view');
        container.classList.remove('cards-grid-priming', 'masonry-ready');
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
      }
      if (batchMode) container.classList.add('batch-mode');
      const searchEl = document.getElementById('searchInputMobile') || document.getElementById('searchInput');
      const search = (searchEl?.value || '').toLowerCase();
      sortMode = document.getElementById('sortSelect')?.value || sortMode || 'updated-desc';
      if (reset || allFilteredCards.length === 0) {
        let filtered = warehouseVisibleCards(cards);
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
      const prefetchCards = pageCards.slice(0, 18);
      let prefetchP = Promise.resolve();
      const warehouseActive = document.getElementById('pageWarehouse')?.classList.contains('active');
      if (page === 1 && prefetchCards.length && window.SupabaseSync?.prefetchWarehousePage && (!mobileGrid || warehouseActive)) {
        prefetchP = window.SupabaseSync.prefetchWarehousePage(prefetchCards, mobileGrid ? 1200 : 2600);
      }
      if (page === 1 && pageCards.length && window.SupabaseSync?.backfillGridThumbsForCards) {
        void window.SupabaseSync.backfillGridThumbsForCards(pageCards, {
          max: mobileGrid ? Math.min(8, pageCards.length) : pageCards.length,
          force: !mobileGrid,
          quiet: true,
          awaitDrain: false
        }).then(() => {
          window.SupabaseSync?.patchImageSrcFromCache?.(container, { visibleFirst: true, max: 12 });
          window.CardImageLoader?.observeContainer?.(container);
        });
      }
      const fragment = document.createDocumentFragment();
      const isAppend = !reset && page > 1;
      const eagerImgCount = mobileGrid ? 3 : Math.min(4, pageCards.length);
      pageCards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = `card card-enter ${card.id === selectedCardId ? 'selected' : ''}${card.pinnedAt ? ' is-pinned' : ''}`;
        if (!mobileGrid && pageCards.length <= 24) {
          div.style.animationDelay = `${Math.min(idx * 0.045, 0.36)}s`;
        } else if (!mobileGrid) {
          div.classList.remove('card-enter');
        }
        div.dataset.id = card.id;
        if (window.isCommunityCollectCard?.(card)) {
          div.dataset.communityCollect = '1';
          const collectMeta = getCommunityCollectImageResolveOpts(card);
          if (collectMeta?.authorId) div.dataset.authorId = collectMeta.authorId;
          if (collectMeta?.assetId) div.dataset.sourceCardId = collectMeta.assetId;
        }
        div.draggable = !globalViewActive;
        if (!mobileGrid) {
          div.style.position = 'relative';
        }
        const checked = selectedCardIds.has(card.id);
        if (checked) div.classList.add('batch-selected');
        const showImage = cardHasDisplayImage(card);
        const cachedUrl = showImage && window.SupabaseSync?.getListDisplayImageSrc
          ? window.SupabaseSync.getListDisplayImageSrc(card.image, card.id)
          : '';
        const imgSrc = showImage ? (cachedUrl || cardImgInitialSrc(card.image)) : '';
        const isCollectCard = window.isCommunityCollectCard?.(card);
        const collectMeta = isCollectCard ? getCommunityCollectImageResolveOpts(card) : null;
        const imgPending = showImage && (!cachedUrl || imgSrc.startsWith('data:image/svg'));
        const mediaLoadingCls = imgPending
          ? ' is-loading card-media--await'
          : (isCollectCard && showImage ? ' card-media--await' : '');
        const shineAt = imgPending ? ` data-shine-at="${Date.now()}"` : '';
        const titleTrim = getCardDisplayTitle(card);
        const timeLabel = formatCardTime(card.updatedAt || card.createdAt);
        const tagsHtml = buildCardTagsHtml(card.tags);
        const pinBadge = card.pinnedAt ? '<span class="card-pin-badge" title="置顶">置顶</span>' : '';
        const imgOnload = "if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'))";
        const fetchPri = !isAppend && idx < 3 ? ' fetchpriority="high"' : '';
        const collectImgAttrs = isCollectCard && collectMeta?.authorId
          ? ` data-author-id="${escapeHtml(collectMeta.authorId)}" data-source-card-id="${escapeHtml(collectMeta.assetId || '')}"`
          : '';
        const mediaHtml = showImage
          ? `<div class="card-media${mediaLoadingCls}"${shineAt}><img class="card-img" src="${escapeHtml(imgSrc)}"${cardImgDataAttr(card.image)} data-image-ref="${escapeHtml(card.image)}"${collectImgAttrs} loading="${!isAppend && idx < eagerImgCount ? 'eager' : 'lazy'}" decoding="async"${fetchPri} draggable="false" alt="" onload="${imgOnload}"></div>`
          : '';
        const headHtml = titleTrim
          ? `<div class="card-head"><div class="card-title">${escapeHtml(titleTrim)}</div>${timeLabel ? `<time class="card-time">${escapeHtml(timeLabel)}</time>` : ''}</div>`
          : (timeLabel ? `<div class="card-head card-head--meta-only"><time class="card-time">${escapeHtml(timeLabel)}</time></div>` : '');
        const mobileActions = window.MobileUI?.isMobile?.()
          ? `<div class="card-mobile-actions mobile-only">
              <button type="button" class="card-mobile-btn" data-mobile-edit="${escapeHtml(card.id)}">编辑</button>
              <button type="button" class="card-mobile-btn" data-mobile-copy="${escapeHtml(card.id)}">复制</button>
              <button type="button" class="card-mobile-btn" data-mobile-fill="${escapeHtml(card.id)}">填入生图</button>
            </div>`
          : '';
        const copyBtnHtml = !window.MobileUI?.isMobile?.()
          ? `<button type="button" class="card-copy-btn" data-card-copy="${escapeHtml(card.id)}" title="复制提示词" aria-label="复制提示词"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`
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
          </div>
          ${copyBtnHtml}`;
        div.addEventListener('click', (e) => {
          if (e.target.closest('.card-copy-btn')) return;
          if (e.target.closest('.card-mobile-actions')) return;
          if (globalViewActive) {
            e.preventDefault();
            openAppreciateViewer(card.id);
            return;
          }
          if (e.target.closest('.card-checkbox')) return;
          rippleWarehouseCard(div, e.clientX, e.clientY);
          if (batchMode) {
            const cb = div.querySelector('.card-checkbox');
            toggleSelectCard(card.id, cb);
          } else {
            pulseWarehouseCard(div, 'press');
            editCard(card.id);
          }
        });
        const img = div.querySelector('.card-img');
        if (img && card.image) {
          const zoomOnClick = !!settings.imageClickZoom;
          img.style.cursor = zoomOnClick ? 'zoom-in' : 'pointer';
          img.addEventListener('click', e => {
            e.stopPropagation();
            if (globalViewActive) {
              openAppreciateViewer(card.id);
              return;
            }
            if (batchMode) {
              const cb = div.querySelector('.card-checkbox');
              toggleSelectCard(card.id, cb);
              return;
            }
            if (zoomOnClick) void openCardImageLightbox(card);
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
          const items = [
            { label: pinLabel, action: () => toggleCardPinById(card.id) },
            { label: '删除', action: () => deleteCardPermanently(card.id) }
          ];
          const others = window.FeatureAssets?.getOtherWarehouses?.() || [];
          others.forEach((w) => {
            items.unshift({
              label: `移到「${w.name}」`,
              action: () => {
                const n = window.FeatureAssets?.moveCardsToWarehouse?.([card.id], w.id);
                if (n) {
                  showToast(`已移到「${w.name}」`);
                  renderGroups();
                  renderCards(true);
                }
              }
            });
          });
          showContextMenu(e.clientX, e.clientY, items);
        });
        fragment.appendChild(div);
      });
      const appendedCards = [...fragment.querySelectorAll('.card')];
      container.appendChild(fragment);
      bindCardGridImageErrors(container);
      bindCardGridImageRelayout(container);
      const runWarehouseImages = () => {
        void hydrateWarehouseGridImages(container, pageCards);
      };
      runWarehouseImages();
      if (!mobileGrid && viewMode !== 'list') {
        if (isAppend && masonryInstance && appendedCards.length) {
          masonryInstance.appended(appendedCards);
          masonryInstance.layout();
        } else {
          resetWarehouseGridLayout(container);
          requestAnimationFrame(() => {
            layoutMasonryGrid();
            requestAnimationFrame(layoutMasonryGrid);
          });
        }
      } else if (mobileGrid) {
        enforceMobileCardGrid();
      }
      if (viewMode === 'list' && masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
      }
      updateBatchCountLabel();
      if (mobileGrid) {
        container.classList.add('cards-grid-primed');
        enforceMobileCardGrid();
        requestAnimationFrame(() => enforceMobileCardGrid());
      }
    }

    document.getElementById('cardsContainer')?.addEventListener('click', (e) => {
      const editId = e.target.closest('[data-mobile-edit]')?.getAttribute('data-mobile-edit');
      if (editId) {
        e.stopPropagation();
        editCard(editId);
        return;
      }
      const copyId = e.target.closest('[data-mobile-copy]')?.getAttribute('data-mobile-copy')
        || e.target.closest('[data-card-copy]')?.getAttribute('data-card-copy');
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

    let warehouseScrollLoading = false;
    document.querySelector('.cards-container')?.addEventListener('scroll', function() {
      if (warehouseScrollLoading) return;
      const mobile = isMobileViewport();
      if (mobile) {
        if (this.scrollTop < 100) return;
        if (this.scrollTop + this.clientHeight < this.scrollHeight - 220) return;
      } else {
        if (this.scrollTop < 48) return;
        if (this.scrollTop + this.clientHeight < this.scrollHeight - 150) return;
      }
      if ((page * PER_PAGE) >= allFilteredCards.length) return;
      warehouseScrollLoading = true;
      page += 1;
      void Promise.resolve(renderCards()).finally(() => {
        warehouseScrollLoading = false;
      });
    }, { passive: true });

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
            if (c) {
              c.group = (targetGroup === 'all' || targetGroup === 'uncategorized') ? null : targetGroup;
              c.updatedAt = Date.now();
            }
          });
          void (async () => {
            await saveAllData();
            renderGroups();
            preserveCardsContainerScroll(() => renderCards(true));
          })();
          if (batchMode) { selectedCardIds.clear(); cancelBatch(); }
          return;
        });
      });
    }

    function updateBatchCountLabel() {
      const el = document.getElementById('batchCountLabel');
      if (el) el.textContent = selectedCardIds.size ? `已选 ${selectedCardIds.size} 张` : '';
    }

    function syncBatchCheckboxUi() {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      container.querySelectorAll('.card[data-id]').forEach((card) => {
        const id = card.dataset.id;
        const on = selectedCardIds.has(id);
        card.classList.toggle('batch-selected', on);
        const cb = card.querySelector('.card-checkbox');
        if (cb) cb.classList.toggle('checked', on);
      });
      updateBatchCountLabel();
    }

    function setBatchModeUi(on) {
      const btn = document.getElementById('batchToggleBtn');
      btn?.classList.toggle('active', on);
      document.getElementById('batchBar')?.classList.toggle('active', on);
      const normalBar = document.getElementById('normalBar');
      if (normalBar) normalBar.style.display = on ? 'none' : 'flex';
      const container = document.getElementById('cardsContainer');
      if (container) container.classList.toggle('batch-mode', on);
    }

    function toggleBatchMode() {
      batchMode = !batchMode;
      selectedCardIds.clear();
      setBatchModeUi(batchMode);
      syncBatchCheckboxUi();
    }

    function cancelBatch() {
      batchMode = false;
      selectedCardIds.clear();
      setBatchModeUi(false);
      syncBatchCheckboxUi();
    }

    function toggleSelectCard(id, el) {
      if (!id) return;
      const cardEl = el?.closest?.('.card') || document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (selectedCardIds.has(id)) {
        selectedCardIds.delete(id);
        if (el) el.classList.remove('checked');
        cardEl?.classList.remove('batch-selected');
      } else {
        selectedCardIds.add(id);
        if (el) el.classList.add('checked');
        cardEl?.classList.add('batch-selected');
        pulseWarehouseCard(cardEl, 'press');
      }
      updateBatchCountLabel();
    }

    let batchProgressVisible = false;

    function showBatchProgress(title, done, total) {
      const ov = document.getElementById('batchProgressOverlay');
      const titleEl = document.getElementById('batchProgressTitle');
      const fill = document.getElementById('batchProgressFill');
      const meta = document.getElementById('batchProgressMeta');
      if (!ov) return;
      batchProgressVisible = true;
      ov.classList.remove('hidden');
      ov.setAttribute('aria-busy', 'true');
      if (titleEl) titleEl.textContent = title || '正在处理…';
      const t = Math.max(1, Number(total) || 1);
      const d = Math.min(t, Math.max(0, Number(done) || 0));
      const pct = Math.round((d / t) * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (meta) meta.textContent = `${d} / ${t}（${pct}%）`;
    }

    function hideBatchProgress() {
      if (!batchProgressVisible) return;
      batchProgressVisible = false;
      const ov = document.getElementById('batchProgressOverlay');
      ov?.classList.add('hidden');
      ov?.setAttribute('aria-busy', 'false');
    }

    async function runBatchWithProgress(title, items, worker) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return;
      showBatchProgress(title, 0, list.length);
      try {
        for (let i = 0; i < list.length; i += 1) {
          await worker(list[i], i);
          showBatchProgress(title, i + 1, list.length);
          if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        hideBatchProgress();
      }
    }

    async function rerenderWarehouseCardsKeepingScroll() {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      const st = container.scrollTop;
      const targetPage = Math.max(1, page);
      const sel = new Set(selectedCardIds);
      const wasBatch = batchMode;
      page = 1;
      await Promise.resolve(renderCards(true));
      for (let p = 2; p <= targetPage; p += 1) {
        page = p;
        await Promise.resolve(renderCards(false));
      }
      if (wasBatch) {
        batchMode = true;
        selectedCardIds = sel;
        setBatchModeUi(true);
        syncBatchCheckboxUi();
      }
      container.scrollTop = st;
      requestAnimationFrame(() => {
        container.scrollTop = st;
        layoutMasonryGrid();
      });
    }

    function initBatchMarqueeSelect() {
      const container = document.getElementById('cardsContainer');
      if (!container || container.dataset.batchMarqueeBound) return;
      container.dataset.batchMarqueeBound = '1';
      let pending = null;
      let drag = null;
      let rectEl = null;
      const DRAG_THRESHOLD = 8;

      const hitTest = (x1, y1, x2, y2) => {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        const hits = [];
        container.querySelectorAll('.card[data-id]').forEach((card) => {
          const r = card.getBoundingClientRect();
          if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) return;
          hits.push(card.dataset.id);
        });
        return hits;
      };

      const clearMarquee = () => {
        rectEl?.remove();
        rectEl = null;
        drag = null;
        pending = null;
        container.classList.remove('batch-marquee-active');
      };

      const finishDrag = (e) => {
        if (!drag) return;
        const ids = hitTest(drag.x, drag.y, e.clientX, e.clientY);
        const add = !e.altKey;
        ids.forEach((id) => {
          if (add) selectedCardIds.add(id);
          else selectedCardIds.delete(id);
        });
        syncBatchCheckboxUi();
        clearMarquee();
      };

      container.addEventListener('mousedown', (e) => {
        if (!batchMode || e.button !== 0) return;
        if (e.target.closest('.card-checkbox, .card-copy-btn, .card-mobile-actions, button, a, input, textarea, select')) return;
        if (!e.target.closest('.cards-container')) return;
        pending = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('mousemove', (e) => {
        if (!pending && !drag) return;
        if (pending && !drag) {
          const dx = Math.abs(e.clientX - pending.x);
          const dy = Math.abs(e.clientY - pending.y);
          if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
          drag = { x: pending.x, y: pending.y };
          pending = null;
          container.classList.add('batch-marquee-active');
          rectEl = document.createElement('div');
          rectEl.className = 'batch-select-rect';
          document.body.appendChild(rectEl);
        }
        if (!drag || !rectEl) return;
        const left = Math.min(drag.x, e.clientX);
        const top = Math.min(drag.y, e.clientY);
        rectEl.style.left = `${left}px`;
        rectEl.style.top = `${top}px`;
        rectEl.style.width = `${Math.abs(e.clientX - drag.x)}px`;
        rectEl.style.height = `${Math.abs(e.clientY - drag.y)}px`;
      });

      window.addEventListener('mouseup', (e) => {
        if (drag) finishDrag(e);
        else pending = null;
      });
    }
    function batchMoveGroup() {
      if (!selectedCardIds.size) return;
      const groups = ['all', 'uncategorized', ...customGroups];
      customPrompt(`输入目标分组 (${groups.join('/')})`, '', (target) => {
        if (!target || !groups.includes(target)) return;
        const gv = target === 'all' || target === 'uncategorized' ? null : target;
        const now = Date.now();
        selectedCardIds.forEach((id) => {
          const c = cards.find((x) => x.id === id);
          if (c) {
            c.group = gv;
            c.updatedAt = now;
          }
        });
        showBatchProgress('正在移动分组…', 0, selectedCardIds.size);
        saveAllData();
        hideBatchProgress();
        cancelBatch();
        renderGroups();
        void rerenderWarehouseCardsKeepingScroll();
      }, null, groups);
    }
    function batchMoveWarehouse() {
      if (!selectedCardIds.size) return;
      const others = window.FeatureAssets?.getOtherWarehouses?.() || [];
      if (!others.length) { showToast('请先创建其他卡片库'); return; }
      const labels = others.map(w => w.name);
      customPrompt('输入目标卡片库名称', '', (name) => {
        const target = others.find(w => w.name === name);
        if (!target) return;
        const n = window.FeatureAssets?.moveCardsToWarehouse?.([...selectedCardIds], target.id);
        if (n) {
          showBatchProgress('正在移库…', n, n);
          saveAllData({ skipCloud: true });
          hideBatchProgress();
          showToast(`已将 ${n} 张卡片移到「${target.name}」`);
          cancelBatch();
          renderGroups();
          void rerenderWarehouseCardsKeepingScroll();
        }
      }, null, labels);
    }
    async function refreshCommunityAfterBatchPublish() {
      window.FeatureDraft?.maybeReconcileCommunityWithCards?.(cards, { force: true });
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        void window.FeatureDraft?.refreshPublicCommunityFeed?.({ force: true }).then(() => {
          window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
        });
      }
      if (document.getElementById('pageCreations')?.classList.contains('active')) {
        void window.FeatureDraft?.renderCreations?.();
      }
    }

    async function batchPublishCommunity() {
      if (!selectedCardIds.size) return;
      if (!isUserLoggedIn()) {
        requireAuth('publish');
        return;
      }
      const ids = [...selectedCardIds];
      let ok = 0;
      let already = 0;
      let skipCollect = 0;
      let skipIneligible = 0;
      await runBatchWithProgress('正在开启社区公开…', ids, async (id) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        if (window.isCommunityCollectCard?.(card)) {
          skipCollect += 1;
          return;
        }
        if (card.publishedToCommunity) {
          already += 1;
          return;
        }
        if (!window.FeatureDraft?.isCommunityPublishEligible?.(card)) {
          skipIneligible += 1;
          return;
        }
        await window.FeatureDraft?.syncCardToCommunity?.(card, true, {
          silent: true,
          skipRender: true,
          skipPersist: true,
          keepPublishFlag: true
        });
        if (card.publishedToCommunity) ok += 1;
      });
      window.__promptHubCards = cards;
      if (ok > 0) {
        showBatchProgress('正在保存并同步社区…', 1, 2);
        await saveAllData({ skipCloud: true });
        if (window.SupabaseSync?.isLoggedIn?.()) {
          scheduleCloudPush();
          void window.FeatureDraft?.syncMyPostsToPublicFeed?.();
        }
        showBatchProgress('正在刷新社区 Feed…', 2, 2);
        await refreshCommunityAfterBatchPublish();
        hideBatchProgress();
      }
      cancelBatch();
      syncBatchCheckboxUi();
      const parts = [];
      if (ok) parts.push(`已公开 ${ok} 张`);
      if (already) parts.push(`${already} 张已是公开`);
      if (skipIneligible) parts.push(`${skipIneligible} 张不满足条件（提示词≥15字且需配图）`);
      if (skipCollect) parts.push(`${skipCollect} 张为社区收藏不可公开`);
      if (!parts.length) showToast('没有可公开的卡片');
      else showToast(parts.join('；'));
    }

    async function batchUnpublishCommunity() {
      if (!selectedCardIds.size) return;
      const ids = [...selectedCardIds];
      let n = 0;
      await runBatchWithProgress('正在关闭社区公开…', ids, async (id) => {
        const card = cards.find((c) => c.id === id);
        if (!card?.publishedToCommunity) return;
        await window.FeatureDraft?.unpublishCommunityByCardId?.(id, { silent: true });
        n += 1;
      });
      if (!n) {
        showToast('所选卡片均未公开到社区');
        return;
      }
      window.__promptHubCards = cards;
      showBatchProgress('正在保存…', 1, 1);
      await saveAllData({ skipCloud: true });
      if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush();
      await refreshCommunityAfterBatchPublish();
      hideBatchProgress();
      cancelBatch();
      syncBatchCheckboxUi();
      showToast(`已关闭 ${n} 张卡片的社区公开`);
    }

    function batchAddTag() {
      if (!selectedCardIds.size) return;
      const allTags = window.getSelectableCardTags?.(cards) || [];
      customPrompt('输入标签名（不含#）', '', (tag) => {
        if (!tag) return;
        if (window.isCommunityCollectTagName?.(tag)) {
          showToast('「社区收藏」标签仅收藏时自动添加');
          return;
        }
        const ids = [...selectedCardIds];
        showBatchProgress('正在添加标签…', 0, ids.length);
        ids.forEach((id, i) => {
          const c = cards.find((x) => x.id === id);
          if (c) {
            if (!c.tags) c.tags = [];
            if (!c.tags.includes(tag)) c.tags.push(tag);
          }
          showBatchProgress('正在添加标签…', i + 1, ids.length);
        });
        saveAllData();
        hideBatchProgress();
        cancelBatch();
        void rerenderWarehouseCardsKeepingScroll();
      }, null, allTags);
    }
    function batchDelete() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        showToast('请先登录后再删除卡片');
        openAuthModal('login');
        return;
      }
      if (!selectedCardIds.size) return;
      customConfirm(`确定永久删除 ${selectedCardIds.size} 张卡片？此操作不可恢复。`, () => {
        void (async () => {
          const ids = [...selectedCardIds];
          await runBatchWithProgress('正在删除卡片…', ids, async (id) => {
            await deleteCardPermanently(id, false, { skipRender: true, silent: true });
          });
          cancelBatch();
          renderGroups();
          await rerenderWarehouseCardsKeepingScroll();
          showToast('已删除所选卡片');
        })();
      });
    }
    function deleteCardPermanently(id, confirm = true, opts = {}) {
      const card = cards.find(c => c.id === id);
      if (card?.image && window.SupabaseSync?.isStorageRef?.(card.image) && !window.SupabaseSync?.isLoggedIn?.()) {
        showToast('请先登录后再操作云端卡片');
        openAuthModal('login');
        return;
      }
      const doDelete = async () => {
        const card = cards.find(c => c.id === id);
        if (!card) return;
        recordCardDeletion(id);
        window.FeatureDraft?.onCardDeletedForGen?.(card);
        const cardPostId = card?.communityPostId;
        if (cardPostId) recordCommunityPostDeletion(cardPostId);
        cards = cards.filter(c => c.id !== id);
        window.__promptHubCards = cards;
        if (selectedCardId === id) {
          selectedCardId = null;
          if (!opts.skipRender) createNewCard({ silentMobile: true });
        }
        if (!opts.skipRender) {
          renderGroups();
          renderCards(true);
          window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
          showToast('已删除卡片');
        }
        void (async () => {
          try {
            if (card?.image && window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync.isStorageRef(card.image)) {
              try {
                await window.SupabaseSync.deleteCardImageByUrl(card.image, { allowGenerated: true });
              } catch (e) { /* ignore */ }
            }
            await window.FeatureDraft?.unpublishCommunityByCardId?.(id, { silent: true });
            await saveAllData();
            if (window.SupabaseSync?.isLoggedIn?.()) {
              try { await pushToCloud({ silent: true }); } catch (e) { scheduleCloudPush(); }
            }
          } catch (e) {
            console.warn('[deleteCard] background cleanup failed', e);
          }
        })();
      };
      if (confirm) {
        customConfirm('确定永久删除该卡片？此操作不可恢复。', () => { void doDelete(); });
        return;
      }
      return doDelete();
    }

    let editCardFillSeq = 0;
    let panelPreviewSeq = 0;
    let lightboxLoadSeq = 0;

    function clearPanelPreviewImage() {
      const img = document.getElementById('previewImage');
      const dropArea = document.getElementById('dropArea');
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
      }
      dropArea?.classList.add('is-loading-preview');
    }

    function stashEditPanelDraft() {
      const prompt = (document.getElementById('floatingPromptText')?.value
        || document.getElementById('cardPrompt')?.value || '').trim();
      const title = (document.getElementById('cardTitle')?.value || '').trim();
      if (!imageData && !pendingUploadFile && !prompt && !title && !currentTags.length) {
        return;
      }
      editPanelStashedDraft = {
        cardId: selectedCardId,
        isNewCardMode: !!isNewCardMode,
        imageData,
        pendingUploadBytes,
        imageRemovalPending: !!imageRemovalPending,
        prompt,
        title,
        tags: [...currentTags],
        customFields: { ...currentCardCustomFields }
      };
    }

    function tryRestoreEditPanelDraft(cardId, isNew) {
      const d = editPanelStashedDraft;
      if (!d) return false;
      if (!!d.isNewCardMode !== !!isNew) return false;
      if (!isNew && String(d.cardId) !== String(cardId)) return false;
      document.getElementById('cardTitle').value = d.title || '';
      document.getElementById('cardPrompt').value = d.prompt || '';
      document.getElementById('floatingPromptText').value = d.prompt || '';
      imageData = d.imageData || null;
      imageRemovalPending = !!d.imageRemovalPending;
      pendingUploadFile = null;
      pendingUploadBytes = d.pendingUploadBytes || estimateDataUrlBytes(imageData);
      currentTags = [...(d.tags || [])];
      currentCardCustomFields = { ...(d.customFields || {}) };
      cardOriginalReuploadRequired = false;
      editPanelStashedDraft = null;
      renderTags();
      renderCustomFields();
      void updatePreview();
      updateCardImageSizeHint();
      return true;
    }

    function editCard(id) {
      const card = cards.find(c => c.id === id); if (!card) return;
      panelPreviewSeq += 1;
      clearPanelPreviewImage();
      selectedCardId = id; isNewCardMode = false;
      highlightSelectedCard(id);
      openEditPanel();
      document.getElementById('panelTitle').textContent = '编辑卡片';
      window.FeatureDraft?.setPublishCheckbox?.(card);
      const seq = ++editCardFillSeq;
      const fillForm = () => {
        if (seq !== editCardFillSeq) return;
        if (tryRestoreEditPanelDraft(id, false)) {
          window.FeatureDraft?.setPublishCheckbox?.(card);
          updateDeleteClearButton();
          updatePinToggleUI();
          return;
        }
        document.getElementById('cardTitle').value = card.title || '';
        document.getElementById('cardPrompt').value = card.prompt || '';
        document.getElementById('floatingPromptText').value = card.prompt || '';
        imageData = card.image || null;
        imageRemovalPending = false;
        pendingUploadFile = null;
        pendingUploadBytes = 0;
        cardOriginalReuploadRequired = false;
        currentTags = [...(card.tags || [])]; tempCustomFields = [];
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
    window.editCardById = editCard;

    function resetNewCardForm() {
      editPanelStashedDraft = null;
      selectedCardId = null;
      isNewCardMode = true;
      document.getElementById('panelTitle').textContent = '新建卡片';
      document.getElementById('cardTitle').value = '';
      document.getElementById('cardPrompt').value = '';
      document.getElementById('floatingPromptText').value = '';
      imageData = null;
      imageRemovalPending = false;
      pendingUploadFile = null;
      pendingUploadBytes = 0;
      currentTags = [];
      tempCustomFields = [];
      currentCardCustomFields = {};
      window.FeatureDraft?.clearPublishDraft?.();
      window.FeatureDraft?.setPublishCheckbox?.(null);
      cardOriginalReuploadRequired = false;
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
      const modalFileInput = document.getElementById('modalFileInput');
      if (modalFileInput) modalFileInput.value = '';
      renderTags();
      renderCustomFields();
      updatePreview();
      updateDeleteClearButton();
      updatePinToggleUI();
      updatePanelTrimToolVisibility();
    }

    function createNewCard(opts) {
      const check = canGuestCreateCard();
      if (!check.ok) {
        promptLogin(check.msg);
        return;
      }
      pulseFabButton();
      resetNewCardForm();
      highlightSelectedCard(null);
      const mobile = isMobileViewport();
      const shouldOpenPanel = !(mobile && opts?.silentMobile);
      if (shouldOpenPanel) {
        openEditPanel();
        if (tryRestoreEditPanelDraft(null, true)) {
          window.FeatureDraft?.setPublishCheckbox?.(null);
          updateDeleteClearButton();
          updatePinToggleUI();
        }
      }
    }

    const TRASH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    function updateDeleteClearButton() {
      const btn = document.getElementById('actionDeleteClearBtn');
      const mobileTop = document.getElementById('actionDeleteClearBtnMobileTop');
      if (isNewCardMode) {
        if (btn) {
          btn.style.display = 'none';
        }
        if (mobileTop) {
          mobileTop.style.display = 'inline-flex';
          mobileTop.title = '清空表单';
          mobileTop.setAttribute('aria-label', '清空表单');
          mobileTop.className = 'btn btn-ghost btn-sm mobile-only panel-header-clear-btn';
          mobileTop.textContent = '清空';
          mobileTop.onclick = () => clearCardForm();
        }
      } else {
        if (mobileTop) {
          mobileTop.style.display = 'inline-flex';
          mobileTop.title = '删除卡片';
          mobileTop.setAttribute('aria-label', '删除卡片');
          mobileTop.className = 'btn btn-ghost btn-sm mobile-only panel-header-delete-btn';
          mobileTop.textContent = '删除';
          mobileTop.onclick = () => {
            if (selectedCardId) deleteCardPermanently(selectedCardId, true);
          };
        }
        if (btn) {
          btn.style.display = 'inline-flex';
          btn.title = '删除卡片';
          btn.className = 'btn-icon-danger desktop-only';
          btn.innerHTML = TRASH_SVG;
          btn.onclick = () => {
            if (selectedCardId) deleteCardPermanently(selectedCardId, true);
          };
        }
      }
    }

    function clearCardForm() {
      createNewCard(isMobileViewport() ? { silentMobile: true } : undefined);
    }

    function renderTags() {
      const wrap = document.getElementById('tagChipsWrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      const collectTag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
      currentTags.forEach(t => {
        const chip = document.createElement('span');
        const locked = t === collectTag;
        chip.className = 'tag-chip' + (locked ? ' tag-chip-locked' : '');
        chip.innerHTML = locked
          ? `#${escapeHtml(t)}`
          : `#${escapeHtml(t)} <span class="remove-tag" onclick="removeTag('${escapeJsString(t)}')">×</span>`;
        wrap.appendChild(chip);
      });
      const picker = document.getElementById('tagInlinePicker');
      if (picker && !picker.hidden) renderTagInlineList();
    }

    function addTag() {
      const raw = document.getElementById('tagInput').value.trim();
      if (!raw) return;
      const t = raw.replace(/^#/, '');
      if (window.isCommunityCollectTagName?.(t)) {
        showToast('「社区收藏」标签仅收藏时自动添加');
        return;
      }
      if (t && !currentTags.includes(t)) { currentTags.push(t); renderTags(); }
      document.getElementById('tagInput').value = '';
    }
    function removeTag(t) {
      if (window.isCommunityCollectTagName?.(t)) {
        showToast('「社区收藏」标签不可移除');
        return;
      }
      currentTags = currentTags.filter(x => x !== t);
      renderTags();
    }
    
    let tagInlineOutsideBound = false;

    function applyTagFromSheet(tag) {
      if (window.isCommunityCollectTagName?.(tag)) {
        showToast('「社区收藏」标签仅收藏时自动添加');
        return;
      }
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        renderTags();
      }
    }

    function tagInlineOutsideClose(e) {
      if (e.target.closest('#tagContainer')) return;
      closeTagSheet();
    }

    function tagInlineEscClose(e) {
      if (e.key === 'Escape') closeTagSheet();
    }

    function bindTagInlineOutsideClose() {
      if (tagInlineOutsideBound) return;
      tagInlineOutsideBound = true;
      document.addEventListener('pointerdown', tagInlineOutsideClose, true);
      document.addEventListener('keydown', tagInlineEscClose);
    }

    function unbindTagInlineOutsideClose() {
      if (!tagInlineOutsideBound) return;
      tagInlineOutsideBound = false;
      document.removeEventListener('pointerdown', tagInlineOutsideClose, true);
      document.removeEventListener('keydown', tagInlineEscClose);
    }

    function closeTagSheet() {
      const picker = document.getElementById('tagInlinePicker');
      const btn = document.getElementById('tagPickBtn');
      const list = document.getElementById('tagInlineList');
      if (picker) picker.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (list) list.innerHTML = '';
      unbindTagInlineOutsideClose();
    }

    function renderTagInlineList() {
      const list = document.getElementById('tagInlineList');
      if (!list) return;
      const all = window.getSelectableCardTags?.(cards) || [];
      list.innerHTML = '';
      if (!all.length) {
        list.innerHTML = '<div class="tag-inline-empty">暂无任何标签</div>';
        return;
      }
      all.forEach(tag => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'tag-inline-option' + (currentTags.includes(tag) ? ' is-selected' : '');
        opt.textContent = '#' + tag;
        opt.disabled = currentTags.includes(tag);
        opt.addEventListener('click', () => {
          applyTagFromSheet(tag);
          showToast('已添加标签');
          opt.classList.add('is-selected');
          opt.disabled = true;
        });
        list.appendChild(opt);
      });
    }

    function showExistingTags() {
      const picker = document.getElementById('tagInlinePicker');
      const btn = document.getElementById('tagPickBtn');
      if (!picker || !btn) return;
      if (!picker.hidden) {
        closeTagSheet();
        return;
      }
      renderTagInlineList();
      picker.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      bindTagInlineOutsideClose();
    }
    window.showExistingTags = showExistingTags;
    window.closeTagSheet = closeTagSheet;
    
    document.getElementById('tagInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    document.getElementById('tagPickBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      showExistingTags();
    });

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

    function setPanelSaveProgress(opts = {}) {
      const wrap = document.getElementById('panelSaveProgress');
      const fill = document.getElementById('panelSaveProgressFill');
      const label = document.getElementById('panelSaveProgressLabel');
      if (!wrap) return;
      if (opts.hidden) {
        wrap.classList.add('hidden');
        fill?.classList.remove('is-indeterminate');
        if (fill) fill.style.width = '0%';
        return;
      }
      wrap.classList.remove('hidden');
      if (label && opts.text) label.textContent = opts.text;
      if (!fill) return;
      if (opts.indeterminate) {
        fill.classList.add('is-indeterminate');
        fill.style.width = '';
        return;
      }
      fill.classList.remove('is-indeterminate');
      fill.style.width = `${Math.max(0, Math.min(100, Number(opts.percent) || 0))}%`;
    }
    window.setPanelSaveProgress = setPanelSaveProgress;

    function uploadEncodeModeLabel(opts = {}) {
      if (!opts.uploadOriginal && !opts.original) return '已压缩保存';
      if (opts.encodeMode === 'full_res_jpeg') return '原尺寸高清JPEG已存';
      return '原图已存';
    }

    function formatFileSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function estimateDataUrlBytes(dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string') return 0;
      const i = dataUrl.indexOf(',');
      if (i < 0) return 0;
      return Math.max(0, Math.floor(dataUrl.slice(i + 1).length * 0.75));
    }

    function syncCardUploadOriginalToggle() {
      const btn = document.getElementById('cardUploadOriginalToggle');
      if (!btn) return;
      const active = window.__cardUploadOriginal === true;
      btn.textContent = active ? '上传原图：开' : '上传原图：关';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-on', active);
    }

    function updateCardImageSizeHint(opts = {}) {
      const el = document.getElementById('cardImageSizeHint');
      const dl = document.getElementById('cardDownloadImageBtn');
      if (!el) return;
      const bytes = opts.bytes != null
        ? opts.bytes
        : (pendingUploadBytes || estimateDataUrlBytes(imageData));
      if (!imageData && !bytes) {
        el.textContent = '未选择图片';
        if (dl) dl.classList.add('hidden');
        return;
      }
      if (!opts.saved && window.SupabaseSync?.isStorageRef?.(imageData) && !pendingUploadFile && !pendingUploadBytes) {
        const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
        if (card?.imageStoredBytes > 0) {
          const mode = card.imageUploadOriginal
            ? (card.imageEncodeMode === 'full_res_jpeg' ? '原尺寸高清JPEG已存' : '原图已存')
            : '已压缩保存';
          el.textContent = `${mode} · ${formatFileSize(card.imageStoredBytes)}`;
          if (dl) dl.classList.remove('hidden');
          return;
        }
        el.textContent = window.__cardUploadOriginal === true
          ? '云端已存 · 重新选择图片可上传原图'
          : '云端已存 · 重新选择可更换图片';
        if (dl) dl.classList.remove('hidden');
        return;
      }
      if (opts.saved) {
        const mode = uploadEncodeModeLabel(opts);
        el.textContent = `${mode} · ${formatFileSize(bytes)}`;
      } else {
        const original = window.__cardUploadOriginal === true;
        const overBucket = bytes > (50 * 1024 * 1024);
        el.textContent = original
          ? (overBucket
            ? `将原图上传 · 本地 ${formatFileSize(bytes)}（超5MB自动转原尺寸JPEG）`
            : `将原图上传 · 本地 ${formatFileSize(bytes)}`)
          : `将压缩上传 · 本地 ${formatFileSize(bytes)}`;
      }
      if (dl) dl.classList.remove('hidden');
    }

    function extensionFromBlob(blob) {
      const t = String(blob?.type || '').toLowerCase();
      if (t.includes('png')) return 'png';
      if (t.includes('webp')) return 'webp';
      if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
      return 'png';
    }

    function downloadFilenameForCard(card, blob, filename) {
      if (filename && /\.\w{3,4}$/i.test(filename)) {
        const ext = extensionFromBlob(blob);
        return filename.replace(/\.\w{3,4}$/i, `.${ext}`);
      }
      const id = card?.id || Date.now();
      return `prompt-hub-${id}.${extensionFromBlob(blob)}`;
    }

    async function fetchBlobFromUrl(url) {
      if (!url) return null;
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) return await res.blob();
      } catch (e) { /* proxy */ }
      if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
        if (tmp) {
          try {
            const blob = await (await fetch(tmp)).blob();
            URL.revokeObjectURL(tmp);
            return blob;
          } catch (e) {
            URL.revokeObjectURL(tmp);
          }
        }
      }
      return null;
    }

    async function tryFastGenJobDownloadBlob(card) {
      const jobId = String(card?.genJobId || '').replace(/#\d+$/, '');
      if (!jobId || !window.PromptHubApi?.getGenerationImageUrl) return null;
      try {
        const r = await window.PromptHubApi.getGenerationImageUrl(jobId);
        if (!r?.ok || !r.data?.url) return null;
        return await fetchBlobFromUrl(r.data.url);
      } catch (e) {
        console.warn('[download] fast gen job url failed', jobId, e);
        return null;
      }
    }

    function saveBlobDownload(blob, filename) {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename || `prompt-hub-${Date.now()}.${extensionFromBlob(blob)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    }

    const cardDownloadInflight = new Set();

    function downloadPrepToast(card) {
      const res = String(card?.resolution || '').toLowerCase();
      if (res === '4k') {
        showToast('正在拉取 4K 原图…（文件较大，约 10–40 秒，可继续浏览其他图）', 5000);
      } else if (res === '2k') {
        showToast('正在拉取 2K 原图…（约几秒，可继续浏览其他图）', 3500);
      } else {
        showToast('正在准备原图下载…', 2500);
      }
    }

    function setDownloadTriggerBusy(btn, busy) {
      if (!btn) return;
      const label = btn.querySelector('span');
      if (busy) {
        if (!btn.dataset.prevLabel) {
          btn.dataset.prevLabel = label?.textContent || btn.textContent || '下载';
        }
        btn.classList.add('is-downloading');
        btn.setAttribute('aria-busy', 'true');
        if (label) label.textContent = '下载中…';
        else btn.textContent = '下载中…';
      } else {
        btn.classList.remove('is-downloading');
        btn.removeAttribute('aria-busy');
        const prev = btn.dataset.prevLabel || '下载';
        if (label) label.textContent = prev;
        else btn.textContent = prev;
        delete btn.dataset.prevLabel;
      }
    }

    async function downloadCardImageFile(imageRef, cardId, filename, opts = {}) {
      const card = cardId ? cards.find((c) => c.id === cardId) : null;
      const inflightKey = String(cardId || imageRef || 'anon');
      const triggerBtn = opts.triggerBtn || null;

      if (cardDownloadInflight.has(inflightKey)) {
        showToast('该图正在下载中，请稍候…');
        return;
      }

      cardDownloadInflight.add(inflightKey);
      setDownloadTriggerBusy(triggerBtn, true);

      try {
        const minBytes = card && window.SupabaseSync?.expectedMinFullImageBytes
          ? window.SupabaseSync.expectedMinFullImageBytes(card.resolution)
          : 0;
        let blob = card ? await tryFastGenJobDownloadBlob(card) : null;
        if (blob && minBytes > 0 && blob.size < minBytes) blob = null;
        if (blob) {
          const name = downloadFilenameForCard(card, blob, filename);
          saveBlobDownload(blob, name);
          showToast(`下载完成 · ${formatFileSize(blob.size)}`);
          return;
        }
        if (card && window.SupabaseSync?.downloadCardFullResBlob) {
          downloadPrepToast(card);
          const fullBlob = await window.SupabaseSync.downloadCardFullResBlob(card);
          if (fullBlob) {
            const name = downloadFilenameForCard(card, fullBlob, filename);
            saveBlobDownload(fullBlob, name);
            if (minBytes > 0 && fullBlob.size < minBytes) {
              showToast(`已下载 · ${formatFileSize(fullBlob.size)}（体积偏小，请稍后再试或重新生成）`, 6000);
            } else {
              showToast(`下载完成 · ${formatFileSize(fullBlob.size)}`);
            }
            return;
          }
        }
        if (typeof imageRef === 'string' && imageRef.startsWith('data:image/')) {
          const dataBlob = await (await fetch(imageRef)).blob();
          const name = downloadFilenameForCard(card, dataBlob, filename);
          await promptHubSaveImage(imageRef, name);
          showToast('下载完成');
          return;
        }
        if (window.SupabaseSync?.downloadCardStorageBlob) {
          downloadPrepToast(card);
          const jobId = card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
          const storageBlob = await window.SupabaseSync.downloadCardStorageBlob(imageRef, cardId, { jobId });
          if (storageBlob) {
            const name = downloadFilenameForCard(card, storageBlob, filename);
            saveBlobDownload(storageBlob, name);
            showToast(`下载完成 · ${formatFileSize(storageBlob.size)}`);
            return;
          }
        }
        if (card?.genJobId && window.SupabaseSync?.rearchiveGeneratedCardFromJob) {
          downloadPrepToast(card);
          await window.SupabaseSync.rearchiveGeneratedCardFromJob(card);
          const retry = await window.SupabaseSync.downloadCardFullResBlob(card, { skipRepair: true });
          if (retry) {
            const name = downloadFilenameForCard(card, retry, filename);
            saveBlobDownload(retry, name);
            showToast(`下载完成 · ${formatFileSize(retry.size)}`);
            return;
          }
        }
        showToast('原图暂不可用，请稍后重试或重新生成');
      } catch (e) {
        showToast('下载失败，请稍后重试');
        console.warn('[download] card image failed', e);
      } finally {
        cardDownloadInflight.delete(inflightKey);
        setDownloadTriggerBusy(triggerBtn, false);
      }
    }
    window.downloadCardImageFile = downloadCardImageFile;
    window.isCardDownloadInflight = (id) => cardDownloadInflight.has(String(id || ''));

    async function downloadPanelCardImage() {
      if (!imageData) {
        showToast('请先选择图片');
        return;
      }
      const dropArea = document.getElementById('dropArea');
      if (dropArea?.classList.contains('is-loading-preview')) {
        showToast('图片加载中，请稍后再下载');
        return;
      }
      const cardId = selectedCardId;
      const ref = imageData;
      await downloadCardImageFile(ref, cardId);
    }
    window.downloadPanelCardImage = downloadPanelCardImage;

    function initCardUploadOriginalToggle() {
      const btn = document.getElementById('cardUploadOriginalToggle');
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      if (typeof window.__cardUploadOriginal !== 'boolean') {
        window.__cardUploadOriginal = settings.preserveOriginalCardImage === true
          || window.SupabaseSync?.preserveOriginalCardImageFromSettings?.() === true;
      }
      syncCardUploadOriginalToggle();
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const turningOn = !window.__cardUploadOriginal;
        window.__cardUploadOriginal = turningOn;
        settings.preserveOriginalCardImage = window.__cardUploadOriginal;
        if (turningOn
          && window.SupabaseSync?.isStorageRef?.(imageData)
          && !pendingUploadFile) {
          cardOriginalReuploadRequired = true;
        } else if (!turningOn) {
          cardOriginalReuploadRequired = false;
        }
        syncCardUploadOriginalToggle();
        updateCardImageSizeHint();
        try {
          localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
          const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
          if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        } catch (err) { /* ignore */ }
      });
      document.getElementById('cardDownloadImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void downloadPanelCardImage();
      });
    }

    function updatePanelTrimToolVisibility() {
      const el = document.getElementById('panelImageTools');
      if (!el) return;
      el.classList.remove('hidden');
      const trimBtn = document.getElementById('trimBlackBorderBtn');
      if (trimBtn) {
        trimBtn.classList.toggle('hidden', settings.showTrimBlackBorderTool !== true || !imageData);
      }
      syncCardUploadOriginalToggle();
      updateCardImageSizeHint();
    }
    window.updatePanelTrimToolVisibility = updatePanelTrimToolVisibility;

    async function trimPanelImageBlackBorder() {
      if (!imageData || !window.ImageTrim?.trimBlackBorders) {
        showToast('暂无法裁切');
        return;
      }
      const btn = document.getElementById('trimBlackBorderBtn');
      if (btn) btn.disabled = true;
      try {
        let src = imageData;
        if (window.SupabaseSync?.isStorageRef?.(imageData)) {
          src = await window.SupabaseSync.resolveDisplayUrl(imageData, { assetId: selectedCardId });
        }
        if (!src || String(src).includes('data:image/svg')) {
          showToast('请先加载图片');
          return;
        }
        const result = await window.ImageTrim.trimBlackBorders(src);
        if (!result?.trimmed) {
          showToast('未检测到明显黑边');
          return;
        }
        imageData = result.dataUrl;
        imageRemovalPending = false;
        pendingUploadFile = null;
        pendingUploadBytes = estimateDataUrlBytes(imageData);
        await updatePreview();
        showToast('已裁除黑边');
      } catch (e) {
        showToast('裁切失败');
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    window.trimPanelImageBlackBorder = trimPanelImageBlackBorder;

    async function updatePreview() {
      const seq = ++panelPreviewSeq;
      const cardIdAtStart = selectedCardId;
      const imageAtStart = imageData;
      const img = document.getElementById('previewImage'), p = document.getElementById('dropPlaceholder');
      const removeBtn = document.getElementById('removeImageBtn'), dropArea = document.getElementById('dropArea');
      const previewStale = () =>
        seq !== panelPreviewSeq || cardIdAtStart !== selectedCardId || imageAtStart !== imageData;
      const finishPreviewLoad = () => {
        if (previewStale()) return;
        dropArea?.classList.remove('is-loading-preview');
        const dl = document.getElementById('cardDownloadImageBtn');
        if (dl) dl.disabled = false;
      };
      const bindPreviewImgHandlers = () => {
        if (!img) return;
        img.onload = () => {
          if (!previewStale()) finishPreviewLoad();
        };
        img.onerror = () => {
          if (previewStale()) return;
          const thumb = selectedCardId && window.SupabaseSync?.getListDisplayImageSrc
            ? window.SupabaseSync.getListDisplayImageSrc(imageData, selectedCardId)
            : '';
          if (thumb && img.src !== thumb) {
            img.src = thumb;
            return;
          }
          dropArea?.classList.add('is-loading-preview');
        };
      };
      const dlBtn = document.getElementById('cardDownloadImageBtn');
      if (imageData) {
        let src = '';
        let thumbSrc = '';
        if (selectedCardId && window.SupabaseSync?.getListDisplayImageSrc) {
          thumbSrc = window.SupabaseSync.getListDisplayImageSrc(imageData, selectedCardId) || '';
        }
        if (window.SupabaseSync?.getCachedDisplayUrl && window.SupabaseSync?.isStorageRef?.(imageData)) {
          src = window.SupabaseSync.getCachedDisplayUrl(imageData, {
            assetId: selectedCardId,
            variant: window.SupabaseSync.VARIANT_FULL || 'full'
          }) || '';
        }
        if ((!src || src.includes('data:image/svg')) && thumbSrc) {
          src = thumbSrc;
        }
        if (!src || src.includes('data:image/svg')) {
          const initial = cardImgInitialSrc(imageData);
          if (initial && !initial.includes('data:image/svg')) src = initial;
        }
        if ((!src || src.includes('data:image/svg')) && typeof imageData === 'string' && imageData.startsWith('data:image/')) {
          src = imageData;
        }
        const waiting = !src || src.includes('data:image/svg');
        dropArea?.classList.toggle('is-loading-preview', waiting);
        if (dlBtn) dlBtn.disabled = waiting;
        if (previewStale()) return;
        bindPreviewImgHandlers();
        if (src && !src.includes('data:image/svg')) {
          img.src = src;
        } else {
          img.removeAttribute('src');
        }
        img.style.display = 'block';
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const cur = img.src || imageData;
          if (cur && !String(cur).includes('data:image/svg') && typeof openLightbox === 'function') {
            openLightbox(cur, { cardId: selectedCardId || undefined });
          } else {
            void openCardImageLightbox({ id: selectedCardId, image: imageData });
          }
        };
        p.style.display = 'none';
        removeBtn.style.display = 'flex';
        dropArea.classList.add('has-image');
        dropArea.classList.remove('no-image');
        if (waiting && typeof window.getCardImageBackup === 'function' && selectedCardId) {
          void getCardImageBackup(selectedCardId).then((backup) => {
            if (previewStale()) return;
            if (backup && String(backup).startsWith('data:')) {
              img.src = backup;
              finishPreviewLoad();
            }
          });
        }
        if (window.SupabaseSync?.resolveDisplayUrl && window.SupabaseSync?.isStorageRef?.(imageData)) {
          const url = await window.SupabaseSync.resolveDisplayUrl(imageData, {
            assetId: selectedCardId,
            variant: window.SupabaseSync.VARIANT_FULL || 'full',
            tryAllPaths: true,
            preferFull: true
          });
          if (previewStale()) return;
          if (url && !url.startsWith('data:image/svg')) {
            if (img.src !== url) img.src = url;
            finishPreviewLoad();
          } else if (thumbSrc && img.src !== thumbSrc) {
            img.src = thumbSrc;
            finishPreviewLoad();
          }
        } else if (src && !src.includes('data:image/svg')) {
          finishPreviewLoad();
        }
      } else {
        if (dlBtn) dlBtn.disabled = true;
        dropArea?.classList.remove('is-loading-preview');
        img.style.display = 'none';
        p.style.display = 'block';
        removeBtn.style.display = 'none';
        dropArea.classList.add('no-image');
        dropArea.classList.remove('has-image');
      }
      updatePanelTrimToolVisibility();
    }

    function removeImage() {
      if (!imageData) return;
      imageData = null;
      imageRemovalPending = true;
      pendingUploadFile = null;
      pendingUploadBytes = 0;
      updatePreview();
      showToast('已从编辑区去掉图片；点「保存」后才会真正删除', 4000);
    }
    function updatePanelOcrBoxVisibility() {
      const on = settings.autoPromptOcr === true;
      document.getElementById('panelOcrDrop')?.classList.toggle('hidden', !on);
    }
    window.updatePanelOcrBoxVisibility = updatePanelOcrBoxVisibility;

    async function handleOcrOnlyImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      if (!isEditPanelOpen() || settings.autoPromptOcr !== true) return;
      const inner = document.getElementById('panelOcrDropInner');
      const hint = document.getElementById('panelOcrDropHint');
      const status = document.getElementById('panelOcrDropStatus');
      inner?.classList.add('is-busy');
      hint?.classList.add('hidden');
      status?.classList.remove('hidden');
      const r = new FileReader();
      r.onload = async (e) => {
        try {
          const text = await recognizeImageText(e.target.result);
          if (text) {
            const promptEl = document.getElementById('cardPrompt');
            if (promptEl) {
              promptEl.value = text;
              if (floatingPromptActive) {
                const fp = document.getElementById('floatingPromptText');
                if (fp) fp.value = text;
              }
              window.FeatureDraft?.syncCardPublishFromPrompt?.(text);
            }
            showToast('已填入提示词');
          } else {
            showToast('未识别到文字');
          }
        } finally {
          inner?.classList.remove('is-busy');
          hint?.classList.remove('hidden');
          status?.classList.add('hidden');
        }
      };
      r.onerror = () => {
        inner?.classList.remove('is-busy');
        hint?.classList.remove('hidden');
        status?.classList.add('hidden');
        showToast('无法读取图片');
      };
      r.readAsDataURL(file);
    }

    function bindPanelOcrDrop() {
      const inner = document.getElementById('panelOcrDropInner');
      const input = document.getElementById('panelOcrFileInput');
      if (!inner || !input || inner.dataset.bound === '1') return;
      inner.dataset.bound = '1';
      inner.setAttribute('tabindex', '0');
      inner.addEventListener('click', (e) => {
        e.stopPropagation();
        input.click();
      });
      ['dragenter', 'dragover'].forEach((ev) => {
        inner.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          inner.classList.add('dragover');
        });
      });
      inner.addEventListener('dragleave', () => inner.classList.remove('dragover'));
      inner.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inner.classList.remove('dragover');
        handleOcrOnlyImage(e.dataTransfer.files[0]);
      });
      input.addEventListener('change', (e) => {
        handleOcrOnlyImage(e.target.files[0]);
        e.target.value = '';
      });
    }

    function isEditPanelOpen() {
      return !document.getElementById('editPanel')?.classList.contains('hidden');
    }
    function handleSingleImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      if (!isEditPanelOpen()) return;
      imageRemovalPending = false;
      cardOriginalReuploadRequired = false;
      pendingUploadFile = file;
      pendingUploadBytes = file.size || 0;
      const r = new FileReader();
      r.onload = e => {
        imageData = e.target.result;
        updatePreview();
        updateCardImageSizeHint({ bytes: pendingUploadBytes });
      };
      r.readAsDataURL(file);
    }
    const dropArea = document.getElementById('dropArea');
    dropArea.addEventListener('dragover', e => { e.preventDefault(); if (!isEditPanelOpen()) return; dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('dragover');
      if (!isEditPanelOpen()) return;
      handleSingleImage(e.dataTransfer.files[0]);
    });
    dropArea.addEventListener('click', (e) => {
      if (!isEditPanelOpen()) return;
      if (e.target.tagName !== 'IMG' && e.target.tagName !== 'BUTTON') document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', e => {
      handleSingleImage(e.target.files[0]);
      e.target.value = '';
    });

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
        const ocrDrop = document.getElementById('panelOcrDrop');
        const ocrEnabled = settings.autoPromptOcr === true && ocrDrop && !ocrDrop.classList.contains('hidden');
        const ocrFocused = ocrDrop?.contains(document.activeElement);
        const items = e.clipboardData.items;
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            if (ocrEnabled && ocrFocused) handleOcrOnlyImage(i.getAsFile());
            else handleSingleImage(i.getAsFile());
            break;
          }
        }
      }
    });

    async function saveCard() {
      const statusEl = document.getElementById('statusMsg');
      const saveBtn = document.querySelector('.btn-footer-save');
      const prompt = floatingPromptActive ? document.getElementById('floatingPromptText').value.trim() : document.getElementById('cardPrompt').value.trim();
      if (!prompt) { statusEl.textContent = '❌ 提示词不能为空'; return; }
      if (isNewCardMode) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          statusEl.textContent = '❌ ' + check.msg;
          promptLogin(check.msg);
          return;
        }
      }
      if (cardOriginalReuploadRequired
        && window.__cardUploadOriginal === true
        && window.SupabaseSync?.isStorageRef?.(imageData)
        && !pendingUploadFile) {
        statusEl.textContent = '❌ 请重新选择图片后再保存原图';
        showToast('已开启原图：请重新选择一次图片再保存');
        return;
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
      const snap = {
        prompt,
        title,
        tags: [...currentTags],
        customFields: customData,
        isNewCard: isNewCardMode,
        cardId: (!isNewCardMode && selectedCardId) ? selectedCardId : generateId(),
        previousImage: (!isNewCardMode && selectedCardId)
          ? (cards.find(c => c.id === selectedCardId)?.image || null)
          : null,
        imageValue: imageData,
        uploadFile: pendingUploadFile,
        uploadOriginal: window.__cardUploadOriginal === true,
        wantPublish: window.FeatureDraft?.readPublishCheckbox?.() ?? false,
        imageRemovalPending: imageRemovalPending
      };
      const editingCard = !snap.isNewCard
        ? cards.find(c => c.id === snap.cardId)
        : null;
      if (window.isCommunityCollectCard?.(editingCard) && snap.wantPublish) {
        statusEl.textContent = '❌ 社区收藏卡片不可发布到社区';
        showToast('社区收藏卡片不可发布到社区');
        return;
      }
      if (snap.wantPublish && !isUserLoggedIn()) {
        statusEl.textContent = '❌ 发布到社区需先登录';
        requireAuth('publish');
        return;
      }
      if (snap.wantPublish && snap.prompt.length < 15) {
        statusEl.textContent = '❌ 发布到社区需要提示词至少 15 字';
        return;
      }
      const uploadSource = snap.uploadFile || (
        snap.imageValue && !window.SupabaseSync?.isStorageRef?.(snap.imageValue)
          ? snap.imageValue
          : null
      );
      const needsFreshUpload = !!uploadSource;
      const pendingRemovalOnly = snap.imageRemovalPending && !uploadSource && !snap.imageValue;
      const localUploadBytes = snap.uploadFile?.size || pendingUploadBytes || estimateDataUrlBytes(snap.imageValue);
      if (saveBtn) saveBtn.disabled = true;
      setPanelSaveProgress({ text: '准备保存…', percent: 8 });
      let finalImage = pendingRemovalOnly ? null : snap.imageValue;
      try {
        if (window.SupabaseSync?.isLoggedIn?.()) {
          if (snap.imageValue && window.SupabaseSync.isDataUrl(snap.imageValue)) {
            setPanelSaveProgress({ text: '备份本地图片…', percent: 12, indeterminate: true });
            await saveCardImageBackup(snap.cardId, snap.imageValue);
          }
          if (pendingRemovalOnly) {
            setPanelSaveProgress({ text: '删除云端图片…', percent: 40, indeterminate: true });
            finalImage = await window.SupabaseSync.resolveCardImageForSave(
              snap.cardId,
              null,
              snap.previousImage,
              { original: snap.uploadOriginal }
            );
          } else if (needsFreshUpload) {
            const estBytes = Math.max(localUploadBytes || 0, snap.uploadFile?.size || 0);
            if (estBytes > 0 && window.Membership?.canAddStorageBytes && !window.Membership.canAddStorageBytes(estBytes)) {
              const summary = window.Membership.getStorageSummaryLabel?.() || '';
              statusEl.textContent = '❌ 云存储空间不足';
              showToast(`云存储已满（${summary}）。请删除旧图或升级会员。`);
              return;
            }
            const prepText = snap.uploadOriginal
              ? (localUploadBytes > 50 * 1024 * 1024
                ? `准备上传（原尺寸JPEG）· ${formatFileSize(localUploadBytes)}`
                : `准备上传原图 · ${formatFileSize(localUploadBytes)}`)
              : `准备上传 · ${formatFileSize(localUploadBytes)}`;
            setPanelSaveProgress({ text: prepText, percent: 15 });
            statusEl.textContent = prepText;
            finalImage = await window.SupabaseSync.uploadCardImage(
              snap.cardId,
              uploadSource,
              {
                original: snap.uploadOriginal,
                onProgress: (ratio, loaded, total) => {
                  const pct = 15 + Math.round(Math.max(0, Math.min(1, ratio)) * 62);
                  const loadedText = total ? formatFileSize(loaded) : '';
                  const totalText = total ? formatFileSize(total) : formatFileSize(localUploadBytes);
                  const text = `上传中 ${Math.round(ratio * 100)}% · ${loadedText || '…'}/${totalText}`;
                  setPanelSaveProgress({ text, percent: pct });
                  statusEl.textContent = text;
                }
              }
            );
            if (snap.previousImage
              && snap.previousImage !== finalImage
              && window.SupabaseSync.isStorageRef(snap.previousImage)) {
              await window.SupabaseSync.deleteCardImageByUrl(snap.previousImage);
            }
            await clearCardImageBackup(snap.cardId);
          } else {
            setPanelSaveProgress({ text: '校验云端图片…', percent: 35, indeterminate: true });
            finalImage = await window.SupabaseSync.resolveCardImageForSave(
              snap.cardId,
              snap.imageValue,
              snap.previousImage,
              { original: snap.uploadOriginal }
            );
            if (finalImage && window.SupabaseSync.isStorageRef(finalImage)) {
              await clearCardImageBackup(snap.cardId);
            }
          }
        }
        setPanelSaveProgress({ text: '写入卡片…', percent: 82 });
        const stillEditingSavedCard = selectedCardId === snap.cardId
          && isNewCardMode === snap.isNewCard;
        if (stillEditingSavedCard) {
          imageData = finalImage;
          pendingUploadFile = null;
          pendingUploadBytes = 0;
        }
        if (finalImage && window.SupabaseSync?.prefetchDisplayUrls) {
          void window.SupabaseSync.prefetchDisplayUrls([finalImage]);
        }
        const wasNewCard = snap.isNewCard;
        let savedCard;
        if (!snap.isNewCard) {
          const card = cards.find(c => c.id === snap.cardId);
          if (card) {
            card.title = snap.title;
            card.prompt = snap.prompt;
            card.image = snap.imageRemovalPending ? null : finalImage;
            const userTags = snap.tags.filter(t => t !== window.COMMUNITY_COLLECT_TAG);
            card.tags = window.isCommunityCollectCard?.(card)
              ? [window.COMMUNITY_COLLECT_TAG, ...userTags.filter(t => t !== window.COMMUNITY_COLLECT_TAG)]
              : [...snap.tags];
            card.customFields = snap.customFields;
            card.updatedAt = Date.now();
            if (window.isCommunityCollectCard?.(card)) {
              card.publishedToCommunity = false;
            }
            savedCard = card;
          }
        } else {
          savedCard = {
            id: snap.cardId, title: snap.title, prompt: snap.prompt,
            image: snap.imageRemovalPending ? null : finalImage,
            group: (currentGroup !== 'all' && currentGroup !== 'uncategorized') ? currentGroup : null,
            tags: [...snap.tags], customFields: snap.customFields,
            warehouseId: getActiveWarehouseId(),
            createdAt: Date.now(), updatedAt: Date.now()
          };
          cards.push(savedCard);
          if (stillEditingSavedCard || (isNewCardMode && !selectedCardId)) {
            selectedCardId = savedCard.id;
            isNewCardMode = false;
          }
        }
        if (savedCard) {
          savedCard.publishedToCommunity = snap.wantPublish === true;
          const uploadMetaEarly = window.__lastCardUploadMeta;
          if (uploadMetaEarly && String(uploadMetaEarly.cardId) === String(savedCard.id)) {
            savedCard.imageUploadOriginal = uploadMetaEarly.original === true;
            savedCard.imageStoredBytes = uploadMetaEarly.bytes || 0;
            savedCard.imageEncodeMode = uploadMetaEarly.encodeMode || 'raw';
          }
          window.FeatureDraft?.clearPublishDraft?.(savedCard.id);
        }
        window.__promptHubCards = cards;
        setPanelSaveProgress({ text: '同步社区状态…', percent: 90, indeterminate: true });
        if (savedCard && window.FeatureDraft?.applyCardPublishState) {
          await window.FeatureDraft.applyCardPublishState(savedCard, snap.wantPublish === true);
        }
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
        setPanelSaveProgress({ text: '保存到本地…', percent: 95, indeterminate: true });
        await saveAllData({ skipCloud: true });
        if (window.SupabaseSync?.isLoggedIn?.()) {
          scheduleCloudPush();
          if (savedCard && snap.wantPublish) {
            void window.FeatureDraft?.syncMyPostsToPublicFeed?.();
          }
        }
        if (!snap.wantPublish && document.getElementById('pageCommunity')?.classList.contains('active')) {
          void window.FeatureDraft?.refreshPublicCommunityFeed?.({ force: true }).then(() => {
            window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
          });
        }
        updateTagFilter();
        renderGroups();
        renderCards(true);
        updateGuestLimitUI();
        statusEl.textContent = '';
        if (stillEditingSavedCard) {
          imageRemovalPending = false;
          cardOriginalReuploadRequired = false;
        }
        editPanelStashedDraft = null;
        setPanelSaveProgress({ text: '保存完成', percent: 100 });
        showToast('保存成功！');
        const uploadMeta = window.__lastCardUploadMeta;
        if (stillEditingSavedCard && uploadMeta && savedCard && String(uploadMeta.cardId) === String(savedCard.id)) {
          updateCardImageSizeHint({
            saved: true,
            bytes: uploadMeta.bytes,
            uploadOriginal: uploadMeta.original,
            encodeMode: uploadMeta.encodeMode
          });
          if (uploadMeta.encodeMode === 'full_res_jpeg') {
            showToast(`已按原尺寸转高清 JPEG 保存 · ${formatFileSize(uploadMeta.bytes)}`, 4500);
          }
        }
        if (wasNewCard && savedCard) {
          if (currentGroup !== 'all' && currentGroup !== 'uncategorized' && savedCard.group !== currentGroup) {
            switchGroup('all');
          }
          if (stillEditingSavedCard) {
            resetNewCardForm();
          }
          highlightSelectedCard(savedCard.id);
        } else if (savedCard && stillEditingSavedCard) {
          window.FeatureDraft?.setPublishCheckbox?.(savedCard);
          highlightSelectedCard(savedCard.id);
          void updatePreview();
        } else if (savedCard) {
          highlightSelectedCard(savedCard.id);
        }
        if (isMobileViewport() && stillEditingSavedCard) {
          closeEditPanel({ skipHistory: true });
        }
      } catch (e) {
        const msg = window.SupabaseSync?.formatError?.(e) || e.message || '保存失败';
        statusEl.textContent = '❌ ' + msg;
        showToast(msg, 6000);
        return;
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        setTimeout(() => setPanelSaveProgress({ hidden: true }), 700);
      }
    }

    function copyCardPrompt(id) { const c = cards.find(x => x.id === id); if (c && c.prompt) { navigator.clipboard.writeText(c.prompt); showToast('提示词已复制'); } }
    function hasUnsavedCardDraft() {
      if (!isNewCardMode) return false;
      const prompt = (document.getElementById('floatingPromptText')?.value || document.getElementById('cardPrompt')?.value || '').trim();
      const title = (document.getElementById('cardTitle')?.value || '').trim();
      return !!(prompt || title || imageData || currentTags.length);
    }

    function closeEditPanel(opts) {
      if (!opts?.skipDraftGuard && isMobileViewport() && isNewCardMode && hasUnsavedCardDraft()) {
        const msg = '当前卡片尚未保存，关闭后内容会丢失。确定关闭吗？';
        const proceed = () => closeEditPanel({ ...opts, skipDraftGuard: true });
        const cancel = () => {
          if (opts?.fromPopstate && isMobileViewport() && !document.getElementById('editPanel')?.classList.contains('hidden')) {
            try {
              history.pushState({ phEditPanel: 1 }, '', location.href);
              mobileEditPanelHistory = true;
            } catch (e) { /* ignore */ }
          }
        };
        if (typeof window.customConfirm === 'function') {
          window.customConfirm(msg, proceed, cancel);
          return;
        }
        if (!confirm(msg)) {
          cancel();
          return;
        }
      }
      if (!isNewCardMode && selectedCardId && imageRemovalPending) {
        const card = cards.find((c) => c.id === selectedCardId);
        if (card) imageData = card.image || null;
      }
      stashEditPanelDraft();
      imageRemovalPending = false;
      closeTagSheet();
      window.FeatureDraft?.closeImageGenFilterSheet?.();
      document.getElementById('editPanel').classList.add('hidden');
      document.getElementById('fabNewBtn').classList.add('visible');
      document.body.classList.remove('panel-open');
      const hadHistory = mobileEditPanelHistory;
      mobileEditPanelHistory = false;
      if (hadHistory && !opts?.skipHistory && !opts?.fromPopstate) {
        try {
          history.back();
        } catch (e) { /* ignore */ }
      }
      scheduleLayoutMasonry();
    }
    window.closeEditPanel = closeEditPanel;
    window.resetMobileEditPanelState = function () {
      mobileEditPanelHistory = false;
      isNewCardMode = false;
      closeEditPanel({ skipHistory: true });
    };
    function openEditPanel() {
      if (globalViewActive) forceExitGlobalView(true);
      window.MobileUI?.closeDrawers?.();
      document.getElementById('editPanel').classList.remove('hidden');
      document.getElementById('fabNewBtn').classList.remove('visible');
      document.body.classList.add('panel-open');
      if (floatingPromptActive) {
        requestAnimationFrame(() => applyFloatingPromptPosition());
      }
      if (isMobileViewport() && !mobileEditPanelHistory) {
        try {
          history.pushState({ phEditPanel: 1 }, '', location.href);
          mobileEditPanelHistory = true;
        } catch (e) { /* ignore */ }
      }
      requestAnimationFrame(() => {
        scheduleLayoutMasonry();
        setTimeout(scheduleLayoutMasonry, 360);
      });
    }
    window.addEventListener('popstate', () => {
      if (!isMobileViewport()) return;
      if (document.body.classList.contains('panel-open')) {
        closeEditPanel({ fromPopstate: true, skipHistory: true });
      } else {
        mobileEditPanelHistory = false;
      }
    });

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
    window.syncLightboxActions = syncLightboxActions;

    function loadLightboxImage(displaySrc, opts) {
      opts = opts || {};
      const seq = ++lightboxLoadSeq;
      const lightbox = document.getElementById('imageLightbox');
      const img = document.getElementById('lightboxImage');
      const frame = getLightboxFrame();
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
      setViewerFrameLoading(frame, true);
      const upgradeImageGenFull = () => {
        if (!opts.imageGen || !opts.feedKey || !window.FeatureDraft?.resolveImageGenFullUrl) return;
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
        if (window.__lightboxCommunityMode) fitLightboxDisplaySize(img);
        resetImageZoom(img);
        attachImageZoom(img);
        finishViewerFrameReveal(frame);
        if (window.__lightboxCommunityMode) layoutViewerBorderSvg(frame);
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
        setViewerFrameLoading(frame, false);
        lightbox.classList.remove('active');
        if (!opts.silentFail) showToast('图片加载失败，请稍后重试');
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
          syncLightboxActions({ cardId: opts.cardId || selectedCardId || null });
        }
      }
      if (opts.imageGen && opts.feedKey && window.FeatureDraft?.getImageGenFeedNavItems) {
        const navItems = window.FeatureDraft.getImageGenFeedNavItems().map((it) => ({
          type: 'imageGen',
          kind: it.kind,
          id: it.id,
          key: it.key
        }));
        window.__lightboxImageGenNav = navItems.length > 1;
        setViewerNav(navItems, opts.feedKey);
      } else {
        window.__lightboxImageGenNav = false;
        const navCardId = opts.cardId || selectedCardId;
        if (globalViewActive && navCardId) {
          const navItems = cards
            .filter((c) => c.image && cardHasDisplayImage(c))
            .map((c) => ({ type: 'card', id: c.id, key: `card:${c.id}` }));
          setViewerNav(navItems, `card:${navCardId}`);
        } else {
          setViewerNav([], '');
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
      loadLightboxImage(src, opts);
    }
    window.openLightbox = openLightbox;
    window.setLightboxSrc = setLightboxSrc;

    async function downloadLightboxImage() {
      const img = document.getElementById('lightboxImage');
      const dlBtn = document.getElementById('lightboxDownloadBtn');
      if (dlBtn?.disabled && !dlBtn.classList.contains('is-downloading')) {
        showToast('图片加载中，请稍后再下载');
        return;
      }
      let cardId = window.__lightboxWarehouseCardId || warehousePreviewCardId || null;
      if (!cardId && !window.__lightboxCommunityMode && window.__lightboxImageGenNav && viewerNav.index >= 0) {
        const item = viewerNav.items[viewerNav.index];
        if (item?.type === 'imageGen' && item.kind === 'warehouse') cardId = item.id;
      }
      if (!cardId && !window.__lightboxCommunityMode) cardId = selectedCardId;
      const card = cardId ? cards.find((c) => c.id === cardId) : null;
      if (card?.image) {
        await downloadCardImageFile(card.image, card.id, null, {
          triggerBtn: dlBtn
        });
        return;
      }
      const url = img?.src || '';
      if (!url || String(url).includes('data:image/svg')) {
        showToast('图片尚未加载完成');
        return;
      }
      const filename = `prompt-hub-${Date.now()}.png`;
      setDownloadTriggerBusy(dlBtn, true);
      showToast('正在准备下载…', 2500);
      try {
        await promptHubSaveImage(url, filename, img);
        showToast('下载完成');
      } catch (e) {
        showToast('下载失败，请稍后重试');
        console.warn('[download] lightbox image failed', e);
      } finally {
        setDownloadTriggerBusy(dlBtn, false);
      }
    }
    window.downloadLightboxImage = downloadLightboxImage;
    document.getElementById('lightboxDownloadBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void downloadLightboxImage();
    });
    document.getElementById('lightboxGenBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const cardId = window.__lightboxWarehouseCardId || warehousePreviewCardId || selectedCardId;
      const card = cards.find((c) => c.id === cardId);
      if (!card) return;
      markQuickPreviewTask({ warehouseGotoGen: true });
      closeLightbox();
      void window.FeatureDraft?.fillCardToImageGen?.(card);
    });

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
      const lightbox = document.getElementById('imageLightbox');
      if (!lightbox?.classList.contains('active')) return;
      if (e) {
        const t = e.target;
        if (t?.closest?.('.lightbox-actions, #lightboxImage, .viewer-image-shine-wrap')) return;
        if (t?.closest?.('.close-lightbox')) { /* fall through */ }
        else if (t !== lightbox && !t?.closest?.('.lightbox-container')) return;
      }
      lightbox?.classList.remove('active');
      syncLightboxActions({});
      const frame = getLightboxFrame();
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
      viewerNav = { items: [], index: -1 };
      window.__lightboxImageGenNav = false;
      if (imageZoom.img === document.getElementById('lightboxImage')) imageZoom.img = null;
      imageZoom.dragging = false;
    }
    window.closeLightbox = closeLightbox;

    function cardsForActiveWarehouse(list) {
      if (window.FeatureAssets?.filterCardsByWarehouse) {
        return window.FeatureAssets.filterCardsByWarehouse(list || cards);
      }
      return list || cards;
    }

    function getActiveWarehouseId() {
      return window.FeatureAssets?.getActiveWarehouseId?.() || 'default';
    }

    window.currentGroup = currentGroup;

    function showContextMenu(x, y, items) {
      const menu = document.getElementById('contextMenu');
      menu.innerHTML = items.map(i => `<button>${i.label}</button>`).join('');
      menu.style.display = 'block'; menu.style.left = x + 'px'; menu.style.top = y + 'px';
      menu.querySelectorAll('button').forEach((btn, idx) => btn.addEventListener('click', () => { items[idx].action(); menu.style.display = 'none'; }));
      const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    }
    window.showContextMenu = showContextMenu;
    window.refreshWarehouseUI = refreshWarehouseUI;

    document.getElementById('sidebarArea').addEventListener('contextmenu', e => { if (e.target.closest('.group-item')) return; e.preventDefault(); });
    document.getElementById('mainContentArea').addEventListener('contextmenu', e => { if (e.target.closest('.card') || e.target.closest('.main-header')) return; e.preventDefault(); showContextMenu(e.clientX, e.clientY, [{ label: '新建卡片', action: () => createNewCard() }]); });
    document.getElementById('viewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || btn.classList.contains('active')) return;
      runCardsLayoutTransition(() => {
        document.querySelectorAll('#viewToggle button[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCards(true);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const viewer = document.getElementById('appreciateViewer');
      if (viewer?.classList.contains('active')) {
        closeAppreciateViewer();
        return;
      }
      if (globalViewActive || document.body.classList.contains('community-appreciate')) exitGlobalView();
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
    async function recognizeImageText(dataUrl) {
      if (!dataUrl) return '';
      const engine = settings.engine || 'tesseract';
      if (engine === 'ocrspace' && settings.apiKey) {
        try {
          const fd = new FormData();
          fd.append('apikey', settings.apiKey);
          fd.append('base64Image', dataUrl);
          fd.append('language', 'chs');
          fd.append('isOverlayRequired', 'false');
          const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
          const d = await resp.json();
          if (d.ParsedResults?.length) return d.ParsedResults[0].ParsedText.trim();
        } catch (e) { /* ignore */ }
        return '';
      }
      try {
        await ensureTesseractScript();
        const result = await Tesseract.recognize(dataUrl, 'chi_sim+eng', { tessedit_pageseg_mode: '6' });
        return result.data.text.trim();
      } catch (e) {
        return '';
      }
    }

    window.runPanelImageOcr = recognizeImageText;

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
          await ensureTesseractScript();
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
        window.FeatureDraft?.syncCardPublishFromPrompt?.(text);
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

    function toggleAppSettingsHelp(forceOpen) {
      const section = document.getElementById('appSettingsHelpSection');
      const btn = document.querySelector('.settings-footer-help-btn');
      if (!section) return;
      const open = forceOpen === true ? true : (forceOpen === false ? false : section.classList.contains('hidden'));
      section.classList.toggle('hidden', !open);
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        requestAnimationFrame(() => {
          section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }
    function openAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.add('active');
      const help = document.getElementById('appSettingsHelpSection');
      if (help) help.classList.add('hidden');
      const helpBtn = document.querySelector('.settings-footer-help-btn');
      if (helpBtn) helpBtn.setAttribute('aria-expanded', 'false');
      const autoDay = document.getElementById('autoDayNightToggle');
      if (autoDay) autoDay.checked = settings.autoDayNight === true;
      const eff = document.getElementById('efficiencyModeToggle');
      if (eff) eff.checked = settings.efficiencyMode === true;
      const imgPub = document.getElementById('defaultImageGenAutoPublishToggle');
      if (imgPub) imgPub.checked = settings.defaultImageGenAutoPublish !== false;
      const notifyOn = document.getElementById('communityNotificationsToggle');
      if (notifyOn) notifyOn.checked = settings.communityNotificationsEnabled !== false;
      const notifyBadge = document.getElementById('communityNotifyBadgeToggle');
      if (notifyBadge) notifyBadge.checked = settings.communityNotifyBadge !== false;
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '';
    }
    function closeAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.remove('active');
    }
    async function saveAppSettings() {
      const autoEl = document.getElementById('autoDayNightToggle');
      const autoOn = autoEl ? autoEl.checked : false;
      const imgPubEl = document.getElementById('defaultImageGenAutoPublishToggle');
      settings.defaultImageGenAutoPublish = imgPubEl ? imgPubEl.checked : true;
      const notifyOnEl = document.getElementById('communityNotificationsToggle');
      settings.communityNotificationsEnabled = notifyOnEl ? notifyOnEl.checked : true;
      const notifyBadgeEl = document.getElementById('communityNotifyBadgeToggle');
      settings.communityNotifyBadge = notifyBadgeEl ? notifyBadgeEl.checked : true;
      const effEl = document.getElementById('efficiencyModeToggle');
      settings.efficiencyMode = effEl ? effEl.checked : false;
      applyEfficiencyMode();
      const wasAuto = settings.autoDayNight === true;
      settings.autoDayNight = autoOn;
      if (autoOn && !wasAuto) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.clearThemeManualOverride?.();
      } else if (autoOn) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      }
      await saveAllData();
      if (autoOn !== wasAuto) {
        window.ThemeSchedule?.onAutoDayNightSettingChanged?.(autoOn);
      }
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '已保存';
      showToast('全局设置已保存');
      window.FeatureDraft?.updateNotifyBadge?.();
      setTimeout(() => { if (status) status.textContent = ''; }, 2000);
    }
    window.toggleAppSettingsHelp = toggleAppSettingsHelp;
    window.openAppSettings = openAppSettings;
    window.closeAppSettings = closeAppSettings;
    window.saveAppSettings = saveAppSettings;

    function openWarehouseSettings() {
      document.getElementById('settingsOverlay')?.classList.add('active');
      document.getElementById('ocrEngineSelect').value = settings.engine || 'tesseract';
      document.getElementById('ocrApiKey').value = settings.apiKey || '';
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      const autoOcrToggle = document.getElementById('autoPromptOcrToggle');
      if (autoOcrToggle) autoOcrToggle.checked = settings.autoPromptOcr === true;
      updatePanelOcrBoxVisibility();
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      if (pubToggle) pubToggle.checked = settings.defaultPublishCommunity !== false;
      const trimToggle = document.getElementById('showTrimBlackBorderToggle');
      if (trimToggle) trimToggle.checked = settings.showTrimBlackBorderTool === true;
      const origToggle = document.getElementById('preserveOriginalCardImageToggle');
      if (origToggle) origToggle.checked = settings.preserveOriginalCardImage === true;
      updatePanelTrimToolVisibility();
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
      const autoOcrToggle = document.getElementById('autoPromptOcrToggle');
      settings.autoPromptOcr = autoOcrToggle ? autoOcrToggle.checked : false;
      updatePanelOcrBoxVisibility();
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      settings.defaultPublishCommunity = pubToggle ? pubToggle.checked : true;
      const trimToggle = document.getElementById('showTrimBlackBorderToggle');
      settings.showTrimBlackBorderTool = trimToggle ? trimToggle.checked : false;
      const origToggle = document.getElementById('preserveOriginalCardImageToggle');
      settings.preserveOriginalCardImage = origToggle ? origToggle.checked : false;
      updatePanelTrimToolVisibility();
      saveAllData();
      const status = document.getElementById('settingsStatus');
      if (status) status.textContent = '设置已保存';
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      renderCards(true);
      if (!document.getElementById('editPanel')?.classList.contains('hidden') && imageData) void updatePreview();
      showToast('设置已保存');
    }
    window.saveSettings = saveSettings;

    function openExtensionCollectPanel() {
      document.getElementById('extensionCollectOverlay')?.classList.add('active');
    }
    function closeExtensionCollectPanel() {
      document.getElementById('extensionCollectOverlay')?.classList.remove('active');
    }
    function openHelpPanel() {
      openAppSettings();
      toggleAppSettingsHelp(true);
    }
    function closeHelpPanel() {
      document.getElementById('helpOverlay')?.classList.remove('active');
    }
    function openContactPanel() {
      document.getElementById('contactOverlay')?.classList.add('active');
    }
    function closeContactPanel() {
      document.getElementById('contactOverlay')?.classList.remove('active');
    }
    function copyWechatId() {
      const id = document.getElementById('contactWechatId')?.textContent?.trim()
        || document.getElementById('subscribeWechatId')?.textContent?.trim()
        || 'bz4jx3jp2li1';
      navigator.clipboard.writeText(id).then(() => showToast('微信号已复制')).catch(() => showToast('复制失败'));
    }
    function openCommunityPanel() {
      document.getElementById('communityOverlay')?.classList.add('active');
    }
    function closeCommunityPanel() {
      document.getElementById('communityOverlay')?.classList.remove('active');
    }
    function copyCommunityQqId() {
      const id = document.getElementById('communityQqId')?.textContent?.trim() || '222653426';
      navigator.clipboard.writeText(id).then(() => showToast('QQ 群号已复制')).catch(() => showToast('复制失败'));
    }
    window.openExtensionCollectPanel = openExtensionCollectPanel;
    window.closeExtensionCollectPanel = closeExtensionCollectPanel;
    window.openHelpPanel = openHelpPanel;
    window.closeHelpPanel = closeHelpPanel;
    window.openContactPanel = openContactPanel;
    window.closeContactPanel = closeContactPanel;
    window.copyWechatId = copyWechatId;
    window.openCommunityPanel = openCommunityPanel;
    window.closeCommunityPanel = closeCommunityPanel;
    window.copyCommunityQqId = copyCommunityQqId;

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
    window.batchPublishCommunity = batchPublishCommunity;
    window.batchUnpublishCommunity = batchUnpublishCommunity;
    

