/**
 * Node 端验证 imagegen tools bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'pack-imagegen.js'), 'utf8');

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
    removeAttribute() {},
    focus() {}
  };
}

const window = {
  PointsSystem: {
    getCredits: () => 0,
    useApiForAccount: () => false,
    getImageGenCostDetail: () => ({ final: 10 }),
    formatCredits: (n) => String(n)
  },
  FeatureDraft: { getImageGenRefImages: () => [] },
  PromptHubApi: {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: {
    body: { classList: { contains: () => false, add() {}, remove() {} }, dataset: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => elStub(),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  localStorage: { getItem: () => null, setItem() {} }
};
window.window = window;

vm.runInContext(code, vm.createContext(window), { filename: 'pack-imagegen.js' });

const checks = [
  ['PointsSystem', !!window.PointsSystem],
  ['ImageGenPromptKit', !!window.ImageGenPromptKit],
  ['ImageGenPromptTools', !!window.ImageGenPromptTools]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('imagegen-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('imagegen-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
