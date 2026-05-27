/**
 * 免费试用会员 · 任务中心
 */
(function () {
  const LS_PWA_FLAG = 'promptrepo_pwa_task_flag';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function collectSyncPayload() {
    const cards =
      window.__promptHubCards ||
      (typeof cards !== 'undefined' ? cards : []) ||
      [];
    const cardCount = Array.isArray(cards) ? cards.length : 0;
    const communityPosts =
      window.FeatureDraft?.getCommunityPostsForTasks?.() || [];
    let pwaInstalled = false;
    try {
      pwaInstalled =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        localStorage.getItem(LS_PWA_FLAG) === '1';
    } catch (e) { /* ignore */ }
    return { cardsCount: cardCount, communityPosts, pwaInstalled };
  }

  async function syncTaskProgress() {
    if (!isLoggedIn() || !window.PromptHubApi?.syncMembershipTasks) return null;
    return window.PromptHubApi.syncMembershipTasks(collectSyncPayload());
  }

  async function loadTasks() {
    if (!isLoggedIn()) return { items: [], lifetimeCreditsSpent: 0, error: null };
    if (!window.PromptHubApi?.isConfigured?.()) {
      return { items: [], lifetimeCreditsSpent: 0, error: '未配置后端 API（api-domain.config.js）' };
    }
    await syncTaskProgress();
    const r = await window.PromptHubApi?.getMembershipTasks?.();
    if (r?.ok && Array.isArray(r.data?.items)) return { ...r.data, error: null };
    const msg = r?.message || r?.code || '任务列表加载失败';
    return { items: [], lifetimeCreditsSpent: 0, error: msg };
  }

  function renderTasks(data) {
    const list = document.getElementById('trialTasksList');
    if (!list) return;
    const items = data?.items || [];
    if (data?.error) {
      list.innerHTML = `<p class="trial-tasks-empty">${esc(data.error)}</p>
        <p class="trial-tasks-hint">请确认 Worker 已部署且 Supabase 已执行迁移 <code>20260528120000_membership_tasks.sql</code>。</p>`;
      return;
    }
    if (!items.length) {
      list.innerHTML =
        '<p class="trial-tasks-empty">暂无任务数据，请稍后刷新或联系管理员检查后端。</p>';
      return;
    }
    list.innerHTML = items
      .map(task => {
        const reward = [
          task.rewardDays ? `${task.rewardDays} 天基础会员（直接到账）` : '',
          task.rewardCredits ? `${task.rewardCredits} 积分` : ''
        ]
          .filter(Boolean)
          .join(' + ');
        const btn = task.claimed
          ? '<span class="trial-task-done">已领取</span>'
          : task.ready
            ? `<button type="button" class="btn btn-primary btn-sm trial-task-claim" data-task-key="${esc(task.key)}">领取会员</button>`
            : '<span class="trial-task-pending">未完成</span>';
        const progress = task.progress
          ? `<span class="trial-task-progress">${esc(task.progress)}</span>`
          : '';
        return `<article class="trial-task-card${task.claimed ? ' is-claimed' : ''}${task.ready ? ' is-ready' : ''}">
          <div class="trial-task-main">
            <h4>${esc(task.title)}</h4>
            <p>${esc(task.description)}</p>
            <p class="trial-task-reward">奖励：${esc(reward || '会员时长')}</p>
            ${progress}
          </div>
          <div class="trial-task-action">${btn}</div>
        </article>`;
      })
      .join('');

    list.querySelectorAll('.trial-task-claim').forEach(btn => {
      btn.addEventListener('click', () => void onClaim(btn.dataset.taskKey));
    });
  }

  async function onClaim(taskKey) {
    if (!taskKey) return;
    if (!isLoggedIn()) {
      if (typeof showToast === 'function') showToast('请先登录');
      if (typeof openAuthModal === 'function') openAuthModal('login');
      return;
    }
    const r = await window.PromptHubApi?.claimMembershipTask?.(taskKey);
    if (r?.ok) {
      if (typeof showToast === 'function') showToast(r.data.message || '领取成功');
      await window.PromptHubApi?.syncMe?.({ silent: true });
      const data = await loadTasks();
      renderTasks(data);
      window.SubscriptionUI?.refreshOfferUI?.();
      return;
    }
    if (typeof showToast === 'function') showToast(r?.message || '领取失败');
  }

  function markPwaInstalled() {
    try {
      localStorage.setItem(LS_PWA_FLAG, '1');
    } catch (e) { /* ignore */ }
    if (isLoggedIn()) void syncTaskProgress();
  }

  async function openTrialTasksPanel() {
    const el = document.getElementById('trialTasksOverlay');
    if (!el) return;
    el.hidden = false;
    el.classList.add('active');
    document.body.classList.add('trial-tasks-open');
    if (!isLoggedIn()) {
      renderTasks({ items: [] });
      const hint = document.getElementById('trialTasksLoginHint');
      if (hint) hint.classList.remove('hidden');
      return;
    }
    document.getElementById('trialTasksLoginHint')?.classList.add('hidden');
    const list = document.getElementById('trialTasksList');
    if (list) list.innerHTML = '<p class="trial-tasks-empty">任务加载中…</p>';
    const data = await loadTasks();
    renderTasks(data);
  }

  function closeTrialTasksPanel() {
    const el = document.getElementById('trialTasksOverlay');
    if (el) {
      el.classList.remove('active');
      el.hidden = true;
    }
    document.body.classList.remove('trial-tasks-open');
  }

  function initPwaDetection() {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    ) {
      markPwaInstalled();
    }
    window.addEventListener('appinstalled', markPwaInstalled);
  }

  window.TrialTasksUI = {
    open: openTrialTasksPanel,
    close: closeTrialTasksPanel,
    syncTaskProgress,
    markPwaInstalled
  };
  window.openTrialTasksPanel = openTrialTasksPanel;
  window.closeTrialTasksPanel = closeTrialTasksPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaDetection);
  } else {
    initPwaDetection();
  }
})();
