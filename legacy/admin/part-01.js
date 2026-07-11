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
        ? '保存后读不到数据：请确认 Worker 的 SUPABASE_URL 与 SQL 编辑器是同一个 MemFire 项目'
        : msg.includes('PERMISSION')
          ? '无写入权限：请在 MemFire SQL 编辑器执行 supabase/migrations/20260602200000_site_settings_grants.sql'
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
    if (bar) bar.classList.toggle('hidden', communityView !== 'bucket-orphans');
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
