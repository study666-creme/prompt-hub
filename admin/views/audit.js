/* 审计：admin_audit_logs 查询
 *
 * 页面要能自解释：每一行是什么操作、动了谁、改了什么。动作码给中文标签，
 * 明细（detail）单独一列展开，避免只看一串 announcements.save 不知道干嘛。
 */

import { $, esc, fullTime, showMsg } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['操作审计', '所有后台写操作的完整记录：谁、改了什么、从什么改成什么'];

const PAGE = 20;
let offset = 0;

/** 动作码 → 人类可读说明。没收录的按动作码本身展示，不会空白。 */
const ACTION_LABELS = {
  'user.update': '修改用户资料',
  'user.credits': '调整用户积分',
  'user.ban': '封禁用户',
  'user.unban': '解封用户',
  'order.manual_grant': '人工补发积分',
  'community.hide': '隐藏社区帖子',
  'community.delete': '删除社区帖子',
  'community.restore': '恢复社区帖子',
  'community.purge': '批量清理无效帖',
  'code.create': '生成激活码',
  'code.toggle': '启用/停用激活码',
  'code.delete': '删除激活码',
  'image_models.save': '保存生图模型定价',
  'announcements.save': '保存站点公告',
  'video_catalog.save_overrides': '保存视频目录覆盖'
};

const ACTION_KIND = {
  user: 'info',
  order: 'ok',
  community: 'warn',
  code: 'ok',
  image_models: 'info',
  announcements: 'info',
  video_catalog: 'warn'
};

function actionLabel(action) {
  const code = String(action || '');
  return ACTION_LABELS[code] || code || '未知操作';
}

/** detail 是结构化对象，挑关键字段拼成一句话。 */
function detailText(row) {
  const d = row.detail;
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d !== 'object') return String(d);
  const parts = [];
  const push = (label, value) => {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      parts.push(`${label} ${value.length > 3 ? `${value.length} 项（${value.slice(0, 3).join('、')}…）` : value.join('、')}`);
      return;
    }
    if (typeof value === 'object') return;
    parts.push(`${label} ${value}`);
  };
  push('积分', d.credits);
  push('原因', d.reason);
  push('数量', d.count);
  push('改动', d.renamed && d.renamed.length ? `改名 ${d.renamed.join('、')}` : null);
  push('改价', d.priced && d.priced.length ? `定价 ${d.priced.join('、')}` : null);
  push('下架', d.offline && d.offline.length ? `下架 ${d.offline.join('、')}` : null);
  push('公告', d.ids && d.ids.length ? d.ids.join('、') : null);
  return parts.join('；');
}

function beforeAfterText(row) {
  const fmt = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const before = fmt(row.before);
  const after = fmt(row.after);
  if (!before && !after) return '';
  if (!before) return `改为 ${after}`;
  if (!after) return `原值 ${before}`;
  return `${before} → ${after}`;
}

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
      tbody.innerHTML = data.items
        .map((row) => {
          const kind = String(row.action || '').split('.')[0];
          const badge = ACTION_KIND[kind] || 'info';
          const detail = detailText(row);
          const change = beforeAfterText(row);
          const target = `${esc(row.target_type || '—')}${row.target_id ? ` · ${esc(String(row.target_id).slice(0, 16))}` : ''}`;
          return `<tr>
          <td>${esc(fullTime(row.created_at))}<br><span class="admin-hint">${esc(row.ip || '')}</span></td>
          <td><code>${esc(row.actor_fingerprint || '—')}</code></td>
          <td><span class="admin-badge admin-badge--${badge}" title="${esc(row.action || '')}">${esc(actionLabel(row.action))}</span><br><span class="admin-hint"><code>${esc(row.action || '')}</code></span></td>
          <td>${target}</td>
          <td class="admin-monitor-detail">${detail ? esc(detail) : '<span class="admin-hint">—</span>'}</td>
          <td class="admin-monitor-detail">${change ? `<code title="${esc(change)}">${esc(change.length > 90 ? change.slice(0, 88) + '…' : change)}</code>` : '<span class="admin-hint">—</span>'}</td>
        </tr>`;
        })
        .join('');
      showMsg($('auditMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('auditMsg'), friendlyFetchError(e), false);
    }
  })();
}
