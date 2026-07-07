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
        window.FeedLayout?.repairCommunityMasonry?.('communityGrid');
        window.FeatureDraft?.scheduleCommunityLayout?.('communityGrid', { force: true, immediate: true, recalcCols: true });
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

    function switchAppPage(app, navOpts) {
      const opts = navOpts && typeof navOpts === 'object' ? navOpts : {};
      if (app === 'assetmarket' || app === 'assetstudio') {
        switchDevLabPanel(app);
        app = 'devlab';
      }
      if (!APP_PAGE_IDS[app]) return;
      if (app !== 'warehouse' && activeFilters.size > 0) {
        clearWarehouseFilters({ toast: false });
      }
      if (app !== 'warehouse') {
        safeForceExitGlobalView(true);
        closeEditPanel();
        if (typeof closeTagSheet === 'function') closeTagSheet();
      }
      const leavingCommunity = document.getElementById('pageCommunity')?.classList.contains('active') && app !== 'community';
      if (leavingCommunity) {
        window.FeatureDraft?.cancelCommunityPageWork?.();
      }
      if (app === 'warehouse') {
        window.SupabaseSync?.bootstrapWarehouseMediaCache?.({ clearAllMissing: true });
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
      if (!opts.skipUrl && window.AppRouter?.syncUrl) {
        window.AppRouter.syncUrl(app, opts.replace === true);
      } else if (window.AppRouter?.syncDocumentTitle) {
        window.AppRouter.syncDocumentTitle(app);
      }
      window.reconcileAuthUI?.();
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
          const container = document.getElementById('cardsContainer');
          const pageSize = warehousePageSize();
          const start = (page - 1) * pageSize;
          const list = allFilteredCards.length
            ? allFilteredCards.slice(start, start + pageSize)
            : warehouseVisibleCards(cards).slice(start, start + pageSize);
          const hasDom = container?.querySelector('.card[data-id]');
          if (!hasDom) {
            renderCards(true);
          } else if (warehousePageDomNeedsFullRender(container, list)) {
            delete container.dataset.whSig;
            renderCards(true);
          } else {
            softHydrateWarehouseContainer(container, list);
            if (warehousePageDomNeedsFullRender(container, list)) {
              void repairGeneratedCardImagesQuiet();
            }
          }
          if (isMobileViewport()) enforceMobileCardGrid();
          else scheduleWarehouseMasonryLayout();
        }, 220);
      }
      deferAfterPagePaint(() => {
        window.FeatureDraft?.onAppChange?.(app);
        resumeRippleBackground(app);
      }, 280);
      if (isMobileViewport()) {
        requestAnimationFrame(() => {
          window.MobileUI?.resetMobilePageScroll?.(app);
          window.MobileUI?.scheduleMobileImageBoostBurst?.();
        });
      }
      window.mobileOnAppPageChange?.(app);
    }
    window.switchAppPage = switchAppPage;

    window.AppRouter?.init?.((app) => {
      switchAppPage(app, { skipUrl: true, fromPopstate: true });
    });

    function warehousePageActive() {
      return document.getElementById('pageWarehouse')?.classList.contains('active');
    }

    /** LabGen 式：非 /prompts 首屏不挂载 800+ 卡片 DOM */
    function renderWarehouseGridIfNeeded(force) {
      if (!force && !warehousePageActive()) return;
      renderCards(force !== false);
    }

    function getPromptCanvasUrl() {
      let url = String(window.PROMPT_CANVAS_URL || 'https://infinite-canvas-jay.vercel.app/canvas').trim();
      if (!url) url = 'https://infinite-canvas-jay.vercel.app/canvas';
      if (!/\/canvas\/?$/.test(url)) url = url.replace(/\/?$/, '') + '/canvas';
      return url;
    }
    function openPromptCanvas() {
      window.MobileUI?.closeAllMobileOverlays?.();
      window.open(getPromptCanvasUrl(), '_blank', 'noopener,noreferrer');
    }
    window.openPromptCanvas = openPromptCanvas;

    function initAppNav() {
      document.querySelectorAll('.app-nav-item[data-app]').forEach(btn => {
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
        rest.sort((a, b) => {
          const diff = (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
          if (diff !== 0) return diff;
          return String(b.id || '').localeCompare(String(a.id || ''));
        });
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
          deletedCommunityPostTombstones: { ...(settings.deletedCommunityPostTombstones || {}) },
          deletedCustomGroupTombstones: { ...(settings.deletedCustomGroupTombstones || {}) }
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
      if (window.MediaPipeline?.safeImgSrc) return window.MediaPipeline.safeImgSrc(image);
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
      const key = String(jobId);
      settings.deletedGenerationJobTombstones[key] = Date.now();
      const base = key.replace(/#\d+$/, '');
      if (base && base !== key) settings.deletedGenerationJobTombstones[base] = Date.now();
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
        const feedGrid = media.closest('#creationsGrid, #communityGrid');
        window.FeatureDraft?.settleCommunityFeedLayout?.(feedGrid?.id, { fromImage: true });
      } else if (media.closest('#userProfileGrid')) {
        window.FeatureDraft?.scheduleCommunityLayout?.('userProfileGrid', { fromImage: true });
      } else if (media.closest('#imageGenFeed')) {
        window.FeatureDraft?.scheduleImageGenFeedLayout?.();
      } else if (media.closest('#cardsContainer')) {
        /* 卡片库：图加载仅轻量 layout，避免整网格 reload */
        scheduleWarehouseMasonryLightLayout();
      } else if (typeof scheduleLayoutMasonry === 'function') {
        scheduleLayoutMasonry();
      }
    }
    window.scheduleMasonryForMedia = scheduleMasonryForMedia;
    window.ensureMasonryScript = ensureMasonryScript;

    function finalizeWarehouseCardMediaFailure(media, img, opts = {}) {
      if (!media) return;
      if (img?.dataset?.feedLoadDone === '1' && img.complete && img.naturalWidth > 0) return;
      const authBlocked = opts.authBlocked === true
        || window.__PH_AUTH_SESSION_EXPIRED__ === true
        || !!(window.__PH_AUTH_SIGN_PAUSE_UNTIL__ && Date.now() < window.__PH_AUTH_SIGN_PAUSE_UNTIL__);
      clearMediaShineWatchdog(media);
      if (media.__whBackfillFailTimer) {
        clearTimeout(media.__whBackfillFailTimer);
        media.__whBackfillFailTimer = null;
      }
      media.classList.remove('is-loading', 'card-media--await', 'media-shine-reveal');
      media.classList.add('card-media--load-failed');
      media.classList.toggle('card-media--auth-blocked', authBlocked);
      if (authBlocked) media.dataset.failureLabel = '登录后加载图片';
      else delete media.dataset.failureLabel;
      const card = media.closest('#cardsContainer .card[data-id]');
      const inWarehouseList = !!(card && !card.closest('.card[data-community-collect="1"]'));
      const cardModel = card?.dataset?.id ? cards.find((c) => c.id === card.dataset.id) : null;
      const keepFailureSlot = opts.keepFailureSlot === true || authBlocked;
      if (inWarehouseList && keepFailureSlot) {
        clearMediaShineWatchdog(media);
        if (media.__whBackfillFailTimer) {
          clearTimeout(media.__whBackfillFailTimer);
          media.__whBackfillFailTimer = null;
        }
        media.classList.remove('is-loading', 'card-media--await', 'media-shine-reveal');
        media.classList.add('card-media--load-failed');
        if (img) {
          img.style.visibility = 'hidden';
          img.style.opacity = '0';
        }
        scheduleWarehouseMasonryForCard(card?.dataset?.id);
        return;
      }
      if (card && opts.collapseToText !== false) {
        card.classList.remove('card--visual');
        card.classList.add('card--text-only');
        media.remove();
        const desc = card.querySelector('.card-desc');
        if (desc && cardModel) {
          desc.textContent = getCardDisplayDesc(cardModel, { textOnly: true });
        }
      } else if (img) {
        img.style.visibility = 'hidden';
        img.style.opacity = '0';
      }
      const cardId = card?.dataset?.id;
      const ref = img?.getAttribute?.('data-image-ref');
      const inRecentFeed = !!img?.closest?.('#imageGenFeed .imagegen-feed-card[data-feed-id^="cr_"]');
      if (!authBlocked && opts.markMissing !== false && ref && !inRecentFeed && window.SupabaseSync?.primaryImagePath) {
        const primary = window.SupabaseSync.primaryImagePath(ref, cardId);
        if (primary && window.SupabaseSync?.markPathMissing) {
          window.SupabaseSync.markPathMissing(String(primary).replace(/^\//, ''));
        }
      }
      scheduleWarehouseMasonryForCard(cardId);
    }
    window.finalizeWarehouseCardMediaFailure = finalizeWarehouseCardMediaFailure;

    async function tryWarehouseGalleryListCover(img, card, media) {
      if (!img || !card || !window.PromptHubCardGallery?.normalizeCardGallery) return false;
      const gallery = window.PromptHubCardGallery.normalizeCardGallery(card);
      if (!gallery.length) return false;
      const tried = new Set(String(img.dataset.whAltTried || '').split('|').filter(Boolean));
      const cur = img.getAttribute('data-image-ref');
      if (cur) tried.add(cur);
      const baseJob = card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '';
      for (let i = 0; i < gallery.length; i += 1) {
        const ref = gallery[i];
        if (!ref || tried.has(ref)) continue;
        tried.add(ref);
        img.dataset.whAltTried = [...tried].join('|');
        img.setAttribute('data-image-ref', ref);
        const slotJob = window.PromptHubCardGallery.gallerySlotJobId?.(baseJob, i);
        if (slotJob) img.setAttribute('data-job-id', slotJob);
        else img.removeAttribute('data-job-id');
        window.SupabaseSync?.clearPathMissingForCard?.(card.id, ref);
        delete img.dataset.warehouseFinalFail;
        img.classList.remove('img-load-failed');
        media?.classList.remove('card-media--load-failed');
        let url = '';
        try {
          if (window.MediaPipeline?.resolveListUrl) {
            url = await window.MediaPipeline.resolveListUrl(ref, {
              assetId: card.id,
              cardId: card.id,
              jobId: slotJob || baseJob || undefined,
              tryAllPaths: true
            });
          }
          if (!url && window.SupabaseSync?.resolveDisplayUrl) {
            url = await window.SupabaseSync.resolveDisplayUrl(ref, {
              assetId: card.id,
              jobId: slotJob || baseJob || undefined,
              variant: window.SupabaseSync.VARIANT_GRID,
              bypassSignBudget: true,
              allowFullFallback: false,
              listOnly: true,
              tryAllPaths: true
            });
          }
        } catch (e) { /* ignore */ }
