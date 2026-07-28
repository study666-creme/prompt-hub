import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'app-router.js'), 'utf8');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle(name, force) {
      const on = force === undefined ? !values.has(name) : !!force;
      if (on) values.add(name);
      else values.delete(name);
      return on;
    }
  };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function boot(pathname, savedApp = 'community') {
  const pages = Object.fromEntries(
    ['pageWarehouse', 'pageImageGen', 'pageCommunity', 'pageCreations', 'pageDevLab']
      .map((id) => [id, { id, classList: makeClassList(id === 'pageCommunity' ? ['app-page', 'active'] : ['app-page']) }])
  );
  const navs = ['warehouse', 'imagegen', 'community', 'creations', 'devlab'].map((app) => ({
    dataset: { app },
    classList: makeClassList(app === 'community' ? ['active'] : [])
  }));
  const listeners = new Map();
  const opened = [];
  const location = { pathname, search: '', hash: '', origin: 'https://prompt-hubs.com' };
  const history = {
    state: null,
    pushState(state, _title, url) { this.state = state; applyUrl(url); },
    replaceState(state, _title, url) { this.state = state; applyUrl(url); }
  };
  function applyUrl(value) {
    const next = new URL(value, location.origin);
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  }
  const document = {
    title: '',
    body: { classList: makeClassList() },
    getElementById: (id) => pages[id] || null,
    querySelectorAll(selector) {
      if (selector === '.app-page.active') {
        return Object.values(pages).filter((page) => page.classList.contains('active'));
      }
      if (selector === '.app-nav-item[data-app]') return navs;
      return [];
    }
  };
  const window = {
    document,
    location,
    history,
    addEventListener: (type, listener) => listeners.set(type, listener),
    open: (...args) => { opened.push(args); return { closed: false }; }
  };
  window.window = window;
  const context = vm.createContext({
    window,
    document,
    history,
    location,
    localStorage: makeStorage({ promptrepo_app_page: savedApp }),
    sessionStorage: makeStorage(),
    URL,
    URLSearchParams,
    Date,
    console
  });
  vm.runInContext(code, context, { filename: 'app-router.js' });
  return { window, document, pages, navs, listeners, opened, context };
}

{
  const app = boot('/', 'imagegen');
  assert.equal(app.window.AppRouter.resolveBootApp(), 'community');
  assert.equal(app.pages.pageCommunity.classList.contains('active'), true);
  assert.equal(app.pages.pageImageGen.classList.contains('active'), false);
}

{
  const app = boot('/dev/');
  app.window.location.search = '?panel=assetstudio';
  assert.equal(app.window.AppRouter.resolveBootApp(), 'devlab');
  assert.equal(app.context.localStorage.getItem('promptrepo_devlab_panel'), 'assetstudio');
}

{
  const app = boot('/prompts/', 'community');
  assert.equal(app.window.AppRouter.resolveBootApp(), 'warehouse');
  assert.equal(app.pages.pageWarehouse.classList.contains('active'), true);
  assert.equal(app.pages.pageCommunity.classList.contains('active'), false);
  assert.equal(app.window.AppRouter.appFromPath('/prompts/card/42'), 'warehouse');
  assert.equal(app.window.AppRouter.pathForApp('warehouse'), '/prompts/');

  let navigated = null;
  app.window.AppRouter.init((next) => { navigated = next; });
  app.window.location.pathname = '/generate/';
  app.window.history.state = { phApp: 'community' };
  app.listeners.get('popstate')();
  assert.equal(navigated, 'imagegen');
}

{
  const app = boot('/prompts/');
  app.window.PROMPT_CANVAS_URL = 'https://canvas.example.test/work?legacy=1#old';
  const deepLink = new URL(app.window.PromptCanvasBridge.buildUrl({ cardId: ' card 42 ' }));
  assert.equal(deepLink.pathname, '/work/canvas');
  assert.equal(deepLink.hash, '');
  assert.deepEqual(
    [...deepLink.searchParams.keys()].sort(),
    ['phCardId', 'phIntent', 'phSource', 'phVersion'].sort()
  );
  assert.equal(deepLink.searchParams.get('phSource'), 'prompt-hub');
  assert.equal(deepLink.searchParams.get('phVersion'), '1');
  assert.equal(deepLink.searchParams.get('phIntent'), 'insert-card');
  assert.equal(deepLink.searchParams.get('phCardId'), 'card 42');

  assert.equal(app.window.openPromptCanvasCard(''), null);
  assert.equal(app.window.openPromptCanvasCard('bad\u0000id'), null);
  assert.equal(app.opened.length, 0);
  assert.equal(app.window.PromptCanvasBridge.shouldRefreshAfterCanvas(), false);

  app.window.openPromptCanvasCard('card/42');
  assert.equal(app.opened.length, 1);
  assert.equal(app.opened[0][1], '_blank');
  assert.equal(app.opened[0][2], 'noopener,noreferrer');
  assert.equal(new URL(app.opened[0][0]).searchParams.get('phCardId'), 'card/42');
  assert.equal(app.window.PromptCanvasBridge.shouldRefreshAfterCanvas(), true);
  assert.equal(app.window.PromptCanvasBridge.consumeRefreshAfterCanvas(), true);
  assert.equal(app.window.PromptCanvasBridge.consumeRefreshAfterCanvas(), false);
}

console.log('verify-card-pages-router-vm OK');
