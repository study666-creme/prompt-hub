/* 流水：credit_ledger 浏览 + 筛选 + CSV 导出 */

import { $, esc, fullTime, showMsg, toast } from '../modules/ui.js';
import { adminFetch, adminFetchRaw, friendlyFetchError } from '../modules/api.js';
import { showUserDetail } from './users.js';

export const title = ['积分流水', 'credit_ledger 对账：发放、消耗、退款全记录'];

const PAGE = 20;
let offset = 0;

/** 把流水 meta 拼成人能看懂的扣费明细：模型 · 时长 · 分辨率 · 每日池/永久拆分 */
function describeLedgerMeta(meta, reason) {
  if (!meta || typeof meta !== 'object') return '—';
  const parts = [];
  const model = meta.modelLabel || meta.model;
  if (model) parts.push(String(model));
  if (meta.duration) parts.push(meta.duration + 's');
  if (meta.resolution) parts.push(String(meta.resolution));
  if (meta.ratio) parts.push(String(meta.ratio));
  if (meta.pool) parts.push('池:' + meta.pool);
  if (meta.fromDaily != null || meta.fromPermanent != null) {
    const d = Number(meta.fromDaily) || 0;
    const p = Number(meta.fromPermanent) || 0;
    if (d || p) parts.push(`每日${d}+永久${p}`);
  }
  if (meta.note) parts.push(String(meta.note));
  if (meta.productId) parts.push(String(meta.productId));
  if (meta.by) parts.push(String(meta.by));
  if (meta.code) parts.push(String(meta.code));
  return parts.length ? parts.join(' · ') : '—';
}

export function init() {
  $('ledgerReasonFilter')?.addEventListener('change', () => void load(true));
  $('ledgerUserSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load(true);
  });
  $('ledgerSearchBtn')?.addEventListener('click', () => void load(true));
  $('ledgerPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('ledgerNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
  $('ledgerExportBtn')?.addEventListener('click', () => void exportCsv());
}

export function load(reset = true, params) {
  if (reset) offset = 0;
  const routeUserId = params?.get?.('userId') || params?.userId || '';
  const tbody = $('ledgerTableBody');
  if (!tbody) return;
  // 从用户详情跳转过来时，把 userId 回填进搜索框便于继续查询
  if (routeUserId && routeUserId !== 'undefined' && $('ledgerUserSearch')) {
    $('ledgerUserSearch').value = routeUserId;
  }
  const userId = ($('ledgerUserSearch')?.value || '').trim();
  const reason = $('ledgerReasonFilter')?.value || '';
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="6">加载中…</td></tr>';
  void (async () => {
    try {
      const data = await adminFetch(
        `/api/admin/ledger?limit=${PAGE}&offset=${offset}${userId ? '&userId=' + encodeURIComponent(userId) : ''}${reason ? '&reason=' + encodeURIComponent(reason) : ''}`
      );
      $('ledgerPageInfo').textContent = `第 ${offset + 1}–${offset + data.items.length} 条 / 共 ${data.total} 条`;
      const prev = $('ledgerPrev');
      const next = $('ledgerNext');
      if (prev) prev.disabled = offset <= 0;
      if (next) next.disabled = offset + data.items.length >= data.total;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="admin-hint">暂无流水</td></tr>';
        return;
      }
      const reasonSelect = $('ledgerReasonFilter');
      if (reasonSelect && !reasonSelect.options.length && Array.isArray(data.reasons)) {
        reasonSelect.innerHTML = '<option value="">全部原因</option>' +
          data.reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
      }
      tbody.innerHTML = data.items
        .map((row) => {
          const delta = Number(row.delta) || 0;
          const cls = delta >= 0 ? 'admin-badge--ok' : 'admin-badge--off';
          const uid = String(row.user_id || '');
          const name = row.userName || '（无昵称）';
          const email = row.userEmail || '';
          const userCell = `
            <div class="admin-ledger-user">
              <button type="button" class="admin-btn admin-btn--link" data-ledger-user="${esc(uid)}" title="查看该用户">${esc(name)}</button>
              ${email ? `<br><span class="admin-hint">${esc(email)}</span>` : ''}
              <br><code class="admin-ledger-uid" title="点击复制完整用户 ID">${esc(uid)}</code>
            </div>`;
          return `<tr>
            <td>${esc(fullTime(row.created_at))}</td>
            <td>${userCell}</td>
            <td><span class="admin-badge ${cls}">${delta >= 0 ? '+' : ''}${delta}</span><br><span class="admin-hint">余额 ${esc(row.balance_after ?? '—')}</span></td>
            <td><code>${esc(row.reason || '—')}</code></td>
            <td><code>${esc(row.ref_id || '—')}</code></td>
            <td class="admin-monitor-detail">${esc(describeLedgerMeta(row.meta, row.reason))}</td>
          </tr>`;
        })
        .join('');
      tbody.querySelectorAll('[data-ledger-user]').forEach((btn) => {
        btn.addEventListener('click', () => void showUserDetail(btn.getAttribute('data-ledger-user')));
      });
      tbody.querySelectorAll('.admin-ledger-uid').forEach((code) => {
        code.style.cursor = 'copy';
        code.addEventListener('click', () => {
          const v = code.textContent;
          if (navigator.clipboard && v) {
            navigator.clipboard.writeText(v).then(() => toast('已复制完整用户 ID', true, 1800)).catch(() => toast('复制失败', false));
          }
        });
      });
      showMsg($('ledgerMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('ledgerMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function exportCsv() {
  try {
    toast('正在导出（最多 5000 条）…', true, 1500);
    const csv = await adminFetchRaw('/api/admin/ledger/export');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出', true);
  } catch (e) {
    toast('导出失败：' + friendlyFetchError(e), false);
  }
}
