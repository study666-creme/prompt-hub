/**
 * 全局 Toast（须在 script.js / features-draft 之前加载）
 */
(function () {
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

  function showToast(msg, durationMs, variant) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('toast--achievement', 'toast--quick-confirm');
    if (variant === 'quick-confirm') toast.classList.add('toast--quick-confirm');
    syncToastStacking();
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    clearTimeout(toast._variantTimeout);
    const ms = Number(durationMs) > 0 ? Number(durationMs) : 2000;
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
      if (variant === 'quick-confirm') {
        toast._variantTimeout = setTimeout(() => toast.classList.remove('toast--quick-confirm'), 160);
      }
    }, ms);
  }

  function showQuickToast(msg, durationMs) {
    showToast(msg, durationMs, 'quick-confirm');
  }

  window.syncToastStacking = syncToastStacking;
  window.showToast = showToast;
  window.showQuickToast = showQuickToast;

  document.addEventListener('ph-api-unauthorized', () => {
    showToast('登录已过期，请退出后重新登录，卡片库图片才能恢复显示', 9000);
  });
})();
