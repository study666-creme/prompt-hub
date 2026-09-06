/* Shared DOM helpers: escaping, toasts, confirm modal, busy buttons, format. */

export function $(id) {
  return document.getElementById(id);
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(2) + ' MB';
  return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function monitorNumber(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

export function monitorPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return (n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0) + '%';
}

export function monitorTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function fullTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('zh-CN');
}

export function showMsg(el, text, ok) {
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'admin-msg ' + (ok ? 'admin-msg--ok' : 'admin-msg--err');
}

let toastTimer = 0;
export function toast(text, ok, holdMs) {
  const el = $('adminToast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'admin-toast ' + (ok ? 'is-ok' : 'is-err');
  if (text) toastTimer = setTimeout(() => (el.hidden = true), holdMs || (ok ? 5200 : 6800));
}

export function setButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || '';
    btn.textContent = busyLabel || '处理中…';
    btn.classList.add('is-busy');
    btn.disabled = true;
    return;
  }
  btn.textContent = btn.dataset.idleLabel || btn.textContent;
  btn.classList.remove('is-busy');
  btn.disabled = false;
}

/* ---------- confirm modal ---------- */

let confirmResolver = null;

export function closeAdminConfirm(result) {
  const modal = $('adminConfirmModal');
  if (modal) modal.hidden = true;
  const resolve = confirmResolver;
  confirmResolver = null;
  if (typeof resolve === 'function') resolve(!!result);
}

export function adminConfirm(opts) {
  const modal = $('adminConfirmModal');
  const titleEl = $('adminConfirmTitle');
  const msgEl = $('adminConfirmMessage');
  const okBtn = $('adminConfirmOkBtn');
  if (!modal || !titleEl || !msgEl || !okBtn) {
    return Promise.resolve(window.confirm(String(opts?.message || opts?.title || '继续？')));
  }
  titleEl.textContent = opts?.title || '请确认';
  msgEl.textContent = opts?.message || '';
  okBtn.textContent = opts?.confirmLabel || '确定';
  okBtn.className = opts?.danger
    ? 'admin-btn admin-btn--danger'
    : 'admin-btn admin-btn--primary';
  modal.hidden = false;
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

export function setupConfirmModal() {
  if (document.body.dataset.adminConfirmBound === '1') return;
  document.body.dataset.adminConfirmBound = '1';
  $('adminConfirmOkBtn')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeAdminConfirm(true);
  });
  $('adminConfirmCancelBtn')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeAdminConfirm(false);
  });
  document.querySelectorAll('[data-confirm-cancel]').forEach((el) => {
    if (el.id === 'adminConfirmCancelBtn') return;
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeAdminConfirm(false);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmResolver) closeAdminConfirm(false);
  });
}

/* ---------- user modal ---------- */

export function openUserModal() {
  const m = $('userModal');
  if (m) m.hidden = false;
}

export function closeUserModal() {
  const m = $('userModal');
  if (m) m.hidden = true;
  const body = $('userModalBody');
  if (body) body.innerHTML = '';
}

export function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
