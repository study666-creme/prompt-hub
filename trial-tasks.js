/**
 * 免费试用会员 · 任务中心
 */
(function () {
  const LS_PWA_FLAG = 'promptrepo_pwa_task_flag';
  let syncDebounceTimer = null;
  let panelBound = false;
  let lastTaskSyncAt = 0;
  const TASK_SYNC_MIN_GAP_MS = 90000;
  let tasksLoadSerial = null;

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
    const communityPosts = window.FeatureDraft?.getCommunityPostsForTasks?.() || [];
    let pwaInstalled = false;
    try {
      pwaInstalled =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        localStorage.getItem(LS_PWA_FLAG) === '1';
    } catch (e) { /* ignore */ }
    return { cardsCount: Array.isArray(cards) ? cards.length : 0, communityPosts, pwaInstalled };
  }

  async function syncTaskProgress(force) {
    if (!isLoggedIn() || !window.PromptHubApi?.syncMembershipTasks) return null;
    if (!force && Date.now() - lastTaskSyncAt < TASK_SYNC_MIN_GAP_MS) return null;
    const r = await window.PromptHubApi.syncMembershipTasks(collectSyncPayload());
    if (r?.ok) lastTaskSyncAt = Date.now();
    return r;
  }

  function scheduleSyncTaskProgress(force) {
    clearTimeout(syncDebounceTimer);
    if (force) {
      void syncTaskProgress(true);
      return;
    }
    syncDebounceTimer = setTimeout(() => {
      void syncTaskProgress(false);
    }, 2000);
  }

  async function diagnoseApiConnection() {
    const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
    const pageHref = typeof location !== 'undefined' ? location.href : '';
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      return {
        ok: false,
        hint:
          '当前是本地文件打开（地址栏以 file:// 开头），浏览器禁止访问 API。请用 https://prompt-hub.cn 打开本站。'
      };
    }
    const api = String(window.API_BASE_URL || '').replace(/\/$/, '');
    if (!api) {
      return {
        ok: false,
        hint: `未配置 API。当前页面：${pageOrigin || pageHref || '未知'}，请用 https://prompt-hub.cn 打开。`
      };
    }
    try {
      const r = await fetch(`${api}/health`, { method: 'GET', cache: 'no-store' });
      if (r.ok) return { ok: true, hint: '' };
      return {
        ok: false,
        hint: `API 返回 ${r.status}。页面来源：${pageOrigin || pageHref}`
      };
    } catch (e) {
      return {
        ok: false,
        hint:
          `浏览器拦住了对 ${api} 的请求（页面来源：${pageOrigin || '未知'}）。请确认用 https://prompt-hub.cn 打开；Edge 请关闭「跟踪防护」；或换 Chrome 并关闭广告拦截。`
      };
    }
  }

  async function loadTasks() {
    if (!isLoggedIn()) return { items: [], lifetimeCreditsSpent: 0, error: null };
    if (!window.PromptHubApi?.isConfigured?.()) {
      const host = typeof location !== 'undefined' ? location.hostname : '';
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: `当前页面（${host}）未配置 API。请用 https://prompt-hub.cn 打开，或在 api-domain.config.js 设置 CUSTOM_API_HOST。`
      };
    }
    const r = await window.PromptHubApi?.getMembershipTasks?.();
    if (r?.ok && Array.isArray(r.data?.items)) return { ...r.data, error: null };
    const msg = r?.message || r?.code || '任务列表加载失败';
    if (r?.code === 'TASKS_LOAD_FAILED' || r?.code === 'INTERNAL_ERROR') {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: msg || '任务接口服务器错误',
        errorDetail: typeof r?.details === 'string' ? r.details : '',
        retryable: true
      };
    }
    if (r?.code === 'MIGRATION_REQUIRED' || /membership_tasks\.sql/i.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error:
          '数据库尚未执行任务迁移。请打开 Supabase → SQL Editor，粘贴并运行文件 20260528120000_membership_tasks.sql'
      };
    }
    if (r?.code === 'NOT_FOUND' || /接口不存在/.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error:
          '会员任务接口未部署：请在 server 目录执行 npm run deploy（需已登录 Cloudflare）'
      };
    }
    if (r?.code === 'RATE_LIMITED' || /过于频繁|rate limit|too many/i.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: '请求过于频繁，请约 1 分钟后再试',
        retryable: true
      };
    }
    if (r?.code === 'UNAUTHORIZED' || /登录已过期|请先登录/.test(msg)) {
      return { items: [], lifetimeCreditsSpent: 0, error: 'session_expired', errorDetail: msg };
    }
    if (r?.code === 'NETWORK_ERROR' || /无法连接|failed to fetch|network|超时/i.test(msg)) {
      const diag = await diagnoseApiConnection();
      const api = String(window.API_BASE_URL || 'api.prompt-hub.cn').replace(/\/$/, '');
      const extra = diag.hint ? ` ${diag.hint}` : '';
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: `连不上 ${api}。${extra}`.trim(),
        retryable: true
      };
    }
    return {
      items: [],
      lifetimeCreditsSpent: 0,
      error: msg,
      errorDetail: (typeof r?.details === 'string' ? r.details : '') || (r?.status ? `HTTP ${r.status}` : ''),
      retryable: true
    };
  }

  function renderTasks(data) {
    const list = document.getElementById('trialTasksList');
    if (!list) return;
    const items = data?.items || [];
    if (data?.error === 'session_expired') {
      list.innerHTML = `<p class="trial-tasks-empty">登录凭证已过期，请点「重新登录」后再试（侧栏邮箱仍显示属正常）。</p>
        <p class="trial-tasks-hint"><button type="button" class="btn btn-primary btn-sm" id="trialTasksReloginBtn">重新登录</button></p>`;
      document.getElementById('trialTasksReloginBtn')?.addEventListener('click', () => {
        closeTrialTasksPanel();
        if (typeof openAuthModal === 'function') openAuthModal('login');
      });
      return;
    }
    if (data?.error) {
      const detail = data.errorDetail ? `<p class="trial-tasks-hint">${esc(data.errorDetail)}</p>` : '';
      const retryBtn = data.retryable
        ? '<p class="trial-tasks-hint"><button type="button" class="btn btn-secondary btn-sm" id="trialTasksRetryBtn">重试</button></p>'
        : '<p class="trial-tasks-hint">若提示迁移：在 Supabase SQL 编辑器执行 <code>20260528120000_membership_tasks.sql</code>。</p>';
      list.innerHTML = `<p class="trial-tasks-empty">${esc(data.error)}</p>${detail}${retryBtn}`;
      document.getElementById('trialTasksRetryBtn')?.addEventListener('click', () => {
        void openTrialTasksPanel();
      });
      return;
    }
    if (!items.length) {
      list.innerHTML =
        '<p class="trial-tasks-empty">暂无任务数据，请稍后刷新或联系管理员检查后端。</p>';
      return;
    }
    list.innerHTML = items
      .map((task) => {
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

    list.querySelectorAll('.trial-task-claim').forEach((btn) => {
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
      renderTasks(await loadTasks());
      window.SubscriptionUI?.refreshOfferUI?.();
      return;
    }
    if (typeof showToast === 'function') showToast(r?.message || '领取失败');
  }

  function markPwaInstalled() {
    try {
      localStorage.setItem(LS_PWA_FLAG, '1');
    } catch (e) { /* ignore */ }
    if (isLoggedIn()) scheduleSyncTaskProgress();
  }

  function closeTrialTasksPanel() {
    if (window.AppModalHub) {
      window.AppModalHub.close('trialTasksOverlay');
      return;
    }
    const el = document.getElementById('trialTasksOverlay');
    if (el) {
      el.classList.remove('active');
      el.hidden = true;
    }
    document.body.classList.remove('trial-tasks-open', 'app-modal-open');
  }

  async function openTrialTasksPanel() {
    const el = document.getElementById('trialTasksOverlay');
    if (!el) return;
    if (window.AppModalHub) window.AppModalHub.open('trialTasksOverlay');
    else {
      el.hidden = false;
      el.classList.add('active');
      document.body.classList.add('trial-tasks-open');
    }
    if (!isLoggedIn()) {
      renderTasks({ items: [] });
      document.getElementById('trialTasksLoginHint')?.classList.remove('hidden');
      return;
    }
    document.getElementById('trialTasksLoginHint')?.classList.add('hidden');
    const list = document.getElementById('trialTasksList');
    if (list) list.innerHTML = '<p class="trial-tasks-empty">任务加载中…</p>';
    if (tasksLoadSerial) return tasksLoadSerial;
    tasksLoadSerial = (async () => {
      try {
        const data = await loadTasks();
        renderTasks(data);
        if (!data?.error && Date.now() - lastTaskSyncAt >= TASK_SYNC_MIN_GAP_MS) {
          await syncTaskProgress(true);
          renderTasks(await loadTasks());
        }
      } finally {
        tasksLoadSerial = null;
      }
    })();
    return tasksLoadSerial;
  }

  function bindTrialTasksPanel() {
    if (panelBound) return;
    panelBound = true;
    const overlay = document.getElementById('trialTasksOverlay');
    const panel = overlay?.querySelector('.trial-tasks-panel');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeTrialTasksPanel();
    });
    panel?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('trialTasksCloseBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTrialTasksPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay?.classList.contains('active')) closeTrialTasksPanel();
    });
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
    syncTaskProgress: scheduleSyncTaskProgress,
    markPwaInstalled
  };
  window.openTrialTasksPanel = openTrialTasksPanel;
  window.closeTrialTasksPanel = closeTrialTasksPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindTrialTasksPanel();
      initPwaDetection();
    });
  } else {
    bindTrialTasksPanel();
    initPwaDetection();
  }
})();
