/* 激活码：生成 / 分类筛选 / 启停 */

import { $, esc, showMsg, toast } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['激活码', '生成、筛选与启停兑换码'];

const PAGE = 20;
let offset = 0;
let category = 'all';

export function init() {
  $('codeSearchBtn')?.addEventListener('click', () => void load(true));
  $('codeFilterActive')?.addEventListener('change', () => void load(true));
  $('codePrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('codeNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
  $('createCodeBtn')?.addEventListener('click', () => void createCodes());
  document.querySelectorAll('[data-code-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      category = btn.getAttribute('data-code-category') || 'all';
      document.querySelectorAll('[data-code-category]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      void load(true);
    });
  });
  $('panel-codes')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-toggle-code]');
    if (!btn) return;
    void toggleCode(btn.getAttribute('data-toggle-code'), btn.getAttribute('data-active') === '1', btn);
  });
}

export function load(reset) {
  if (reset) offset = 0;
  const q = ($('codeSearch')?.value || '').trim().toUpperCase();
  const active = $('codeFilterActive')?.value || '';
  const tbody = $('codeTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
  void (async () => {
    try {
      let path = `/api/admin/codes?limit=${PAGE}&offset=${offset}`;
      if (q) path += '&q=' + encodeURIComponent(q);
      if (active) path += '&active=' + active;
      if (category !== 'all') path += '&category=' + encodeURIComponent(category);
      const data = await adminFetch(path);
      $('codePageInfo').textContent = `第 ${offset + 1}–${offset + data.items.length} 条，约 ${data.total} 个码`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((row) => {
          const tierLabel =
            row.membership_tier === 'lite' ? '轻量'
            : row.membership_tier === 'basic' ? '基础'
            : row.membership_tier === 'standard' ? '标准'
            : row.membership_tier === 'pro' ? '专业'
            : row.membership_tier || '';
          const extra =
            row.membership_tier && row.membership_days
              ? ` + ${row.membership_days}天${tierLabel}`
              : row.membership_days
                ? ` + ${row.membership_days}天会员`
                : '';
          return `<tr>
            <td><code>${esc(row.code)}</code></td>
            <td>${row.credits}${extra}</td>
            <td>${row.used_count}/${row.max_uses}</td>
            <td>${row.active ? '<span class="admin-badge admin-badge--ok">启用</span>' : '<span class="admin-badge admin-badge--off">停用</span>'}</td>
            <td>${esc(row.note || '—')}</td>
            <td>
              <button type="button" class="admin-btn admin-btn--sm" data-toggle-code="${esc(row.code)}" data-active="${row.active ? '0' : '1'}">${row.active ? '停用' : '启用'}</button>
            </td>
          </tr>`;
        })
        .join('');
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('codeMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function toggleCode(code, active, btn) {
  try {
    btn.disabled = true;
    await adminFetch('/api/admin/codes/' + encodeURIComponent(code), {
      method: 'PATCH',
      body: { active }
    });
    toast('激活码已更新', true);
    void load(false);
  } catch (e) {
    showMsg($('codeMsg'), friendlyFetchError(e), false);
    btn.disabled = false;
  }
}

async function createCodes() {
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
    const data = await adminFetch('/api/admin/codes', { method: 'POST', body });
    $('codeOutput').textContent = (data.codes || []).join('\n');
    showMsg($('codeMsg'), `已生成 ${data.created} 个码`, true);
    toast(`已生成 ${data.created} 个激活码`, true);
    void load(true);
  } catch (e) {
    showMsg($('codeMsg'), friendlyFetchError(e), false);
  }
}
