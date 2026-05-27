(function () {
  const MQ = window.matchMedia('(max-width: 900px)');

  function isMobile() {
    return MQ.matches;
  }

  function isMobileViewport() {
    return isMobile();
  }

  function closeDrawers() {
    document.body.classList.remove('mobile-nav-open', 'mobile-groups-open');
  }

  function openNavDrawer() {
    document.body.classList.add('mobile-nav-open');
    document.body.classList.remove('mobile-groups-open');
  }

  function openGroupsDrawer() {
    document.body.classList.add('mobile-groups-open');
    document.body.classList.remove('mobile-nav-open');
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
  }

  window.mobileSwitchTab = function (tab) {
    if (!isMobile()) return;
    setBottomTab(tab);
    if (tab === 'cards') {
      closeDrawers();
      if (typeof closeEditPanel === 'function') closeEditPanel();
      if (typeof switchAppPage === 'function') switchAppPage('warehouse');
    } else if (tab === 'groups') {
      openGroupsDrawer();
    } else if (tab === 'imagegen') {
      closeDrawers();
      if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    } else if (tab === 'new') {
      closeDrawers();
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
    if (app === 'imagegen') initImageGenMobileView();
  };

  function onViewportChange() {
    if (!isMobile()) {
      closeDrawers();
      document.body.classList.remove('panel-open', 'imagegen-mobile-view-form', 'imagegen-mobile-view-feed');
    } else {
      applyMobileColumns();
      if (typeof closeEditPanel === 'function') closeEditPanel();
      window.FeatureDraft?.resetMobileFeedGridStyles?.();
      if (typeof scheduleLayoutMasonry === 'function') scheduleLayoutMasonry();
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
    setImageGenView,
    initImageGenMobileView
  };

  function init() {
    bindMobileUI();
    if (isMobile()) {
      applyMobileColumns();
      if (typeof closeEditPanel === 'function') closeEditPanel();
      if (typeof scheduleLayoutMasonry === 'function') scheduleLayoutMasonry();
      window.FeatureDraft?.resetMobileFeedGridStyles?.();
      const saved = localStorage.getItem('promptrepo_app_page');
      if (saved) {
        window.mobileOnAppPageChange?.(saved);
      } else {
        setBottomTab('cards');
      }
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        initImageGenMobileView();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
