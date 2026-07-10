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
    const LOCAL_SNAPSHOT_MIN_INTERVAL_MS = 30_000;
    const LOCAL_AUTOSAVE_MIN_INTERVAL_MS = 60_000;
    let db = null;
    let lastEmergencyBackupAt = 0;
    const lastLocalPayloadWriteAt = new Map();

    function localPayloadThrottleKey(kind, uid) {
      return `${kind}:${String(uid || '')}`;
    }
    function shouldSkipThrottledLocalPayload(kind, uid, minIntervalMs, opts = {}) {
      if (!opts.throttle || opts.force) return false;
      const key = localPayloadThrottleKey(kind, uid);
      const last = lastLocalPayloadWriteAt.get(key) || 0;
      return Date.now() - last < minIntervalMs;
    }
    function markLocalPayloadWritten(kind, uid) {
      lastLocalPayloadWriteAt.set(localPayloadThrottleKey(kind, uid), Date.now());
    }
    function rememberLocalPayloadMeta(kind, uid, payload) {
      if (!uid || !payload) return;
      try {
        localStorage.setItem(userStorageKey(`${kind}_meta`, uid), JSON.stringify({
          at: Date.now(),
          cards: Array.isArray(payload.cards) ? payload.cards.length : 0,
          groups: Array.isArray(payload.customGroups) ? payload.customGroups.length : 0
        }));
      } catch (e) { /* ignore */ }
    }

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
    function cardPersistenceId(card) {
      const id = card?.id;
      return id == null ? '' : String(id);
    }
    function serializeCardForPersistence(card) {
      try {
        return JSON.stringify(card);
      } catch (e) {
        return null;
      }
    }
    function cardsEqualForPersistence(a, b) {
      if (a === b) return true;
      const sa = serializeCardForPersistence(a);
      if (sa == null) return false;
      return sa === serializeCardForPersistence(b);
    }
    async function saveCardsToDB(cardsArray, opts = {}) {
      if (!db) await openDB();
      const incoming = Array.isArray(cardsArray) ? cardsArray : [];
      const ownerUid = opts.ownerUid != null
        ? String(opts.ownerUid || '')
        : (window.SupabaseSync?.getUserId?.() || activeAccountId || getIdbOwnerUid() || '');
      const previousOwnerUid = getIdbOwnerUid();
      const forceRewrite = opts.forceRewrite === true
        || !!(ownerUid && previousOwnerUid && previousOwnerUid !== ownerUid);
      const existing = await loadCardsFromDB({ ignoreOwner: true });
      if (!incoming.length) {
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
      const latestById = new Map();
      for (const card of incoming) {
        const id = cardPersistenceId(card);
        if (id) latestById.set(id, card);
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['cards'], 'readwrite');
        const store = tx.objectStore('cards');
        const fail = () => reject(tx.error || new Error('IndexedDB cards save failed'));
        tx.oncomplete = () => resolve();
        tx.onerror = fail;
        tx.onabort = fail;
        if (forceRewrite) {
          store.clear();
          latestById.forEach((card) => store.put(card));
          return;
        }
        const existingById = new Map();
        existing.forEach((card) => {
          const id = cardPersistenceId(card);
          if (id) existingById.set(id, card);
        });
        existingById.forEach((card, id) => {
          if (!latestById.has(id)) store.delete(id);
        });
        latestById.forEach((card, id) => {
          if (!cardsEqualForPersistence(card, existingById.get(id))) {
            store.put(card);
          }
        });
      });
      if (ownerUid) setIdbOwnerUid(ownerUid);
      else if (!incoming.length) setIdbOwnerUid('');
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

    let cards = [], customGroups = [], globalFields = [], settings = { engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, autoPromptOcr: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, communityNotificationsEnabled: true, communityNotifyBadge: true, autoDayNight: false, themeManualOverride: false, showTrimBlackBorderTool: false, preserveOriginalCardImage: false };
    let pendingUploadFile = null;
    let pendingUploadBytes = 0;
    let currentGroup = 'all', selectedCardId = null, isNewCardMode = false, imageData = null;
    let imageRemovalPending = false;
    let editPanelStashedDraft = null;
    let cardOriginalReuploadRequired = false;
    let mobileEditPanelHistory = false;
    let currentTags = [], tempCustomFields = [];
    let batchMode = false, selectedCardIds = new Set();
    const BATCH_IMPORT_MAX = 40;
    let batchImportItems = [];
    let fileHandle = null, masonryInstance = null;
    let page = 1, allFilteredCards = [];
    const warehouseRenderedPages = new Set();
    const PER_PAGE = 24;
    const MOBILE_PER_PAGE = 24;
    function warehousePageSize() {
      return isMobileViewport() ? MOBILE_PER_PAGE : PER_PAGE;
    }
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
    window.__viewerGlobalViewActive = false;
    let activeFilters = new Set();
    const WAREHOUSE_FILTER_ALIASES = { '纯文字': 'text', '有图片': 'image' };
    function normalizeWarehouseFilterValue(raw) {
      const v = String(raw || '').trim();
      if (!v) return '';
      return WAREHOUSE_FILTER_ALIASES[v] || v;
    }
    function normalizeActiveFilters(set) {
      const next = new Set();
      for (const raw of set || []) {
        const v = normalizeWarehouseFilterValue(raw);
        if (v === 'image' || v === 'text' || v.startsWith('tag:')) next.add(v);
      }
      return next;
    }
    try {
      const savedFilters = JSON.parse(localStorage.getItem('promptrepo_filters') || '[]');
      if (Array.isArray(savedFilters)) activeFilters = normalizeActiveFilters(new Set(savedFilters));
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

    function setGlobalViewActive(v) {
      globalViewActive = !!v;
      window.__viewerGlobalViewActive = globalViewActive;
    }

    /** pack-appreciate 未加载时（SW/缓存旧 index）兜底，避免导航报错 */
    function safeForceExitGlobalView(skipRender = false) {
      if (typeof window.forceExitGlobalView === 'function') {
        window.forceExitGlobalView(skipRender);
        return;
      }
      const wasActive = globalViewActive || document.body.classList.contains('global-view');
      if (!wasActive) return;
      window.closeAppreciateViewer?.();
      setGlobalViewActive(false);
      document.body.classList.remove('global-view', 'global-view-entering', 'global-view-exiting', 'appreciate-viewing');
      document.getElementById('globalViewBtn')?.classList.remove('active');
      if (!skipRender && typeof renderCards === 'function') renderCards(true);
    }

    function safeCloseAppreciateViewer(e) {
      if (typeof window.closeAppreciateViewer === 'function') window.closeAppreciateViewer(e);
    }

    function safeExitGlobalView() {
      if (typeof window.exitGlobalView === 'function') window.exitGlobalView();
      else safeForceExitGlobalView(false);
    }

    if (typeof window.forceExitGlobalView !== 'function') {
      console.warn('[PromptHub] pack-appreciate.js 未加载，请强刷（Ctrl+Shift+R）');
    }

    function generateId() { return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

    window.layoutMasonryGrid = layoutMasonryGrid;
    window.scheduleLayoutMasonry = scheduleLayoutMasonry;

    async function promptHubSaveImage(url, filename, imgEl) {
      if (window.MediaDownload?.saveImageUrl) {
        return window.MediaDownload.saveImageUrl(url, filename, imgEl);
      }
      throw new Error('MediaDownload unavailable');
    }
    if (!window.promptHubSaveImage) window.promptHubSaveImage = promptHubSaveImage;

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
      return false;
    };

    function warehouseVisibleCards(list) {
      const base = cardsForActiveWarehouse(filterTombstonedCards(list || cards));
      return base.filter((c) => window.SupabaseSync?.shouldShowCardInWarehouse?.(c) !== false);
    }

    /** @type {{ key: string, list: any[] }|null} */
    let imageGenWarehouseListCache = null;
    /** @type {{ rev: number, cardsLen: number, byGroup: Map<string, any[]> }|null} */
    let warehouseGroupIndexCache = null;
    /** @type {{ key: string, list: any[] }|null} */
    let warehouseFilteredListCache = null;

    window.invalidateWarehouseCardsForImageGenCache = function () {
      imageGenWarehouseListCache = null;
      warehouseGroupIndexCache = null;
      warehouseFilteredListCache = null;
      window.__imageGenWhCardsRev = (window.__imageGenWhCardsRev || 0) + 1;
    };

    function warehouseActiveFiltersKey() {
      return [...activeFilters].sort().join(',');
    }

    function getWarehouseGroupIndexMap() {
      const rev = window.__imageGenWhCardsRev || 0;
      if (warehouseGroupIndexCache?.rev === rev && warehouseGroupIndexCache.cardsLen === cards.length) {
        return warehouseGroupIndexCache.byGroup;
      }
      const visible = warehouseVisibleCards(cards);
      const byGroup = new Map();
      byGroup.set('all', visible);
      const uncat = [];
      const dynamicGroups = new Map();
      for (const g of customGroups) dynamicGroups.set(g, []);
      for (const c of visible) {
        if (!c.group) {
          uncat.push(c);
          continue;
        }
        if (!dynamicGroups.has(c.group)) dynamicGroups.set(c.group, []);
        dynamicGroups.get(c.group).push(c);
      }
      byGroup.set('uncategorized', uncat);
      for (const [g, list] of dynamicGroups) byGroup.set(g, list);
      warehouseGroupIndexCache = { rev, cardsLen: cards.length, byGroup };
      return byGroup;
    }

    function getWarehouseGroupBaseList() {
      const byGroup = getWarehouseGroupIndexMap();
      if (currentGroup === 'uncategorized') return byGroup.get('uncategorized') || [];
      if (currentGroup === 'all') return byGroup.get('all') || [];
      return byGroup.get(currentGroup) || [];
    }

    function getWarehouseFilteredSortedList(search) {
      const searchKey = (search || '').toLowerCase();
      const cacheKey = [
        window.__imageGenWhCardsRev || 0,
        cards.length,
        currentGroup,
        searchKey,
        sortMode,
        warehouseActiveFiltersKey()
      ].join('\u001f');
      if (warehouseFilteredListCache?.key === cacheKey) {
        return warehouseFilteredListCache.list;
      }
      let filtered = getWarehouseGroupBaseList();
      if (searchKey) {
        filtered = filtered.filter((c) =>
          (c.title?.toLowerCase().includes(searchKey))
          || (c.prompt || '').toLowerCase().includes(searchKey)
          || (c.tags?.some((t) => t.toLowerCase().includes(searchKey))));
      }
      if (activeFilters.size > 0) filtered = filtered.filter(cardMatchesFilters);
      if (window.CloudSyncSafety?.dedupeWarehouseCards) {
        filtered = window.CloudSyncSafety.dedupeWarehouseCards(filtered);
      } else {
        const seenIds = new Set();
        filtered = filtered.filter((c) => {
          const id = String(c?.id || '');
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });
      }
      const list = sortCardsWithPins(filtered);
      warehouseFilteredListCache = { key: cacheKey, list };
      return list;
    }

    function buildWarehouseCardsForImageGen(group, tag, buildOpts) {
      const base = warehouseVisibleCards(cards);
      const isGenCard = (c) => {
        if (window.FeatureDraft?.isGeneratedWarehouseCard?.(c)) return true;
        const tags = Array.isArray(c.tags) ? c.tags : [];
        return !!(c.genJobId || tags.includes(window.GEN_AUTO_TAG || '图片生成'));
      };
      let list = base.filter((c) => {
        if (!isGenCard(c)) return false;
        const hasImage = cardHasDisplayImage(c)
          || (c.image && window.FeatureDraft?.isDisplayableImage?.(c.image));
        if (!hasImage) return false;
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
      list.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      if (buildOpts?.returnTotal) window.__imageGenWhFeedBuildTotal = list.length;
      const maxItems = Number(buildOpts?.maxItems);
      if (Number.isFinite(maxItems) && maxItems > 0) list = list.slice(0, maxItems);
      return list
        .map(c => {
          window.PromptHubCardGallery?.ensureFeedCoverFromGallery?.(c, { persist: false, backfill: false });
          const CG = window.PromptHubCardGallery;
          const cover = CG?.pickWarehouseListThumb?.(c)
            || CG?.pickWarehouseFeedCover?.(c)
            || CG?.getCardFeedCoverMeta?.(c)
            || { ref: CG?.getCardFeedCoverImage?.(c) || CG?.getCardCoverImage?.(c) || c.image };
          return {
          id: c.id,
          title: (c.title || '').trim() || '',
          prompt: (c.prompt || '').trim() || (c.title || '').trim() || '',
          image: cover.ref || c.image || null,
          feedCoverIndex: cover.galleryIndex ?? 0,
          feedCoverJobId: cover.slotJobId || (c.genJobId ? String(c.genJobId).replace(/#\d+$/, '') : null),
          cardImages: window.PromptHubCardGallery?.normalizeCardGallery?.(c) || null,
          tags: c.tags || [],
          group: c.group || null,
          genJobId: c.genJobId || null,
          isMidjourney: !!c.isMidjourney,
          mjGridUrls: Array.isArray(c.mjGridUrls) ? c.mjGridUrls : null,
          mjButtons: Array.isArray(c.mjButtons) ? c.mjButtons : null,
          model: c.model || null,
          size: c.genSize || null,
          resolution: c.resolution || null,
          quality: c.genQuality || null
        };
        });
    }

    window.getWarehouseCardsForImageGen = function (opts) {
      const lightFeed = opts?.lightFeed === true;
      const group = lightFeed ? 'all' : (opts?.group || 'all');
      const tag = lightFeed ? 'all' : (opts?.tag || 'all');
      const rev = window.__imageGenWhCardsRev || 0;
      const key = lightFeed
        ? `light\0${rev}\0${cards.length}`
        : `${group}\0${tag}\0${cards.length}\0${rev}\0${cards}`;
      if (imageGenWarehouseListCache && imageGenWarehouseListCache.key === key) {
        return imageGenWarehouseListCache.list;
      }
      const buildOpts = lightFeed
        ? { maxItems: window.IMAGEGEN_WAREHOUSE_FEED_MAX || 48, returnTotal: true }
        : undefined;
      const list = buildWarehouseCardsForImageGen(group, tag, buildOpts);
      if (lightFeed) {
        window.__imageGenWhFeedTotal = window.__imageGenWhFeedBuildTotal ?? list.length;
        delete window.__imageGenWhFeedBuildTotal;
      }
      imageGenWarehouseListCache = { key, list };
      return list;
    };

    window.IMAGEGEN_WAREHOUSE_FEED_MAX = 48;

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
    window.GEN_AUTO_TAG = '图片生成';
    window.GEN_RECOVER_TAG = '自动恢复';
    window.GEN_MULTI_TAG = '多图';
    window.EXTENSION_SAVE_TAG = '浏览器插件';
    window.SYSTEM_CARD_TAGS = new Set([
      window.GEN_AUTO_TAG,
      window.INSPIRE_DRAW_TAG,
      window.COMMUNITY_COLLECT_TAG,
      window.GEN_RECOVER_TAG,
      window.GEN_MULTI_TAG,
      window.EXTENSION_SAVE_TAG,
      '#浏览器插件'
    ]);
    window.normalizeCardTagName = function (tag) {
      return String(tag || '').replace(/^#+/, '').trim();
    };
    window.isCommunityCollectTagName = function (tag) {
      const name = window.normalizeCardTagName(tag);
      return name === window.COMMUNITY_COLLECT_TAG;
    };
    window.isSystemCardTag = function (tag) {
      const name = window.normalizeCardTagName(tag);
      if (!name) return true;
      if (name === window.EXTENSION_SAVE_TAG) return true;
      for (const t of window.SYSTEM_CARD_TAGS) {
        if (window.normalizeCardTagName(t) === name) return true;
      }
      return false;
    };
    window.getSelectableCardTags = function (sourceCards) {
      const src = sourceCards || cards;
      return [...new Set(src.flatMap(c => c.tags || []))]
        .filter(t => t && !window.isCommunityCollectTagName(t) && !window.isSystemCardTag(t))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    };
    window.getUserCreatedCardTags = function (sourceCards) {
      return window.getSelectableCardTags(sourceCards);
    };
    window.getCustomGroupsList = function () {
      return Array.isArray(customGroups) ? [...customGroups] : [];
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
        const url = window.MediaPipeline?.resolvePreviewUrl
          ? await window.MediaPipeline.resolvePreviewUrl(ref, signOpts)
          : await window.SupabaseSync?.resolveDisplayUrl?.(ref, signOpts);
