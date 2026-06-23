/**
 * Node 端验证 account-modules.bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'pack-account.js'), 'utf8');

function elStub() {
  return {
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    dataset: {},
    style: {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    hidden: false
  };
}

function bodyStub() {
  return {
    classList: {
      contains: () => false,
      add() {},
      remove() {},
      toggle() {}
    },
    appendChild() {},
    dataset: {}
  };
}

const body = bodyStub();
const window = {
  SupabaseSync: { getUserId: () => null, isLoggedIn: () => false },
  PromptHubApi: { isConfigured: () => false, syncMe: async () => ({ ok: true }) },
  AppModalHub: { open() {}, close() {}, unlockAll() {} },
  MobileUI: { closeDrawers() {} },
  PointsSystem: { updateCreditsUI() {}, setCreditsFromServer() {} },
  Membership: { applyServerState() {}, getMembershipDisplay: () => null, isMember: () => false, getMemberTier: () => null, getStorageSummaryLabel: () => '' },
  API_BASE_URL: 'https://api.example.com',
  AUTH_PHONE_ENABLED: false,
  localStorage: { getItem: () => null, setItem() {} },
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
  showToast: () => {},
  copyWechatId: () => {},
  openAuthModal: () => {},
  closeTrialTasksPanel: () => {}
};
window.window = window;

vm.runInContext(code, vm.createContext(window), { filename: 'pack-account.js' });

const checks = [
  ['Membership', !!window.Membership],
  ['SubscriptionUI', !!window.SubscriptionUI],
  ['TrialTasksUI', !!window.TrialTasksUI]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('account-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('account-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
