(function () {
  const MQ = window.matchMedia('(max-width: 900px)');

  function isMobile() {
    return MQ.matches;
  }

  function isMobileViewport() {
    return isMobile();
  }

  function syncDrawerOverlayVisibility() {
    const ov = document.getElementById('mobileDrawerOverlay');
    if (!ov) return;
    const open =
      document.body.classList.contains('mobile-nav-open') ||
      document.body.classList.contains('mobile-groups-open');
    if (open) {
      ov.hidden = false;
      ov.style.removeProperty('display');
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
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
      }
    });
    document.querySelectorAll('.subscribe-overlay:not(.active), .community-detail-overlay:not(.active)').forEach((el) => {
      el.hidden = true;
      el.style.pointerEvents = 'none';
    });
  }

  function closeAllMobileOverlays() {
    closeDrawers();
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
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    });
    if (typeof closeTagSheet === 'function') closeTagSheet();
    window.FeatureDraft?.closeImageGenFilterSheet?.();
    window.SubscriptionUI?.close?.();
    window.TrialTasksUI?.close?.();
    document.getElementById('authOverlay')?.classList.remove('open');
    document.querySelectorAll('.settings-overlay.active, .modal-overlay.active').forEach((el) => {
      el.classList.remove('active');
    });
    syncDrawerOverlayVisibility();
    forceHideBlockingLayers();
  }

  function closeDrawers() {
    document.body.classList.remove('mobile-nav-open', 'mobile-groups-open');
    syncDrawerOverlayVisibility();
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
    if (app === 'warehouse') return 'cards';
    return null;
  }

  function setImageGenView(view) {
    const v = view === 'feed' ? 'feed' : 'form';
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
    if (v === 'feed') {
      requestAnimationFrame(() => {
        document.getElementById('imageGenFeed')?.scrollTo?.(0, 0);
      });
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
    if (!isMobile() || typeof window.setCardColumns !== 'function') return;
    const cur = Number(getComputedStyle(document.documentElement).getPropertyValue('--card-columns')) || 4;
    if (cur > 2) window.setCardColumns(2);
  }

  function bindMobileUI() {
    const overlay = document.getElementById('mobileDrawerOverlay');
    const navBtn = document.getElementById('mobileNavBtn');
    const groupsBtn = document.getElementById('mobileGroupsBtn');

    overlay?.addEventListener('click', closeDrawers);
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
      }
    }

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
        syncMobileSearchOpen(false);
      }
    });
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
    } else if (tab === 'new') {
      if (typeof switchAppPage === 'function') switchAppPage('warehouse');
      if (typeof createNewCard === 'function') createNewCard({ forceOpenPanel: true });
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
    } else {
      applyMobileColumns();
      if (typeof closeEditPanel === 'function') closeEditPanel();
      window.FeatureDraft?.resetMobileFeedGridStyles?.();
      window.FeatureDraft?.enforceMobileImageGenFeed?.();
      if (typeof enforceMobileCardGrid === 'function') enforceMobileCardGrid();
      else if (typeof scheduleLayoutMasonry === 'function') scheduleLayoutMasonry();
      if (typeof renderCards === 'function') renderCards(true);
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        initImageGenMobileView();
        window.FeatureDraft?.renderImageGenFeed?.();
      }
    }
  }

  MQ.addEventListener('change', onViewportChange);

  window.MobileUI = {
    isMobile,
    isMobileViewport,
    openNavDrawer,
    openGroupsDrawer,
    closeDrawers,
    closeAllMobileOverlays,
    setImageGenView,
    initImageGenMobileView
  };

  function init() {
    bindMobileUI();
    if (isMobile()) {
      closeAllMobileOverlays();
      syncDrawerOverlayVisibility();
      requestAnimationFrame(() => closeAllMobileOverlays());
      applyMobileColumns();
      if (typeof closeEditPanel === 'function') closeEditPanel();
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
        const runSync = () => window.TrialTasksUI?.syncTaskProgress?.();
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

  MQ.addEventListener('change', () => {
    if (isMobile()) closeAllMobileOverlays();
    else {
      closeAllMobileOverlays();
      document.getElementById('cardsContainer')?.classList.remove('mobile-grid');
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
