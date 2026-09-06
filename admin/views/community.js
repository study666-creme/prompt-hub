/* 社区：在线帖管理（桶内孤儿视图已下线，如需清理请用 scripts 工具） */

import { $, esc, showMsg, toast, adminConfirm, setButtonBusy } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['社区内容', '下架、删除、写回与无效帖清理'];

const PAGE = 20;
let offset = 0;

export function init() {
  $('communitySearchBtn')?.addEventListener('click', () => void load(true));
  $('communitySearchClear')?.addEventListener('click', () => {
    const input = $('communitySearch');
    if (input) input.value = '';
    void load(true);
  });
  $('communitySearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load(true);
  });
  $('communityPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('communityNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
  $('communityPurgePreviewBtn')?.addEventListener('click', () => void purgePreview());
  $('communityPurgeBtn')?.addEventListener('click', () => void purge());
  $('panel-community')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-post-action]');
    if (!btn) return;
    void rowAction(btn.getAttribute('data-post-action'), btn.getAttribute('data-post-id'), btn);
  });
}

function communityThumbCell(p) {
  if (!p?.thumbUrl) return '<div class="admin-thumb-wrap"><span class="admin-hint">无预览</span></div>';
  const fb = esc(p.thumbFallbackUrl || p.thumbUrl);
  const src = esc(p.thumbUrl);
  return `<div class="admin-thumb-wrap"><img class="admin-thumb" src="${src}" data-fallback="${fb}" alt="" loading="lazy"><span class="admin-thumb-label">裂</span></div>`;
}

function communityImageStatusCell(p) {
  const img = String(p?.image || '').trim();
  if (!img) return '<span class="admin-badge admin-badge--warn" title="数据库无 image 字段">无图</span>';
  if (/^https?:\/\//i.test(img) && !/api\.prompt-hubs\.com/i.test(img)) {
    return '<span class="admin-badge admin-badge--warn" title="第三方直链，易 404 失效">外链</span>';
  }
  if (/card-images|\/media\//i.test(img)) {
    return '<span class="admin-badge admin-badge--ok" title="Storage / R2 路径">桶</span>';
  }
  return '<span class="admin-hint" title="' + esc(img) + '">其他</span>';
}

function communityCardLibBadge(item) {
  if (item.cardInLibrary === true) return '<span class="admin-badge admin-badge--ok">有</span>';
  if (item.cardInLibrary === false) return '<span class="admin-badge admin-badge--warn">无</span>';
  return '<span class="admin-hint">—</span>';
}

