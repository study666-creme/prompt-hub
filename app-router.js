/**
 * LabGen 风格客户端路由：/prompts /generate /community /profile
 * 静态 Pages + history API，不改后端。
 */
(function () {
  'use strict';

  /** @type {Record<string, string[]>} */
  const ROUTES = {
    warehouse: ['/prompts', '/cards', '/warehouse'],
    imagegen: ['/generate', '/imagegen'],
    community: ['/community'],
    creations: ['/profile', '/home', '/creations'],
    devlab: ['/dev', '/devlab']
  };

  const PATH_TO_APP = { '/': 'landing' };
  for (const [app, paths] of Object.entries(ROUTES)) {
    for (const p of paths) PATH_TO_APP[p] = app;
  }

  const APP_PATH = {
    landing: '/',
    warehouse: '/prompts/',
    imagegen: '/generate/',
    community: '/community/',
    creations: '/profile/',
    devlab: '/dev/'
  };

  const APP_PAGE_ID = {
    landing: 'pageLanding',
    warehouse: 'pageWarehouse',
    imagegen: 'pageImageGen',
    community: 'pageCommunity',
    creations: 'pageCreations',
    devlab: 'pageDevLab'
  };

  const APP_TITLE = {
    landing: '',
    warehouse: '',
    imagegen: '图片生成',
    community: '提示词社区',
    creations: '我的主页',
    devlab: '开发实验室'
  };

  const SITE_DESC = '卡片式提示词仓库';
  const SITE_TAGLINE = ' — AI 提示词管理、社区与生图';

  function normalizePath(path) {
    const raw = String(path || '/').split('?')[0].split('#')[0];
    const p = raw.replace(/\/+$/, '') || '/';
    return p;
  }

  function appFromPath(path) {
    const p = normalizePath(path);
    if (PATH_TO_APP[p]) return PATH_TO_APP[p];
    for (const [app, paths] of Object.entries(ROUTES)) {
      for (const route of paths) {
        if (route !== '/' && p.startsWith(`${route}/`)) return app;
      }
    }
    return null;
  }

  function pathForApp(app) {
    return APP_PATH[app] || '/';
  }

  const CANVAS_FALLBACK_URL = 'https://canvas.prompt-hubs.com/canvas';
  const CANVAS_HANDOFF_KEY = 'promptrepo_canvas_handoff_at';
  const CANVAS_HANDOFF_TTL_MS = 4 * 60 * 60 * 1000;

  function normalizePromptCanvasUrl(raw) {
    const configured = String(raw || CANVAS_FALLBACK_URL).trim() || CANVAS_FALLBACK_URL;
    let url;
    try {
      const base = /^https?:\/\//i.test(window.location?.origin || '')
        ? window.location.origin
        : CANVAS_FALLBACK_URL;
      url = new URL(configured, base);
      if (!/^https?:$/.test(url.protocol)) throw new Error('unsupported protocol');
    } catch (e) {
      url = new URL(CANVAS_FALLBACK_URL);
    }
    if (!/\/canvas\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/+$/, '') + '/canvas';
    }
    return url;
  }

  function normalizeCanvasCardId(raw) {
    const value = String(raw || '').trim();
    if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) return '';
    return value;
  }

  function getPromptCanvasUrl(options = {}) {
    const url = normalizePromptCanvasUrl(window.PROMPT_CANVAS_URL);
    const cardId = normalizeCanvasCardId(options.cardId);
    if (cardId) {
      url.searchParams.set('phSource', 'prompt-hub');
      url.searchParams.set('phVersion', '1');
      url.searchParams.set('phIntent', 'insert-card');
      url.searchParams.set('phCardId', cardId);
    }
    return url.toString();
  }

  function markCanvasHandoff() {
    try { sessionStorage.setItem(CANVAS_HANDOFF_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  function shouldRefreshAfterCanvas() {
    try {
      const at = Number(sessionStorage.getItem(CANVAS_HANDOFF_KEY));
      if (!Number.isFinite(at) || at <= 0) return false;
      if (Date.now() - at > CANVAS_HANDOFF_TTL_MS) {
        sessionStorage.removeItem(CANVAS_HANDOFF_KEY);
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function consumeRefreshAfterCanvas() {
    const shouldRefresh = shouldRefreshAfterCanvas();
    if (shouldRefresh) {
      try { sessionStorage.removeItem(CANVAS_HANDOFF_KEY); } catch (e) { /* ignore */ }
    }
    return shouldRefresh;
  }

  function openPromptCanvas(options = {}) {
    markCanvasHandoff();
    return window.open(getPromptCanvasUrl(options), '_blank', 'noopener,noreferrer');
  }

  function openPromptCanvasCard(cardId) {
    const normalized = normalizeCanvasCardId(cardId);
    if (!normalized) return null;
    return openPromptCanvas({ cardId: normalized });
  }

  function syncUrl(app, replace) {
    if (!app || !APP_PATH[app]) return;
    const path = pathForApp(app);
    const cur = normalizePath(window.location.pathname);
    const sameRoute = cur === normalizePath(path);
    if (sameRoute && window.location.pathname === path) return;
    const url = path + window.location.search + window.location.hash;
    try {
      if (replace || sameRoute) window.history.replaceState({ phApp: app }, '', url);
      else window.history.pushState({ phApp: app }, '', url);
    } catch (e) { /* ignore file:// */ }
    syncDocumentTitle(app);
  }

  function syncDocumentTitle(app) {
    const sub = APP_TITLE[app];
    document.title = sub
      ? `卡藏 · ${sub}${SITE_TAGLINE}`
      : `卡藏 · ${SITE_DESC}${SITE_TAGLINE}`;
  }

  function resolveBootApp() {
    const path = normalizePath(window.location.pathname);
    const fromUrl = appFromPath(path);
    if (fromUrl) return fromUrl;
    // The address bar is the persisted navigation state. Do not resurrect a
    // stale local page (especially a previously opened community page) at /.
    return 'landing';
  }

  function applyInitialAppPage() {
    if (typeof document === 'undefined') return;
    const app = resolveBootApp();
    const page = document.getElementById(APP_PAGE_ID[app]);
    if (!page) return;
    document.querySelectorAll('.app-page.active').forEach((node) => {
      node.classList.remove('active');
    });
    page.classList.add('active');
    document.querySelectorAll('.app-nav-item[data-app]').forEach((node) => {
      node.classList.toggle('active', node.dataset.app === app);
    });
    document.body?.classList.toggle('app-landing-active', app === 'landing');
    syncDocumentTitle(app);
  }

  function init(onNavigate) {
    if (typeof onNavigate !== 'function') return;
    window.addEventListener('popstate', () => {
      const app = appFromPath(window.location.pathname)
        || (window.history.state && window.history.state.phApp)
        || resolveBootApp();
      onNavigate(app, { fromPopstate: true });
    });
  }

  window.AppRouter = {
    appFromPath,
    pathForApp,
    syncUrl,
    syncDocumentTitle,
    resolveBootApp,
    applyInitialAppPage,
    init
  };
  applyInitialAppPage();
  window.getPromptCanvasUrl = getPromptCanvasUrl;
  window.openPromptCanvas = openPromptCanvas;
  window.openPromptCanvasCard = openPromptCanvasCard;
  window.PromptCanvasBridge = {
    buildUrl: getPromptCanvasUrl,
    open: openPromptCanvas,
    openCard: openPromptCanvasCard,
    markHandoff: markCanvasHandoff,
    shouldRefreshAfterCanvas,
    consumeRefreshAfterCanvas
  };
})();
