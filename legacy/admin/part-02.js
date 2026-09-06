
  let session = loadSession();
  let userOffset = 0;
  let cardAdminOffset = 0;
  let cardAdminLastCheckImages = false;
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
  const PAGE = 20;
  let activeTab = 'overview';

  function adminPageMode() {
    return document.body?.dataset?.adminPage || ($('adminApp') ? 'console' : 'login');
  }

  function adminPageQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const v = params.get('v');
    return v ? `?v=${encodeURIComponent(v)}` : '';
  }

  function adminConsoleHref() {
    return `admin.html${adminPageQuery()}`;
  }

  function adminLoginHref() {
    return `admin-login.html${adminPageQuery()}`;
  }

  function redirectAdminTo(href) {
    const target = new URL(href, window.location.href);
    if (target.href !== window.location.href) window.location.replace(target.href);
  }

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
    if (tab === 'cards') void loadCardAdmin(true);
    if (tab === 'community') void loadCommunity(true);
    if (tab === 'codes') void loadCodes(true);
    if (tab === 'models') void loadImageModels();
    if (tab === 'canvas') void loadCanvasOperations();
  }

  function showApp(loggedIn) {
    const mode = adminPageMode();
    document.body.classList.toggle('admin-gate', mode === 'login' || !loggedIn);
    document.body.classList.toggle('admin-is-authenticated', !!loggedIn);
    const login = $('adminLogin');
    const app = $('adminApp');
    if (login) login.hidden = mode === 'console' || loggedIn;
    if (app) app.hidden = !loggedIn;
    document.title = loggedIn ? 'Prompt Hub 运营控制台' : 'Prompt Hub 管理登录';
    updateAdminApiChip();
    if (mode === 'console' && !loggedIn) redirectAdminTo(adminLoginHref());
    if (mode === 'login' && loggedIn) redirectAdminTo(adminConsoleHref());
  }

  const PAGE_TITLES = {
    overview: ['数据概览', '用户、存储、运行环境一览'],
    users: ['用户管理', '搜索、查看云存储额度与会员状态'],
    cards: ['卡片库后台', '云端卡片、图片引用与风险巡检'],
    community: ['社区图片', '查看在线帖数量、下架无效或已删卡的社区帖'],
    codes: ['激活码', '生成与查询兑换码'],
    models: ['生图模型', '定价、折扣与线路配置'],
    canvas: ['画布调用', '模型映射、任务状态与生成服务日志']
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
        if (tab === 'cards') void loadCardAdmin(true);
        if (tab === 'community') void loadCommunity(true);
        if (tab === 'codes') void loadCodes(true);
        if (tab === 'models') void loadImageModels();
        if (tab === 'canvas') void loadCanvasOperations();
      });
    });
  }

  async function loadDashboard() {
    const el = $('dashStats');
    if (!el || !session) return;
    el.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
    void loadDashboardInfra();
    void loadDashboardMonitor();
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
      const dbOk = d.databasePing === 'ok';
      const keyOk = d.databaseServiceKeyLooksValid;
      hint.textContent = `API：${d.apiOrigin || '—'} · 环境 ${d.environment || '—'}`;
      const policyRows = (d.userStoragePolicy || [])
        .map((p) => `<li>${esc(p.tier)}：${esc(p.quotaLabel)}</li>`)
        .join('');
      body.innerHTML = `
        <div class="admin-kv">
          <div><span>API 地址</span><strong>${esc(d.apiOrigin || '—')}</strong></div>
          <div><span>站点</span><strong>${esc(d.pagesHint || '—')}</strong></div>
          <div><span>MemFire 项目</span><strong>${esc(d.databaseProjectHost || '未配置')}</strong></div>
          <div><span>Service Key</span><strong>${keyOk ? '已配置（格式正常）' : '未配置或异常'}</strong></div>
          <div><span>数据库连通</span><strong class="${dbOk ? '' : 'admin-warn'}">${esc(d.databasePing || '—')}</strong></div>
          <div><span>全能模型2 / 香蕉</span><strong>${d.newApiConfigured ? '已配置' : '未配置'}</strong></div>
          <div><span>MJ</span><strong>${d.midjourneyApiConfigured ? '已配置' : '未配置'}</strong></div>
          <div><span>对话 API</span><strong>${d.chatApiConfigured ? '已配置' : '未配置'}</strong></div>
          <div><span>图片存储模式</span><strong>${esc(d.mediaStorageMode || '—')}</strong></div>
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

  function monitorNumber(n) {
    return Number(n || 0).toLocaleString('zh-CN');
  }

  function monitorPercent(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return (n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0) + '%';
  }

  function monitorTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function monitorBadge(text, kind) {
    return `<span class="admin-badge admin-badge--${kind || 'ok'}">${esc(text)}</span>`;
  }

  function renderMonitorBars(hours) {
    const items = Array.isArray(hours) ? hours : [];
    if (!items.length) return '';
    const max = Math.max(1, ...items.map((h) => Math.max(h.requestTotal || 0, h.api5xx || 0, h.image404 || 0)));
    return `<div class="admin-monitor-bars" aria-label="近 24 小时请求趋势">
      ${items.map((h) => {
        const total = Math.max(0, Number(h.requestTotal) || 0);
        const err = Math.max(0, Number(h.api5xx) || 0);
        const img404 = Math.max(0, Number(h.image404) || 0);
        const height = Math.max(4, Math.round((total / max) * 100));
        const hasIssue = err > 0 || img404 > 0;
        return `<span class="admin-monitor-bar ${hasIssue ? 'has-issue' : ''}" style="height:${height}%" title="${esc(h.hour)} · 请求 ${total} · 5xx ${err} · 图片404 ${img404}"></span>`;
      }).join('')}
    </div>`;
  }

  function renderMonitorRecordTable(title, record, emptyText) {
    const entries = Object.entries(record || {}).slice(0, 10);
    if (!entries.length) {
      return `<div class="admin-monitor-section"><h3>${esc(title)}</h3><p class="admin-hint">${esc(emptyText || '暂无数据')}</p></div>`;
    }
    return `<div class="admin-monitor-section">
      <h3>${esc(title)}</h3>
      <div class="admin-table-wrap">
        <table class="admin-table admin-table--compact">
          <thead><tr><th>项目</th><th>次数</th></tr></thead>
          <tbody>${entries.map(([key, count]) => `
            <tr><td><code>${esc(key)}</code></td><td>${monitorNumber(count)}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }

  async function loadDashboardMonitor() {
    const hint = $('dashMonitorHint');
    const body = $('dashMonitorBody');
    const refresh = $('dashMonitorRefresh');
    if (!session || !hint || !body) return;
    hint.textContent = '正在读取近 24 小时运行监控…';
    body.hidden = true;
    if (refresh && refresh.dataset.bound !== '1') {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', () => loadDashboardMonitor());
    }
    if (refresh) refresh.disabled = true;
    try {
      const d = await adminFetch(session, '/api/admin/dashboard/monitoring?hours=24', { timeoutMs: 90000 });
      const req = d.requests || {};
      const gen = d.generation || {};
      const biz = d.business || {};
      const requestSource = req.available ? 'Worker 自计数' : '未绑定 KV';
      const lastSeen = req.lastUpdatedAt ? ` · 最新 ${monitorTime(req.lastUpdatedAt)}` : '';
      hint.textContent = `近 ${d.hours || 24} 小时 · ${requestSource}${lastSeen}`;

      const alerts = Array.isArray(d.alerts) && d.alerts.length
        ? `<div class="admin-alerts admin-monitor-alerts">${d.alerts.map((a) => `
            <div class="admin-alert admin-alert--${a.level === 'critical' ? 'critical' : 'warn'}">
              <strong>${esc(a.title)}</strong>${esc(a.detail || '')}
            </div>`).join('')}</div>`
        : '';

      const stats = `
        <div class="admin-stats admin-monitor-stats">
          <div class="admin-stat admin-stat--slate"><span>Cloudflare 请求量</span><strong>${monitorNumber(req.requestTotal)}</strong></div>
          <div class="admin-stat ${req.api5xx > 0 ? 'admin-stat--rose' : 'admin-stat--slate'}"><span>Worker/API 5xx</span><strong>${monitorNumber(req.api5xx)}</strong></div>
          <div class="admin-stat ${req.image404 > 0 ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>图片 404</span><strong>${monitorNumber(req.image404)}</strong></div>
          <div class="admin-stat ${gen.failureRate >= 0.15 ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>生图失败率</span><strong>${monitorPercent(gen.failureRate)}</strong></div>
          <div class="admin-stat ${gen.stuckProcessing > 0 ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>生成中 / 卡住</span><strong>${monitorNumber(gen.processing || 0)} / ${monitorNumber(gen.stuckProcessing || 0)}</strong></div>
          <div class="admin-stat admin-stat--slate"><span>积分消耗 / 退款</span><strong>${monitorNumber(biz.creditsSpent)} / ${monitorNumber(biz.creditsRefunded)}</strong></div>
        </div>`;

      const genBadge = gen.available
        ? `${monitorBadge(`成功 ${monitorNumber(gen.completed || 0)}`, 'ok')} ${monitorBadge(`失败 ${monitorNumber(gen.failed || 0)}`, gen.failed ? 'warn' : 'ok')} ${monitorBadge(`平均 ${gen.averageDurationSec == null ? '—' : gen.averageDurationSec + 's'}`, 'info')}`
        : monitorBadge(gen.error || '生图记录不可读', 'warn');
      const businessBadge = [
        biz.ledgerAvailable ? monitorBadge('流水可读', 'ok') : monitorBadge('流水不可读', 'warn'),
        biz.redemptionsAvailable ? monitorBadge(`兑换 ${monitorNumber(biz.redemptions)}`, 'ok') : monitorBadge('兑换不可读', 'warn'),
        biz.paymentsAvailable ? monitorBadge(`支付事件 ${monitorNumber(biz.payments)}`, 'ok') : monitorBadge('支付事件不可读', 'warn')
      ].join(' ');

      const recentErrors = Array.isArray(req.recentErrors) ? req.recentErrors : [];
      const recentFailures = Array.isArray(gen.recentFailures) ? gen.recentFailures : [];
      const recentImage404 = Array.isArray(req.recentImage404) ? req.recentImage404 : [];
      const issueRows = [
        ...recentErrors.slice(0, 12).map((e) => ({
          type: e.status === 404 ? '图片 404' : `HTTP ${e.status}`,
          at: e.ts,
          target: `${e.method || ''} ${e.route || e.path || ''}`.trim(),
          detail: e.path || e.message || ''
        })),
        ...recentFailures.slice(0, 12).map((f) => ({
          type: '生图失败',
          at: f.createdAt,
          target: [f.jobId, f.model, f.provider].filter(Boolean).join(' · '),
          detail: f.message || f.reason || ''
        }))
      ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 14);

      const issues = issueRows.length
        ? `<div class="admin-table-wrap">
            <table class="admin-table admin-table--compact">
              <thead><tr><th>时间</th><th>类型</th><th>目标</th><th>详情</th></tr></thead>
              <tbody>${issueRows.map((r) => `
                <tr>
                  <td>${esc(monitorTime(r.at))}</td>
                  <td>${esc(r.type)}</td>
                  <td><code>${esc(r.target || '—')}</code></td>
                  <td class="admin-monitor-detail">${esc(r.detail || '—')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`
        : '<p class="admin-hint">近 24 小时没有记录到 5xx、图片 404 或生图失败。</p>';

      const image404List = recentImage404.length
        ? `<ul class="admin-notes admin-monitor-paths">${recentImage404.slice(0, 8).map((e) => `<li><code>${esc(e.path || e.route || '')}</code> · ${esc(monitorTime(e.ts))}</li>`).join('')}</ul>`
        : '<p class="admin-hint">暂无图片代理 404。</p>';

      body.innerHTML = `
        ${alerts}
        ${stats}
        ${renderMonitorBars(req.lastHours || [])}
        <div class="admin-monitor-grid">
          <div class="admin-monitor-section">
            <h3>生图状态</h3>
            <p class="admin-hint">${genBadge}</p>
            <div class="admin-kv admin-kv--compact">
              <div><span>任务数</span><strong>${monitorNumber(gen.total)}</strong></div>
              <div><span>有结果图</span><strong>${monitorNumber(gen.withResultImage)}</strong></div>
              <div><span>完成但无图</span><strong>${monitorNumber(gen.missingResultImage)}</strong></div>
              <div><span>扣费合计</span><strong>${monitorNumber(gen.totalCreditsCharged)}</strong></div>
            </div>
          </div>
          <div class="admin-monitor-section">
            <h3>运营流水</h3>
            <p class="admin-hint">${businessBadge}</p>
            <div class="admin-kv admin-kv--compact">
              <div><span>积分发放</span><strong>${monitorNumber(biz.creditsGranted)}</strong></div>
              <div><span>兑换记录</span><strong>${monitorNumber(biz.redemptions)}</strong></div>
              <div><span>支付事件</span><strong>${monitorNumber(biz.payments)}</strong></div>
              <div><span>流水行数</span><strong>${monitorNumber(biz.ledgerRows)}</strong></div>
            </div>
          </div>
        </div>
        <div class="admin-monitor-section">
          <h3>最近异常</h3>
          ${issues}
        </div>
        <div class="admin-monitor-grid">
          ${renderMonitorRecordTable('热门接口', req.byRoute, '暂无请求统计')}
          ${renderMonitorRecordTable('状态码分布', req.byStatus, '暂无状态码统计')}
        </div>
        <div class="admin-monitor-section">
          <h3>最近图片 404</h3>
          ${image404List}
        </div>
        <p class="admin-hint admin-monitor-footnote">请求量为 Worker 自计数近似值；正式账单/免费额度仍以 Cloudflare 控制台 Analytics 为准。</p>
      `;
      body.hidden = false;
    } catch (e) {
      hint.textContent = '监控加载失败：' + friendlyFetchError(e);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function loadDashboardStorage() {
    const hint = $('dashStorageHint');
    const body = $('dashStorageBody');
    const alertsEl = $('dashAlerts');
    if (!session || !hint || !body) return;
    hint.textContent = '正在扫描当前主存储（文件较多时约需几秒）…';
    body.hidden = true;
    if (alertsEl) alertsEl.hidden = true;
    try {
      const s = await adminFetch(session, '/api/admin/dashboard/storage');
      const ps = s.projectStorage || {};
      const db = s.database || {};
      const sourceName = s.bucketSource === 'r2' ? 'Cloudflare R2' : 'MemFire Storage';
      hint.textContent = s.bucketScanTruncated
        ? `${sourceName}：前 ${s.bucketFileCount} 个文件（扫描已截断）`
        : `${sourceName}：${s.bucketFileCount} 个文件`;

      const fileBadge = ps.source === 'r2'
        ? { kind: 'ok', text: 'R2 主存储' }
        : ps.source === 'env'
          ? { kind: 'ok', text: 'Usage 同步' }
          : { kind: 'warn', text: 'MemFire 扫描' };
      const dbBadge = db.configured
        ? { kind: 'ok', text: 'Usage 同步' }
        : { kind: 'warn', text: '未填实际用量' };

      const fileUsedMain = ps.usedLabel || s.bucketLabel;
      const filePercent = ps.percentUsed != null ? ps.percentUsed : null;
      const fileStatus = ps.status || 'unknown';

      const topUsers = Array.isArray(s.topUsersByBucket) ? s.topUsersByBucket : [];
      const topUsersHtml = topUsers.length
        ? `<div class="admin-bucket-users" style="margin-top:16px">
            <h3 style="font-size:13px;margin:0 0 8px">主存储按用户（对象占用，非 SQL 登记）</h3>
            <table class="admin-table admin-table--compact">
              <thead><tr><th>用户 ID</th><th>文件数</th><th>桶内占用</th></tr></thead>
              <tbody>${topUsers.map((u) => `
                <tr>
                  <td><code>${esc(u.userId)}</code></td>
                  <td>${esc(String(u.fileCount))}</td>
                  <td>${esc(u.label)}</td>
                </tr>`).join('')}</tbody>
            </table>
            <p class="admin-hint" style="margin-top:8px">路径前缀即用户 UUID。缩略图和生成仓库对象也计入对象存储，因此不会与 profiles.storage_bytes 完全相等。</p>
          </div>`
        : '';

      body.innerHTML = `
        <div class="admin-quota-grid">
          ${renderQuotaCard(
            ps.source === 'r2' ? 'Cloudflare R2 主存储' : 'MemFire Storage',
            fileUsedMain,
            ps.quotaLabel || s.storageQuotaLabel,
            filePercent,
            fileStatus,
            ps.source === 'r2'
              ? '来自 Worker 的 R2 对象列表；R2 按量计费，不套用 MemFire Storage 配额。'
              : ps.source === 'env'
                ? '来自 Worker 变量 <code>SUPABASE_STORAGE_USED_MB</code>。'
                : '来自 MemFire Storage 对象扫描，仅作为当前占用估算。',
            fileBadge
          )}
          ${renderQuotaCard(
            'MemFire Database',
            db.usedLabel || '未同步',
            db.quotaLabel || s.dbQuotaLabel,
            db.percentUsed,
            db.status || 'unknown',
            db.configured
              ? '来自 Worker 变量 <code>SUPABASE_DB_USED_MB</code>（与 Usage 页 Database 一致）'
              : '请在 MemFire 控制台查看数据库用量，并填入 Worker 变量 <code>SUPABASE_DB_USED_MB</code>。',
            dbBadge
          )}
          ${renderQuotaCard(
            '用户登记存储（业务层）',
            s.registeredLabel,
            '—',
            null,
            'unknown',
            '所有用户 <code>profiles.storage_bytes</code> 合计，用于会员配额；不包含缩略图等派生对象。',
            { kind: 'ok', text: '业务数据' }
          )}
        </div>
        ${topUsersHtml}
        <p class="admin-hint" style="margin-top:12px">${esc(s.dbNote || '')}</p>
      `;
      body.hidden = false;

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

  function cardRiskLabel(risk) {
    const labels = {
      'no-image': '无图',
      'data-image': '本地图',
      'remote-image': '外链',
      'owner-mismatch': '串号',
      'empty-content': '空内容',
      'duplicate-id': '重复 ID'
    };
    return labels[risk] || risk || '正常';
  }

  function cardImageKindLabel(kind) {
    if (kind === 'storage') return '桶内';
    if (kind === 'remote') return '外链';
    if (kind === 'data') return '本地 data';
    if (kind === 'missing') return '无图';
    return '其他';
  }

  function cardDateLabel(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function cardRiskBadges(item) {
    const risks = Array.isArray(item?.riskFlags) ? item.riskFlags : [];
    if (!risks.length) return '<span class="admin-badge admin-badge--ok">正常</span>';
    return risks
      .map((r) => {
        const kind = r === 'owner-mismatch' || r === 'data-image' ? 'warn' : 'info';
        return `<span class="admin-badge admin-badge--${kind}">${esc(cardRiskLabel(r))}</span>`;
      })
      .join(' ');
  }

  function cardImageStatusCell(item) {
    const kind = item?.imageKind || 'other';
    const path = item?.imagePath || item?.image || '';
    const short = path && path.length > 42 ? path.slice(0, 22) + '…' + path.slice(-16) : path;
    let exists = '';
    if (item?.imageChecked) {
      if (item.imageExists === true) exists = ' ' + '<span class="admin-badge admin-badge--ok">存在</span>';
      else if (item.imageExists === false) exists = ' ' + '<span class="admin-badge admin-badge--off">不存在</span>';
      else exists = ' ' + '<span class="admin-badge admin-badge--warn">未知</span>';
    }
    return `
      <div>${cardRiskBadges(item)} ${exists}</div>
      <div class="admin-hint">${esc(cardImageKindLabel(kind))}${short ? ` · <code title="${esc(path)}">${esc(short)}</code>` : ''}</div>
    `;
  }

  function renderCardUserSummary(users) {
    const rows = Array.isArray(users) ? users.slice(0, 6) : [];
    if (!rows.length) return '<p class="admin-hint">暂无用户摘要。</p>';
    return `<table class="admin-table admin-table--compact">
      <thead><tr><th>用户</th><th>卡片</th><th>风险</th><th>登记存储</th></tr></thead>
      <tbody>${rows.map((u) => {
        const risk = (u.noImage || 0) + (u.dataImage || 0) + (u.remoteImage || 0) + (u.ownerMismatch || 0) + (u.emptyContent || 0) + (u.duplicateIds || 0);
        return `<tr>
          <td>${esc(u.displayName || u.userId?.slice(0, 8) || '—')}<br><span class="admin-hint">${esc(u.userId || '')}</span></td>
          <td>${u.cards || 0}</td>
          <td>${risk}</td>
          <td>${esc(u.storageLabel || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function renderCardAdminSummary(data) {
    const box = $('cardAdminSummary');
    if (!box) return;
    const top = data?.topUsers || [];
    const risk = data?.riskUsers || [];
    const recent = data?.recentUsers || [];
    box.innerHTML = `
      <div class="admin-card-framed">
        <h3>卡片最多的用户</h3>
        ${renderCardUserSummary(top)}
      </div>
      <div class="admin-card-framed">
        <h3>需要优先处理</h3>
        ${renderCardUserSummary(risk)}
      </div>
      <div class="admin-card-framed">
        <h3>最近同步</h3>
        ${renderCardUserSummary(recent)}
      </div>
    `;
  }

  async function loadCardAdminSummary(opts) {
    const stats = $('cardAdminStats');
    if (!session || !stats) return;
    stats.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
    try {
      const refreshQ = opts?.refresh ? '?refresh=1' : '';
      const d = await adminFetch(session, `/api/admin/cards/summary${refreshQ}`, { timeoutMs: 120000 });
      const riskTotal =
        (d.noImage || 0) + (d.dataImages || 0) + (d.remoteImages || 0) + (d.ownerMismatch || 0) + (d.emptyContent || 0) + (d.duplicateIds || 0);
      stats.innerHTML = `
        <div class="admin-stat admin-stat--slate"><span>云端卡片</span><strong>${monitorNumber(d.totalCards)}</strong></div>
        <div class="admin-stat admin-stat--slate"><span>有卡用户</span><strong>${monitorNumber(d.usersWithCards)}</strong></div>
        <div class="admin-stat admin-stat--slate"><span>桶内图</span><strong>${monitorNumber(d.storageImages)}</strong></div>
        <div class="admin-stat ${riskTotal ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>风险项</span><strong>${monitorNumber(riskTotal)}</strong></div>
        <div class="admin-stat ${d.ownerMismatch ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>路径串号</span><strong>${monitorNumber(d.ownerMismatch)}</strong></div>
        <div class="admin-stat admin-stat--slate"><span>JSON 体积</span><strong>${esc(d.payloadApproxLabel || '—')}</strong></div>
      `;
      renderCardAdminSummary(d);
      const hint = $('cardAdminHint');
      if (hint) {
        hint.textContent = d.truncated
          ? `已扫描前 ${d.scannedUserDataRows} 个云数据用户；总行数约 ${d.userDataRows}，结果可能不完整。`
          : `已扫描 ${d.scannedUserDataRows} 个云数据用户；只读巡检，不会修改卡片或图片。`;
      }
    } catch (e) {
      stats.innerHTML = '';
      renderCardAdminSummary(null);
      showMsg($('cardAdminMsg'), '卡片库统计加载失败：' + friendlyFetchError(e), false);
    }
  }

  function bindCardAdminActions() {
    const panel = $('panel-cards');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    $('cardAdminRefresh')?.addEventListener('click', () => {
      cardAdminLastCheckImages = false;
      void loadCardAdmin(true, { refresh: true });
    });
    $('cardAdminSearchBtn')?.addEventListener('click', () => {
      cardAdminLastCheckImages = false;
      void loadCardAdmin(true);
    });
    $('cardAdminSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        cardAdminLastCheckImages = false;
        void loadCardAdmin(true);
      }
    });
    $('cardAdminRisk')?.addEventListener('change', () => {
      cardAdminLastCheckImages = false;
      void loadCardAdmin(true);
    });
    $('cardAdminCheckImagesBtn')?.addEventListener('click', () => {
      cardAdminLastCheckImages = true;
      void loadCardAdmin(false, { checkImages: true });
    });
    $('cardAdminPrev')?.addEventListener('click', () => {
      cardAdminOffset = Math.max(0, cardAdminOffset - PAGE);
      void loadCardAdmin(false, { checkImages: cardAdminLastCheckImages });
    });
    $('cardAdminNext')?.addEventListener('click', () => {
      cardAdminOffset += PAGE;
      void loadCardAdmin(false, { checkImages: cardAdminLastCheckImages });
    });
    panel.addEventListener('click', (ev) => {
      const userBtn = ev.target.closest('[data-card-user]');
      if (userBtn) {
        const userId = userBtn.getAttribute('data-card-user');
        if (userId) void showUserDetail(userId);
        return;
      }
      const copyBtn = ev.target.closest('[data-card-copy]');
      if (copyBtn) {
        const text = copyBtn.getAttribute('data-card-copy') || '';
        if (navigator.clipboard && text) {
          navigator.clipboard.writeText(text).then(() => toast('已复制图片路径', true)).catch(() => toast('复制失败', false));
        }
      }
    });
  }

  async function loadCardAdmin(reset, opts) {
    if (!session) return;
    bindCardAdminActions();
    if (reset) {
      cardAdminOffset = 0;
      void loadCardAdminSummary({ refresh: !!opts?.refresh });
    }
    const tbody = $('cardAdminTableBody');
    if (!tbody) return;
    const q = ($('cardAdminSearch')?.value || '').trim();
    const risk = $('cardAdminRisk')?.value || 'all';
    const checkImages = !!opts?.checkImages;
    const checkQ = checkImages ? '&checkImages=1' : '';
    const refreshQ = opts?.refresh ? '&refresh=1' : '';
    tbody.innerHTML = '<tr class="admin-loading"><td colspan="6">加载中…</td></tr>';
    showMsg($('cardAdminMsg'), '', true);
    try {
      const data = await adminFetch(
        session,
        `/api/admin/cards?limit=${PAGE}&offset=${cardAdminOffset}&risk=${encodeURIComponent(risk)}${q ? '&q=' + encodeURIComponent(q) : ''}${checkQ}${refreshQ}`,
        { timeoutMs: checkImages ? 150000 : 90000 }
      );
      const items = data.items || [];
      $('cardAdminPageInfo').textContent = `第 ${cardAdminOffset + 1}–${cardAdminOffset + items.length} 条 / 共 ${data.total} 张${checkImages ? ' · 已抽检本页图片' : ''}`;
      const prev = $('cardAdminPrev');
      const next = $('cardAdminNext');
      if (prev) prev.disabled = cardAdminOffset <= 0;
      if (next) next.disabled = cardAdminOffset + items.length >= data.total;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="admin-hint">没有符合条件的卡片</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((item) => {
        const title = item.title || item.promptPreview || '未命名卡片';
        const prompt = item.promptPreview && item.promptPreview !== title ? `<br><span class="admin-hint">${esc(item.promptPreview)}</span>` : '';
        const community = item.publishedToCommunity || item.communityPostId
          ? `<span class="admin-badge admin-badge--ok">有关联</span>${item.communityPostId ? `<br><span class="admin-hint">${esc(item.communityPostId)}</span>` : ''}`
          : '<span class="admin-hint">—</span>';
        return `<tr>
          <td><strong>${esc(title)}</strong>${prompt}<br><code>${esc(item.cardId || '—')}</code></td>
          <td>${esc(item.displayName || '用户')}<br><span class="admin-hint">${esc(item.userId || '')}</span></td>
          <td>${cardImageStatusCell(item)}</td>
          <td>${community}</td>
          <td>${esc(cardDateLabel(item.updatedAt || item.cloudUpdatedAt))}</td>
          <td class="admin-actions-cell">
            <button type="button" class="admin-btn admin-btn--sm" data-card-user="${esc(item.userId)}">用户</button>
            ${item.imagePath ? `<button type="button" class="admin-btn admin-btn--sm" data-card-copy="${esc(item.imagePath)}">复制路径</button>` : ''}
          </td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('cardAdminMsg'), friendlyFetchError(e), false);
    }
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
          ? '<tr><th>缩略图</th><th>路径 / 说明</th><th>大小</th><th></th></tr>'
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
