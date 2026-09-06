/* 概览：数据总览 + 运行环境 + 近 24h 监控 + 存储扫描（按需） */

import { $, esc, formatBytes, monitorNumber, monitorPercent, monitorTime, showMsg } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['数据概览', '用户、存储、运行环境一览'];

export function init() {
  $('dashStorageRefresh')?.addEventListener('click', () => void loadStorage());
  $('dashMonitorRefresh')?.addEventListener('click', () => void loadMonitor());
}

export function load() {
  void loadStats();
  void loadInfra();
  void loadMonitor();
}

async function loadStats() {
  const el = $('dashStats');
  if (!el) return;
  el.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
  try {
    const d = await adminFetch('/api/admin/dashboard');
    const tier = d.membersByTier || {};
    el.innerHTML = `
      <div class="admin-stat admin-stat--blue"><span>注册用户</span><strong>${monitorNumber(d.usersTotal)}</strong></div>
      <div class="admin-stat admin-stat--green"><span>有效会员</span><strong>${monitorNumber(d.membersActive)}</strong></div>
      <div class="admin-stat admin-stat--violet"><span>轻/基/标/专</span><strong>${tier.lite || 0} / ${tier.basic || 0} / ${tier.standard || 0} / ${tier.pro || 0}</strong></div>
      <div class="admin-stat admin-stat--amber"><span>永久积分合计</span><strong>${monitorNumber(d.totalPermanentCredits)}</strong></div>
      <div class="admin-stat admin-stat--slate"><span>登记存储合计</span><strong>${formatBytes(d.totalStorageBytes)}</strong></div>
      <div class="admin-stat admin-stat--rose"><span>可用激活码</span><strong>${monitorNumber(d.codesActive)}</strong></div>
      <div class="admin-stat admin-stat--blue"><span>累计兑换</span><strong>${monitorNumber(d.redemptionsTotal)}</strong></div>
    `;
    showMsg($('dashMsg'), '', true);
  } catch (e) {
    el.innerHTML = '';
    showMsg($('dashMsg'), friendlyFetchError(e), false);
  }
}

async function loadInfra() {
  const hint = $('dashInfraHint');
  const body = $('dashInfraBody');
  if (!hint || !body) return;
  hint.textContent = '正在读取 Worker 环境…';
  body.hidden = true;
  try {
    const d = await adminFetch('/api/admin/dashboard/infra');
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
      </div>
      ${policyRows ? `<p style="margin:12px 0 6px;font-size:13px"><strong>用户云存储策略</strong></p><ul class="admin-notes">${policyRows}</ul>` : ''}
      <ul class="admin-notes" style="margin-top:10px">${(d.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    `;
    body.hidden = false;
  } catch (e) {
    hint.textContent = '环境信息加载失败：' + friendlyFetchError(e);
  }
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

async function loadMonitor() {
  const hint = $('dashMonitorHint');
  const body = $('dashMonitorBody');
  const refresh = $('dashMonitorRefresh');
  if (!hint || !body) return;
  hint.textContent = '正在读取近 24 小时运行监控…';
  body.hidden = true;
  if (refresh) refresh.disabled = true;
  try {
    const d = await adminFetch('/api/admin/dashboard/monitoring?hours=24', { timeoutMs: 90000 });
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

    const recentErrors = Array.isArray(req.recentErrors) ? req.recentErrors : [];
    const recentFailures = Array.isArray(gen.recentFailures) ? gen.recentFailures : [];
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

    body.innerHTML = `
      ${alerts}
      ${stats}
      ${renderMonitorBars(req.lastHours || [])}
      <div class="admin-monitor-section">
        <h3>生图状态</h3>
        <p class="admin-hint">${genBadge}</p>
      </div>
      <div class="admin-monitor-section">
        <h3>最近异常</h3>
        ${issues}
      </div>
      <div class="admin-monitor-grid">
        ${renderMonitorRecordTable('热门接口', req.byRoute, '暂无请求统计')}
        ${renderMonitorRecordTable('状态码分布', req.byStatus, '暂无状态码统计')}
      </div>
      <p class="admin-hint admin-monitor-footnote">请求量为 Worker 自计数近似值；正式账单/免费额度以 Cloudflare 控制台 Analytics 为准。</p>
    `;
    body.hidden = false;
  } catch (e) {
    hint.textContent = '监控加载失败：' + friendlyFetchError(e);
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

async function loadStorage() {
  const hint = $('dashStorageHint');
  const body = $('dashStorageBody');
  const alertsEl = $('dashAlerts');
  if (!hint || !body) return;
  hint.textContent = '正在扫描当前主存储（文件较多时约需几秒）…';
  body.hidden = true;
  if (alertsEl) alertsEl.hidden = true;
  try {
    const s = await adminFetch('/api/admin/dashboard/storage');
    const ps = s.projectStorage || {};
    const sourceName = s.bucketSource === 'r2' ? 'Cloudflare R2' : 'MemFire Storage';
    hint.textContent = s.bucketScanTruncated
      ? `${sourceName}：前 ${s.bucketFileCount} 个文件（扫描已截断）`
      : `${sourceName}：${s.bucketFileCount} 个文件`;

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

    const fileUsed = ps.usedLabel || s.bucketLabel;
    const fileQuota = ps.quotaLabel || s.storageQuotaLabel;
    const filePercent = ps.percentUsed != null ? ps.percentUsed : null;
    const pct = filePercent != null ? filePercent : 0;
    const bar = filePercent != null
      ? `<div class="admin-progress" title="${pct}%"><div class="admin-progress__bar${pct >= 80 ? ' is-warn' : ''}" style="width:${Math.min(100, pct)}%"></div></div>`
      : '';

    body.innerHTML = `
      <div class="admin-quota-grid">
        <div class="admin-quota-card">
          <div class="admin-quota-card__head">
            <span class="admin-quota-card__title">${sourceName} 主存储</span>
            <span class="admin-badge admin-badge--${ps.source === 'r2' ? 'ok' : 'warn'}">${ps.source === 'r2' ? 'R2 主存储' : 'MemFire 扫描'}</span>
          </div>
          <div><strong style="font-size:18px">${esc(fileUsed)}</strong> <span class="admin-hint">/ ${esc(fileQuota || '按量计费')}</span></div>
          ${bar}
          <p class="admin-quota-card__meta">${ps.source === 'r2' ? '来自 Worker 的 R2 对象列表；R2 按量计费。' : '来自 MemFire Storage 对象扫描，仅作为当前占用估算。'}</p>
        </div>
        <div class="admin-quota-card">
          <div class="admin-quota-card__head">
            <span class="admin-quota-card__title">用户登记存储（业务层）</span>
            <span class="admin-badge admin-badge--ok">业务数据</span>
          </div>
          <div><strong style="font-size:18px">${esc(s.registeredLabel)}</strong></div>
          <p class="admin-quota-card__meta">所有用户 <code>profiles.storage_bytes</code> 合计，用于会员配额；不包含缩略图等派生对象。</p>
        </div>
      </div>
      ${topUsersHtml}
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
