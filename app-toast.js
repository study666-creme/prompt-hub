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

  function showToast(msg, durationMs) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('toast--achievement');
    syncToastStacking();
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    const ms = Number(durationMs) > 0 ? Number(durationMs) : 2000;
    toast._timeout = setTimeout(() => toast.classList.remove('show'), ms);
  }

  window.syncToastStacking = syncToastStacking;
  window.showToast = showToast;

  document.addEventListener('ph-api-unauthorized', () => {
    showToast('登录已过期，请退出后重新登录，卡片库图片才能恢复显示', 9000);
  });
})();
