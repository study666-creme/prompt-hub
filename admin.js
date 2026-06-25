(function () {
  const LS_KEY = 'ph_admin_session_v1';

  function $(id) {
    return document.getElementById(id);
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(LS_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s?.secret) {
        const expected = resolveApiBase();
        if (s.apiBase !== expected) s.apiBase = expected;
      }
      return s;
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    sessionStorage.setItem(LS_KEY, JSON.stringify(s));
  }

  function clearSession() {
    sessionStorage.removeItem(LS_KEY);
  }

  function resolveApiBase() {
    const host = (window.location.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return String(window.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
    }
    const custom = String(window.CUSTOM_API_HOST || '').trim();
    if (custom) {
      return 'https://' + custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    }
    const prodByHost = {
      'prompt-hubs.com': 'https://api.prompt-hubs.com',
      'www.prompt-hubs.com': 'https://api.prompt-hubs.com',
      'prompt-hub.cn': 'https://api.prompt-hub.cn',
      'www.prompt-hub.cn': 'https://api.prompt-hub.cn',
      'prompt-hub-hub.pages.dev': 'https://api.prompt-hubs.com',
      'prompt-hub-web.pages.dev': 'https://api.prompt-hubs.com'
    };
    if (prodByHost[host]) return prodByHost[host];
    if (/\.prompt-hub-hub\.pages\.dev$/i.test(host) || /\.prompt-hub-web\.pages\.dev$/i.test(host)) {
      return 'https://api.prompt-hubs.com';
    }
    return String(window.API_BASE_URL || 'https://api.prompt-hubs.com').replace(/\/$/, '');
  }

  function apiBase(session) {
    return (session?.apiBase || resolveApiBase()).replace(/\/$/, '');
  }

  function encodeAdminSecret(secret) {
    const bytes = new TextEncoder().encode(secret);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'b64:' + btoa(binary);
  }

  function friendlyFetchError(err) {
    const msg = String(err?.message || err || '');
    if (/non ISO-8859-1|headers.*RequestInit/i.test(msg)) {
      return '密钥含特殊符号导致浏览器无法发送，请刷新页面后重试；或改用纯英文+数字密钥';
    }
    if (/UNAUTHORIZED|管理员密钥无效/i.test(msg)) {
      return '密钥与 Cloudflare 中保存的不一致。请重新执行 wrangler secret put 设置同一串后再登录。';
    }
    if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
      const base = resolveApiBase();
      const localHint =
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? '本地请先运行：cd server 后 npx wrangler dev（8787）。'
          : '';
      return `无法连接 API：${base}。${localHint}线上请确认 server 已 deploy、/health 返回 supabase:ok（见 docs/OVERSEAS-FIRST.md）`;
    }
    if (/site_settings|Could not find the table|PGRST205|SITE_SETTINGS|SAVE_VERIFY|PERMISSION/i.test(msg)) {
      return msg.includes('SAVE_VERIFY')
        ? '保存后读不到数据：请确认 Worker 的 SUPABASE_URL 与 SQL 编辑器是同一个 Supabase 项目'
        : msg.includes('PERMISSION')
          ? '无写入权限：请在 Supabase 再执行 supabase/migrations/20260602200000_site_settings_grants.sql'
          : '数据库 site_settings 不可用。请执行建表+授权 SQL 后重试';
    }
    return msg || '请求失败';
  }

  async function adminFetch(session, path, opts) {
    const url = apiBase(session) + path;
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Secret': encodeAdminSecret(session.secret)
    };
    const timeoutMs = opts?.timeoutMs || 90000;
    const attempts = Math.max(1, Number(opts?.retries) || 1);

    async function once() {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await fetch(url, {
          method: opts?.method || 'GET',
          headers,
          body: opts?.body ? JSON.stringify(opts.body) : undefined,
          mode: 'cors',
          cache: 'no-store',
          signal: controller?.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          const msg = json?.error?.message || res.statusText || '请求失败';
          const code = json?.error?.code || '';
          const err = new Error(code ? `${msg} (${code})` : msg);
          err.status = res.status;
          err.code = code;
          throw err;
        }
        return json.data;
      } catch (e) {
        if (e?.name === 'AbortError') {
          throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）：${url}`);
        }
        if (e instanceof TypeError) {
          const err = new Error(e.message || 'Failed to fetch');
          err.cause = url;
          throw err;
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    let lastErr = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await once();
      } catch (e) {
        lastErr = e;
        const retryable = /failed to fetch|networkerror|load failed/i.test(String(e?.message || ''));
        if (!retryable || i >= attempts - 1) throw e;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    throw lastErr;
  }

  function formatBytes(n) {
    const v = Math.max(0, Number(n) || 0);
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(2) + ' MB';
    return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'admin-msg ' + (ok ? 'admin-msg--ok' : 'admin-msg--err');
  }

  let toastTimer = 0;
  function toast(text, ok, holdMs) {
    const el = $('adminToast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'admin-toast ' + (ok ? 'is-ok' : 'is-err');
    if (text) toastTimer = setTimeout(() => (el.hidden = true), holdMs || (ok ? 5200 : 6800));
  }

  function setCommunityTaskProgress(text, active, opts = {}) {
    const box = $('communityTaskProgress');
    const label = $('communityTaskProgressText');
    const bar = $('communityTaskProgressBar');
    if (!box || !label) return;
    if (!active) {
      box.hidden = true;
      label.textContent = '';
      if (bar) {
        bar.classList.add('is-indeterminate');
        bar.style.width = '';
      }
      return;
    }
    box.hidden = false;
    label.textContent = text || '处理中…';
    if (!bar) return;
    const fraction = Number(opts.fraction);
    if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
      bar.classList.remove('is-indeterminate');
      bar.style.width = `${Math.max(4, Math.round(fraction * 100))}%`;
    } else {
      bar.classList.add('is-indeterminate');
      bar.style.width = '';
    }
  }

  function setButtonBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || '';
      btn.textContent = busyLabel || '处理中…';
      btn.classList.add('is-busy');
      btn.disabled = true;
      return;
    }
    btn.textContent = btn.dataset.idleLabel || btn.textContent;
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }

  async function runCommunityAdminTask(opts) {
    const {
      btn,
      confirmText,
      confirmTitle,
      confirmDanger,
      progressText,
      request,
      onSuccess,
      msgEl,
      resultEl
    } = opts;
    if (!session) return;
    if (communityRowBusy) {
      toast('上一项单行操作尚未完成，请稍候', false);
      return;
    }
    if (confirmText) {
      const ok = await adminConfirm({
        title: confirmTitle || '请确认',
        message: confirmText,
        confirmLabel: confirmDanger ? '确认删除' : '确定',
        danger: !!confirmDanger
      });
      if (!ok) return;
    }
    communityRowBusy = true;
    setButtonBusy(btn, true, '处理中…');
    setCommunityTaskProgress(progressText || '正在处理，请稍候…', true);
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.textContent = progressText || '正在处理…';
    }
    if (msgEl) showMsg(msgEl, progressText || '正在处理…', true);
    try {
      const data = await request();
      const text = onSuccess(data);
      setCommunityTaskProgress(text, true);
      if (resultEl) resultEl.textContent = text;
      if (msgEl) showMsg(msgEl, text, true);
      toast(text, true);
      return data;
    } catch (e) {
      const err = '操作失败：' + friendlyFetchError(e);
      setCommunityTaskProgress(err, true);
      if (resultEl) resultEl.textContent = err;
      if (msgEl) showMsg(msgEl, err, false);
      toast(err, false);
      throw e;
    } finally {
      communityRowBusy = false;
      setButtonBusy(btn, false);
      if (confirmOpen) closeAdminConfirm(false);
      setTimeout(() => setCommunityTaskProgress('', false), 8000);
    }
  }

  function updateCommunityBatchUi() {
    const bar = $('communityBatchBar');
    const countEl = $('communitySelectedCount');
    const n = communitySelected.size;
    const isPostView = communityView === 'published';
    if (bar) bar.classList.toggle('hidden', !isPostView);
    if (countEl) countEl.textContent = `已选 ${n} 条`;
    const disabled = n === 0 || communityRowBusy || !!communityBatchTask?.running;
    ['communityBatchUnpublishBtn', 'communityBatchDeleteBtn'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
    const allBox = $('communitySelectAll');
    if (allBox) {
      const pageIds = communityPageItems.map((p) => p.id).filter(Boolean);
      allBox.checked = pageIds.length > 0 && pageIds.every((id) => communitySelected.has(id));
      allBox.indeterminate =
        pageIds.some((id) => communitySelected.has(id)) && !allBox.checked;
    }
  }

  function updateBucketOrphanBatchUi() {
    const bar = $('communityBucketBatchBar');
    const countEl = $('communityBucketSelectedCount');
    const btn = $('communityBucketDeleteSelectedBtn');
    const n = communityBucketSelected.size;
    if (bar) bar.classList.toggle('hidden', communityView !== 'bucket-orphans');
    if (countEl) countEl.textContent = `已选 ${n} 组`;
    if (btn) btn.disabled = true;
    const allBox = $('communityBucketSelectAll');
    if (allBox) {
      const pageIds = communityBucketItems.map((g) => g.id).filter(Boolean);
      allBox.checked = pageIds.length > 0 && pageIds.every((id) => communityBucketSelected.has(id));
      allBox.indeterminate =
        pageIds.some((id) => communityBucketSelected.has(id)) && !allBox.checked;
    }
  }

  function bucketOrphanRiskBadge(o) {
    const risk = o.risk || 'safe';
    const cls =
      risk === 'recoverable' ? 'admin-badge--info' : risk === 'relink' ? 'admin-badge--warn' : 'admin-badge--ok';
    const label = esc(o.riskLabel || (risk === 'safe' ? '高置信孤儿' : risk));
    const hint = o.recoverHint ? `<br><span class="admin-hint">${esc(o.recoverHint)}</span>` : '';
    return `<span class="admin-badge ${cls}">${label}</span>${hint}`;
  }

  function bucketOrphanActionCell(o) {
    const id = esc(o.id);
    const canRestore = o.risk === 'recoverable' || o.risk === 'relink';
    const restoreBtn = canRestore
      ? `<button type="button" class="admin-btn admin-btn--sm" data-restore-orphan="${id}" title="${esc(o.recoverHint || '写回或修复关联')}">恢复</button> `
      : '';
    const delLabel = o.fileCount > 1 ? `删 ${o.fileCount} 个` : '删除';
    return `${restoreBtn}<button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete-orphan="${id}">${delLabel}</button>`;
  }

  function communityPostTableHead() {
    return '<tr><th class="admin-col-check"><span class="admin-sr-only">选择</span></th><th>缩略图</th><th>图态</th><th>作者</th><th>提示词</th><th>卡片库</th><th>赞</th><th>时间</th><th>操作</th></tr>';
  }

  function syncCommunitySelectionFromDom() {
    communitySelected.clear();
    document.querySelectorAll('[data-community-select]:checked').forEach((el) => {
      const id = el.getAttribute('data-community-select');
      if (id) communitySelected.add(id);
    });
    updateCommunityBatchUi();
  }

  function batchCommunityItemPath(action, id) {
    const enc = encodeURIComponent(id);
    if (action === 'restore') return `/api/admin/community/posts/${enc}/restore`;
    if (action === 'unpublish') return `/api/admin/community/posts/${enc}/unpublish`;
    if (action === 'delete') return `/api/admin/community/posts/${enc}/delete`;
    return '';
  }

  function batchCommunityActionLabel(action) {
    if (action === 'restore') return '写回卡片库';
    if (action === 'unpublish') return '从社区隐藏';
    return '删除';
  }

  async function runBatchCommunityChunked(action, ids) {
    const label = batchCommunityActionLabel(action);
    const total = ids.length;
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    let storageRemoved = 0;
    const errors = [];

    communityBatchTask = { action, done: 0, total, running: true };
    updateCommunityBatchUi();
    setCommunityTaskProgress(`正在${label} 0/${total}…`, true, { fraction: 0 });

    for (let i = 0; i < total; i += 1) {
      const id = ids[i];
      const path = batchCommunityItemPath(action, id);
      if (!path) continue;
      const step = i + 1;
      setCommunityTaskProgress(`正在${label} ${step}/${total}…`, true, { fraction: step / total });
      if ($('communityMsg')) showMsg($('communityMsg'), `正在${label} ${step}/${total}…`, true);
      try {
        const data = await adminFetch(session, path, {
          method: 'POST',
          body: action === 'delete' ? { deleteStorage: true } : undefined,
          timeoutMs: 120000,
          retries: 0
        });
        if (action === 'restore') {
          if (data.alreadyExists) skipped += 1;
          else succeeded += 1;
        } else if (action === 'delete') {
          succeeded += 1;
          storageRemoved += Number(data.storageRemoved || 0);
        } else {
          succeeded += 1;
        }
      } catch (e) {
        failed += 1;
        errors.push({ id, message: friendlyFetchError(e) });
        console.warn('[admin] batch item failed', id, e);
      }
      communityBatchTask = { action, done: step, total, running: true };
    }

    communityBatchTask = null;
    updateCommunityBatchUi();
    communitySelected.clear();
    void loadCommunity(false);

    const errHint = failed ? `，失败 ${failed}（见控制台）` : '';
    if (errors.length) console.warn('[admin] batch errors', errors);
    let summary;
    if (action === 'restore') {
      summary = `批量恢复完成：成功 ${succeeded}，跳过 ${skipped}${errHint}`;
    } else if (action === 'delete') {
      summary = `批量删除完成：成功 ${succeeded}，清图 ${storageRemoved}${errHint}`;
    } else {
      summary = `批量下架完成：成功 ${succeeded}${errHint}`;
    }
    setCommunityTaskProgress(summary, true, { fraction: 1 });
    if ($('communityMsg')) showMsg($('communityMsg'), summary, failed === 0);
    toast(summary, failed === 0);
    setTimeout(() => setCommunityTaskProgress('', false), 12000);
  }

  async function runBatchCommunityAction(action) {
    if (!session) return;
    if (communityBatchTask?.running) {
      toast(`批量${batchCommunityActionLabel(action)}进行中 ${communityBatchTask.done}/${communityBatchTask.total}，可继续其他操作`, true);
      return;
    }
    const ids = [...communitySelected];
    if (!ids.length) {
      toast('请先勾选本页要处理的帖子', false);
      return;
    }
    const labels = {
      restore: { title: '批量恢复到卡片库', msg: `将恢复 ${ids.length} 条社区帖到各作者卡片库。\n\n已存在的卡会跳过。`, danger: false },
      unpublish: { title: '批量下架', msg: `下架 ${ids.length} 条社区帖？\n\n仅隐藏，不删图片。`, danger: false },
      delete: {
        title: '批量永久删除',
        msg: `永久删除 ${ids.length} 条社区帖，并删除 Storage/R2 配图？\n\n不可恢复。`,
        danger: true
      }
    };
    const meta = labels[action];
    if (!meta) return;
    const ok = await adminConfirm({
      title: meta.title,
      message: meta.msg,
      confirmLabel: meta.danger ? '确认删除' : '确定',
      danger: !!meta.danger
    });
    if (!ok) return;
    void runBatchCommunityChunked(action, ids);
  }

  function openModal() {
    const m = $('userModal');
    if (m) m.hidden = false;
  }

  function closeModal() {
    const m = $('userModal');
    if (m) m.hidden = true;
    $('userModalBody').innerHTML = '';
  }

  let confirmResolver = null;
  let confirmOpen = false;

  function closeAdminConfirm(result) {
    const modal = $('adminConfirmModal');
    if (modal) modal.hidden = true;
    confirmOpen = false;
    const resolve = confirmResolver;
    confirmResolver = null;
    if (typeof resolve === 'function') resolve(!!result);
  }

  function resetCommunityUiLock() {
    communityRowBusy = false;
    setCommunityTaskProgress('', false);
    document.querySelectorAll('.admin-btn.is-busy').forEach((btn) => setButtonBusy(btn, false));
  }

  function adminConfirm(opts) {
    if (confirmOpen) closeAdminConfirm(false);
    const modal = $('adminConfirmModal');
    const titleEl = $('adminConfirmTitle');
    const msgEl = $('adminConfirmMessage');
    const okBtn = $('adminConfirmOkBtn');
    if (!modal || !titleEl || !msgEl || !okBtn) {
      return Promise.resolve(window.confirm(String(opts?.message || opts?.title || '继续？')));
    }
    titleEl.textContent = opts?.title || '请确认';
    msgEl.textContent = opts?.message || '';
    okBtn.textContent = opts?.confirmLabel || '确定';
    okBtn.className = opts?.danger
      ? 'admin-btn admin-btn--danger'
      : 'admin-btn admin-btn--primary';
    modal.hidden = false;
    confirmOpen = true;
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(val) {
    if (!val) return null;
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  let session = loadSession();
  let userOffset = 0;
  let codeOffset = 0;
  let communityOffset = 0;
  let communityView = 'published';
  let communityBucketRisk = 'all';
  let communityBucketScanMeta = null;
  let communityBucketForceRefresh = false;
  let communityBucketPollTimer = null;
  let communityBucketPollStarted = 0;
  let communityBucketPageSize = 50;
  let communityBucketTotal = 0;
  let communityBucketItems = [];
  let codeCategory = 'all';
  let communityPageItems = [];
  let communityRowBusy = false;
  /** 批量任务在后台跑，不阻塞单行删除/下架 */
  let communityBatchTask = null;
  const communitySelected = new Set();
  const communityBucketSelected = new Set();
  const PAGE = 20;
  let activeTab = 'overview';

  function syncAdminBuildLabels() {
    const build = window.__ADMIN_BUILD__ || 'dev';
    ['adminBuildTag', 'adminSidebarBuild'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = build;
    });
  }

  function updateAdminApiChip() {
    const chip = $('adminApiChip');
    if (!chip) return;
    const base = session ? apiBase(session) : resolveApiBase();
    chip.textContent = base.replace(/^https?:\/\//, '');
    chip.title = base;
  }

  function getActiveTab() {
    return document.querySelector('.admin-tab.is-active')?.dataset?.tab || activeTab;
  }

  function refreshCurrentTab() {
    const tab = getActiveTab();
    activeTab = tab;
    if (tab === 'overview') void loadDashboard();
    if (tab === 'users') void loadUsers(true);
    if (tab === 'community') void loadCommunity(true);
    if (tab === 'codes') void loadCodes(true);
    if (tab === 'models') void loadImageModels();
  }

  function showApp(loggedIn) {
    document.body.classList.toggle('admin-gate', !loggedIn);
    $('adminLogin').hidden = loggedIn;
    $('adminApp').hidden = !loggedIn;
    document.title = loggedIn ? 'Prompt Hub 运营控制台' : '管理登录';
    updateAdminApiChip();
  }

  const PAGE_TITLES = {
    overview: ['数据概览', '用户、存储、运行环境一览'],
    users: ['用户管理', '搜索、查看云存储额度与会员状态'],
    community: ['社区图片', '查看在线帖数量、下架无效或已删卡的社区帖'],
    codes: ['激活码', '生成与查询兑换码'],
    models: ['生图模型', '定价、折扣与线路配置']
  };

  function setPageTitle(tab) {
    const meta = PAGE_TITLES[tab] || PAGE_TITLES.overview;
    const t = $('adminPageTitle');
    const s = $('adminPageSubtitle');
    if (t) t.textContent = meta[0];
    if (s) s.textContent = meta[1];
  }

  function renderQuotaCard(title, usedLabel, quotaLabel, percent, status, meta, badge) {
    const cls = status === 'critical' ? 'is-critical' : status === 'warn' ? 'is-warn' : status === 'unknown' ? 'is-unknown' : '';
    const barWarn = percent != null && percent >= 80 ? ' is-warn' : '';
    const pct = percent != null ? percent : 0;
    const bar = percent != null
      ? `<div class="admin-progress" title="${pct}%"><div class="admin-progress__bar${barWarn}" style="width:${Math.min(100, pct)}%"></div></div>`
      : '';
    return `<div class="admin-quota-card ${cls}">
      <div class="admin-quota-card__head">
        <span class="admin-quota-card__title">${esc(title)}</span>
        ${badge ? `<span class="admin-badge admin-badge--${badge.kind || 'ok'}">${esc(badge.text)}</span>` : ''}
      </div>
      <div><strong style="font-size:18px">${esc(usedLabel)}</strong> <span class="admin-hint">/ ${esc(quotaLabel || '—')}</span></div>
      ${bar}
      ${meta ? `<p class="admin-quota-card__meta">${meta}</p>` : ''}
    </div>`;
  }

  function bindTabs() {
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeAdminConfirm(false);
        resetCommunityUiLock();
        document.querySelectorAll('.admin-tab').forEach((b) => b.classList.remove('is-active'));
        document.querySelectorAll('.admin-panel').forEach((p) => (p.hidden = true));
        btn.classList.add('is-active');
        const tab = btn.dataset.tab;
        activeTab = tab;
        setPageTitle(tab);
        const panel = $('panel-' + tab);
        if (panel) panel.hidden = false;
        if (tab === 'overview') void loadDashboard();
        if (tab === 'users') void loadUsers(true);
        if (tab === 'community') void loadCommunity(true);
        if (tab === 'codes') void loadCodes(true);
        if (tab === 'models') void loadImageModels();
      });
    });
  }

  async function loadDashboard() {
    const el = $('dashStats');
    if (!el || !session) return;
    el.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
    void loadDashboardInfra();
    void loadDashboardStorage();
    bindDashboardCommunityPurge();
    try {
      const d = await adminFetch(session, '/api/admin/dashboard');
      const tier = d.membersByTier || {};
      el.innerHTML = `
        <div class="admin-stat admin-stat--blue"><span>注册用户</span><strong>${d.usersTotal}</strong></div>
        <div class="admin-stat admin-stat--green"><span>有效会员</span><strong>${d.membersActive}</strong></div>
        <div class="admin-stat admin-stat--amber"><span>永久积分合计</span><strong>${d.totalPermanentCredits}</strong></div>
        <div class="admin-stat admin-stat--violet"><span>登记存储合计</span><strong>${formatBytes(d.totalStorageBytes)}</strong></div>
        <div class="admin-stat admin-stat--rose"><span>可用激活码</span><strong>${d.codesActive}</strong></div>
        <div class="admin-stat admin-stat--slate"><span>累计兑换</span><strong>${d.redemptionsTotal}</strong></div>
        <div class="admin-stat admin-stat--blue"><span>轻/基/标/专</span><strong>${tier.lite || 0} / ${tier.basic || 0} / ${tier.standard || 0} / ${tier.pro || 0}</strong></div>
      `;
      showMsg($('dashMsg'), '', true);
    } catch (e) {
      el.innerHTML = '';
      showMsg($('dashMsg'), friendlyFetchError(e), false);
    }
  }

  async function loadDashboardInfra() {
    const hint = $('dashInfraHint');
    const body = $('dashInfraBody');
    if (!session || !hint || !body) return;
    hint.textContent = '正在读取 Worker 环境…';
    body.hidden = true;
    try {
      const d = await adminFetch(session, '/api/admin/dashboard/infra');
      const dbOk = d.supabaseDbPing === 'ok';
      const keyOk = d.supabaseServiceKeyLooksValid;
      hint.textContent = `API：${d.apiOrigin || '—'} · 环境 ${d.environment || '—'}`;
      const policyRows = (d.userStoragePolicy || [])
        .map((p) => `<li>${esc(p.tier)}：${esc(p.quotaLabel)}</li>`)
        .join('');
      body.innerHTML = `
        <div class="admin-kv">
          <div><span>API 地址</span><strong>${esc(d.apiOrigin || '—')}</strong></div>
          <div><span>站点</span><strong>${esc(d.pagesHint || '—')}</strong></div>
          <div><span>Supabase 项目</span><strong>${esc(d.supabaseProjectHost || '未配置')}</strong></div>
          <div><span>Service Key</span><strong>${keyOk ? '已配置（格式正常）' : '未配置或异常'}</strong></div>
          <div><span>数据库连通</span><strong class="${dbOk ? '' : 'admin-warn'}">${esc(d.supabaseDbPing || '—')}</strong></div>
          <div><span>生图 API</span><strong>${d.imageApiConfigured ? '已配置' : '未配置'}</strong></div>
          <div><span>对话 API</span><strong>${d.chatApiConfigured ? '已配置' : '未配置'}</strong></div>
          <div><span>桶配额参考</span><strong>${d.storageQuotaMbEnv || '—'} MB</strong></div>
          <div><span>库配额参考</span><strong>${d.dbQuotaMbEnv || '—'} MB</strong></div>
          <div><span>Usage 文件存储</span><strong>${d.storageUsedMbEnv != null ? d.storageUsedMbEnv + ' MB' : '未填'}</strong></div>
          <div><span>Usage 数据库</span><strong>${d.dbUsedMbEnv != null ? d.dbUsedMbEnv + ' MB' : '未填'}</strong></div>
        </div>
        ${policyRows ? `<p style="margin:12px 0 6px;font-size:13px"><strong>用户云存储策略</strong></p><ul class="admin-notes">${policyRows}</ul>` : ''}
        <ul class="admin-notes" style="margin-top:10px">${(d.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      `;
      body.hidden = false;
    } catch (e) {
      hint.textContent = '环境信息加载失败：' + friendlyFetchError(e);
    }
  }

  async function loadDashboardStorage() {
    const hint = $('dashStorageHint');
    const body = $('dashStorageBody');
    const alertsEl = $('dashAlerts');
    if (!session || !hint || !body) return;
    hint.textContent = '正在扫描 card-images 桶（文件较多时约需几秒）…';
    body.hidden = true;
    if (alertsEl) alertsEl.hidden = true;
    try {
      const s = await adminFetch(session, '/api/admin/dashboard/storage');
      const ps = s.projectStorage || {};
      const db = s.database || {};
      hint.textContent = s.bucketScanTruncated
        ? `桶扫描：前 ${s.bucketFileCount} 个文件（不完整，仅供参考）`
        : `桶扫描：${s.bucketFileCount} 个文件 · card-images`;

      const fileBadge = ps.source === 'env'
        ? { kind: 'ok', text: 'Usage 同步' }
        : { kind: 'warn', text: '桶扫描估算' };
      const dbBadge = db.configured
        ? { kind: 'ok', text: 'Usage 同步' }
        : { kind: 'warn', text: '未填实际用量' };

      const fileUsedMain = ps.source === 'env'
        ? (ps.usedLabel || s.bucketLabel)
        : `未填 Usage · 扫描 ${esc(s.bucketLabel)}`;
      const filePercent = ps.source === 'env'
        ? (ps.percentUsed != null ? ps.percentUsed : s.storageUsedPercent)
        : null;
      const fileStatus = ps.source === 'env' ? (ps.status || 'unknown') : 'unknown';

      const topUsers = Array.isArray(s.topUsersByBucket) ? s.topUsersByBucket : [];
      const topUsersHtml = topUsers.length
        ? `<div class="admin-bucket-users" style="margin-top:16px">
            <h3 style="font-size:13px;margin:0 0 8px">桶内按用户（真实文件占用，非 SQL 登记）</h3>
            <table class="admin-table admin-table--compact">
              <thead><tr><th>用户 ID</th><th>文件数</th><th>桶内占用</th></tr></thead>
              <tbody>${topUsers.map((u) => `
                <tr>
                  <td><code>${esc(u.userId)}</code></td>
                  <td>${esc(String(u.fileCount))}</td>
                  <td>${esc(u.label)}</td>
                </tr>`).join('')}</tbody>
            </table>
            <p class="admin-hint" style="margin-top:8px">路径前缀即用户 UUID。登记存储列来自 profiles.storage_bytes，历史上传未上报时会远低于此表。</p>
          </div>`
        : '';

      body.innerHTML = `
        <div class="admin-quota-grid">
          ${renderQuotaCard(
            '项目 File Storage（Supabase 账单）',
            fileUsedMain,
            ps.quotaLabel || s.storageQuotaLabel,
            filePercent,
            fileStatus,
            ps.source === 'env'
              ? '来自 Worker 变量 <code>SUPABASE_STORAGE_USED_MB</code>（与 Usage 页 File Storage 一致）'
              : `Supabase Usage 页 Storage Size 才是账单（你那边约 0.754 GB，未超限）。下方 ${esc(s.bucketLabel)} 是逐文件 metadata 累加，常因旧图未删而偏高。请填 Worker 变量 SUPABASE_STORAGE_USED_MB=754。`,
            fileBadge
          )}
          ${renderQuotaCard(
            'Database（Postgres 账单）',
            db.usedLabel || '未同步',
            db.quotaLabel || s.dbQuotaLabel,
            db.percentUsed,
            db.status || 'unknown',
            db.configured
              ? '来自 Worker 变量 <code>SUPABASE_DB_USED_MB</code>（与 Usage 页 Database 一致）'
              : 'Database 与 File Storage 分开统计。请到 Supabase → Project Settings → Usage 查看 Database 已用，填入 Worker 变量 <code>SUPABASE_DB_USED_MB</code>。',
            dbBadge
          )}
          ${renderQuotaCard(
            '用户登记存储（业务层）',
            s.registeredLabel,
            '—',
            null,
            'unknown',
            '所有用户 <code>profiles.storage_bytes</code> 合计，用于会员配额；<strong>不是</strong> Supabase 账单数字。',
            { kind: 'ok', text: '业务数据' }
          )}
        </div>
        ${topUsersHtml}
        <p class="admin-hint" style="margin-top:12px">${esc(s.dbNote || '')}</p>
      `;
      body.hidden = false;

      const reconcileBtn = $('dashStorageReconcile');
      if (reconcileBtn) {
        reconcileBtn.hidden = false;
        reconcileBtn.onclick = async () => {
          if (!confirm('按 card-images 桶内文件重算并写回 profiles.storage_bytes？\n\n仅修正「登记存储」账本，不影响 Supabase 账单。')) return;
          reconcileBtn.disabled = true;
          try {
            const r = await adminFetch(session, '/api/admin/dashboard/storage/reconcile', { method: 'POST', timeoutMs: 120000 });
            toast(`已回填 ${r.updated || 0} 个用户 · 桶合计 ${r.bucketLabel || ''}`, true);
            await loadDashboardStorage();
            if ($('panel-users') && !$('panel-users').hidden) await loadUsers(true);
          } catch (e) {
            toast('回填失败：' + friendlyFetchError(e), false);
          } finally {
            reconcileBtn.disabled = false;
          }
        };
      }

      if (alertsEl && Array.isArray(s.alerts) && s.alerts.length) {
        alertsEl.innerHTML = s.alerts.map((a) => `
          <div class="admin-alert admin-alert--${a.level === 'critical' ? 'critical' : 'warn'}">
            <strong>${esc(a.title)}</strong>
            ${esc(a.detail)}
          </div>`).join('');
        alertsEl.hidden = false;
      }
    } catch (e) {
      hint.textContent = '存储扫描失败：' + friendlyFetchError(e);
    }
  }

  function bindDashboardCommunityPurge() {
    const btn = $('dashCommunityPurgeBtn');
    const result = $('dashCommunityPurgeResult');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try {
        await runCommunityAdminTask({
          btn,
          confirmTitle: '清理无效社区帖',
          confirmText: '将检查所有已发布社区帖：\n· 作者卡片库已删\n· Storage 无图片\n· 无效作者\n· 重复卡片\n\n会从社区隐藏（published=false），图片保留。继续？',
          progressText: '正在扫描 Storage 与社区帖（帖多时约需 1～2 分钟）…',
          resultEl: result,
          request: () => adminFetch(session, '/api/admin/community/purge-ghosts', {
            method: 'POST',
            timeoutMs: 180000
          }),
          onSuccess: (r) =>
            `已下架 ${r.unpublishedTotal || 0} 条（删卡孤儿 ${r.unpublishedOrphans || 0}，无图/无效作者 ${r.unpublishedMissing || 0}，重复 ${r.unpublishedDuplicates || 0}）· 修正作者 ${r.repairedAuthors || 0} · 仍在线 ${r.publishedRemaining ?? '—'} 条（有图 ${r.publishedWithImage ?? '—'}）`
        });
      } catch (e) { /* toast handled */ }
    });
  }

  async function runCommunityPurge(btn, resultEl, msgEl) {
    try {
      await runCommunityAdminTask({
        btn,
        confirmTitle: '清理无效社区帖',
        confirmText: '将检查所有已发布社区帖：\n· 作者卡片库已删\n· Storage 无图片\n· 无效作者\n· 重复卡片\n\n会被下架（published=false）。继续？',
        progressText: '正在扫描无效社区帖（帖多时约需 1～2 分钟）…',
        resultEl,
        msgEl,
        request: () => adminFetch(session, '/api/admin/community/purge-ghosts', {
          method: 'POST',
          timeoutMs: 180000
        }),
        onSuccess: (r) => {
          if ($('panel-community') && !$('panel-community').hidden) void loadCommunity(true);
          return `已下架 ${r.unpublishedTotal || 0} 条（删卡孤儿 ${r.unpublishedOrphans || 0}，无图 ${r.unpublishedMissing || 0}，重复 ${r.unpublishedDuplicates || 0}）· 仍在线 ${r.publishedRemaining ?? '—'} 条（有图 ${r.publishedWithImage ?? '—'}）`;
        }
      });
    } catch (e) { /* toast handled */ }
  }

  function communityImageCell(image) {
    const ref = String(image || '').trim();
    if (!ref) return '<span class="admin-hint">无</span>';
    const short = ref.length > 36 ? ref.slice(0, 18) + '…' + ref.slice(-14) : ref;
    return `<code title="${esc(ref)}">${esc(short)}</code>`;
  }

  function communityCardLibBadge(item) {
    if (item.cardInLibrary === true) return '<span class="admin-badge admin-badge--ok">有</span>';
    if (item.cardInLibrary === false) return '<span class="admin-badge admin-badge--warn">无</span>';
    return '<span class="admin-hint">—</span>';
  }

  function communityImageStatusCell(p) {
    const img = String(p?.image || '').trim();
    if (!img) {
      return '<span class="admin-badge admin-badge--warn" title="数据库无 image 字段">无图</span>';
    }
    if (/^https?:\/\//i.test(img) && !/api\.prompt-hubs\.com/i.test(img)) {
      return '<span class="admin-badge admin-badge--warn" title="第三方直链，易 404 失效">外链</span>';
    }
    if (/card-images|\/media\//i.test(img)) {
      return '<span class="admin-badge admin-badge--ok" title="Storage / R2 路径">桶</span>';
    }
    const short = img.length > 28 ? img.slice(0, 14) + '…' : img;
    return `<span class="admin-hint" title="${esc(img)}">${esc(short)}</span>`;
  }

  function communityThumbCell(p) {
    if (!p?.thumbUrl) {
      return '<div class="admin-thumb-wrap"><span class="admin-hint">无预览</span></div>';
    }
    const fb = esc(p.thumbFallbackUrl || p.thumbUrl);
    const src = esc(p.thumbUrl);
    return `<div class="admin-thumb-wrap"><img class="admin-thumb" src="${src}" data-fallback="${fb}" alt="" loading="lazy" onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}else{this.classList.add('is-broken')}"><span class="admin-thumb-label">裂</span></div>`;
  }

  function setCommunityView(view) {
    communityView = view || 'published';
    document.querySelectorAll('[data-community-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-community-view') === communityView);
    });
    const postTools = $('communityPostTools');
    const bucketBatch = $('communityBucketBatchBar');
    const guide = $('communityActionGuide');
    const head = $('communityTableHead');
    const hint = $('communityViewHint');
    if (postTools) postTools.classList.toggle('hidden', communityView === 'bucket-orphans');
    if (bucketBatch) bucketBatch.classList.toggle('hidden', communityView !== 'bucket-orphans');
    if (guide) guide.classList.toggle('hidden', communityView === 'bucket-orphans');
    if (head) {
      head.innerHTML =
        communityView === 'bucket-orphans'
          ? '<tr><th class="admin-col-check"><span class="admin-sr-only">选择</span></th><th>缩略图</th><th>路径 / 说明</th><th>大小</th><th></th></tr>'
          : communityPostTableHead();
    }
    const batchBar = $('communityBatchBar');
    if (batchBar) {
      batchBar.classList.toggle('hidden', communityView !== 'published');
    }
    if (hint) {
      const hints = {
        published: '在线社区帖。「从社区隐藏」仅下架展示；「永久删除」会删记录并尝试删桶内配图。与用户卡片库「是否公开」无关。',
        'bucket-orphans':
          '直接扫描 R2，与云端卡片库/社区/生图任务引用对比。generated/、imagegen/ 目录不再标为「高置信」——请勿批量删。删前务必逐条对缩略图；批量删除已暂停。点「重新扫描」刷新列表。'
      };
      hint.textContent = hints[communityView] || hints.published;
    }
    if (communityView === 'bucket-orphans') setBucketRiskFilter(communityBucketRisk);
    const bucketPageTools = $('communityBucketPageTools');
    if (bucketPageTools) bucketPageTools.classList.toggle('hidden', communityView !== 'bucket-orphans');
    updateBucketOrphanBatchUi();
    updateBucketPaginationUi();
  }

  function setBucketRiskFilter(risk) {
    communityBucketRisk = risk || 'all';
    document.querySelectorAll('[data-bucket-risk]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-bucket-risk') === communityBucketRisk);
    });
  }

  function setCodeCategoryFilter(category) {
    codeCategory = category || 'all';
    document.querySelectorAll('[data-code-category]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-code-category') === codeCategory);
    });
  }

  function stopBucketOrphanPoll() {
    if (communityBucketPollTimer) {
      clearTimeout(communityBucketPollTimer);
      communityBucketPollTimer = null;
    }
  }

  function normalizeBucketOrphanItem(o) {
    return {
      ...o,
      paths: Array.isArray(o.paths) && o.paths.length ? o.paths : [o.path]
    };
  }

  function updateBucketOrphanMeta(data) {
    const meta = $('communityBucketMeta');
    if (!meta || !data) return;
    const src = data.scanSource === 'r2' ? 'R2' : 'Storage';
    const counts = `高置信 ${data.safeCount ?? '—'} · 可写回 ${data.recoverableCount ?? '—'} · 可关联 ${data.relinkCount ?? '—'}`;
    const cacheHint = data.fromCache ? ' · 缓存' : '';
    meta.textContent = data.truncated
      ? `${src} 扫描上限 ${data.scannedCount ?? '—'}，请分批处理 · ${counts}${cacheHint}`
      : `${src} 已扫 ${data.scannedCount ?? '—'} 对象 · 引用 ${data.referencedCount ?? '—'} 路径 · ${counts}${cacheHint}`;
  }

  function bucketOrphanPageSize() {
    const n = Number(communityBucketPageSize) || 50;
    return Math.min(100, Math.max(20, n));
  }

  function bucketOrphanTotalPages() {
    const total = Math.max(0, Number(communityBucketTotal) || 0);
    const size = bucketOrphanPageSize();
    return Math.max(1, Math.ceil(total / size) || 1);
  }

  function updateBucketPaginationUi() {
    const tools = $('communityBucketPageTools');
    const prev = $('communityPrev');
    const next = $('communityNext');
    const pageInput = $('communityBucketPageInput');
    const pageTotalEl = $('communityBucketPageTotal');
    const sizeSelect = $('communityBucketPageSize');
    const isBucket = communityView === 'bucket-orphans';
    if (tools) tools.classList.toggle('hidden', !isBucket);
    if (!isBucket) {
      if (prev) prev.disabled = false;
      if (next) next.disabled = false;
      return;
    }
    const totalPages = bucketOrphanTotalPages();
    const currentPage = Math.floor(communityOffset / bucketOrphanPageSize()) + 1;
    if (pageTotalEl) pageTotalEl.textContent = String(totalPages);
    if (pageInput) {
      pageInput.max = String(totalPages);
      pageInput.value = String(Math.min(totalPages, Math.max(1, currentPage)));
    }
    if (sizeSelect && String(sizeSelect.value) !== String(bucketOrphanPageSize())) {
      sizeSelect.value = String(bucketOrphanPageSize());
    }
    if (prev) prev.disabled = communityOffset <= 0;
    if (next) {
      next.disabled =
        communityBucketTotal > 0
          ? communityOffset + communityBucketItems.length >= communityBucketTotal
          : communityBucketItems.length < bucketOrphanPageSize();
    }
  }

  function jumpBucketOrphanPage(pageNum) {
    const totalPages = bucketOrphanTotalPages();
    const page = Math.min(totalPages, Math.max(1, Number(pageNum) || 1));
    communityOffset = (page - 1) * bucketOrphanPageSize();
    void loadBucketOrphansPage({ reset: false, forceRefresh: false });
  }

  function renderBucketOrphanPage(data) {
    communityBucketScanMeta = data;
    communityBucketItems = (data.items || []).map(normalizeBucketOrphanItem);
    communityBucketTotal = Number(data.total) || 0;
    const rawFiles = data.rawOrphanFiles ?? 0;
    const total = communityBucketTotal || communityBucketItems.length;
    const currentPage = Math.floor(communityOffset / bucketOrphanPageSize()) + 1;
    const totalPages = bucketOrphanTotalPages();
    $('communityPageInfo').textContent = `桶内孤儿 · 第 ${communityOffset + 1}–${communityOffset + communityBucketItems.length} 组 / 共 ${total} 组（${rawFiles} 个物理文件）· ${currentPage}/${totalPages} 页`;
    updateBucketOrphanMeta(data);
    setBucketRiskFilter(communityBucketRisk);
    renderBucketOrphansTable();
    updateCommunityBatchUi();
    updateBucketPaginationUi();
    showMsg($('communityMsg'), '', true);
  }

  async function loadBucketOrphansPage(opts) {
    if (!session) return;
    const forceRefresh = !!(opts && opts.forceRefresh);
    const reset = !opts || opts.reset !== false;
    if (reset) communityOffset = 0;
    setCommunityView(communityView);
    setBucketRiskFilter(communityBucketRisk);

    const tbody = $('communityTableBody');
    if (!tbody) return;
    if (forceRefresh || !communityBucketScanMeta) {
      tbody.innerHTML =
        '<tr class="admin-loading"><td colspan="5">正在扫描 R2（约 1～3 分钟，请保持本页打开）…</td></tr>';
      if (forceRefresh) communityBucketPollStarted = Date.now();
      else if (!communityBucketPollStarted) communityBucketPollStarted = Date.now();
    }

    const riskQ =
      communityBucketRisk && communityBucketRisk !== 'all'
        ? `&risk=${encodeURIComponent(communityBucketRisk)}`
        : '';
    const refreshQ = forceRefresh ? '&refresh=1' : '';
    const timeoutMs = communityBucketScanMeta && !forceRefresh ? 45000 : 180000;

    try {
      const data = await adminFetch(
        session,
        `/api/admin/community/bucket-orphans?limit=${bucketOrphanPageSize()}&offset=${communityOffset}${riskQ}${refreshQ}`,
        { timeoutMs }
      );

      if (data.scanStatus === 'scanning') {
        const waited = Math.max(0, Math.round((Date.now() - communityBucketPollStarted) / 1000));
        tbody.innerHTML = `<tr class="admin-loading"><td colspan="5">正在扫描 R2… 已等待 ${waited}s（完成后自动刷新）</td></tr>`;
        $('communityPageInfo').textContent = '桶内孤儿 · 扫描进行中…';
        stopBucketOrphanPoll();
        communityBucketPollTimer = setTimeout(
          () => void loadBucketOrphansPage({ reset: false, forceRefresh: false }),
          3000
        );
        return;
      }

      stopBucketOrphanPoll();
      communityBucketForceRefresh = false;
      communityBucketPollStarted = 0;

      if (data.scanStatus === 'error') {
        tbody.innerHTML = '';
        $('communityPageInfo').textContent = '桶内孤儿 · 扫描失败';
        showMsg($('communityMsg'), data.scanError || 'R2 孤儿扫描失败，请点「重新扫描」重试', false);
        return;
      }

      renderBucketOrphanPage(data);
    } catch (e) {
      stopBucketOrphanPoll();
      tbody.innerHTML = '';
      $('communityPageInfo').textContent = '桶内孤儿 · 加载失败';
      const msg = String(e?.message || '');
      showMsg(
        $('communityMsg'),
        /请求超时/i.test(msg)
          ? `${msg}。扫描较慢，请点「重新扫描」或稍后再试。`
          : friendlyFetchError(e),
        false
      );
    }
  }

  function renderBucketOrphansTable() {
    const tbody = $('communityTableBody');
    if (!tbody) return;
    if (!communityBucketItems.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="admin-hint">暂无桶内孤儿（首次加载需扫描全桶，约 1～3 分钟）</td></tr>';
      updateBucketOrphanBatchUi();
      return;
    }
    tbody.innerHTML = communityBucketItems
      .map(
        (o) => `<tr>
            <td class="admin-col-check"><input type="checkbox" data-bucket-orphan-select="${esc(o.id)}"${communityBucketSelected.has(o.id) ? ' checked' : ''} aria-label="选择文件组"></td>
            <td>${communityThumbCell(o)}</td>
            <td><code class="admin-path" title="${esc(o.path)}">${esc(o.path.length > 42 ? o.path.slice(0, 40) + '…' : o.path)}</code>${o.variantHint ? `<br><span class="admin-hint">${esc(o.variantHint)}</span>` : ''}<br>${bucketOrphanRiskBadge(o)}</td>
            <td>${formatBytes(o.bytes || 0)}</td>
            <td class="admin-actions-cell">${bucketOrphanActionCell(o)}</td>
          </tr>`
      )
      .join('');
    updateBucketOrphanBatchUi();
  }

  function removeBucketOrphanGroups(deletedPaths) {
    communityBucketScanMeta = null;
    const gone = new Set(deletedPaths);
    communityBucketSelected.forEach((id) => {
      const g = communityBucketItems.find((x) => x.id === id);
      if (g && (g.paths || [g.path]).some((p) => gone.has(p))) communityBucketSelected.delete(id);
    });
    void loadBucketOrphansPage({ reset: false, forceRefresh: false });
  }

  async function handleCommunityRowAction(action, id, btn, extra) {
    if (!session || !id || communityRowBusy) return;
    const orphanGroup = action === 'orphan' || action === 'restore-orphan'
      ? communityBucketItems.find((g) => g.id === id)
      : null;
    const orphanPaths = orphanGroup?.paths || (extra ? [extra] : [id]);
    const copy = {
      restore: {
        title: '写回卡片库',
        message: '将该社区帖写回作者云端卡片库？（不会重新发布到社区）',
        progress: `正在写回 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/restore`,
        body: undefined,
        danger: false,
        done: (r) => (r.alreadyExists ? '卡片库已有该卡' : `已写回 · ${r.cardId || id}`)
      },
      unpublish: {
        title: '从社区隐藏',
        message: '仅从社区隐藏该帖？图片与卡片库记录保留。',
        progress: `正在隐藏 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/unpublish`,
        body: undefined,
        danger: false,
        done: () => '已从社区隐藏'
      },
      delete: {
        title: '永久删除',
        message: '永久删除该社区帖，并删除 Storage/R2 中的配图？\n\n不可恢复。',
        progress: `正在删除帖子 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/delete`,
        body: { deleteStorage: true },
        danger: true,
        done: (r) => `已删除 · 清图 ${r.storageRemoved || 0} 个`
      },
      orphan: {
        title: '删除孤儿文件',
        message: `删除 ${orphanPaths.length} 个 R2 文件？\n\n${orphanPaths.slice(0, 3).join('\n')}${orphanPaths.length > 3 ? '\n…' : ''}\n\n若缩略图像卡片库里的卡，请勿删。服务端会再次校验引用；仍被引用会拒绝。\n\n不可恢复。`,
        progress: `正在删除 ${orphanPaths.length} 个文件…`,
        path: '/api/admin/community/bucket-orphans/delete',
        body: { paths: orphanPaths },
        paths: orphanPaths,
        danger: true,
        done: (r) => `已删 ${r.removed || 0} 个文件（R2 ${r.r2Removed || 0}）`
      },
      'restore-orphan': {
        title: orphanGroup?.risk === 'relink' ? '修复图片关联' : '写回卡片库',
        message:
          orphanGroup?.recoverHint ||
          '将 R2 文件写回作者卡片库或修复 image 字段（不删图）',
        progress: '正在恢复…',
        path: '/api/admin/community/bucket-orphans/restore-card',
        body: {
          primaryPath: orphanGroup?.path,
          risk: orphanGroup?.risk,
          recoverPostId: orphanGroup?.recoverPostId,
          recoverCardId: orphanGroup?.recoverCardId,
          recoverUserId: orphanGroup?.recoverUserId
        },
        danger: false,
        done: (r) =>
          r.alreadyExists
            ? '卡片库已有该卡，已尝试修复图片指向'
            : r.action === 'relink'
              ? `已修复关联 · ${r.cardId || ''}`
              : `已写回卡片库 · ${r.cardId || ''}`
      }
    };
    const spec = copy[action];
    if (!spec) return;
    try {
      await runCommunityAdminTask({
        btn,
        confirmTitle: spec.title,
        confirmText: spec.message,
        confirmDanger: spec.danger,
        progressText: spec.progress,
        msgEl: $('communityMsg'),
        request: () =>
          adminFetch(session, spec.path, {
            method: 'POST',
            body: spec.body,
            timeoutMs: action === 'orphan' ? 60000 : 120000,
            retries: 1
          }),
        onSuccess: (r) => {
          communitySelected.delete(id);
          if (action === 'orphan') {
            removeBucketOrphanGroups(spec.paths || orphanPaths);
            communityBucketSelected.delete(id);
            updateBucketOrphanBatchUi();
          } else if (action === 'restore-orphan') {
            communityBucketScanMeta = null;
            communityBucketSelected.delete(id);
            void loadBucketOrphansPage({ reset: false, forceRefresh: false });
          } else {
            void loadCommunity(false);
          }
          return spec.done(r);
        }
      });
    } catch (e) { /* toast handled */ }
  }

  function setupAdminConfirmModal() {
    if (document.body.dataset.adminConfirmBound === '1') return;
    document.body.dataset.adminConfirmBound = '1';
    $('adminConfirmOkBtn')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeAdminConfirm(true);
    });
    $('adminConfirmCancelBtn')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeAdminConfirm(false);
    });
    document.querySelectorAll('[data-confirm-cancel]').forEach((el) => {
      if (el.id === 'adminConfirmCancelBtn') return;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeAdminConfirm(false);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirmOpen) closeAdminConfirm(false);
    });
  }

  function setupCommunityPanelActions() {
    const panel = $('panel-community');
    if (!panel || panel.dataset.actionsBound === '1') return;
    panel.dataset.actionsBound = '1';

    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-confirm-cancel]')) {
        closeAdminConfirm(false);
        return;
      }
      if (ev.target.closest('#adminConfirmOkBtn')) {
        closeAdminConfirm(true);
        return;
      }
      if (communityRowBusy) return;
      const restoreBtn = ev.target.closest('[data-restore-post]');
      if (restoreBtn) {
        void handleCommunityRowAction('restore', restoreBtn.getAttribute('data-restore-post'), restoreBtn);
        return;
      }
      const unpublishBtn = ev.target.closest('[data-unpublish-post]');
      if (unpublishBtn) {
        void handleCommunityRowAction('unpublish', unpublishBtn.getAttribute('data-unpublish-post'), unpublishBtn);
        return;
      }
      const deleteBtn = ev.target.closest('[data-delete-post]');
      if (deleteBtn) {
        void handleCommunityRowAction('delete', deleteBtn.getAttribute('data-delete-post'), deleteBtn);
        return;
      }
      const orphanBtn = ev.target.closest('[data-delete-orphan]');
      if (orphanBtn) {
        const groupId = orphanBtn.getAttribute('data-delete-orphan');
        if (groupId) void handleCommunityRowAction('orphan', groupId, orphanBtn);
        return;
      }
      const restoreOrphanBtn = ev.target.closest('[data-restore-orphan]');
      if (restoreOrphanBtn) {
        const groupId = restoreOrphanBtn.getAttribute('data-restore-orphan');
        if (groupId) void handleCommunityRowAction('restore-orphan', groupId, restoreOrphanBtn);
      }
    });

    panel.addEventListener('change', (ev) => {
      const target = ev.target;
      if (target.id === 'communitySelectAll') {
        const pageIds = communityPageItems.map((p) => p.id).filter(Boolean);
        if (target.checked) pageIds.forEach((id) => communitySelected.add(id));
        else pageIds.forEach((id) => communitySelected.delete(id));
        document.querySelectorAll('[data-community-select]').forEach((el) => {
          const id = el.getAttribute('data-community-select');
          if (id && pageIds.includes(id)) el.checked = target.checked;
        });
        updateCommunityBatchUi();
        return;
      }
      if (target.id === 'communityBucketSelectAll') {
        const pageIds = communityBucketItems.map((g) => g.id).filter(Boolean);
        if (target.checked) pageIds.forEach((id) => communityBucketSelected.add(id));
        else pageIds.forEach((id) => communityBucketSelected.delete(id));
        document.querySelectorAll('[data-bucket-orphan-select]').forEach((el) => {
          const id = el.getAttribute('data-bucket-orphan-select');
          if (id && pageIds.includes(id)) el.checked = target.checked;
        });
        updateBucketOrphanBatchUi();
        return;
      }
      if (target.matches('[data-bucket-orphan-select]')) {
        const id = target.getAttribute('data-bucket-orphan-select');
        if (!id) return;
        if (target.checked) communityBucketSelected.add(id);
        else communityBucketSelected.delete(id);
        updateBucketOrphanBatchUi();
        return;
      }
      if (target.matches('[data-community-select]')) {
        const id = target.getAttribute('data-community-select');
        if (!id) return;
        if (target.checked) communitySelected.add(id);
        else communitySelected.delete(id);
        updateCommunityBatchUi();
      }
    });
  }

  async function loadCommunity(reset) {
    if (!session) return;
    if (reset) communityOffset = 0;
    setCommunityView(communityView);
    const tbody = $('communityTableBody');
    const statsEl = $('communityStats');
    if (!tbody) return;
    const colSpan = communityView === 'bucket-orphans' ? 5 : 9;
    tbody.innerHTML = `<tr class="admin-loading"><td colspan="${colSpan}">${communityView === 'bucket-orphans' ? '正在扫描全桶（约 1～3 分钟，请稍候）…' : '加载中…'}</td></tr>`;
    try {
      if (statsEl) {
        const st = await adminFetch(session, '/api/admin/community/stats');
        statsEl.innerHTML = `
          <div class="admin-stat admin-stat--blue"><span>在线帖</span><strong>${st.publishedCount ?? 0}</strong></div>
          <div class="admin-stat admin-stat--slate"><span>已隐藏（库内）</span><strong>${st.unpublishedCount ?? 0}</strong></div>
          <div class="admin-stat admin-stat--amber"><span>当前视图</span><strong>${communityView === 'bucket-orphans' ? '桶内孤儿' : '在线帖'}</strong></div>`;
      }

      if (communityView === 'bucket-orphans') {
        communityPageItems = [];
        if (reset) communityBucketSelected.clear();
        await loadBucketOrphansPage({ reset, forceRefresh: communityBucketForceRefresh });
        return;
      }

      const q = ($('communitySearch')?.value || '').trim();
      const data = await adminFetch(
        session,
        `/api/admin/community/posts?limit=${PAGE}&offset=${communityOffset}${q ? '&q=' + encodeURIComponent(q) : ''}&view=published`
      );
      const items = data.items || [];
      communityPageItems = items;
      const viewLabel = data.view || communityView;
      $('communityPageInfo').textContent = `视图 ${viewLabel} · 第 ${communityOffset + 1}–${communityOffset + items.length} 条，约 ${data.total ?? items.length} 帖`;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="admin-hint">暂无在线社区帖</td></tr>';
        updateCommunityBatchUi();
        return;
      }
      tbody.innerHTML = items
        .map(
          (p) => `<tr>
          <td class="admin-col-check"><input type="checkbox" data-community-select="${esc(p.id)}"${communitySelected.has(p.id) ? ' checked' : ''} aria-label="选择帖子"></td>
          <td>${communityThumbCell(p)}</td>
          <td>${communityImageStatusCell(p)}</td>
          <td>${esc(p.authorName || '用户')}<br><span class="admin-hint">${esc((p.authorId || '').slice(0, 8))}…</span></td>
          <td title="${esc(p.promptPreview || '')}">${esc((p.promptPreview || '').slice(0, 48))}${(p.promptPreview || '').length > 48 ? '…' : ''}</td>
          <td>${communityCardLibBadge(p)}${p.sourceCardId ? `<br><span class="admin-hint">${esc(String(p.sourceCardId).slice(0, 16))}…</span>` : ''}</td>
          <td>${p.likes ?? 0}</td>
          <td>${esc((p.createdAt || '').slice(0, 10))}</td>
          <td class="admin-actions-cell">
            ${p.cardInLibrary === false ? `<button type="button" class="admin-btn admin-btn--sm" data-restore-post="${esc(p.id)}" title="写回作者云端卡片库">写回</button> ` : ''}
            ${p.published ? `<button type="button" class="admin-btn admin-btn--sm" data-unpublish-post="${esc(p.id)}" title="仅从社区隐藏">隐藏</button> ` : ''}
            <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete-post="${esc(p.id)}" title="删记录并尝试删配图">删除</button>
          </td>
        </tr>`
        )
        .join('');
      updateCommunityBatchUi();
      showMsg($('communityMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      if (communityView === 'bucket-orphans') {
        $('communityPageInfo').textContent = '桶内孤儿 · 加载失败';
      }
      showMsg($('communityMsg'), friendlyFetchError(e), false);
    }
  }

  async function loadUsers(reset) {
    if (!session) return;
    if (reset) userOffset = 0;
    const q = ($('userSearch')?.value || '').trim();
    const tbody = $('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="admin-loading"><td colspan="7">加载中…</td></tr>';
    try {
      const data = await adminFetch(
        session,
        `/api/admin/users?limit=${PAGE}&offset=${userOffset}${q ? '&q=' + encodeURIComponent(q) : ''}`
      );
      $('userPageInfo').textContent = `第 ${userOffset + 1}–${userOffset + data.items.length} 条，约 ${data.total} 用户`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="7">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((u) => {
          const sq = u.storageQuota || {};
          const quotaCell = esc(sq.summaryLabel || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`);
          return `<tr>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.displayName || '—')}</td>
            <td>${u.creditsPermanent} + 日${u.dailyCredits}</td>
            <td>${u.membershipActive ? '<span class="admin-badge admin-badge--ok">' + esc(u.membershipTierLabel) + '</span>' : '<span class="admin-badge">免费</span>'}</td>
            <td>${esc(u.storageLabel)}</td>
            <td>${quotaCell}</td>
            <td><button type="button" class="admin-btn admin-btn--primary" data-user-id="${esc(u.userId)}">管理</button></td>
          </tr>`;
        })
        .join('');
      tbody.querySelectorAll('[data-user-id]').forEach((btn) => {
        btn.addEventListener('click', () => void showUserDetail(btn.getAttribute('data-user-id')));
      });
      showMsg($('userMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('userMsg'), e.message, false);
    }
  }

  async function showUserDetail(userId) {
    const box = $('userModalBody');
    if (!box || !session) return;
    openModal();
    box.innerHTML = '<p class="admin-hint">加载中…</p>';
    try {
      const u = await adminFetch(session, '/api/admin/users/' + encodeURIComponent(userId));
      $('userModalTitle').textContent = u.displayName || u.email || '用户管理';
      const sq = u.storageQuota || {};
      const storageQuotaText = sq.summaryLabel
        || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`;
      const reds = (u.recentRedemptions || [])
        .map((r) => `<li>${esc(r.code)} · ${esc(r.redeemed_at || '')}</li>`)
        .join('');
      box.innerHTML = `
        <div class="admin-detail-readonly">
          <dl>
            <dt>邮箱</dt><dd>${esc(u.email || '—')}</dd>
            <dt>昵称</dt><dd>${esc(u.displayName || '—')}</dd>
            <dt>用户 ID</dt><dd><code>${esc(u.userId)}</code></dd>
            <dt>云端卡片数</dt><dd>${u.cardCount ?? 0} 张（不按张数限）</dd>
            <dt>云存储</dt><dd>${esc(storageQuotaText)}</dd>
            <dt>登记字节</dt><dd>${esc(u.storageLabel)}</dd>
            <dt>累计消耗</dt><dd>${u.lifetimeCreditsSpent ?? 0} 积分</dd>
            <dt>云同步</dt><dd>${esc(u.cloudUpdatedAt || '—')}</dd>
          </dl>
          ${reds ? '<p><strong>最近兑换</strong></p><ul>' + reds + '</ul>' : ''}
        </div>
        <h3 style="margin:16px 0 10px;font-size:15px">调整积分 / 会员</h3>
        <div class="admin-form-grid">
          <div class="admin-field" style="margin:0">
            <label for="editCredits">永久积分</label>
            <input type="number" id="editCredits" min="0" step="0.1" value="${Number(u.creditsPermanent) || 0}">
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editDaily">当日积分</label>
            <input type="number" id="editDaily" min="0" step="0.1" value="${Number(u.dailyCredits) || 0}">
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editTier">会员档位</label>
            <select id="editTier">
              <option value="" ${!u.membershipTier ? 'selected' : ''}>免费</option>
              <option value="lite" ${u.membershipTier === 'lite' ? 'selected' : ''}>轻量</option>
              <option value="basic" ${u.membershipTier === 'basic' ? 'selected' : ''}>基础</option>
              <option value="standard" ${u.membershipTier === 'standard' ? 'selected' : ''}>标准</option>
              <option value="pro" ${u.membershipTier === 'pro' ? 'selected' : ''}>专业</option>
            </select>
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editUntil">会员到期</label>
            <input type="datetime-local" id="editUntil" value="${esc(toDatetimeLocal(u.membershipUntil))}">
          </div>
        </div>
        <label class="admin-check" style="margin-top:10px"><input type="checkbox" id="editClearQueue"> 清除排队会员</label>
        <div class="admin-form-actions">
          <button type="button" class="admin-btn admin-btn--primary" id="saveUserBtn">保存修改</button>
          <button type="button" class="admin-btn" id="extend30Btn">会员 +30 天</button>
        </div>
        <h3 style="margin:20px 0 10px;font-size:15px;color:var(--danger)">删除账号</h3>
        <p class="admin-hint">会删除 Auth 账号、数据库资料及 card-images 下该用户文件，不可恢复。</p>
        <div class="admin-field">
          <label for="deleteConfirm">输入邮箱 <strong>${esc(u.email || '')}</strong> 确认删除</label>
          <input type="text" id="deleteConfirm" autocomplete="off" placeholder="完整邮箱">
        </div>
        <button type="button" class="admin-btn admin-btn--danger" id="deleteUserBtn">永久删除此用户</button>
      `;

      $('extend30Btn')?.addEventListener('click', () => {
        const untilInput = $('editUntil');
        const base = untilInput?.value ? new Date(untilInput.value) : new Date();
        if (Number.isNaN(base.getTime())) base.setTime(Date.now());
        base.setDate(base.getDate() + 30);
        if (untilInput) untilInput.value = toDatetimeLocal(base.toISOString());
        const tier = $('editTier');
        if (tier && !tier.value) tier.value = 'basic';
      });

      $('saveUserBtn')?.addEventListener('click', () => void saveUser(u));
      $('deleteUserBtn')?.addEventListener('click', () => void deleteUser(u));
    } catch (e) {
      box.innerHTML = '<p class="admin-msg admin-msg--err">' + esc(friendlyFetchError(e)) + '</p>';
    }
  }

  async function saveUser(u) {
    if (!session) return;
    const tier = $('editTier')?.value ?? '';
    const body = {
      credits: Number($('editCredits')?.value),
      dailyCredits: Number($('editDaily')?.value)
    };
    if (tier === '') {
      body.clearMembership = true;
    } else {
      body.membershipTier = tier;
      const until = fromDatetimeLocal($('editUntil')?.value || '');
      if (until) body.membershipUntil = until;
    }
    if ($('editClearQueue')?.checked) body.clearQueuedMembership = true;

    try {
      $('saveUserBtn').disabled = true;
      await adminFetch(session, '/api/admin/users/' + encodeURIComponent(u.userId), {
        method: 'PATCH',
        body
      });
      toast('已保存', true);
      void loadUsers(false);
      void loadDashboard();
      void showUserDetail(u.userId);
    } catch (e) {
      toast(friendlyFetchError(e), false);
    } finally {
      const btn = $('saveUserBtn');
      if (btn) btn.disabled = false;
    }
  }

  async function deleteUser(u) {
    if (!session) return;
    const typed = ($('deleteConfirm')?.value || '').trim();
    if (!u.email || typed !== u.email) {
      toast('请输入完整邮箱以确认删除', false);
      return;
    }
    if (!window.confirm('确定永久删除 ' + u.email + ' ？此操作不可撤销。')) return;

    try {
      $('deleteUserBtn').disabled = true;
      const res = await adminFetch(session, '/api/admin/users/' + encodeURIComponent(u.userId), {
        method: 'DELETE'
      });
      toast('已删除，清理图片 ' + (res.storageFilesRemoved || 0) + ' 个', true);
      closeModal();
      void loadUsers(true);
      void loadDashboard();
    } catch (e) {
      toast(friendlyFetchError(e), false);
      $('deleteUserBtn').disabled = false;
    }
  }

  async function loadCodes(reset) {
    if (!session) return;
    if (reset) codeOffset = 0;
    setCodeCategoryFilter(codeCategory);
    const q = ($('codeSearch')?.value || '').trim().toUpperCase();
    const active = $('codeFilterActive')?.value || '';
    const tbody = $('codeTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
    try {
      let path = `/api/admin/codes?limit=${PAGE}&offset=${codeOffset}`;
      if (q) path += '&q=' + encodeURIComponent(q);
      if (active) path += '&active=' + active;
      if (codeCategory && codeCategory !== 'all') path += '&category=' + encodeURIComponent(codeCategory);
      const data = await adminFetch(session, path);
      $('codePageInfo').textContent = `第 ${codeOffset + 1}–${codeOffset + data.items.length} 条，约 ${data.total} 个码`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((row) => {
          const tierLabel =
            row.membership_tier === 'lite'
              ? '轻量'
              : row.membership_tier === 'basic'
                ? '基础'
                : row.membership_tier === 'standard'
                  ? '标准'
                  : row.membership_tier === 'pro'
                    ? '专业'
                    : row.membership_tier || '';
          const offerLabel =
            row.offer_kind === 'mini_3d'
              ? '¥0.99/3天'
              : row.offer_kind === 'starter_14d'
                ? '¥1.9/14天'
                : '';
          const extra =
            row.membership_tier && row.membership_days
              ? ` + ${row.membership_days}天${tierLabel}`
              : row.membership_days
                ? ` + ${row.membership_days}天会员`
                : '';
          const offerExtra = offerLabel ? ` · ${offerLabel}` : '';
          return `<tr>
            <td><code>${esc(row.code)}</code></td>
            <td>${row.credits}${extra}${offerExtra}</td>
            <td>${row.used_count}/${row.max_uses}</td>
            <td>${row.active ? '<span class="admin-badge admin-badge--ok">启用</span>' : '<span class="admin-badge admin-badge--off">停用</span>'}</td>
            <td>${esc(row.note || '—')}</td>
            <td>
              <button type="button" class="admin-btn" data-toggle-code="${esc(row.code)}" data-active="${row.active ? '0' : '1'}">${row.active ? '停用' : '启用'}</button>
            </td>
          </tr>`;
        })
        .join('');
      tbody.querySelectorAll('[data-toggle-code]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const code = btn.getAttribute('data-toggle-code');
          const active = btn.getAttribute('data-active') === '1';
          try {
            await adminFetch(session, '/api/admin/codes/' + encodeURIComponent(code), {
              method: 'PATCH',
              body: { active }
            });
            void loadCodes(false);
            showMsg($('codeMsg'), '已更新 ' + code, true);
            toast('激活码已更新', true);
          } catch (e) {
            showMsg($('codeMsg'), e.message, false);
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('codeMsg'), e.message, false);
    }
  }

  async function createCodes() {
    if (!session) return;
    const body = {
      count: Number($('codeCount')?.value) || 1,
      credits: Number($('codeCredits')?.value) || 0,
      maxUses: Number($('codeMaxUses')?.value) || 1,
      prefix: ($('codePrefix')?.value || 'PH').trim(),
      note: ($('codeNote')?.value || '').trim() || undefined,
      membershipTier: $('codeTier')?.value || undefined,
      membershipDays: Number($('codeDays')?.value) || undefined
    };
    if (body.membershipTier === '') delete body.membershipTier;
    if (!body.membershipDays) delete body.membershipDays;
    try {
      const data = await adminFetch(session, '/api/admin/codes', { method: 'POST', body });
      $('codeOutput').textContent = (data.codes || []).join('\n');
      showMsg($('codeMsg'), `已生成 ${data.created} 个码`, true);
      toast(`已生成 ${data.created} 个激活码`, true);
      void loadCodes(true);
      void loadDashboard();
    } catch (e) {
      showMsg($('codeMsg'), e.message, false);
    }
  }

  let imageModelSettings = null;
  let imageModelRows = [];
  let apimartCostReference = [];
  let apimartCostFamilyFilter = 'all';
  let grsaiCostReference = [];
  let grsaiCostFamilyFilter = 'all';
  let modelFamilyFilter = 'all';
  let modelProviderFilter = 'all';
  let modelStatusFilter = 'all';

  const MODEL_UI_FAMILY_LABEL = {
    gim2: '全能2',
    banana: '香蕉',
    jimeng: '即梦',
    midjourney: 'MJ',
    wan: '万相',
    flux: 'Flux'
  };

  const MODEL_PROVIDER_BADGE = {
    grsai: '<span class="admin-badge admin-badge--ok">常规</span>',
    apimart: '<span class="admin-badge admin-badge--warn">备用</span>',
    ithink: '<span class="admin-badge">经济</span>',
    mooko: '<span class="admin-badge">慢速</span>'
  };

  function formatAdminRmbYuan(rmb) {
    const v = Number(rmb);
    if (!Number.isFinite(v) || v <= 0) return '¥0';
    if (v >= 1) return `¥${v.toFixed(2)}`;
    if (v >= 0.1) return `¥${v.toFixed(2)}`;
    return `¥${v.toFixed(3)}`;
  }

  function buildCostReferenceFromModelRows(rows) {
    return rows
      .filter((r) => r.provider === 'apimart' && Array.isArray(r.upstreamCostLines) && r.upstreamCostLines.length)
      .map((r) => ({
        id: r.id,
        label: r.label,
        uiFamily: MODEL_UI_FAMILY_LABEL[r.uiFamily] || r.uiFamily || '—',
        uiFamilyKey: r.uiFamily || 'other',
        functionLabel: r.pricingBySpeed ? '文生图/图生图' : '文生图',
        lines: r.upstreamCostLines
      }));
  }

  function filteredApimartCostReference() {
    if (apimartCostFamilyFilter === 'all') return apimartCostReference;
    return apimartCostReference.filter((row) => row.uiFamilyKey === apimartCostFamilyFilter);
  }

  function filteredGrsaiCostReference() {
    if (grsaiCostFamilyFilter === 'all') return grsaiCostReference;
    return grsaiCostReference.filter((row) => row.uiFamilyKey === grsaiCostFamilyFilter);
  }

  function renderGrsaiCostReference() {
    const tbody = $('grsaiCostTableBody');
    if (!tbody) return;
    const rows = filteredGrsaiCostReference();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">当前筛选无成本数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .flatMap((row) =>
        (row.lines || []).map((line) =>
          `<tr>
            <td>${esc(row.uiFamily)}</td>
            <td><code>${esc(row.id)}</code><br>${esc(row.label)}</td>
            <td>${esc(row.functionLabel)}</td>
            <td>${esc(line.label)}</td>
            <td>${esc(String(line.points))}</td>
            <td><strong>${esc(formatAdminRmbYuan(line.rmb))}</strong></td>
          </tr>`
        )
      )
      .join('');
  }

  function renderApimartCostReference() {
    const tbody = $('apimartCostTableBody');
    if (!tbody) return;
    const rows = filteredApimartCostReference();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5">当前筛选无成本数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .flatMap((row) =>
        (row.lines || []).map((line) =>
          `<tr>
            <td>${esc(row.uiFamily)}</td>
            <td><code>${esc(row.id)}</code><br>${esc(row.label)}</td>
            <td>${esc(row.functionLabel)}</td>
            <td>${esc(line.label)}</td>
            <td><strong>${esc(formatAdminRmbYuan(line.rmb ?? line.creditsCost))}</strong></td>
          </tr>`
        )
      )
      .join('');
  }

  function filteredModelRows() {
    return imageModelRows.filter((row) => {
      if (modelFamilyFilter !== 'all' && row.uiFamily !== modelFamilyFilter) return false;
      if (modelProviderFilter !== 'all' && row.provider !== modelProviderFilter) return false;
      if (modelStatusFilter !== 'all' && row.status !== modelStatusFilter) return false;
      return true;
    });
  }

  function effectiveModelCredits(row, resolution, speed) {
    const disc = Number(row.discountPercent) || 100;
    const globalDisc = Number($('modelsGlobalDiscount')?.value) || 100;
    let base = Number(row.creditsPerCall) || 0;
    if (row.pricingBySpeed && speed && row.creditsBySpeed?.[speed] != null) {
      base = Number(row.creditsBySpeed[speed]) || 0;
    } else if (row.pricingByResolution && resolution && row.creditsByResolution?.[resolution] != null) {
      base = Number(row.creditsByResolution[resolution]) || 0;
    }
    const raw = (base * disc * globalDisc) / 10000;
    return Math.max(0.1, Math.round(raw * 10) / 10);
  }

  function formatAdminCredits(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function isMjPricingRow(row) {
    return row.pricingBySpeed === true || String(row.id || '').startsWith('apimart-mj-');
  }

  function ensureMjCreditsBySpeed(row) {
    if (!isMjPricingRow(row)) return row;
    row.pricingBySpeed = true;
    if (!row.creditsBySpeed || typeof row.creditsBySpeed !== 'object') {
      row.creditsBySpeed = {};
    }
    const flat = Number(row.creditsPerCall);
    for (const speed of ['relax', 'fast', 'turbo']) {
      if (row.creditsBySpeed[speed] == null || row.creditsBySpeed[speed] === '') {
        if (Number.isFinite(flat) && flat > 0) row.creditsBySpeed[speed] = flat;
      }
    }
    return row;
  }

  function syncModelRowsFromDom() {
    const tbody = $('modelsTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
      const row = imageModelRows.find((r) => r.id === tr.dataset.modelId);
      if (!row) return;
      tr.querySelectorAll('input, select').forEach((inp) => {
        const field = inp.dataset.field;
        if (!field) return;
        if (field === 'displayName') row.displayName = inp.value;
        if (field === 'status') row.status = inp.value;
        if (field === 'fixedPrice') row.fixedPrice = inp.checked;
        if (field === 'refundOnViolation') row.refundOnViolation = inp.checked;
        if (field === 'memberCap') {
          const v = inp.value.trim();
          row.memberDiscountCapPercent = v === '' ? null : Number(v) || null;
        }
        if (field === 'sortOrder') row.sortOrder = Number(inp.value) || row.sortOrder;
        if (field === 'discount') row.discountPercent = Number(inp.value) || 100;
        if (field === 'credits') row.creditsPerCall = Number(inp.value) || row.creditsPerCall;
        if (field.startsWith('credits-speed-')) {
          const speed = field.slice('credits-speed-'.length);
          if (!row.creditsBySpeed) row.creditsBySpeed = {};
          const n = Number(inp.value);
          if (Number.isFinite(n) && n > 0) row.creditsBySpeed[speed] = n;
        }
        if (field.startsWith('credits-') && !field.startsWith('credits-speed-')) {
          const res = field.slice('credits-'.length);
          if (!row.creditsByResolution) row.creditsByResolution = {};
          const n = Number(inp.value);
          if (Number.isFinite(n) && n > 0) row.creditsByResolution[res] = n;
        }
      });
      ensureMjCreditsBySpeed(row);
    });
  }

  function renderModelCreditsInputs(row) {
    ensureMjCreditsBySpeed(row);
    if (isMjPricingRow(row)) {
      const speeds = [
        { key: 'relax', label: 'Relax' },
        { key: 'fast', label: 'Fast' },
        { key: 'turbo', label: 'Turbo' }
      ];
      if (!row.creditsBySpeed) row.creditsBySpeed = {};
      return speeds
        .map(
          (s) =>
            `<label class="admin-res-price"><span>${s.label}</span><input type="number" class="admin-input-sm" data-field="credits-speed-${s.key}" min="0.1" max="99999" step="0.1" value="${row.creditsBySpeed[s.key] ?? ''}"></label>`
        )
        .join('');
    }
    if (row.pricingByResolution) {
      const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) =>
        ['1k', '2k', '4k'].includes(r)
      );
      if (!row.creditsByResolution) row.creditsByResolution = {};
      return resList
        .map(
          (res) =>
            `<label class="admin-res-price"><span>${res.toUpperCase()}</span><input type="number" class="admin-input-sm" data-field="credits-${res}" min="0.1" max="99999" step="0.1" value="${row.creditsByResolution[res] ?? ''}"></label>`
        )
        .join('');
    }
    return `<input type="number" class="admin-input-sm" data-field="credits" min="0.1" max="99999" step="0.1" value="${row.creditsPerCall}">`;
  }

  function renderModelEffectiveCell(row) {
    ensureMjCreditsBySpeed(row);
    if (isMjPricingRow(row)) {
      return ['relax', 'fast', 'turbo']
        .map((s) => `${s} ${formatAdminCredits(effectiveModelCredits(row, '1k', s))}`)
        .join('<br>');
    }
    if (row.pricingByResolution) {
      const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) =>
        ['1k', '2k', '4k'].includes(r)
      );
      return resList
        .map((res) => `${res.toUpperCase()} ${formatAdminCredits(effectiveModelCredits(row, res))}`)
        .join('<br>');
    }
    return formatAdminCredits(effectiveModelCredits(row));
  }

  const MODEL_STATUS_OPTS = [
    { value: 'active', label: '上架' },
    { value: 'maintenance', label: '维护中' },
    { value: 'offline', label: '下架' }
  ];

  function normalizeModelRow(row, index) {
    const status =
      row.status === 'maintenance' || row.status === 'offline' || row.status === 'active'
        ? row.status
        : row.enabled === false
          ? 'offline'
          : 'active';
    return {
      ...row,
      displayName: row.displayName || row.displayLabel || row.label || '',
      status,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10,
      creditsPerCall: row.creditsPerCall,
      creditsByResolution: row.creditsByResolution || null,
      creditsBySpeed: row.creditsBySpeed || null,
      pricingByResolution: row.pricingByResolution === true,
      pricingBySpeed: isMjPricingRow(row),
      uiFamily: row.uiFamily || 'gim2',
      discountPercent: row.discountPercent ?? 100,
      fixedPrice: row.fixedPrice === true,
      memberDiscountCapPercent:
        row.memberDiscountCapPercent != null && row.memberDiscountCapPercent !== ''
          ? Number(row.memberDiscountCapPercent)
          : null,
      refundOnViolation: row.refundOnViolation !== false
    };
  }

  function sortModelRowsInPlace() {
    imageModelRows.sort(
      (a, b) => a.sortOrder - b.sortOrder || String(a.label).localeCompare(String(b.label), 'zh-CN')
    );
  }

  function moveModelRow(modelId, delta) {
    sortModelRowsInPlace();
    const idx = imageModelRows.findIndex((r) => r.id === modelId);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= imageModelRows.length) return;
    const tmp = imageModelRows[idx].sortOrder;
    imageModelRows[idx].sortOrder = imageModelRows[next].sortOrder;
    imageModelRows[next].sortOrder = tmp;
    sortModelRowsInPlace();
    renderModelsTable();
  }

  function renderUpstreamCostCell(row) {
    if (row.upstreamCostText) {
      return String(row.upstreamCostText)
        .split('\n')
        .map((line) => esc(line))
        .join('<br>');
    }
    if (row.provider === 'grsai' && row.upstreamPoints) {
      return esc(String(row.upstreamPoints));
    }
    return '—';
  }

  function renderModelsTable() {
    const tbody = $('modelsTableBody');
    if (!tbody) return;
    const rows = filteredModelRows();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="14">当前筛选无模型</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const providerBadge = MODEL_PROVIDER_BADGE[row.provider] || MODEL_PROVIDER_BADGE.grsai;
        const familyLabel = MODEL_UI_FAMILY_LABEL[row.uiFamily] || row.uiFamily || '—';
        const statusOpts = MODEL_STATUS_OPTS.map(
          (o) =>
            `<option value="${o.value}"${row.status === o.value ? ' selected' : ''}>${o.label}</option>`
        ).join('');
        const refundCell = `<label class="admin-check" title="取消勾选=违规不返还积分"><input type="checkbox" data-field="refundOnViolation" ${row.refundOnViolation !== false ? 'checked' : ''}> 返还</label>`;
        return `<tr data-model-id="${esc(row.id)}">
          <td class="admin-model-sort">
            <div class="admin-model-sort__btns">
              <button type="button" class="admin-btn" data-move-up="${esc(row.id)}" title="上移">↑</button>
              <button type="button" class="admin-btn" data-move-down="${esc(row.id)}" title="下移">↓</button>
            </div>
            <input type="number" class="admin-input-sm" data-field="sortOrder" min="0" max="9999" value="${row.sortOrder}" title="数字越小越靠前">
          </td>
          <td>${esc(familyLabel)}</td>
          <td>${providerBadge}</td>
          <td><code>${esc(row.id)}</code><br><span class="admin-hint">${esc(row.label)} · ${esc(row.description || '')}</span></td>
          <td><input type="text" class="admin-input-sm" data-field="displayName" maxlength="48" value="${esc(row.displayName)}" placeholder="${esc(row.label)}"></td>
          <td><select class="admin-input-sm" data-field="status">${statusOpts}</select></td>
          <td class="admin-upstream-cost">${renderUpstreamCostCell(row)}</td>
          <td>${refundCell}</td>
          <td>${esc((row.resolutions || []).join(' / ') || '—')}</td>
          <td>${renderModelCreditsInputs(row)}</td>
          <td><input type="number" class="admin-input-sm" data-field="discount" min="1" max="100" value="${row.discountPercent ?? 100}"></td>
          <td class="model-effective">${renderModelEffectiveCell(row)}</td>
          <td><label class="admin-check"><input type="checkbox" data-field="fixedPrice" ${row.fixedPrice ? 'checked' : ''}> 固定</label></td>
          <td><input type="number" class="admin-input-sm" data-field="memberCap" min="1" max="100" placeholder="不限" value="${row.memberDiscountCapPercent != null ? row.memberDiscountCapPercent : ''}" title="会员至少付售价的百分之几"></td>
        </tr>`;
      })
      .join('');
    tbody.querySelectorAll('[data-move-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveModelRow(btn.getAttribute('data-move-up'), -1));
    });
    tbody.querySelectorAll('[data-move-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveModelRow(btn.getAttribute('data-move-down'), 1));
    });
    tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
      const row = imageModelRows.find((r) => r.id === tr.dataset.modelId);
      if (!row) return;
      tr.querySelectorAll('input, select').forEach((inp) => {
        const handler = () => {
          if (inp.dataset.field === 'displayName') row.displayName = inp.value;
          if (inp.dataset.field === 'status') row.status = inp.value;
          if (inp.dataset.field === 'fixedPrice') row.fixedPrice = inp.checked;
          if (inp.dataset.field === 'refundOnViolation') row.refundOnViolation = inp.checked;
          if (inp.dataset.field === 'memberCap') {
            const v = inp.value.trim();
            row.memberDiscountCapPercent = v === '' ? null : Number(v) || null;
          }
          if (inp.dataset.field === 'sortOrder') {
            row.sortOrder = Number(inp.value) || row.sortOrder;
            sortModelRowsInPlace();
            renderModelsTable();
            return;
          }
          if (inp.dataset.field === 'credits') row.creditsPerCall = Number(inp.value) || row.creditsPerCall;
          if (inp.dataset.field?.startsWith('credits-speed-')) {
            const speed = inp.dataset.field.slice('credits-speed-'.length);
            if (!row.creditsBySpeed) row.creditsBySpeed = {};
            row.creditsBySpeed[speed] = Number(inp.value) || row.creditsBySpeed[speed];
          }
          if (inp.dataset.field?.startsWith('credits-')) {
            const res = inp.dataset.field.slice('credits-'.length);
            if (res === 'speed-relax' || res === 'speed-fast' || res === 'speed-turbo') return;
            if (!row.creditsByResolution) row.creditsByResolution = {};
            row.creditsByResolution[res] = Number(inp.value) || row.creditsByResolution[res];
          }
          if (inp.dataset.field === 'discount') row.discountPercent = Number(inp.value) || 100;
          const eff = tr.querySelector('.model-effective');
          if (eff) eff.innerHTML = renderModelEffectiveCell(row);
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
    });
  }

  async function loadImageModels() {
    if (!session) return;
    const tbody = $('modelsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="14">加载中…</td></tr>';
    try {
      const data = await adminFetch(session, '/api/admin/image-models');
      imageModelSettings = data.settings || { globalDiscountPercent: 100, models: {} };
      imageModelRows = (data.models || []).map((row, i) => ensureMjCreditsBySpeed(normalizeModelRow(row, i)));
      sortModelRowsInPlace();
      apimartCostReference =
        (data.apimartCostReference && data.apimartCostReference.length
          ? data.apimartCostReference
          : null) || buildCostReferenceFromModelRows(imageModelRows);
      grsaiCostReference = data.grsaiCostReference || [];
      const warn = $('modelsPersistWarn');
      if (warn) {
        const hint = data.settingsHint || '';
        if (hint) {
          warn.textContent = hint;
          warn.hidden = false;
          warn.className = data.settingsTableReady
            ? 'admin-msg admin-msg--warn'
            : 'admin-msg admin-msg--err';
        } else {
          warn.hidden = true;
          warn.textContent = '';
        }
      }
      if ($('modelsGlobalDiscount')) {
        $('modelsGlobalDiscount').value = String(imageModelSettings.globalDiscountPercent || 100);
      }
      renderGrsaiCostReference();
      renderApimartCostReference();
      renderModelsTable();
      showMsg(
        $('modelsMsg'),
        data.settingsPersisted ? '' : data.settingsTableReady ? '尚未保存过，改完请点保存' : '',
        true
      );
    } catch (e) {
      if (tbody) tbody.innerHTML = '';
      showMsg($('modelsMsg'), friendlyFetchError(e), false);
    }
  }

  async function saveImageModels() {
    if (!session) return;
    const btn = $('modelsSaveBtn');
    syncModelRowsFromDom();
    sortModelRowsInPlace();
    const models = {};
    imageModelRows.forEach((row, index) => {
      ensureMjCreditsBySpeed(row);
      const displayName = String(row.displayName || '').trim();
      const patch = {
        status: row.status || 'active',
        sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10,
        discountPercent: Number(row.discountPercent) || 100,
        fixedPrice: !!row.fixedPrice
      };
      if (row.pricingByResolution && row.creditsByResolution) {
        patch.creditsByResolution = {};
        for (const [res, val] of Object.entries(row.creditsByResolution)) {
          if (val != null && val !== '') patch.creditsByResolution[res] = Number(val) || 0;
        }
      } else if (isMjPricingRow(row)) {
        patch.creditsBySpeed = {};
        const speeds = ['relax', 'fast', 'turbo'];
        const fallback = Number(row.creditsPerCall) || 8;
        for (const speed of speeds) {
          const raw = row.creditsBySpeed?.[speed];
          const n = Number(raw);
          patch.creditsBySpeed[speed] = Number.isFinite(n) && n > 0 ? n : fallback;
        }
      } else {
        patch.creditsPerCall = Number(row.creditsPerCall) || 10;
      }
      if (displayName) patch.displayName = displayName;
      if (row.memberDiscountCapPercent != null && Number.isFinite(Number(row.memberDiscountCapPercent))) {
        patch.memberDiscountCapPercent = Number(row.memberDiscountCapPercent);
      }
      patch.refundOnViolation = row.refundOnViolation !== false;
      models[row.id] = patch;
    });
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中…';
      }
      const body = {
        globalDiscountPercent: Number($('modelsGlobalDiscount')?.value) || 100,
        models
      };
      let data;
      try {
        data = await adminFetch(session, '/api/admin/image-models', { method: 'PUT', body });
      } catch (putErr) {
        if (!/failed to fetch|networkerror|load failed/i.test(String(putErr?.message || ''))) {
          throw putErr;
        }
        data = await adminFetch(session, '/api/admin/image-models/save', { method: 'POST', body });
      }
      imageModelSettings = data.settings;
      imageModelRows = (data.models || imageModelRows).map((row, i) =>
        ensureMjCreditsBySpeed(normalizeModelRow(row, i))
      );
      sortModelRowsInPlace();
      const warn = $('modelsPersistWarn');
      if (warn) {
        if (data.settingsPersisted === false) {
          warn.textContent =
            '保存请求已发出，但数据库仍未读到配置。请在 Supabase 执行 site_settings 迁移 SQL 后重试。';
          warn.hidden = false;
        } else {
          warn.hidden = true;
        }
      }
      renderModelsTable();
      showMsg($('modelsMsg'), '定价、排序与防亏本规则已保存', true);
      toast('生图模型配置已保存', true);
    } catch (e) {
      showMsg($('modelsMsg'), friendlyFetchError(e), false);
      toast(friendlyFetchError(e), false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存全部定价';
      }
    }
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function submitAdminLogin() {
    const btn = $('loginBtn');
    const secret = $('adminSecret')?.value?.trim();
    if (!secret) {
      showMsg($('loginMsg'), '请填写访问密钥', false);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = '验证中…';
    }
    session = { secret, apiBase: resolveApiBase() };
    try {
      await adminFetch(session, '/api/admin/dashboard/infra', { timeoutMs: 20000 });
      saveSession(session);
      updateAdminApiChip();
      const sub = $('adminPageSubtitle');
      if (sub) sub.textContent = `API：${apiBase(session)} · 用户、存储、运行环境一览`;
      showApp(true);
      showMsg($('loginMsg'), '', true);
      document.querySelector('.admin-tab[data-tab="overview"]')?.click();
    } catch (e) {
      session = null;
      clearSession();
      showApp(false);
      showMsg($('loginMsg'), friendlyFetchError(e), false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.textContent = '登录';
      }
    }
  }

  async function validateStoredSession() {
    if (!session?.secret) return;
    try {
      await adminFetch(session, '/api/admin/dashboard/infra', { timeoutMs: 12000 });
      showApp(true);
    } catch (e) {
      const msg = String(e?.message || e || '');
      const authFailed =
        e?.status === 401 ||
        e?.code === 'UNAUTHORIZED' ||
        /UNAUTHORIZED|管理员密钥无效/i.test(msg);
      if (!authFailed) {
        showApp(true);
        toast('API 暂时不可用，登录状态已保留。' + friendlyFetchError(e), false, 9000);
        return;
      }
      clearSession();
      session = null;
      showApp(false);
      showMsg($('loginMsg'), '登录已过期，请重新输入密钥', false);
    }
  }

  function init() {
    try {
    syncAdminBuildLabels();
    bindTabs();
    setupAdminConfirmModal();
    setupCommunityPanelActions();
    showApp(!!session?.secret);
    updateAdminApiChip();

    $('adminRefreshBtn')?.addEventListener('click', () => {
      const btn = $('adminRefreshBtn');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('is-busy');
      }
      Promise.resolve(refreshCurrentTab()).finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-busy');
        }
        toast('已刷新', true, 1800);
      });
    });

    $('loginBtn')?.addEventListener('click', () => { void submitAdminLogin(); });
    $('adminSecret')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submitAdminLogin();
      }
    });

    $('adminShowSecret')?.addEventListener('change', (e) => {
      const input = $('adminSecret');
      if (input) input.type = e.target.checked ? 'text' : 'password';
    });

    $('logoutBtn')?.addEventListener('click', () => {
      clearSession();
      session = null;
      showApp(false);
    });

    $('userSearchBtn')?.addEventListener('click', () => void loadUsers(true));
    $('userSearchClear')?.addEventListener('click', () => {
      const input = $('userSearch');
      if (input) input.value = '';
      void loadUsers(true);
    });
    $('userSearch')?.addEventListener('focus', () => {
      const input = $('userSearch');
      if (input?.value && /@/.test(input.value)) input.value = '';
    });
    let searchTimer = 0;
    $('userSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadUsers(true), 400);
    });
    $('userSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void loadUsers(true);
    });
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    $('userPrev')?.addEventListener('click', () => {
      userOffset = Math.max(0, userOffset - PAGE);
      void loadUsers(false);
    });
    $('userNext')?.addEventListener('click', () => {
      userOffset += PAGE;
      void loadUsers(false);
    });

    $('codeSearchBtn')?.addEventListener('click', () => void loadCodes(true));
    $('codeFilterActive')?.addEventListener('change', () => void loadCodes(true));
    $('codePrev')?.addEventListener('click', () => {
      codeOffset = Math.max(0, codeOffset - PAGE);
      void loadCodes(false);
    });
    $('codeNext')?.addEventListener('click', () => {
      codeOffset += PAGE;
      void loadCodes(false);
    });
    $('createCodeBtn')?.addEventListener('click', () => void createCodes());
    $('modelsSaveBtn')?.addEventListener('click', () => void saveImageModels());
    $('modelsGlobalDiscount')?.addEventListener('input', () => renderModelsTable());
    document.getElementById('panel-models')?.addEventListener('click', (e) => {
      const grsaiFamBtn = e.target.closest('[data-grsai-cost-family]');
      if (grsaiFamBtn) {
        grsaiCostFamilyFilter = grsaiFamBtn.getAttribute('data-grsai-cost-family') || 'all';
        $('grsaiCostFamilyTabs')?.querySelectorAll('[data-grsai-cost-family]').forEach((b) => {
          b.classList.toggle('is-active', b === grsaiFamBtn);
        });
        renderGrsaiCostReference();
        return;
      }
      const costFamBtn = e.target.closest('[data-apimart-cost-family]');
      if (costFamBtn) {
        apimartCostFamilyFilter = costFamBtn.getAttribute('data-apimart-cost-family') || 'all';
        $('apimartCostFamilyTabs')?.querySelectorAll('[data-apimart-cost-family]').forEach((b) => {
          b.classList.toggle('is-active', b === costFamBtn);
        });
        renderApimartCostReference();
        return;
      }
      const famBtn = e.target.closest('[data-model-family]');
      if (famBtn) {
        modelFamilyFilter = famBtn.getAttribute('data-model-family') || 'all';
        $('modelFamilyTabs')?.querySelectorAll('[data-model-family]').forEach((b) => {
          b.classList.toggle('is-active', b === famBtn);
        });
        renderModelsTable();
        return;
      }
      const provBtn = e.target.closest('[data-model-provider]');
      if (provBtn) {
        modelProviderFilter = provBtn.getAttribute('data-model-provider') || 'all';
        $('modelProviderTabs')?.querySelectorAll('[data-model-provider]').forEach((b) => {
          b.classList.toggle('is-active', b === provBtn);
        });
        renderModelsTable();
        return;
      }
      const statusBtn = e.target.closest('[data-model-status]');
      if (statusBtn) {
        modelStatusFilter = statusBtn.getAttribute('data-model-status') || 'all';
        $('modelStatusTabs')?.querySelectorAll('[data-model-status]').forEach((b) => {
          b.classList.toggle('is-active', b === statusBtn);
        });
        renderModelsTable();
      }
    });

    $('communitySearchBtn')?.addEventListener('click', () => void loadCommunity(true));
    $('communitySearchClear')?.addEventListener('click', () => {
      const input = $('communitySearch');
      if (input) input.value = '';
      void loadCommunity(true);
    });
    $('communitySearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void loadCommunity(true);
    });
    $('communityPrev')?.addEventListener('click', () => {
      if (communityView === 'bucket-orphans') {
        communityOffset = Math.max(0, communityOffset - bucketOrphanPageSize());
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      } else {
        communityOffset = Math.max(0, communityOffset - PAGE);
        void loadCommunity(false);
      }
    });
    $('communityNext')?.addEventListener('click', () => {
      if (communityView === 'bucket-orphans') {
        communityOffset += bucketOrphanPageSize();
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      } else {
        communityOffset += PAGE;
        void loadCommunity(false);
      }
    });
    $('communityBucketPageGoBtn')?.addEventListener('click', () => {
      jumpBucketOrphanPage($('communityBucketPageInput')?.value);
    });
    $('communityBucketPageInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') jumpBucketOrphanPage(e.target.value);
    });
    $('communityBucketPageSize')?.addEventListener('change', (e) => {
      communityBucketPageSize = Number(e.target.value) || 50;
      communityOffset = 0;
      communityBucketSelected.clear();
      if (communityView === 'bucket-orphans') void loadBucketOrphansPage({ reset: false, forceRefresh: false });
    });
    $('communityPurgeBtn')?.addEventListener('click', () =>
      void runCommunityPurge($('communityPurgeBtn'), null, $('communityMsg'))
    );
    $('communityPurgePreviewBtn')?.addEventListener('click', async () => {
      if (!session) return;
      const btn = $('communityPurgePreviewBtn');
      try {
        await runCommunityAdminTask({
          btn,
          confirmTitle: '预览清理',
          confirmText: '将扫描所有在线帖（约 1～2 分钟），统计会被「清理无效帖」下架的数量，不修改任何数据。继续？',
          progressText: '正在扫描待清理帖…',
          msgEl: $('communityMsg'),
          request: () =>
            adminFetch(session, '/api/admin/community/purge-ghosts/preview', { timeoutMs: 180000 }),
          onSuccess: (r) =>
            `预览：将下架 ${r.total || 0} 条（删卡孤儿 ${r.orphans || 0}，无图/无效 ${r.missing || 0}，重复 ${r.duplicates || 0}）。「卡片库无」${r.libraryMissing ?? '—'} 条请用「写回卡片库」，清理不会写回。`
        });
      } catch (e) { /* toast handled */ }
    });
    $('communityBatchUnpublishBtn')?.addEventListener('click', () => void runBatchCommunityAction('unpublish'));
    $('communityBatchDeleteBtn')?.addEventListener('click', () => void runBatchCommunityAction('delete'));
    document.querySelectorAll('[data-community-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        communityView = btn.getAttribute('data-community-view') || 'published';
        communitySelected.clear();
        communityBucketSelected.clear();
        stopBucketOrphanPoll();
        if (communityView !== 'bucket-orphans') {
          communityBucketScanMeta = null;
          communityBucketPollStarted = 0;
        }
        void loadCommunity(true);
      });
    });
    document.querySelectorAll('[data-bucket-risk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setBucketRiskFilter(btn.getAttribute('data-bucket-risk') || 'all');
        communityOffset = 0;
        communityBucketSelected.clear();
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      });
    });
    $('communityBucketRescanBtn')?.addEventListener('click', () => {
      communityBucketScanMeta = null;
      communityBucketForceRefresh = true;
      communityBucketPollStarted = Date.now();
      communityBucketSelected.clear();
      void loadBucketOrphansPage({ reset: true, forceRefresh: true });
    });
    document.querySelectorAll('[data-code-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCodeCategoryFilter(btn.getAttribute('data-code-category') || 'all');
        void loadCodes(true);
      });
    });
    $('communityBucketDeleteSelectedBtn')?.addEventListener('click', async () => {
      toast('批量删除已暂停：此前扫描有误删风险。请逐条核对后再删，或联系维护人员。', false);
      return;
      if (!session || !communityBucketSelected.size) return;
      const groups = communityBucketItems.filter((g) => communityBucketSelected.has(g.id));
      const risky = groups.filter((g) => g.risk && g.risk !== 'safe');
      if (risky.length) {
        toast(`已选 ${risky.length} 组非「高置信」条目，建议先点恢复再删`, false);
        return;
      }
      const paths = groups.flatMap((g) => g.paths || [g.path]);
      if (paths.length > 50) {
        toast('单次最多删除 50 个物理文件，请减少勾选数量', false);
        return;
      }
      const btn = $('communityBucketDeleteSelectedBtn');
      try {
        await runCommunityAdminTask({
          btn,
          confirmTitle: '删除选中的孤儿文件',
          confirmText: `删除已勾选的 ${groups.length} 组（共 ${paths.length} 个物理文件）？\n\n请确认预览图不是仍在使用的卡片。\n\n不可恢复。`,
          confirmDanger: true,
          progressText: `正在删除 ${paths.length} 个文件…`,
          msgEl: $('communityMsg'),
          request: () => adminFetch(session, '/api/admin/community/bucket-orphans/delete', {
            method: 'POST',
            body: { paths },
            timeoutMs: 120000
          }),
          onSuccess: (r) => {
            removeBucketOrphanGroups(paths);
            groups.forEach((g) => communityBucketSelected.delete(g.id));
            updateBucketOrphanBatchUi();
            return `已删 ${r.removed || 0} 个（R2 ${r.r2Removed || 0}）`;
          }
        });
      } catch (e) { /* toast handled */ }
    });

    if (session?.secret) {
      const sub = $('adminPageSubtitle');
      if (sub) sub.textContent = `API：${apiBase(session)} · 正在验证登录…`;
      setPageTitle('overview');
      void validateStoredSession().then(() => {
        if (session?.secret) {
          document.querySelector('.admin-tab[data-tab="overview"]')?.click();
        }
      });
    }
    } catch (e) {
      console.error('[admin] init failed', e);
      showApp(false);
      showMsg($('loginMsg'), '控制台脚本加载异常，请强刷页面（Ctrl+Shift+R）', false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
