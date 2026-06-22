(function () {
  /** 全站手机断点（唯一来源；script / features-draft / feed-layout 均走 MobileUI） */
  const MOBILE_MQ = window.matchMedia('(max-width: 900px)');

  function isMobile() {
    return MOBILE_MQ.matches;
  }

  function isMobileViewport() {
    return isMobile();
  }

  /** 解析前即可用（mobile.js 在 script.js 之前加载） */
  window.MobileUI = window.MobileUI || {};
  window.MobileUI.isMobile = isMobile;
  window.MobileUI.isMobileViewport = isMobileViewport;
  window.MobileUI.MOBILE_MQ = MOBILE_MQ;

  function syncDrawerOverlayVisibility() {
    const ov = document.getElementById('mobileDrawerOverlay');
    if (!ov) return;
    const open =
      document.body.classList.contains('mobile-nav-open') ||
      document.body.classList.contains('mobile-groups-open');
    if (open) {
      ov.hidden = false;
      ov.style.removeProperty('display');
      if (ov.parentElement !== document.body) document.body.appendChild(ov);
    } else {
      ov.hidden = true;
      ov.style.display = 'none';
    }
    ov.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function forceHideBlockingLayers() {
    const drawer = document.getElementById('mobileDrawerOverlay');
    if (drawer && !document.body.classList.contains('mobile-nav-open') && !document.body.classList.contains('mobile-groups-open')) {
      drawer.hidden = true;
      drawer.style.display = 'none';
      drawer.style.pointerEvents = 'none';
    }
    document.querySelectorAll('.filter-sheet-overlay, .tag-sheet-overlay').forEach((el) => {
      if (!el.classList.contains('open')) {
        el.hidden = true;
        el.style.pointerEvents = 'none';
      }
    });
    document.querySelectorAll('.subscribe-overlay:not(.active), .community-detail-overlay:not(.active)').forEach((el) => {
      el.hidden = true;
      el.style.pointerEvents = 'none';
    });
    document.querySelectorAll('.subscribe-overlay.active, .trial-tasks-overlay.active').forEach((el) => {
      el.hidden = false;
      el.style.removeProperty('display');
      el.style.pointerEvents = 'auto';
    });
  }

  function closeAllMobileOverlays(opts) {
    const keepModals = opts?.keepModals === true;
    closeDrawers();
    if (!keepModals) {
      window.AppModalHub?.close?.('trialTasksOverlay', true);
      window.AppModalHub?.close?.('subscribeOverlay', true);
      window.SubscriptionUI?.close?.();
      window.TrialTasksUI?.close?.();
    }
    if (typeof closeEditPanel === 'function') closeEditPanel({ skipHistory: true });
    if (typeof window.closeMobileSearch === 'function') window.closeMobileSearch();
    else {
      const bar = document.getElementById('mobileSearchBar');
      const btn = document.getElementById('mobileSearchBtn');
      if (bar) bar.hidden = true;
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('active');
      }
    }
    document.body.classList.remove(
      'mobile-search-open',
      'subscribe-open',
      'trial-tasks-open',
      'panel-open',
      'community-panel-open',
      'global-view-entering',
      'global-view-exiting'
    );
    document.querySelectorAll(
      '.tag-sheet-overlay.open, .filter-sheet-overlay.open, .subscribe-overlay.active, .community-detail-overlay.active'
    ).forEach((el) => {
      el.classList.remove('open', 'active');
      el.hidden = true;
      el.style.pointerEvents = 'none';
    });
    if (typeof closeTagSheet === 'function') closeTagSheet();
    window.FeatureDraft?.closeImageGenFilterSheet?.();
    window.AppModalHub?.unlockAll?.();
    if (!keepModals) {
      document.getElementById('authOverlay')?.classList.remove('open');
    }
    document.querySelectorAll('.settings-overlay.active, .modal-overlay.active').forEach((el) => {
      el.classList.remove('active');
    });
    syncDrawerOverlayVisibility();
    forceHideBlockingLayers();
  }

  function closeDrawers() {
    document.body.classList.remove('mobile-nav-open', 'mobile-groups-open');
    syncDrawerOverlayVisibility();
    forceHideBlockingLayers();
  }

  function openNavDrawer() {
    document.body.classList.add('mobile-nav-open');
    document.body.classList.remove('mobile-groups-open');
    syncDrawerOverlayVisibility();
  }

  function openGroupsDrawer() {
    document.body.classList.add('mobile-groups-open');
    document.body.classList.remove('mobile-nav-open');
    syncDrawerOverlayVisibility();
  }

  function setBottomTab(tab) {
    document.querySelectorAll('.mobile-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mobileTab === tab);
    });
  }

  function tabForApp(app) {
    if (app === 'imagegen') return 'imagegen';
    if (app === 'community') return 'community';
    if (app === 'warehouse') return 'cards';
    return null;
  }

  function setImageGenView(view, opts) {
    const v = view === 'feed' ? 'feed' : 'form';
    const wasFeed = document.body.classList.contains('imagegen-mobile-view-feed');
    document.body.classList.toggle('imagegen-mobile-view-form', v === 'form');
    document.body.classList.toggle('imagegen-mobile-view-feed', v === 'feed');
    document.querySelectorAll('[data-imagegen-view]').forEach((btn) => {
      const on = btn.dataset.imagegenView === v;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    try {
      localStorage.setItem('promptrepo_imagegen_mobile_view', v);
    } catch (e) { /* ignore */ }
    if (v === 'feed' && opts?.scrollToTop && !wasFeed) {
      requestAnimationFrame(() => {
        const feed = document.getElementById('imageGenFeed');
        const scrollRoot = feed?.closest('.feature-shell') || feed;
        scrollRoot?.scrollTo?.(0, 0);
      });
    }
    if (v === 'feed') {
      void window.FeatureDraft?.resumePendingGenerationJobs?.().then(() => {
        const preserve = wasFeed || !opts?.scrollToTop;
        window.FeatureDraft?.renderImageGenFeed?.({ preserveScroll: preserve });
      });
    } else {
      window.FeatureDraft?.renderImageGenMobileResult?.();
    }
  }

  function initImageGenMobileView() {
    if (!isMobile()) {
      document.body.classList.remove('imagegen-mobile-view-form', 'imagegen-mobile-view-feed');
      return;
    }
    let v = 'form';
    try {
      v = localStorage.getItem('promptrepo_imagegen_mobile_view') === 'feed' ? 'feed' : 'form';
    } catch (e) { /* ignore */ }
    setImageGenView(v);
  }

  function bindImageGenMobileUI() {
    document.getElementById('imageGenMobileMenuBtn')?.addEventListener('click', () => {
      if (document.body.classList.contains('mobile-nav-open')) closeDrawers();
      else openNavDrawer();
    });
    document.querySelectorAll('[data-imagegen-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!isMobile()) return;
        setImageGenView(btn.dataset.imagegenView);
      });
    });
  }

  function applyMobileColumns() {
    if (!isMobile()) return;
    document.documentElement.style.setProperty('--card-columns', '2');
  }

  function restoreDesktopLayout() {
    if (isMobile()) return;
    document.getElementById('cardsContainer')?.classList.remove('mobile-grid');
    if (typeof window.restoreDesktopCardColumns === 'function') {
      window.restoreDesktopCardColumns();
    } else if (typeof scheduleLayoutMasonry === 'function') {
      scheduleLayoutMasonry();
    }
    window.FeatureDraft?.renderImageGenFeed?.();
  }

  function bindMobileUI() {
    const overlay = document.getElementById('mobileDrawerOverlay');
    const navBtn = document.getElementById('mobileNavBtn');
    const groupsBtn = document.getElementById('mobileGroupsBtn');

    const onDrawerBackdropTap = (e) => {
      if (e.target !== overlay) return;
      e.preventDefault();
      e.stopPropagation();
      closeDrawers();
    };
    overlay?.addEventListener('click', onDrawerBackdropTap);
    overlay?.addEventListener('touchend', onDrawerBackdropTap, { passive: false });
    overlay?.addEventListener('pointerdown', onDrawerBackdropTap);
    navBtn?.addEventListener('click', () => {
      if (document.body.classList.contains('mobile-nav-open')) closeDrawers();
      else openNavDrawer();
    });
    groupsBtn?.addEventListener('click', () => {
      if (document.body.classList.contains('mobile-groups-open')) closeDrawers();
      else openGroupsDrawer();
    });

    document.querySelectorAll('.group-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (isMobile()) closeDrawers();
      });
    });

    document.querySelectorAll('.app-nav-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (isMobile()) closeDrawers();
      });
    });

    bindImageGenMobileUI();

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!isMobile()) return;
        if (!document.body.classList.contains('mobile-nav-open') && !document.body.classList.contains('mobile-groups-open')) return;
        if (e.target.closest('.app-nav, .sidebar, .mobile-bottom-nav, .mobile-drawer-overlay')) {
          if (e.target === overlay) closeDrawers();
          return;
        }
        closeDrawers();
      },
      true
    );

    const mobileSearchBtn = document.getElementById('mobileSearchBtn');
    const mobileSearchBar = document.getElementById('mobileSearchBar');
    const searchDesktop = document.getElementById('searchInput');
    const searchMobile = document.getElementById('searchInputMobile');

    function syncMobileSearchOpen(open) {
      if (!mobileSearchBar || !mobileSearchBtn) return;
      mobileSearchBar.hidden = !open;
      mobileSearchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileSearchBtn.classList.toggle('active', open);
      document.body.classList.toggle('mobile-search-open', open);
      if (open) {
        if (searchMobile && searchDesktop) searchMobile.value = searchDesktop.value;
        setTimeout(() => searchMobile?.focus(), 50);
      } else {
        searchMobile?.blur();
      }
    }

    function closeMobileSearch() {
      syncMobileSearchOpen(false);
    }
    window.closeMobileSearch = closeMobileSearch;

    mobileSearchBtn?.addEventListener('click', () => {
      syncMobileSearchOpen(mobileSearchBar?.hidden !== false);
    });
    searchMobile?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') syncMobileSearchOpen(false);
    });
    searchMobile?.addEventListener('input', () => {
      if (searchDesktop) searchDesktop.value = searchMobile.value;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('mobile-search-open')) {
        closeMobileSearch();
      }
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!isMobile()) return;
        if (!document.body.classList.contains('mobile-search-open')) return;
        if (e.target.closest('#mobileSearchBar, #mobileSearchBtn')) return;
        closeMobileSearch();
      },
      true
    );
  }

  window.mobileSwitchTab = function (tab) {
    if (!isMobile()) return;
    closeAllMobileOverlays();
    setBottomTab(tab);
    if (tab === 'cards') {
      if (typeof closeEditPanel === 'function') closeEditPanel();
      if (typeof switchAppPage === 'function') switchAppPage('warehouse');
    } else if (tab === 'groups') {
      openGroupsDrawer();
    } else if (tab === 'imagegen') {
      if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    } else if (tab === 'community') {
      if (typeof switchAppPage === 'function') switchAppPage('community');
    } else if (tab === 'me') {
      openNavDrawer();
    }
  };

  window.mobileOnAppPageChange = function (app) {
    if (!isMobile()) return;
    const tab = tabForApp(app);
    if (tab) setBottomTab(tab);
    if (app === 'imagegen') {
      closeAllMobileOverlays();
      initImageGenMobileView();
    }
  };

  function onViewportChange() {
    if (!isMobile()) {
      closeDrawers();
      document.body.classList.remove('panel-open', 'imagegen-mobile-view-form', 'imagegen-mobile-view-feed');
      restoreDesktopLayout();
    } else {
      applyMobileColumns();
      if (typeof closeEditPanel === 'function') closeEditPanel();
      window.FeatureDraft?.resetMobileFeedGridStyles?.();
      window.FeatureDraft?.enforceMobileImageGenFeed?.();
      if (typeof enforceMobileCardGrid === 'function') enforceMobileCardGrid();
      else if (typeof scheduleLayoutMasonry === 'function') scheduleLayoutMasonry();
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        window.FeedLayout?.repairCommunityMasonry?.('communityGrid');
        window.FeatureDraft?.scheduleCommunityLayout?.('communityGrid', { force: true, immediate: true, recalcCols: true });
      }
      if (typeof renderCards === 'function') renderCards(true);
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        initImageGenMobileView();
        window.FeatureDraft?.renderImageGenFeed?.();
      }
    }
  }

  MOBILE_MQ.addEventListener('change', onViewportChange);

  Object.assign(window.MobileUI, {
    openNavDrawer,
    openGroupsDrawer,
    closeDrawers,
    closeAllMobileOverlays,
    setImageGenView,
    initImageGenMobileView
  });

  function init() {
    bindMobileUI();
    if (isMobile()) {
      closeAllMobileOverlays();
      syncDrawerOverlayVisibility();
      requestAnimationFrame(() => closeAllMobileOverlays());
      applyMobileColumns();
      if (typeof window.resetMobileEditPanelState === 'function') window.resetMobileEditPanelState();
      else if (typeof closeEditPanel === 'function') closeEditPanel({ skipHistory: true });
      if (typeof enforceMobileCardGrid === 'function') enforceMobileCardGrid();
      else if (typeof scheduleLayoutMasonry === 'function') scheduleLayoutMasonry();
      window.FeatureDraft?.resetMobileFeedGridStyles?.();
      window.FeatureDraft?.enforceMobileImageGenFeed?.();
      const saved = localStorage.getItem('promptrepo_app_page');
      if (saved) {
        window.mobileOnAppPageChange?.(saved);
      } else {
        setBottomTab('cards');
      }
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        initImageGenMobileView();
      }
      if (window.SupabaseSync?.isLoggedIn?.()) {
        const runSync = () => {
          if (window.TrialTasksUI?.isHomescreenLaunch?.()) {
            window.TrialTasksUI?.markPwaInstalled?.();
          } else {
            window.TrialTasksUI?.syncTaskProgress?.();
          }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(runSync, { timeout: 4000 });
        else setTimeout(runSync, 2000);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  MOBILE_MQ.addEventListener('change', () => {
    if (isMobile()) closeAllMobileOverlays();
    else {
      closeAllMobileOverlays();
      document.getElementById('cardsContainer')?.classList.remove('mobile-grid');
      restoreDesktopLayout();
    }
  });

  if (isMobile()) {
    closeAllMobileOverlays();
    document.addEventListener(
      'touchstart',
      () => {
        if (!document.body.classList.contains('mobile-nav-open') && !document.body.classList.contains('mobile-groups-open')) {
          forceHideBlockingLayers();
        }
      },
      { passive: true, capture: true }
    );
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) closeAllMobileOverlays();
    });
  }
})();
