/**
 * PWA 添加到主屏幕：捕获 beforeinstallprompt，拒绝后可在设置里再次触发
 */
(function () {
  const LS_DISMISS = 'promptrepo_pwa_install_dismissed_at';
  const REASK_MS = 7 * 86400000;
  let deferredPrompt = null;

  function isStandalone() {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (window.navigator.standalone === true) return true;
    return /[?&]launch=homescreen\b/.test(location.search || '');
  }

  function isIosSafari() {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  }

  function isMobile() {
    return window.matchMedia?.('(max-width: 900px)')?.matches;
  }

  function dismissedRecently() {
    const at = Number(localStorage.getItem(LS_DISMISS) || 0);
    return at > 0 && Date.now() - at < REASK_MS;
  }

  function markDismissed() {
    try {
      localStorage.setItem(LS_DISMISS, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function clearDismissed() {
    try {
      localStorage.removeItem(LS_DISMISS);
    } catch (e) { /* ignore */ }
  }

  function hideBanner() {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  }

  function showBanner() {
    if (isStandalone() || !isMobile()) return;
    if (dismissedRecently() && !deferredPrompt) return;
    document.getElementById('pwaInstallBanner')?.classList.remove('hidden');
  }

  function showIosGuide() {
    const msg = 'iPhone / iPad 请用 Safari 打开本站，点底部分享按钮，再选「添加到主屏幕」。添加后从桌面图标打开，就像独立 App。';
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 12000);
    } else if (typeof window.customConfirm === 'function') {
      window.customConfirm(msg, () => {});
    } else {
      alert(msg);
    }
  }

  async function promptInstall() {
    if (isStandalone()) {
      if (typeof window.showToast === 'function') window.showToast('已从主屏幕打开');
      return { outcome: 'accepted' };
    }
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        hideBanner();
        if (outcome === 'accepted') {
          clearDismissed();
          window.TrialTasksUI?.markPwaInstalled?.();
        } else {
          markDismissed();
        }
        return { outcome };
      } catch (e) {
        console.warn('[pwa] prompt failed', e);
      }
    }
    if (isIosSafari()) {
      showIosGuide();
      return { outcome: 'ios_manual' };
    }
    if (typeof window.showToast === 'function') {
      window.showToast('请用 Chrome / Edge 打开本站；若已拒绝过安装，请在浏览器菜单里选「安装应用」或「添加到主屏幕」', 10000);
    }
    return { outcome: 'unavailable' };
  }

  function bindUi() {
    document.getElementById('pwaInstallAcceptBtn')?.addEventListener('click', () => {
      void promptInstall();
    });
    document.getElementById('pwaInstallDismissBtn')?.addEventListener('click', () => {
      markDismissed();
      hideBanner();
    });
    document.getElementById('pwaInstallSettingsBtn')?.addEventListener('click', () => {
      void promptInstall();
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissedRecently()) {
      setTimeout(showBanner, 1200);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideBanner();
    clearDismissed();
    window.TrialTasksUI?.markPwaInstalled?.();
  });

  function init() {
    bindUi();
    if (isStandalone()) {
      hideBanner();
      window.TrialTasksUI?.markPwaInstalled?.();
      return;
    }
    if (isMobile() && isIosSafari() && !dismissedRecently()) {
      setTimeout(showBanner, 2500);
    }
  }

  window.PwaInstall = {
    prompt: promptInstall,
    isStandalone,
    showBanner,
    hideBanner,
    clearDismissed
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
