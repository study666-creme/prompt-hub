/* 审计：admin_audit_logs 查询 */

import { $, esc, fullTime, showMsg } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['操作审计', '所有后台写操作的完整记录'];

const PAGE = 20;
let offset = 0;

export function init() {
  $('auditSearchBtn')?.addEventListener('click', () => void load(true));
  $('auditActionSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load(true);
  });
  $('auditPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('auditNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
}

export function load(reset = true) {
  if (reset) offset = 0;
  const tbody = $('auditTableBody');
  if (!tbody) return;
  const action = ($('auditActionSearch')?.value || '').trim();
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="6">加载中…</td></tr>';
  void (async () => {
    try {
      const data = await adminFetch(
        `/api/admin/audit?limit=${PAGE}&offset=${offset}${action ? '&action=' + encodeURIComponent(action) : ''}`
      );
      $('auditPageInfo').textContent = `第 ${offset + 1}–${offset + data.items.length} 条 / 共 ${data.total} 条`;
      const prev = $('auditPrev');
      const next = $('auditNext');
      if (prev) prev.disabled = offset <= 0;
      if (next) next.disabled = offset + data.items.length >= data.total;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="admin-hint">暂无审计记录（新操作会自动记录）</td></tr>';
        return;
      }
      const actionBadge = (action) => {
        const kind = String(action || '').split('.')[0];
        const map = { user: 'info', community: 'warn', code: 'ok', order: 'ok', image_models: 'info' };
        return `<span class="admin-badge admin-badge--${map[kind] || 'info'}">${esc(action)}</span>`;
      };
      const jsonCell = (v) => {
        if (v == null) return '<span class="admin-hint">—</span>';
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        const short = s.length > 60 ? s.slice(0, 58) + '…' : s;
        return `<code title="${esc(s)}">${esc(short)}</code>`;
      };
      tbody.innerHTML = data.items
        .map((row) => `<tr>
          <td>${esc(fullTime(row.created_at))}<br><span class="admin-hint">${esc(row.ip || '')}</span></td>
          <td><code>${esc(row.actor_fingerprint || '—')}</code></td>
          <td>${actionBadge(row.action)}</td>
          <td>${esc(row.target_type)}<br><span class="admin-hint">${esc(row.target_id ? String(row.target_id).slice(0, 16) : '')}</span></td>
          <td>${jsonCell(row.before)}</td>
          <td>${jsonCell(row.after ?? row.detail)}</td>
        </tr>`)
        .join('');
      showMsg($('auditMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('auditMsg'), friendlyFetchError(e), false);
    }
  })();
}
