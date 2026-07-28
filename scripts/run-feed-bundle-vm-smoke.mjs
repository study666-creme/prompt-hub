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
  ['ImageGenFeed', !!window.ImageGenFeed]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('feed-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

function assertRegression(condition, message) {
  if (!condition) throw new Error(`feed regression: ${message}`);
}

const evidenceOrder = [];
let deliveryResult = { ok: false, status: 404, code: 'RESULT_PERMANENTLY_MISSING' };
let taskResult = { ok: true, data: { status: 'completed' } };
let storageMissing = true;
const revoked = [];
window.URL = { revokeObjectURL: (url) => revoked.push(url) };
window.SupabaseSync = {
  isPathKnownMissing: (path) => {
    evidenceOrder.push(`storage:${path}`);
    return storageMissing;
  },
  primaryImagePath: () => 'owner/image.png'
};
window.PromptHubApi = {
  getGenerationJobImageBlobUrl: async (jobId) => {
    evidenceOrder.push(`task:${jobId}`);
    return deliveryResult;
  },
  getGenerationJob: async (jobId) => {
    evidenceOrder.push(`task-state:${jobId}`);
    return taskResult;
  }
};
const feedImages = window.FeedImages.init({ getCommunityFeedPageLoading: () => false });
const evidenceImg = {
  dataset: {
    storageRef: 'storage://card-images/owner/image.png',
    jobId: 'job-missing#2',
    sourceCardId: 'card-missing'
  }
};

storageMissing = false;
assertRegression(
  await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === false,
  'one task-independent storage result is insufficient'
);
assertRegression(evidenceOrder.join('|') === 'storage:owner/image.png', 'storage evidence must be checked first');

storageMissing = true;
evidenceOrder.length = 0;
assertRegression(
  await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === true,
  'two permanent missing signals should confirm cleanup'
);
assertRegression(
  evidenceOrder.join('|') === 'storage:owner/image.png|task:job-missing',
  'task/image evidence must follow the storage miss'
);

deliveryResult = { ok: false, status: 404, code: 'NOT_FOUND' };
taskResult = { ok: true, data: { status: 'processing' } };
assertRegression(
  await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === false,
  'legacy NOT_FOUND must preserve a task that still exists'
);
taskResult = { ok: false, status: 404, code: 'NOT_FOUND' };
assertRegression(
  await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === true,
  'legacy NOT_FOUND may clean up only after the task reread is also permanently missing'
);

for (const transient of [
  { ok: false, status: 404, code: 'NOT_READY' },
  { ok: false, status: 401, code: 'UNAUTHORIZED' },
  { ok: false, status: 429, code: 'RATE_LIMITED' },
  { ok: false, status: 500, code: 'INTERNAL_ERROR' },
  { ok: false, code: 'NETWORK_ERROR' },
  { ok: false, code: 'DELIVERY_TIMEOUT' }
]) {
  deliveryResult = transient;
  taskResult = { ok: true, data: { status: 'processing' } };
  assertRegression(
    await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === false,
    `${transient.code} must preserve the card`
  );
}

deliveryResult = { ok: true, data: { imageUrl: 'blob:still-deliverable' } };
assertRegression(
  await feedImages.confirmCommunityFeedCardPermanentlyMissing(evidenceImg) === false,
  'a deliverable task image must preserve the card'
);
assertRegression(revoked.includes('blob:still-deliverable'), 'evidence probes must revoke delivered Blob URLs');

console.log('feed-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
