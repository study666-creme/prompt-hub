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
  ['ImageGenPromptTools', !!window.ImageGenPromptTools],
  ['ImageGenGenErrors', !!window.ImageGenGenErrors?.friendlyGenErrorMessage],
  ['ImageGenWarehouseRepair', !!window.ImageGenWarehouseRepair?.init],
  ['ImageGenRefCompress', !!window.ImageGenRefCompress?.init],
  ['ImageGenRefUI', !!window.ImageGenRefUI?.init],
  ['ImageGenRefResolve', !!window.ImageGenRefResolve?.init],
  ['ImageGenWarehouseSave', !!window.ImageGenWarehouseSave?.init],
  ['ImageGenFinishRun', !!window.ImageGenFinishRun?.init],
  ['ImageGenPollWarehouse', !!window.ImageGenPollWarehouse?.init],
  ['ImageGenJobRunner', !!window.ImageGenJobRunner?.init],
  ['ImageGenSubmit', !!window.ImageGenSubmit?.init]
];

const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
if (failed.length) {
  console.error('imagegen-bundle-vm-smoke FAIL:', failed.join(', '));
  process.exit(1);
}

const api = window.ImageGenJobRunner.init({
  getPendingJobs: () => [],
  setPendingJobs: () => {},
  getFailedJobs: () => [],
  setFailedJobs: () => {},
  genId: (p) => p,
  toast: () => {},
  batchIndexLabel: () => '',
  normalizeImageGenModelId: (m) => m,
  imageGenModelLabel: (m) => m,
  renderImageGenFeed: () => {},
  renderImageGenMobileResult: () => {},
  ensureGenJobCreationsFromPoll: async () => true,
  finishImageGenRun: async () => true,
  allGenCreationSlotsSaved: () => true,
  getCreations: () => [],
  isDisplayableImage: () => true,
  isGenerationJobDeleted: () => false,
  isMobileViewport: () => false,
  isGeneratedWarehouseCard: () => false,
  syncMissingBonusImagesForJob: async () => false,
  repairWarehouseCardImageFromJob: async () => false
});
if (typeof api.listRecoverableOrphanJobs !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: listRecoverableOrphanJobs missing from init()');
  process.exit(1);
}

const pwApi = window.ImageGenPollWarehouse.init({
  finishImageGenRun: async () => true,
  removePendingJob: () => {},
  clearSessionGenJob: () => {},
  renderImageGenFeed: () => {},
  repairWarehouseCardImageFromJob: async () => false,
  warehouseCardImageNeedsRecovery: () => false,
  toast: () => {},
  isDisplayableImage: () => true,
  resolveMjPollImages: () => ({ tiles: [], primary: null, composite: null }),
  isImageGenMidjourneyModel: () => false,
  isImageGenMjSaveAllTiles: () => false,
  repairMjWarehouseCardFields: async () => {}
});
if (typeof pwApi.ensureGenJobCreationsFromPoll !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: ensureGenJobCreationsFromPoll missing');
  process.exit(1);
}

const compressApi = window.ImageGenRefCompress.init({
  getRefMaxSide: () => 2560,
  getRefTargetMaxBytes: () => 8 * 1024 * 1024
});
if (typeof compressApi.compressRefImageFromSource !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: compressRefImageFromSource missing');
  process.exit(1);
}

const refUiApi = window.ImageGenRefUI.init({
  toast: () => {},
  isDisplayableImage: () => true,
  updateImageGenCostHint: () => {},
  compressRefImageFromSource: async () => 'data:image/jpeg;base64,'
});
if (typeof refUiApi.getImageGenRefImages !== 'function' || typeof refUiApi.setImageGenRefs !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: ImageGenRefUI exports missing');
  process.exit(1);
}

const refApi = window.ImageGenRefResolve.init({
  genId: (p) => p,
  compressRefImageFromSource: async () => 'data:image/jpeg;base64,',
  getRefMaxSide: () => 2560,
  getRefResolveTimeoutMs: () => 8000
});
if (typeof refApi.resolveRefUrlsFromList !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: resolveRefUrlsFromList missing');
  process.exit(1);
}

