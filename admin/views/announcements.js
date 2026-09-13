/* 公告管理：发布 / 下线 / 编辑通知（存 site_settings.announcements） */

import { $, esc, fullTime, showMsg, toast, adminConfirm } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['公告管理', '发布 / 编辑 / 下线站点公告（登录后弹窗、每日首次）'];

let items = [];
let editingIndex = -1;

function escAttr(s) {
  return esc(s);
}

const SCOPE_LABEL = { all: '卡片库 + 画布', warehouse: '仅卡片库', canvas: '仅画布' };

function scopeLabel(a) {
  return SCOPE_LABEL[a.scope] || SCOPE_LABEL.all;
}

function renderList() {
  const box = $('annList');
  if (!box) return;
  if (!items.length) {
    box.innerHTML = '<p class="admin-hint">暂无公告，点击「新增公告」发布第一条。</p>';
    return;
  }
  box.innerHTML = items.map((a, i) => `
    <div class="admin-ann-item${a.active === false ? ' is-off' : ''}">
      <div class="admin-ann-main">
        <div class="admin-ann-status">
          <span class="admin-badge ${a.active === false ? 'admin-badge--off' : 'admin-badge--ok'}">${a.active === false ? '已下线' : '发布中'}</span>
          <span class="admin-badge">${esc(scopeLabel(a))}</span>
          <span class="admin-hint">${esc(a.startAt ? fullTime(a.startAt) : '—')}${a.endAt ? ' ~ ' + esc(fullTime(a.endAt)) : ''}</span>
        </div>
        <p class="admin-ann-text">${esc(a.text)}</p>
        <code class="admin-hint">${esc(a.id)}</code>
      </div>
      <div class="admin-ann-actions">
        <button type="button" class="admin-btn admin-btn--sm" data-ann-edit="${i}">编辑</button>
        ${a.active === false
          ? `<button type="button" class="admin-btn admin-btn--sm" data-ann-on="${i}">发布</button>`
          : `<button type="button" class="admin-btn admin-btn--sm" data-ann-off="${i}">下线</button>`}
        <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-ann-del="${i}">删除</button>
      </div>
    </div>`).join('');
}

function setEditor(item) {
  $('annText').value = item?.text || '';
  $('annStart').value = item?.startAt ? String(item.startAt).slice(0, 16) : '';
  $('annScope').value = SCOPE_LABEL[item?.scope] ? item.scope : 'all';
  $('annActive').checked = item?.active !== false;
}

function readEditor() {
  const text = ($('annText')?.value || '').trim();
  if (!text) { toast('请输入公告内容', false); return null; }
  const startRaw = $('annStart')?.value;
  return {
    text,
    startAt: startRaw ? new Date(startRaw).toISOString() : new Date().toISOString(),
    scope: SCOPE_LABEL[$('annScope')?.value] ? $('annScope').value : 'all',
    active: $('annActive')?.checked !== false
  };
}

export function init() {
  $('annNewBtn')?.addEventListener('click', () => {
    editingIndex = -1;
    setEditor({ text: '', startAt: '', active: true });
    $('annEditor').hidden = false;
    $('annText').focus();
  });
  $('annCancelBtn')?.addEventListener('click', () => {
    $('annEditor').hidden = true;
    editingIndex = -1; // 不复位会让后续静默保存误入编辑器分支（2026-09-13 实测根因之一）
  });
  $('annSaveBtn')?.addEventListener('click', () => void save());
  const list = $('annList');
  list?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-ann-edit]');
    if (editBtn) {
      const i = Number(editBtn.getAttribute('data-ann-edit'));
      editingIndex = i;
      const item = items[i];
      if (item) {
        $('annEditor').hidden = false;
        setEditor(item);
      }
      return;
    }
    const onBtn = e.target.closest('[data-ann-on]');
    if (onBtn) {
      const i = Number(onBtn.getAttribute('data-ann-on'));
      if (items[i]) { items[i].active = true; void save(true); }
      return;
    }
    const offBtn = e.target.closest('[data-ann-off]');
    if (offBtn) {
      const i = Number(offBtn.getAttribute('data-ann-off'));
      if (items[i]) { items[i].active = false; void save(true); }
      return;
    }
    const delBtn = e.target.closest('[data-ann-del]');
    if (delBtn) {
      const i = Number(delBtn.getAttribute('data-ann-del'));
      void (async () => {
        const ok = await adminConfirm({ title: '删除公告', message: '确定删除这条公告？不可恢复。', danger: true, confirmLabel: '确认删除' });
        if (!ok) return;
        items.splice(i, 1);
        void save(true);
      })();
    }
  });
}

export function load() {
  const box = $('annList');
  if (box) box.innerHTML = '<p class="admin-hint">加载中…</p>';
  void (async () => {
    try {
      const d = await adminFetch('/api/admin/announcements');
      items = d.items || [];
      renderList();
      $('annEditor').hidden = true;
      showMsg($('annMsg'), '', true);
    } catch (e) {
      if (box) box.innerHTML = '';
      showMsg($('annMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function save(silent) {
  const btn = $('annSaveBtn');
  if (!silent && btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    // 静默保存（下线/发布/删除）绝不读编辑器：items 已被对应操作直接改好。
    // 之前 editingIndex 残留时静默保存会走进编辑器分支——隐藏编辑器空文本校验
    // 直接 return（请求不发、看似没反应），或用旧快照把改动覆盖回去。
    if (silent) {
      // no editor involvement
    } else if (editingIndex >= 0 && editingIndex < items.length) {
      const edited = readEditor();
      if (!edited) return;
      items[editingIndex] = { ...items[editingIndex], ...edited };
    } else {
      const created = readEditor();
      if (!created) return;
      items.push({ id: 'ann-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), ...created });
    }
    editingIndex = -1;
    await adminFetch('/api/admin/announcements', { method: 'PUT', body: { items } });
    renderList();
    $('annEditor').hidden = true;
    showMsg($('annMsg'), '公告已保存', true);
    if (!silent) toast('公告已保存', true);
  } catch (e) {
    showMsg($('annMsg'), friendlyFetchError(e), false);
    toast(friendlyFetchError(e), false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存公告'; }
  }
}
