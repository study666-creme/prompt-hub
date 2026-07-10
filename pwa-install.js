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

  function isEdgeAndroid() {
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua) && /EdgA|Edg\//i.test(ua);
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

  function showGuideMessage(msg, durationMs) {
    const ms = durationMs || 14000;
    if (typeof window.customConfirm === 'function') {
      window.customConfirm(msg, () => {});
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(msg, ms);
      return;
    }
    alert(msg);
  }

  function showIosGuide() {
    showGuideMessage(
      'iPhone / iPad 请用 Safari 打开本站，点底部分享按钮，再选「添加到主屏幕」。添加后从桌面图标打开，就像独立 App。',
      12000
    );
  }

  function showEdgeAndroidGuide() {
    showGuideMessage(
      'Edge 安装说明（不是权限报错）：\n\n'
      + '若点「添加」后跳到「网站权限」页且没有提示，请先点左上角 ← 返回本站。\n\n'
      + '正确步骤：\n'
      + '1. 点 Edge 右下角「…」菜单\n'
      + '2. 选「添加到手机」或「安装应用」\n'
      + '3. 按提示确认即可\n\n'
      + '本站不需要摄像头、定位等权限；权限页是 Edge 误跳转，与安装无关。\n'
      + '若菜单里没有安装项，可换 Chrome 打开 prompt-hubs.com 再试。',
      18000
    );
  }

  function showGenericAndroidGuide() {
    showGuideMessage(
      '请用 Chrome 或 Edge 打开本站；在浏览器菜单里选「安装应用」或「添加到主屏幕」。若曾点过「取消」，需从菜单手动安装。',
      10000
    );
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
          if (isEdgeAndroid()) showEdgeAndroidGuide();
        }
        return { outcome };
      } catch (e) {
        console.warn('[pwa] prompt failed', e);
        if (isEdgeAndroid()) {
          showEdgeAndroidGuide();
          return { outcome: 'edge_manual' };
        }
      }
    }
    if (isIosSafari()) {
      showIosGuide();
      return { outcome: 'ios_manual' };
    }
    if (isEdgeAndroid()) {
      showEdgeAndroidGuide();
      return { outcome: 'edge_manual' };
    }
    showGenericAndroidGuide();
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
    if (isMobile() && isEdgeAndroid() && !dismissedRecently() && !deferredPrompt) {
      const desc = document.querySelector('#pwaInstallBanner .pwa-install-banner-desc');
      if (desc) {
        desc.textContent = '像 App 一样全屏打开；若误跳权限页，点返回后在 Edge 菜单选「添加到手机」';
      }
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
