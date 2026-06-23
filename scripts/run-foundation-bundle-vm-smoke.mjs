/**
 * Node 端验证 foundation.bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'foundation.bundle.js'), 'utf8');

function elStub() {
  return {
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    dataset: {},
    style: {},
    hidden: true,
    parentElement: null,
    addEventListener() {},
    removeAttribute() {},
    setAttribute() {},
    focus() {},
    blur() {}
  };
}

const body = {
  classList: {
    contains: () => false,
    add() {},
    remove() {},
    toggle() {}
  },
  appendChild() {}
};

const window = {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: '', hostname: 'localhost', protocol: 'https:', origin: 'https://example.com', href: 'https://example.com/' },
  document: {
    readyState: 'complete',
    body,
    querySelector: () => elStub(),
    querySelectorAll: () => [],
    getElementById: () => elStub(),
    addEventListener: () => {},
    createElement: () => elStub()
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener: () => {},
  requestAnimationFrame: (fn) => { fn(); },
  setTimeout: () => 0,
  requestIdleCallback: (fn) => { fn(); }
};
window.window = window;

vm.runInContext(code, vm.createContext(window), { filename: 'foundation.bundle.js' });

const checks = [
  ['CloudSyncSafety', !!window.CloudSyncSafety],
  ['AppModalHub', !!window.AppModalHub],
  ['MobileUI', !!window.MobileUI?.isMobileViewport],
  ['mobileSwitchTab', typeof window.mobileSwitchTab === 'function']
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('foundation-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('foundation-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
