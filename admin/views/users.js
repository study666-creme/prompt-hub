/* 用户：搜索 / 列表 / 详情（改积分走 RPC、封禁、流水直链） */

import { $, esc, adminConfirm, closeUserModal, fromDatetimeLocal, openUserModal, showMsg, toast, toDatetimeLocal, setButtonBusy } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';
import { navigate } from '../modules/router.js';

export const title = ['用户管理', '搜索、积分、会员与封禁'];

const PAGE = 20;
let offset = 0;

export function init() {
  $('userSearchBtn')?.addEventListener('click', () => void load(true));
  $('userSearchClear')?.addEventListener('click', () => {
    const input = $('userSearch');
    if (input) input.value = '';
    void load(true);
  });
  $('userSearch')?.addEventListener('focus', () => {
    const input = $('userSearch');
    if (input?.value && /@/.test(input.value)) input.value = '';
  });
  let searchTimer = 0;
  $('userSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(true), 400);
  });
  $('userSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load(true);
  });
  $('userPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('userNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeUserModal);
  });
}

export function load(reset = true) {
  if (reset) offset = 0;
  const q = ($('userSearch')?.value || '').trim();
  const tbody = $('userTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="7">加载中…</td></tr>';
  void (async () => {
    try {
      const data = await adminFetch(
        `/api/admin/users?limit=${PAGE}&offset=${offset}${q ? '&q=' + encodeURIComponent(q) : ''}`
      );
      $('userPageInfo').textContent = `第 ${offset + 1}–${offset + data.items.length} 条，约 ${data.total} 用户`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="7">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((u) => {
          const sq = u.storageQuota || {};
          const quotaCell = esc(sq.summaryLabel || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`);
          const tierCell = u.membershipActive
            ? '<span class="admin-badge admin-badge--ok">' + esc(u.membershipTierLabel) + '</span>'
            : '<span class="admin-badge">免费</span>';
          return `<tr>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.displayName || '—')}${u.banned ? ' <span class="admin-badge admin-badge--off" title="' + esc(u.banReason || '') + '">已封禁</span>' : ''}</td>
            <td>${u.creditsPermanent} + 日${u.dailyCredits}</td>
            <td>${tierCell}</td>
            <td>${esc(u.storageLabel)}</td>
            <td>${quotaCell}</td>
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
      showMsg($('userMsg'), friendlyFetchError(e), false);
    }
  })();
}

export async function showUserDetail(userId) {
  const box = $('userModalBody');
  if (!box) return;
  openUserModal();
  box.innerHTML = '<p class="admin-hint">加载中…</p>';
  try {
    const u = await adminFetch('/api/admin/users/' + encodeURIComponent(userId));
    $('userModalTitle').textContent = u.displayName || u.email || '用户管理';
    const sq = u.storageQuota || {};
    const storageQuotaText = sq.summaryLabel || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`;
    const reds = (u.recentRedemptions || [])
      .map((r) => `<li>${esc(r.code)} · ${esc(r.redeemed_at || '')}</li>`)
      .join('');
    const banBlock = u.banned
      ? `<h3 style="margin:20px 0 10px;font-size:15px;color:var(--danger)">封禁状态</h3>
         <p class="admin-hint">该账号已于 ${esc(u.bannedAt?.slice(0, 16).replace('T', ' ') || '—')} 被封禁。${u.banReason ? '原因：' + esc(u.banReason) : ''}</p>
         <button type="button" class="admin-btn" id="unbanBtn">解除封禁</button>`
      : `<h3 style="margin:20px 0 10px;font-size:15px">封禁账号</h3>
         <p class="admin-hint">封禁后该用户无法登录/调用，数据保留，可随时解封。</p>
         <div class="admin-field">
           <label for="banReasonInput">封禁原因（选填）</label>
           <input type="text" id="banReasonInput" maxlength="300" placeholder="如：违规内容、刷积分">
         </div>
         <button type="button" class="admin-btn admin-btn--danger" id="banBtn">封禁此用户</button>`;
    box.innerHTML = `
      <div class="admin-detail-readonly">
        <dl>
          <dt>邮箱</dt><dd>${esc(u.email || '—')}</dd>
          <dt>昵称</dt><dd>${esc(u.displayName || '—')}</dd>
          <dt>用户 ID</dt><dd><code>${esc(u.userId)}</code></dd>
          <dt>云端卡片数</dt><dd>${u.cardCount ?? 0} 张</dd>
          <dt>云存储</dt><dd>${esc(storageQuotaText)}</dd>
          <dt>累计消耗</dt><dd>${u.lifetimeCreditsSpent ?? 0} 积分</dd>
          <dt>云同步</dt><dd>${esc(u.cloudUpdatedAt || '—')}</dd>
        </dl>
        ${reds ? '<p><strong>最近兑换</strong></p><ul>' + reds + '</ul>' : ''}
        <p><button type="button" class="admin-btn admin-btn--sm" id="viewLedgerBtn">查看积分流水 →</button></p>
      </div>
      <h3 style="margin:16px 0 10px;font-size:15px">调整积分 / 会员</h3>
      <p class="admin-hint">积分修改会写入流水（reason=admin_manual），可审计。</p>
      <div class="admin-form-grid">
        <div class="admin-field" style="margin:0">
          <label for="editCredits">永久积分</label>
          <input type="number" id="editCredits" min="0" step="0.1" value="${Number(u.creditsPermanent) || 0}">
        </div>
        <div class="admin-field" style="margin:0">
          <label for="editDaily">当日积分</label>
          <input type="number" id="editDaily" min="0" step="0.1" value="${Number(u.dailyCredits) || 0}">
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
      ${banBlock}
      <h3 style="margin:20px 0 10px;font-size:15px;color:var(--danger)">删除账号</h3>
      <p class="admin-hint">会删除 Auth 账号、数据库资料及存储文件，不可恢复。优先考虑封禁。</p>
      <div class="admin-field">
        <label for="deleteConfirm">输入邮箱 <strong>${esc(u.email || '')}</strong> 确认删除</label>
        <input type="text" id="deleteConfirm" autocomplete="off" placeholder="完整邮箱">
      </div>
      <button type="button" class="admin-btn admin-btn--danger" id="deleteUserBtn">永久删除此用户</button>
    `;

    $('viewLedgerBtn')?.addEventListener('click', () => {
      closeUserModal();
      navigate('ledger', new URLSearchParams({ userId: u.userId }));
    });
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
    $('banBtn')?.addEventListener('click', () => void toggleBan(u, true));
    $('unbanBtn')?.addEventListener('click', () => void toggleBan(u, false));
    $('deleteUserBtn')?.addEventListener('click', () => void deleteUser(u));
  } catch (e) {
    box.innerHTML = '<p class="admin-msg admin-msg--err">' + esc(friendlyFetchError(e)) + '</p>';
  }
}

async function toggleBan(u, banned) {
  const reason = banned ? ($('banReasonInput')?.value || '').trim() : undefined;
  const ok = await adminConfirm({
    title: banned ? '封禁账号' : '解除封禁',
    message: banned
      ? `封禁 ${u.email || u.displayName || u.userId}？\n\n该用户将无法登录与调用，数据保留，可随时解封。`
      : `恢复 ${u.email || u.displayName || u.userId} 的访问权限？`,
    confirmLabel: banned ? '确认封禁' : '确定',
    danger: banned
  });
  if (!ok) return;
  const btn = banned ? $('banBtn') : $('unbanBtn');
  setButtonBusy(btn, true, '处理中…');
  try {
    await adminFetch(`/api/admin/users/${encodeURIComponent(u.userId)}/ban`, {
      method: 'POST',
      body: { banned, reason }
    });
    toast(banned ? '已封禁' : '已解封', true);
    closeUserModal();
    void load(false);
  } catch (e) {
    toast('操作失败：' + friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function saveUser(u) {
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

  const btn = $('saveUserBtn');
  setButtonBusy(btn, true, '保存中…');
  try {
    await adminFetch('/api/admin/users/' + encodeURIComponent(u.userId), {
      method: 'PATCH',
      body
    });
    toast('已保存（积分变更已记流水）', true);
    void load(false);
    void showUserDetail(u.userId);
  } catch (e) {
    toast(friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function deleteUser(u) {
  const typed = ($('deleteConfirm')?.value || '').trim();
  if (!u.email || typed !== u.email) {
    toast('请输入完整邮箱以确认删除', false);
    return;
  }
  const ok = await adminConfirm({
    title: '永久删除账号',
    message: `确定永久删除 ${u.email} ？\n\n将删除 Auth 账号、数据库资料与存储文件，不可撤销。已写入审计日志。`,
    confirmLabel: '确认删除',
    danger: true
  });
  if (!ok) return;

  const btn = $('deleteUserBtn');
  setButtonBusy(btn, true, '删除中…');
  try {
    const res = await adminFetch('/api/admin/users/' + encodeURIComponent(u.userId), {
      method: 'DELETE'
    });
    toast('已删除，清理图片 ' + (res.storageFilesRemoved || 0) + ' 个', true);
    closeUserModal();
    void load(true);
  } catch (e) {
    toast(friendlyFetchError(e), false);
    setButtonBusy(btn, false);
  }
}
