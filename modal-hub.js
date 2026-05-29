/**
 * 全局弹层：解决 body zoom 导致遮罩点穿、关不掉的问题
 */
(function () {
  const OPEN_CLASS = 'app-modal-open';
  let backdropEl = null;
  let guardInstalled = false;

  function ensureBackdrop() {
    if (backdropEl) return backdropEl;
    backdropEl = document.createElement('div');
    backdropEl.id = 'appModalBackdrop';
    backdropEl.className = 'app-modal-backdrop';
    backdropEl.setAttribute('aria-hidden', 'true');
    backdropEl.addEventListener('click', () => closeTopModal());
    document.body.appendChild(backdropEl);
    return backdropEl;
  }

  function getOverlayIds() {
    return ['userProfileOverlay', 'trialTasksOverlay', 'subscribeOverlay'];
  }

  function activeOverlay() {
    for (const id of getOverlayIds()) {
      const el = document.getElementById(id);
      if (el?.classList.contains('active')) return el;
    }
    return null;
  }

  function isMobileModal() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function syncBackdrop() {
    const el = activeOverlay();
    const bd = ensureBackdrop();
    const mobile = isMobileModal();
    if (el) {
      if (mobile) {
        bd.classList.remove('active');
        bd.hidden = true;
      } else {
        bd.hidden = false;
        bd.classList.add('active');
      }
      document.body.classList.add(OPEN_CLASS);
      if (el.parentElement !== document.body) document.body.appendChild(el);
      if (!mobile) {
        document.body.appendChild(bd);
      }
      document.body.appendChild(el);
      el.style.pointerEvents = 'auto';
      if (mobile) {
        el.style.background = 'rgba(0, 0, 0, 0.48)';
      } else {
        el.style.removeProperty('background');
      }
    } else {
      bd.classList.remove('active');
      bd.hidden = true;
      document.body.classList.remove(OPEN_CLASS);
      document.body.classList.remove('subscribe-open', 'trial-tasks-open');
    }
  }

  function openModal(overlayId) {
    window.MobileUI?.closeDrawers?.();
    document.body.classList.remove('mobile-nav-open', 'mobile-groups-open');
    const el = document.getElementById(overlayId);
    if (!el) return;
    getOverlayIds().forEach((id) => {
      if (id !== overlayId) closeModal(id, true);
    });
    el.hidden = false;
    el.removeAttribute('hidden');
    el.classList.add('active');
    el.style.removeProperty('display');
    el.style.pointerEvents = 'auto';
    if (overlayId === 'userProfileOverlay') document.body.classList.add('user-profile-open');
    if (overlayId === 'trialTasksOverlay') document.body.classList.add('trial-tasks-open');
    if (overlayId === 'subscribeOverlay') document.body.classList.add('subscribe-open');
    syncBackdrop();
  }

  function closeModal(overlayId, silent) {
    const el = document.getElementById(overlayId);
    if (el) {
      el.classList.remove('active');
      el.hidden = true;
      el.setAttribute('hidden', '');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('display');
    }
    if (overlayId === 'userProfileOverlay') document.body.classList.remove('user-profile-open');
    if (overlayId === 'trialTasksOverlay') document.body.classList.remove('trial-tasks-open');
    if (overlayId === 'subscribeOverlay') document.body.classList.remove('subscribe-open');
    if (!silent) syncBackdrop();
    else if (!activeOverlay()) syncBackdrop();
  }

  function closeTopModal() {
    const el = activeOverlay();
    if (!el) return;
    if (el.id === 'userProfileOverlay') window.closeUserProfile?.();
    else if (el.id === 'trialTasksOverlay') window.closeTrialTasksPanel?.();
    else if (el.id === 'subscribeOverlay') window.closeSubscribePanel?.();
    else closeModal(el.id);
  }

  function installGuard() {
    if (guardInstalled) return;
    guardInstalled = true;
    document.addEventListener(
      'click',
      (e) => {
        if (!activeOverlay()) return;
        const overlay = activeOverlay();
        if (e.target.closest('.modal-close-btn, #trialTasksFooterClose, #subscribeCloseBtn, #userProfileClose, #userProfileBack')) return;
        if (e.target.closest('.subscribe-panel, .trial-tasks-panel, .user-profile-panel')) return;
        if (isMobileModal()) {
          if (e.target === overlay) {
            e.preventDefault();
            e.stopPropagation();
            closeTopModal();
          }
          return;
        }
        if (e.target === overlay || e.target === backdropEl) {
          e.preventDefault();
          e.stopPropagation();
          closeTopModal();
          return;
        }
        if (!overlay.contains(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          closeTopModal();
        }
      },
      true
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!activeOverlay() || !isMobileModal()) return;
        if (e.target.closest('.subscribe-panel, .trial-tasks-panel, .user-profile-panel')) {
          e.stopPropagation();
        }
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeOverlay()) {
        e.preventDefault();
        closeTopModal();
      }
    });
  }

  function unlockAll() {
    getOverlayIds().forEach((id) => closeModal(id, true));
    syncBackdrop();
  }

  window.AppModalHub = {
    open: openModal,
    close: closeModal,
    closeTop: closeTopModal,
    unlockAll,
    sync: syncBackdrop
  };
  window.unlockPageInteraction = unlockAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureBackdrop();
      installGuard();
    });
  } else {
    ensureBackdrop();
    installGuard();
  }
})();
