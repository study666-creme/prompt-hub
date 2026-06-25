/**
 * 云同步编排：合并 push/pull 调度，避免重复静默上传与多次 Feed 刷新。
 */
(function () {
  'use strict';

  /** @type {{ pushToCloud?: Function, pullFromCloud?: Function, refreshFeeds?: Function }|null} */
  let api = null;
  let pushTimer = null;
  let pullTimer = null;
  let refreshTimer = null;
  let pushUrgent = false;

  function init(hooks) {
    api = hooks && typeof hooks === 'object' ? hooks : null;
  }

  function scheduleFeedRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      api?.refreshFeeds?.();
    }, 800);
  }

  function requestFeedRefresh() {
    scheduleFeedRefresh();
  }

  function schedulePush(opts = {}) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    if (opts.urgent === true) pushUrgent = true;
    clearTimeout(pushTimer);
    const delay = pushUrgent ? 350 : 90000;
    pushTimer = setTimeout(() => {
      const urgent = pushUrgent;
      pushUrgent = false;
      if (!urgent && document.hidden) {
        schedulePush({ urgent: false });
        return;
      }
      const push = api?.pushToCloud || window.pushToCloud;
      if (typeof push !== 'function') return;
      void push({
        silent: true,
        skipSafety: true,
        skipImageUpload: !urgent
      }).then((res) => {
        if (res?.ok !== false && !res?.cancelled) scheduleFeedRefresh();
      }).catch((e) => {
        console.warn('[SyncOrchestrator] silent push failed', e);
      });
    }, delay);
  }

  function schedulePull(opts = {}) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    clearTimeout(pullTimer);
    const delay = opts.immediate === true ? 0 : (opts.light ? 1200 : 2500);
    pullTimer = setTimeout(() => {
      const pull = api?.pullFromCloud || window.runDeferredCloudPull;
      if (typeof pull !== 'function') return;
      void pull({
        silent: opts.silent !== false,
        light: opts.light === true,
        force: opts.force === true
      }).then((ok) => {
        if (ok) scheduleFeedRefresh();
      }).catch((e) => {
        console.warn('[SyncOrchestrator] pull failed', e);
      });
    }, delay);
  }

  /** 本地卡片变更后：默认只排队元数据 push，不立刻拉云端 */
  function notifyCardsChanged(opts = {}) {
    if (opts.pull === true) schedulePull({ light: true, silent: true });
    schedulePush(opts);
  }

  function cancelPendingPush() {
    clearTimeout(pushTimer);
    pushUrgent = false;
  }

  function cancelPendingPull() {
    clearTimeout(pullTimer);
  }

  function cancelPending() {
    cancelPendingPush();
    cancelPendingPull();
    clearTimeout(refreshTimer);
  }

  window.SyncOrchestrator = {
    init,
    schedulePush,
    schedulePull,
    notifyCardsChanged,
    scheduleFeedRefresh,
    requestFeedRefresh,
    cancelPendingPush,
    cancelPendingPull,
    cancelPending
  };
})();
