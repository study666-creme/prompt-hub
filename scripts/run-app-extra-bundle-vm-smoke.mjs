/**
 * Node 端验证 app-extra.bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'app-extra.bundle.js'), 'utf8');

const window = {
  SupabaseSync: { getUserId: () => 'guest', isLoggedIn: () => false },
  FeatureDraft: {
    getCommunityFeedForDisplay: () => [],
    isDisplayableImage: () => false
  },
  TrialTasksUI: { markPwaInstalled() {} },
  toast: () => {},
  showToast: () => {},
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: '', hostname: 'localhost' },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {} } }
  },
  matchMedia: () => ({ matches: false }),
  navigator: { userAgent: '', standalone: false },
  addEventListener: () => {}
};
window.window = window;

vm.runInContext(code, vm.createContext(window), { filename: 'app-extra.bundle.js' });

const checks = [
  ['CommunityGacha', !!window.CommunityGacha]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('app-extra-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('app-extra-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
