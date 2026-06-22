/**
 * Node 端模拟 window，验证 core bundle 可执行且导出三个全局对象。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'core-pipeline.bundle.js');
const code = readFileSync(bundlePath, 'utf8');

const window = {
  SupabaseSync: {
    isLoggedIn: () => false,
    getCachedDisplayUrl: () => '',
    getListDisplayImageSrc: () => '',
    resolveDisplayUrl: async () => '',
    resolvePreviewFullUrl: async () => '',
    patchImageSrcFromCache: () => {},
    isStorageRef: (v) => String(v || '').startsWith('storage://'),
    isDataUrl: (v) => typeof v === 'string' && v.startsWith('data:'),
    safeImgSrc: (v) => v || '',
    VARIANT_GRID: 'grid',
    VARIANT_FULL: 'full'
  },
  IntersectionObserver: class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false
  }
};
window.window = window;
window.self = window;

const ctx = vm.createContext(window);
vm.runInContext(code, ctx, { filename: 'core-pipeline.bundle.js' });

const checks = [
  ['MediaPipeline', !!window.MediaPipeline],
  ['resolveFeedUrl', typeof window.MediaPipeline?.resolveFeedUrl === 'function'],
  ['SyncOrchestrator', !!window.SyncOrchestrator],
  ['CardImageLoader', !!window.CardImageLoader]
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

console.log('bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