const repairApi = window.ImageGenWarehouseRepair.init({
  isGenerationJobDeleted: () => false,
  isDisplayableImage: () => true,
  isUsableWarehouseImage: () => true,
  getCreations: () => [],
  persistCreations: () => {},
  getCards: () => [],
  persistPromptHubCards: async () => {},
  renderImageGenFeed: () => {},
  queueUrgentCardsSync: () => {},
  refreshWarehouseUI: () => {},
  isPageImageGenActive: () => false
});
if (typeof repairApi.repairWarehouseCardImageFromJob !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: repairWarehouseCardImageFromJob missing');
  process.exit(1);
}

const warehouseApi = window.ImageGenWarehouseSave.init({ toast: () => {} });
if (typeof warehouseApi.saveGeneratedToWarehouse !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: saveGeneratedToWarehouse missing');
  process.exit(1);
}

const finishApi = window.ImageGenFinishRun.init({
  toast: () => {},
  genId: (p) => p,
  isGenerationJobDeleted: () => false,
  findWarehouseCardForJob: () => null,
  hasWarehouseCardForJob: () => false,
  repairMjWarehouseCardFields: async () => {},
  warehouseCardImageNeedsRecovery: () => false,
  repairWarehouseCardImageFromJob: async () => false,
  clearSessionGenJob: () => {},
  removePendingJob: () => {},
  prunePendingJobsWithWarehouseCards: () => {},
  getCreations: () => [],
  setCreations: () => {},
  persistCreations: () => {},
  getImageGenRefImages: () => [],
  getImageGenPrimaryRef: () => null,
  isImageGenMjSaveAllTiles: () => false,
  randomGenRetentionMs: () => 86400000,
  dedupeCreationsByJobId: (list) => list,
  setImageGenLastResult: () => {},
  setImageGenActiveHistoryId: () => {},
  switchImageGenFeedToWarehouse: () => {},
  updateImageGenFeedHint: () => {},
  restoreImageGenSubmitLabel: () => {},
  isImageGenGenPublicChecked: () => false,
  saveGeneratedToWarehouse: async () => true,
  renderImageGenFeed: () => {},
  renderImageGenMobileResult: () => {},
  queueUrgentCardsSync: () => {},
  isCommunityPublishEligible: () => false
});
if (typeof finishApi.finishImageGenRun !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: finishImageGenRun missing');
  process.exit(1);
}

const submitApi = window.ImageGenSubmit.init({
  getImageGenFormMeta: () => ({ model: 'gpt-image-2', resolution: '1k', quality: 'standard', size: '1:1' }),
  isImageGenMidjourneyModel: () => false,
  getImageGenMjMode: () => 'imagine',
  getImageGenRefImages: () => [],
  getImageGenPrimaryRef: () => null,
  getImageGenBatchCount: () => 1,
  getImageGenModelCatalogReady: () => true,
  getImageGenBatchRunning: () => false,
  genId: (p) => p,
  toast: () => {},
  restoreImageGenSubmitLabel: () => {},
  saveImageGenDraft: () => {},
  getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
  unshiftPendingJob: () => {},
  persistPendingGenJobs: () => {},
  switchImageGenFeedToWarehouse: () => {},
  updateImageGenFeedHint: () => {},
  renderImageGenFeed: () => {},
  safeRenderImageGenFeed: () => {},
  isMobileViewport: () => false,
  quoteGenerationCost: async () => ({ cost: 10, fromApi: false }),
  getGenCostQuoteTimeoutMs: () => 1800,
  resolveRefUrlsFromList: async () => [],
  removePendingJob: () => {},
  failPendingJob: () => {},
  tryRecoverOrphanGenJobAfterSubmitError: async () => false,
  deferPendingJobRecovery: () => {},
  pendingJobToPollCtx: () => ({}),
  trackSessionGenJob: () => {},
  resolveMjPollImages: () => ({ tiles: [], primary: null, composite: null }),
  saveMjToWarehouse: async () => true,
  finishImageGenRun: async () => true,
  pollGenerationJobUntilDone: async () => true
});
if (typeof submitApi.runImageGenWithPrompt !== 'function') {
  console.error('imagegen-bundle-vm-smoke FAIL: runImageGenWithPrompt missing');
  process.exit(1);
}

console.log('imagegen-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
