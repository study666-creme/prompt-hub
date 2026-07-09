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

  const PATH_TO_APP = { '/': 'community' };
  for (const [app, paths] of Object.entries(ROUTES)) {
    for (const p of paths) PATH_TO_APP[p] = app;
  }

  const APP_PATH = {
    warehouse: '/prompts',
    imagegen: '/generate',
    community: '/community',
    creations: '/profile',
    devlab: '/dev'
  };

  const APP_TITLE = {
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
    return APP_PATH[app] || '/community';
  }

  function getPromptCanvasUrl() {
    let url = String(window.PROMPT_CANVAS_URL || 'https://infinite-canvas-jay.vercel.app/canvas').trim();
    if (!url) url = 'https://infinite-canvas-jay.vercel.app/canvas';
    if (!/\/canvas\/?$/.test(url)) url = url.replace(/\/?$/, '') + '/canvas';
    return url;
  }

  function openPromptCanvas() {
    window.open(getPromptCanvasUrl(), '_blank', 'noopener,noreferrer');
  }

  function getPromptCodexRemoteUrl() {
    const url = String(window.PROMPT_CODEX_REMOTE_URL || '/codex-remote').trim();
    return url || '/codex-remote';
  }

  function openPromptCodexRemote() {
    window.location.href = getPromptCodexRemoteUrl();
  }

  function syncUrl(app, replace) {
    if (!app || !APP_PATH[app]) return;
    const path = pathForApp(app);
    const cur = normalizePath(window.location.pathname);
    if (cur === path) return;
    const url = path + window.location.search + window.location.hash;
    try {
      if (replace) window.history.replaceState({ phApp: app }, '', url);
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
    const fromUrl = appFromPath(window.location.pathname);
    if (fromUrl) return fromUrl;
    try {
      const saved = localStorage.getItem('promptrepo_app_page');
      if (saved && APP_PATH[saved]) return saved;
    } catch (e) { /* ignore */ }
    return 'community';
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
    init
  };
  window.getPromptCanvasUrl = getPromptCanvasUrl;
  window.openPromptCanvas = openPromptCanvas;
  window.getPromptCodexRemoteUrl = getPromptCodexRemoteUrl;
  window.openPromptCodexRemote = openPromptCodexRemote;
})();
