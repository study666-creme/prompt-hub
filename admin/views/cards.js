/* 卡片库：巡检 + 风险筛选 + 图片抽检（只读） */

import { $, esc, monitorNumber, showMsg, toast } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';
import { showUserDetail } from './users.js';

export const title = ['卡片库巡检', '云端卡片、图片引用与风险（只读）'];

const PAGE = 20;
let offset = 0;
let lastCheckImages = false;

export function init() {
  $('cardAdminRefresh')?.addEventListener('click', () => {
    lastCheckImages = false;
    void load(true, { refresh: true });
  });
  $('cardAdminSearchBtn')?.addEventListener('click', () => {
    lastCheckImages = false;
    void load(true);
  });
  $('cardAdminSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      lastCheckImages = false;
      void load(true);
    }
  });
  $('cardAdminRisk')?.addEventListener('change', () => {
    lastCheckImages = false;
    void load(true);
  });
  $('cardAdminCheckImagesBtn')?.addEventListener('click', () => {
    lastCheckImages = true;
    void load(false, { checkImages: true });
  });
  $('cardAdminPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false, { checkImages: lastCheckImages });
  });
  $('cardAdminNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false, { checkImages: lastCheckImages });
  });
  $('panel-cards')?.addEventListener('click', (ev) => {
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
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function cardImageStatusCell(item) {
  const kind = item?.imageKind || 'other';
  const path = item?.imagePath || item?.image || '';
  const short = path && path.length > 42 ? path.slice(0, 22) + '…' + path.slice(-16) : path;
  const risks = Array.isArray(item?.riskFlags) ? item.riskFlags : [];
  const badges = risks.length
    ? risks.map((r) => {
        const kindCls = r === 'owner-mismatch' || r === 'data-image' ? 'warn' : 'info';
        return `<span class="admin-badge admin-badge--${kindCls}">${esc(cardRiskLabel(r))}</span>`;
      }).join(' ')
    : '<span class="admin-badge admin-badge--ok">正常</span>';
  let exists = '';
  if (item?.imageChecked) {
    if (item.imageExists === true) exists = ' <span class="admin-badge admin-badge--ok">存在</span>';
    else if (item.imageExists === false) exists = ' <span class="admin-badge admin-badge--off">不存在</span>';
    else exists = ' <span class="admin-badge admin-badge--warn">未知</span>';
  }
  return `
    <div>${badges} ${exists}</div>
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

async function loadSummary(refresh) {
  const stats = $('cardAdminStats');
  if (!stats) return;
  stats.innerHTML = '<div class="admin-stat"><span>加载中</span><strong>…</strong></div>';
  try {
    const refreshQ = refresh ? '?refresh=1' : '';
    const d = await adminFetch(`/api/admin/cards/summary${refreshQ}`, { timeoutMs: 120000 });
    const riskTotal =
      (d.noImage || 0) + (d.dataImages || 0) + (d.remoteImages || 0) + (d.ownerMismatch || 0) + (d.emptyContent || 0) + (d.duplicateIds || 0);
    stats.innerHTML = `
      <div class="admin-stat admin-stat--slate"><span>云端卡片</span><strong>${monitorNumber(d.totalCards)}</strong></div>
      <div class="admin-stat admin-stat--slate"><span>有卡用户</span><strong>${monitorNumber(d.usersWithCards)}</strong></div>
      <div class="admin-stat admin-stat--slate"><span>桶内图</span><strong>${monitorNumber(d.storageImages)}</strong></div>
      <div class="admin-stat ${riskTotal ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>风险项</span><strong>${monitorNumber(riskTotal)}</strong></div>
      <div class="admin-stat ${d.ownerMismatch ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>路径串号</span><strong>${monitorNumber(d.ownerMismatch)}</strong></div>
    `;
    const box = $('cardAdminSummary');
    if (box) {
      box.innerHTML = `
        <div class="admin-card-framed">
          <h3>卡片最多的用户</h3>
          ${renderCardUserSummary(d.topUsers)}
        </div>
        <div class="admin-card-framed">
          <h3>需要优先处理</h3>
          ${renderCardUserSummary(d.riskUsers)}
        </div>
        <div class="admin-card-framed">
          <h3>最近同步</h3>
          ${renderCardUserSummary(d.recentUsers)}
        </div>
      `;
    }
    const hint = $('cardAdminHint');
    if (hint) {
      hint.textContent = d.truncated
        ? `已扫描前 ${d.scannedUserDataRows} 个云数据用户；总行数约 ${d.userDataRows}，结果可能不完整。`
        : `已扫描 ${d.scannedUserDataRows} 个云数据用户；只读巡检。`;
    }
  } catch (e) {
    stats.innerHTML = '';
    showMsg($('cardAdminMsg'), '卡片库统计加载失败：' + friendlyFetchError(e), false);
  }
}

export function load(reset, opts) {
  if (reset) {
    offset = 0;
    void loadSummary(!!opts?.refresh);
  }
  const tbody = $('cardAdminTableBody');
  if (!tbody) return;
  const q = ($('cardAdminSearch')?.value || '').trim();
  const risk = $('cardAdminRisk')?.value || 'all';
  const checkImages = !!opts?.checkImages;
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="6">加载中…</td></tr>';
  showMsg($('cardAdminMsg'), '', true);
  void (async () => {
    try {
      const data = await adminFetch(
        `/api/admin/cards?limit=${PAGE}&offset=${offset}&risk=${encodeURIComponent(risk)}${q ? '&q=' + encodeURIComponent(q) : ''}${checkImages ? '&checkImages=1' : ''}${opts?.refresh ? '&refresh=1' : ''}`,
        { timeoutMs: checkImages ? 150000 : 90000 }
      );
      const items = data.items || [];
      $('cardAdminPageInfo').textContent = `第 ${offset + 1}–${offset + items.length} 条 / 共 ${data.total} 张${checkImages ? ' · 已抽检本页图片' : ''}`;
      const prev = $('cardAdminPrev');
      const next = $('cardAdminNext');
      if (prev) prev.disabled = offset <= 0;
      if (next) next.disabled = offset + items.length >= data.total;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="admin-hint">没有符合条件的卡片</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((item) => {
        const t = item.title || item.promptPreview || '未命名卡片';
        const prompt = item.promptPreview && item.promptPreview !== t ? `<br><span class="admin-hint">${esc(item.promptPreview)}</span>` : '';
        const community = item.publishedToCommunity || item.communityPostId
          ? `<span class="admin-badge admin-badge--ok">有关联</span>${item.communityPostId ? `<br><span class="admin-hint">${esc(item.communityPostId)}</span>` : ''}`
          : '<span class="admin-hint">—</span>';
        return `<tr>
          <td><strong>${esc(t)}</strong>${prompt}<br><code>${esc(item.cardId || '—')}</code></td>
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
  })();
}