export function load(reset) {
  if (reset) offset = 0;
  const tbody = $('communityTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="8">加载中…</td></tr>';
  const q = ($('communitySearch')?.value || '').trim();
  void (async () => {
    try {
      const st = await adminFetch('/api/admin/community/stats');
      const statsEl = $('communityStats');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="admin-stat admin-stat--blue"><span>在线帖</span><strong>${st.publishedCount ?? 0}</strong></div>
          <div class="admin-stat admin-stat--slate"><span>已隐藏（库内）</span><strong>${st.unpublishedCount ?? 0}</strong></div>`;
      }
      const data = await adminFetch(
        `/api/admin/community/posts?limit=${PAGE}&offset=${offset}${q ? '&q=' + encodeURIComponent(q) : ''}&view=published`
      );
      const items = data.items || [];
      $('communityPageInfo').textContent = `第 ${offset + 1}–${offset + items.length} 条，约 ${data.total ?? items.length} 帖`;
      const prev = $('communityPrev');
      const next = $('communityNext');
      if (prev) prev.disabled = offset <= 0;
      if (next) next.disabled = offset + items.length >= (data.total ?? items.length);
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="admin-hint">暂无在线社区帖</td></tr>';
        return;
      }
      tbody.innerHTML = items
        .map((p) => `<tr>
          <td>${communityThumbCell(p)}</td>
          <td>${esc(p.authorName || '用户')}<br><span class="admin-hint">${esc((p.authorId || '').slice(0, 8))}…</span></td>
          <td title="${esc(p.promptPreview || '')}">${esc((p.promptPreview || '').slice(0, 48))}${(p.promptPreview || '').length > 48 ? '…' : ''}</td>
          <td>${communityCardLibBadge(p)}${p.sourceCardId ? `<br><span class="admin-hint">${esc(String(p.sourceCardId).slice(0, 16))}…</span>` : ''}</td>
          <td>${communityImageStatusCell(p)}</td>
          <td>${p.likes ?? 0}</td>
          <td>${esc((p.createdAt || '').slice(0, 10))}</td>
          <td class="admin-actions-cell">
            ${p.cardInLibrary === false ? `<button type="button" class="admin-btn admin-btn--sm" data-post-action="restore" data-post-id="${esc(p.id)}">写回</button> ` : ''}
            <button type="button" class="admin-btn admin-btn--sm" data-post-action="unpublish" data-post-id="${esc(p.id)}">隐藏</button>
            <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-post-action="delete" data-post-id="${esc(p.id)}">删除</button>
          </td>
        </tr>`)
        .join('');
      // broken-image fallback (no inline onerror)
      tbody.querySelectorAll('img.admin-thumb').forEach((img) => {
        img.addEventListener('error', () => {
          if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
          else img.classList.add('is-broken');
        }, { once: false });
      });
      showMsg($('communityMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('communityMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function rowAction(action, id, btn) {
  if (!id) return;
  const spec = {
    restore: {
      title: '写回卡片库',
      message: '将该社区帖写回作者云端卡片库？（不会重新发布到社区）',
      path: `/api/admin/community/posts/${encodeURIComponent(id)}/restore`,
      body: undefined,
      danger: false
    },
    unpublish: {
      title: '从社区隐藏',
      message: '仅从社区隐藏该帖？图片与卡片库记录保留。',
      path: `/api/admin/community/posts/${encodeURIComponent(id)}/unpublish`,
      body: undefined,
      danger: false
    },
    delete: {
      title: '永久删除',
      message: '永久删除该社区帖，并删除 Storage/R2 中的配图？\n\n不可恢复。',
      path: `/api/admin/community/posts/${encodeURIComponent(id)}/delete`,
      body: { deleteStorage: true },
      danger: true
    }
  }[action];
  if (!spec) return;
  const ok = await adminConfirm({
    title: spec.title,
    message: spec.message,
    confirmLabel: spec.danger ? '确认删除' : '确定',
    danger: spec.danger
  });
  if (!ok) return;
  setButtonBusy(btn, true, '处理中…');
  try {
    await adminFetch(spec.path, { method: 'POST', body: spec.body, timeoutMs: 120000, retries: 1 });
    toast('操作成功', true);
    void load(false);
  } catch (e) {
    toast('操作失败：' + friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function purgePreview() {
  const btn = $('communityPurgePreviewBtn');
  const ok = await adminConfirm({
    title: '预览清理',
    message: '将扫描所有在线帖（约 1～2 分钟），统计会被下架的数量，不修改数据。继续？'
  });
  if (!ok) return;
  setButtonBusy(btn, true, '扫描中…');
  try {
    const r = await adminFetch('/api/admin/community/purge-ghosts/preview', { timeoutMs: 180000 });
    showMsg($('communityMsg'), `预览：将下架 ${r.total || 0} 条（删卡孤儿 ${r.orphans || 0}，无图/无效 ${r.missing || 0}，重复 ${r.duplicates || 0}）`, true);
  } catch (e) {
    showMsg($('communityMsg'), friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function purge() {
  const btn = $('communityPurgeBtn');
  const ok = await adminConfirm({
    title: '清理无效社区帖',
    message: '将检查所有已发布社区帖：作者卡片库已删 / Storage 无图片 / 无效作者 / 重复卡片。\n\n会被下架（published=false）。继续？',
    confirmLabel: '开始清理'
  });
  if (!ok) return;
  setButtonBusy(btn, true, '清理中…');
  try {
    const r = await adminFetch('/api/admin/community/purge-ghosts', { method: 'POST', timeoutMs: 180000 });
    const text = `已下架 ${r.unpublishedTotal || 0} 条（删卡孤儿 ${r.unpublishedOrphans || 0}，无图 ${r.unpublishedMissing || 0}，重复 ${r.unpublishedDuplicates || 0}）· 仍在线 ${r.publishedRemaining ?? '—'} 条`;
    showMsg($('communityMsg'), text, true);
    toast(text, true);
    void load(false);
  } catch (e) {
    showMsg($('communityMsg'), friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}
