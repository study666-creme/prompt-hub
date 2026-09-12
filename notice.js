/* __PROMPT_HUB_NOTICE__ notice.js
 * 站点公告：登录后拉取 /api/v1/announcements，若有当天未读通知则弹一次横幅卡片。
 * 用主站同款浮层，视觉贴合站点风格。点击"我知道了"调 seen 接口，当日不再弹。
 */
(function () {
  'use strict';
  if (window.__PH_NOTICE_LOADED__) return;
  window.__PH_NOTICE_LOADED__ = true;

  function apiBase() {
    return String(window.API_BASE_URL || '').replace(/\/$/, '');
  }
  function getToken() {
    try {
      const s = window.SupabaseSync?.getSession?.();
      return s?.access_token || s?.user?.access_token || null;
    } catch (e) { return null; }
  }

  async function fetchAnnouncements() {
    const base = apiBase();
    const token = getToken();
    if (!base || !token) return null;
    try {
      const res = await fetch(base + '/api/v1/announcements', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j?.ok ? j.data : null;
    } catch (e) {
      console.warn('[notice] fetch failed', e);
      return null;
    }
  }

  // 与服务端一致的 UTC 日期键；本地已读兜底解决网络失败/同步覆盖导致的当天重复弹出
  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function localSeenToday(id) {
    try {
      return localStorage.getItem('ph_notice_seen_' + id) === todayKey();
    } catch (e) {
      return false;
    }
  }

  function markLocalSeen(id) {
    try {
      localStorage.setItem('ph_notice_seen_' + id, todayKey());
    } catch (e) { /* 存储不可用时忽略 */ }
  }

  async function markSeen(id) {
    markLocalSeen(id);
    const base = apiBase();
    const token = getToken();
    if (!base || !token) return;
    try {
      const res = await fetch(base + '/api/v1/announcements/' + encodeURIComponent(id) + '/seen', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store'
      });
      if (!res.ok) console.warn('[notice] seen mark rejected', res.status);
    } catch (e) { /* 标记失败不阻断：本地已兜底 */ }
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showAnnouncement(item) {
    const existing = document.getElementById('phNoticeModal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'notice-overlay';
    overlay.id = 'phNoticeModal';
    overlay.innerHTML = `
      <div class="notice-card" role="dialog" aria-modal="true" aria-labelledby="phNoticeTitle">
        <button type="button" class="notice-close" aria-label="关闭">✕</button>
        <div class="notice-mark" aria-hidden="true">📢</div>
        <h3 id="phNoticeTitle">公告</h3>
        <div class="notice-text">${esc(item.text).replace(/\n/g, '<br>')}</div>
        <button type="button" class="notice-ok">我知道了</button>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('notice-open');
    const close = () => {
      overlay.remove();
      document.body.classList.remove('notice-open');
      markSeen(item.id);
    };
    overlay.querySelector('.notice-close').onclick = close;
    overlay.querySelector('.notice-ok').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  let lastCheckAt = 0;
  async function maybeShow() {
    // 防抖：同一会话 60s 内不重复拉
    const now = Date.now();
    if (now - lastCheckAt < 60000) return;
    lastCheckAt = now;
    const data = await fetchAnnouncements();
    if (!data?.items || data.hasUnread === false) return;
    const unread = data.items.find(i => !i.readToday);
    if (!unread) return;
    // 服务端已读可能被同步覆盖或网络失败丢失；本地兜底保证当天不再弹
    if (localSeenToday(unread.id)) return;
    showAnnouncement(unread);
  }

  function tryCheck() {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    setTimeout(maybeShow, 600); // 等登录后 UI 稳定
  }

  window.addEventListener('ph-auth-complete', tryCheck);
  // 启动时若已登录也检查一次（刷新场景）
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryCheck, 800));
})();
