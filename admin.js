(function () {
  const LS_KEY = 'ph_admin_session_v1';

  function $(id) {
    return document.getElementById(id);
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
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
    const prodByHost = {
      'prompt-hub.cn': 'https://api.prompt-hub.cn',
      'www.prompt-hub.cn': 'https://api.prompt-hub.cn',
      'prompt-hub-hub.pages.dev': 'https://api.prompt-hub.cn',
      'prompt-hub-web.pages.dev': 'https://api.prompt-hub.cn'
    };
    if (prodByHost[host]) return prodByHost[host];
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8787';
    return 'https://api.prompt-hub.cn';
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
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return '无法连接服务器，请检查网络后重试';
    }
    return msg || '请求失败';
  }

  async function adminFetch(session, path, opts) {
    const url = apiBase(session) + path;
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Secret': encodeAdminSecret(session.secret)
    };
    const res = await fetch(url, {
      method: opts?.method || 'GET',
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const msg = json?.error?.message || res.statusText || '请求失败';
      const code = json?.error?.code || '';
      throw new Error(code ? `${msg} (${code})` : msg);
    }
    return json.data;
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
  function toast(text, ok) {
    const el = $('adminToast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'admin-toast ' + (ok ? 'is-ok' : 'is-err');
    if (text) toastTimer = setTimeout(() => (el.hidden = true), 3200);
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
  const PAGE = 20;

  function showApp(loggedIn) {
    $('adminLogin').hidden = loggedIn;
    $('adminApp').hidden = !loggedIn;
  }

  function bindTabs() {
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach((b) => b.classList.remove('is-active'));
        document.querySelectorAll('.admin-panel').forEach((p) => (p.hidden = true));
        btn.classList.add('is-active');
        const panel = $('panel-' + btn.dataset.tab);
        if (panel) panel.hidden = false;
        if (btn.dataset.tab === 'overview') void loadDashboard();
        if (btn.dataset.tab === 'users') void loadUsers(true);
        if (btn.dataset.tab === 'codes') void loadCodes(true);
      });
    });
  }

  async function loadDashboard() {
    const el = $('dashStats');
    if (!el || !session) return;
    el.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
    void loadDashboardStorage();
    try {
      const d = await adminFetch(session, '/api/admin/dashboard');
      const tier = d.membersByTier || {};
      el.innerHTML = `
        <div class="admin-stat"><span>注册用户</span><strong>${d.usersTotal}</strong></div>
        <div class="admin-stat"><span>有效会员</span><strong>${d.membersActive}</strong></div>
        <div class="admin-stat"><span>永久积分合计</span><strong>${d.totalPermanentCredits}</strong></div>
        <div class="admin-stat"><span>登记存储合计</span><strong>${formatBytes(d.totalStorageBytes)}</strong></div>
        <div class="admin-stat"><span>可用激活码</span><strong>${d.codesActive}</strong></div>
        <div class="admin-stat"><span>累计兑换</span><strong>${d.redemptionsTotal}</strong></div>
        <div class="admin-stat"><span>轻/基/标/专</span><strong>${tier.lite || 0} / ${tier.basic || 0} / ${tier.standard || 0} / ${tier.pro || 0}</strong></div>
      `;
      showMsg($('dashMsg'), '', true);
    } catch (e) {
      el.innerHTML = '';
      showMsg($('dashMsg'), friendlyFetchError(e), false);
    }
  }

  async function loadDashboardStorage() {
    const hint = $('dashStorageHint');
    const body = $('dashStorageBody');
    if (!session || !hint || !body) return;
    hint.textContent = '正在扫描 card-images 桶（文件较多时约需几秒）…';
    body.hidden = true;
    try {
      const s = await adminFetch(session, '/api/admin/dashboard/storage');
      hint.textContent = s.bucketScanTruncated
        ? '已扫描前 ' + s.bucketFileCount + ' 个文件（数量过多，结果为估算下限）'
        : 'card-images 桶共 ' + s.bucketFileCount + ' 个文件';
      const pct = s.storageUsedPercent || 0;
      const warn = pct >= 85 ? ' is-warn' : '';
      body.innerHTML = `
        <div class="admin-progress" title="文件存储 ${pct}%"><div class="admin-progress__bar${warn}" style="width:${pct}%"></div></div>
        <div class="admin-kv">
          <div><span>桶内已用</span><strong>${esc(s.bucketLabel)}</strong></div>
          <div><span>配额（约）</span><strong>${esc(s.storageQuotaLabel)}</strong></div>
          <div><span>剩余（约）</span><strong>${esc(s.storageRemainingLabel)}</strong></div>
          <div><span>用户登记合计</span><strong>${esc(s.registeredLabel)}</strong></div>
          <div><span>数据库配额</span><strong>${esc(s.dbQuotaLabel)}</strong></div>
        </div>
        <p class="admin-hint" style="margin-top:10px">${esc(s.dbNote)}。精确用量：Supabase 控制台 → Project Settings → Usage。</p>
      `;
      body.hidden = false;
    } catch (e) {
      hint.textContent = '存储扫描失败：' + friendlyFetchError(e);
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
          const cards =
            u.cardLimit == null ? '会员不限' : `≤${u.cardLimit} 张`;
          return `<tr>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.displayName || '—')}</td>
            <td>${u.creditsPermanent} + 日${u.dailyCredits}</td>
            <td>${u.membershipActive ? '<span class="admin-badge admin-badge--ok">' + esc(u.membershipTierLabel) + '</span>' : '<span class="admin-badge">免费</span>'}</td>
            <td>${esc(u.storageLabel)}</td>
            <td>${cards}</td>
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
      const cards =
        u.cardLimit == null
          ? '会员不限张数'
          : `${u.cardCount} / ${u.cardLimit} 张（剩余 ${u.cardsRemaining}）`;
      const reds = (u.recentRedemptions || [])
        .map((r) => `<li>${esc(r.code)} · ${esc(r.redeemed_at || '')}</li>`)
        .join('');
      box.innerHTML = `
        <div class="admin-detail-readonly">
          <dl>
            <dt>邮箱</dt><dd>${esc(u.email || '—')}</dd>
            <dt>昵称</dt><dd>${esc(u.displayName || '—')}</dd>
            <dt>用户 ID</dt><dd><code>${esc(u.userId)}</code></dd>
            <dt>云端卡片</dt><dd>${esc(cards)}</dd>
            <dt>登记存储</dt><dd>${esc(u.storageLabel)}</dd>
            <dt>累计消耗</dt><dd>${u.lifetimeCreditsSpent ?? 0} 积分</dd>
            <dt>云同步</dt><dd>${esc(u.cloudUpdatedAt || '—')}</dd>
          </dl>
          ${reds ? '<p><strong>最近兑换</strong></p><ul>' + reds + '</ul>' : ''}
        </div>
        <h3 style="margin:16px 0 10px;font-size:15px">调整积分 / 会员</h3>
        <div class="admin-form-grid">
          <div class="admin-field" style="margin:0">
            <label for="editCredits">永久积分</label>
            <input type="number" id="editCredits" min="0" value="${Number(u.creditsPermanent) || 0}">
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editDaily">当日积分</label>
            <input type="number" id="editDaily" min="0" value="${Number(u.dailyCredits) || 0}">
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
    const q = ($('codeSearch')?.value || '').trim().toUpperCase();
    const active = $('codeFilterActive')?.value || '';
    const tbody = $('codeTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
    try {
      let path = `/api/admin/codes?limit=${PAGE}&offset=${codeOffset}`;
      if (q) path += '&q=' + encodeURIComponent(q);
      if (active) path += '&active=' + active;
      const data = await adminFetch(session, path);
      $('codePageInfo').textContent = `第 ${codeOffset + 1}–${codeOffset + data.items.length} 条，约 ${data.total} 个码`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((row) => {
          const extra =
            row.membership_tier && row.membership_days
              ? ` + ${row.membership_days}天${row.membership_tier}`
              : '';
          return `<tr>
            <td><code>${esc(row.code)}</code></td>
            <td>${row.credits}${extra}</td>
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

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    bindTabs();
    showApp(!!session?.secret);

    $('loginBtn')?.addEventListener('click', async () => {
      const secret = $('adminSecret')?.value?.trim();
      if (!secret) {
        showMsg($('loginMsg'), '请填写访问密钥', false);
        return;
      }
      session = { secret, apiBase: resolveApiBase() };
      try {
        await adminFetch(session, '/api/admin/dashboard');
        saveSession(session);
        showApp(true);
        showMsg($('loginMsg'), '', true);
        document.querySelector('.admin-tab[data-tab="overview"]')?.click();
      } catch (e) {
        session = null;
        showMsg($('loginMsg'), friendlyFetchError(e), false);
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

    if (session?.secret) {
      document.querySelector('.admin-tab[data-tab="overview"]')?.click();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
