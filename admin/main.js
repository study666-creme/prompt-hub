/* Admin console entry: registers views, drives hash routing, handles login. */

import { $, adminConfirm, closeAdminConfirm, closeUserModal, esc, setupConfirmModal, showMsg, toast } from './modules/ui.js';
import { adminFetch, apiBase, clearSession, friendlyFetchError, resolveApiBase, saveSession, session } from './modules/api.js';

import * as overview from './views/overview.js';
import * as users from './views/users.js';
import * as orders from './views/orders.js';
import * as ledger from './views/ledger.js';
import * as audit from './views/audit.js';
import * as announcements from './views/announcements.js';
import * as videoCatalog from './views/video-catalog.js';
import * as cards from './views/cards.js';
import * as community from './views/community.js';
import * as codes from './views/codes.js';
import * as models from './views/models.js';
import * as canvas from './views/canvas.js';

const VIEWS = {
  overview,
  users,
  orders,
  ledger,
  audit,
  cards,
  community,
  codes,
  models,
  canvas,
  announcements,
  videoCatalog
};

const NAV_ORDER = ['overview', 'users', 'orders', 'ledger', 'cards', 'community', 'codes', 'models', 'canvas', 'announcements', 'videoCatalog', 'audit'];
const NAV_LABELS = {
  overview: '概览',
  users: '用户',
  orders: '订单',
  ledger: '积分流水',
  cards: '卡片库',
  community: '社区',
  codes: '激活码',
  models: '生图模型',
  canvas: '生图任务',
  announcements: '公告管理',
  videoCatalog: '视频目录',
  audit: '操作审计'
};

function isConsolePage() {
  return document.body?.dataset?.adminPage === 'console' || !!$('adminApp');
}

function updateApiChip() {
  const chip = $('adminApiChip');
  if (!chip) return;
  const base = apiBase();
  chip.textContent = base.replace(/^https?:\/\//, '');
  chip.title = base;
}

function setPageTitle(tab) {
  const meta = VIEWS[tab]?.title || VIEWS.overview.title;
  const t = $('adminPageTitle');
  const s = $('adminPageSubtitle');
  if (t) t.textContent = meta[0];
  if (s) s.textContent = meta[1];
}

function renderNav(activeTab) {
  const nav = $('adminNav');
  if (!nav) return;
  nav.innerHTML = NAV_ORDER
    .map((tab) => `<button type="button" class="admin-tab${tab === activeTab ? ' is-active' : ''}" data-tab="${tab}"><span class="admin-tab-icon admin-tab-icon--${tab}" aria-hidden="true"></span>${NAV_LABELS[tab]}</button>`)
    .join('');
  nav.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeAdminConfirm(false);
      window.location.hash = `#/${btn.dataset.tab}`;
    });
  });
}

function showTab(tab, params) {
  const view = VIEWS[tab] || VIEWS.overview;
  renderNav(tab);
  setPageTitle(tab);
  document.querySelectorAll('.admin-panel').forEach((p) => (p.hidden = p.id !== `panel-${tab}`));
  if (!$(`panel-${tab}`)) tab = 'overview';
  view.load(params);
}

/* ---------- login ---------- */

async function submitAdminLogin() {
  const btn = $('loginBtn');
  const secret = $('adminSecret')?.value?.trim();
  if (!secret) {
    showMsg($('loginMsg'), '请填写访问密钥', false);
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = '验证中…';
  }
  try {
    saveSession({ secret, apiBase: resolveApiBase() });
    await adminFetch('/api/admin/dashboard/infra', { timeoutMs: 20000 });
    showApp(true);
    showMsg($('loginMsg'), '', true);
    window.location.hash = '#/overview';
  } catch (e) {
    clearSession();
    showApp(false);
    showMsg($('loginMsg'), friendlyFetchError(e), false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = '登录';
    }
  }
}

async function validateStoredSession() {
  if (!session?.secret) return;
  try {
    await adminFetch('/api/admin/dashboard/infra', { timeoutMs: 12000 });
    showApp(true);
  } catch (e) {
    const msg = String(e?.message || e || '');
    const authFailed =
      e?.status === 401 || e?.code === 'UNAUTHORIZED' || /UNAUTHORIZED|管理员密钥无效/i.test(msg);
    if (!authFailed) {
      showApp(true);
      toast('API 暂时不可用，登录状态已保留。' + friendlyFetchError(e), false, 9000);
      return;
    }
    clearSession();
    showApp(false);
    showMsg($('loginMsg'), '登录已过期，请重新输入密钥', false);
  }
}

function showApp(loggedIn) {
  const mode = document.body?.dataset?.adminPage || ($('adminApp') ? 'console' : 'login');
  document.body.classList.toggle('admin-gate', mode === 'login' || !loggedIn);
  document.body.classList.toggle('admin-is-authenticated', !!loggedIn);
  const login = $('adminLogin');
  const app = $('adminApp');
  if (login) login.hidden = mode === 'console' || loggedIn;
  if (app) app.hidden = !loggedIn;
  document.title = loggedIn ? 'Prompt Hub 运营控制台' : 'Prompt Hub 管理登录';
  updateApiChip();
  if (mode === 'login' && loggedIn) window.location.replace('admin.html');
  if (mode === 'console' && !loggedIn) window.location.replace('admin-login.html');
}

/* ---------- boot ---------- */

function init() {
  setupConfirmModal();

  $('adminRefreshBtn')?.addEventListener('click', () => {
    const btn = $('adminRefreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
    }
    const tab = (window.location.hash.replace(/^#\/?/, '').split('?')[0]) || 'overview';
    const view = VIEWS[tab] || VIEWS.overview;
    Promise.resolve(view.load()).finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
      toast('已刷新', true, 1800);
    });
  });

  $('logoutBtn')?.addEventListener('click', () => {
    clearSession();
    showApp(false);
  });

  $('loginBtn')?.addEventListener('click', () => void submitAdminLogin());
  $('adminSecret')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitAdminLogin();
    }
  });
  $('adminShowSecret')?.addEventListener('change', (e) => {
    const input = $('adminSecret');
    if (input) input.type = e.target.checked ? 'text' : 'password';
  });

  for (const view of Object.values(VIEWS)) {
    try {
      view.init();
    } catch (e) {
      console.error('[admin] view init failed', e);
    }
  }

  if (isConsolePage()) {
    window.addEventListener('hashchange', () => {
      if (!session?.secret) return;
      const hash = (window.location.hash || '').replace(/^#\/?/, '');
      const [tab, query = ''] = hash.split('?');
      showTab(tab || 'overview', new URLSearchParams(query));
    });
    showApp(!!session?.secret);
    if (session?.secret) {
      void validateStoredSession().then(() => {
        const hash = (window.location.hash || '').replace(/^#\/?/, '');
        const [tab, query = ''] = hash.split('?');
        showTab(tab || 'overview', new URLSearchParams(query));
      });
    }
  } else {
    showApp(!!session?.secret);
    if (session?.secret) void validateStoredSession();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
