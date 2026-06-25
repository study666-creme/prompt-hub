/**
 * Node 端验证 feed bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'pack-feed.js'), 'utf8');

function elStub() {
  return {
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    dataset: {},
    style: {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    appendChild() {},
    remove() {},
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {}
  };
}

const window = {
  SupabaseSync: {
    isLoggedIn: () => false,
    getCachedDisplayUrl: () => '',
    resolveDisplayUrl: async () => '',
    isStorageRef: (v) => String(v || '').startsWith('storage://'),
    isInvalidMediaUrl: () => false
  },
  MediaPipeline: {
    resolveFeedUrl: async () => '',
    patchContainerFromCache: () => {}
  },
  MobileUI: { isMobileViewport: () => false },
  Masonry: class {
    constructor() {}
    layout() {}
    reloadItems() {}
    destroy() {}
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  getComputedStyle: () => ({ overflowY: 'visible' }),
  document: {
    hidden: false,
    body: { classList: { contains: () => false, add() {}, remove() {} } },
    scrollingElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => elStub(),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  __promptHubCards: [],
  CSS: { escape: (s) => String(s) }
};
window.window = window;
window.globalThis = window;

vm.runInContext(code, vm.createContext(window), { filename: 'pack-feed.js' });

const checks = [
  ['FeedLayout', !!window.FeedLayout],
  ['FeedImages', !!window.FeedImages],
  ['ImageGenFeed', !!window.ImageGenFeed],
  ['CommunityPublicFeed', !!window.CommunityPublicFeed]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('feed-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('feed-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
