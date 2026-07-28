/**
 * Node 端验证 imagegen tools bundle 可执行。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'pack-imagegen.js'), 'utf8');
const apiClientCode = readFileSync(join(root, 'api-client.js'), 'utf8');

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
  setTimeout,
  clearTimeout,
  AbortController,
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
  localStorage: { getItem: () => null, setItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
window.window = window;

const context = vm.createContext(window);
vm.runInContext(code, context, { filename: 'pack-imagegen.js' });

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

function assertRegression(condition, message) {
  if (!condition) throw new Error(`imagegen regression: ${message}`);
}

async function waitUntil(predicate, message, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`imagegen regression timeout: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createRunnerHarness({ seedPending, getGenerationJob, getDelivery, getByRequestId, savePoll }) {
  let pendingJobs = seedPending.map((job) => ({ ...job }));
  let failedJobs = [];
  let pollCalls = 0;
  let deliveryCalls = 0;
  let requestLookupCalls = 0;
  let requestLookupValue = null;

  window.PointsSystem = {
    ...window.PointsSystem,
    useApiForAccount: () => true,
    refreshCreditsFromServer: async () => {},
    setCreditsFromServer: () => {},
    updateCreditsUI: () => {}
  };
  window.PromptHubApi = {
    getGenerationJob: async (...args) => {
      pollCalls += 1;
      return getGenerationJob(...args, pollCalls);
    },
    getGenerationJobImageBlobUrl: async (...args) => {
      deliveryCalls += 1;
      return getDelivery?.(...args, deliveryCalls);
    },
    getGenerationJobByClientRequestId: async (requestId) => {
      requestLookupCalls += 1;
      requestLookupValue = requestId;
      return getByRequestId?.(requestId);
    }
  };

  const runner = window.ImageGenJobRunner.init({
    getPendingJobs: () => pendingJobs,
    setPendingJobs: (next) => { pendingJobs = next; },
    getFailedJobs: () => failedJobs,
    setFailedJobs: (next) => { failedJobs = next; },
    genId: (prefix) => `${prefix}-test`,
    toast: () => {},
    batchIndexLabel: () => '',
    normalizeImageGenModelId: (model) => model,
    imageGenModelLabel: (model) => model,
    renderImageGenFeed: () => {},
    renderImageGenMobileResult: () => {},
    ensureGenJobCreationsFromPoll: async (poll, ctx, pendingId) => savePoll(poll, ctx, pendingId),
    finishImageGenRun: async () => true,
    allGenCreationSlotsSaved: () => false,
    getCreations: () => [],
    isDisplayableImage: () => true,
    isGenerationJobDeleted: () => false,
    isMobileViewport: () => false,
    isGeneratedWarehouseCard: () => false,
    isImageGenMidjourneyModel: () => false,
    resolveMjPollImages: () => ({ gallery: [] }),
    syncMissingBonusImagesForJob: async () => false,
    repairWarehouseCardImageFromJob: async () => false
  });

  return {
    runner,
    pendingJobs: () => pendingJobs,
    pollCalls: () => pollCalls,
    deliveryCalls: () => deliveryCalls,
    requestLookupCalls: () => requestLookupCalls,
    requestLookupValue: () => requestLookupValue
  };
}

// The authenticated delivery endpoint must turn a body-read failure into a retryable result.
vm.runInContext(apiClientCode, context, { filename: 'api-client.js' });
window.API_BASE_URL = 'https://api.test';
window.SupabaseSync = { getValidAccessToken: async () => 'test-token' };
window.fetch = async () => ({
  ok: true,
  status: 200,
  blob: async () => { throw new Error('response stream interrupted'); }
});
const deliveryReadFailure = await window.PromptHubApi.getGenerationJobImageBlobUrl('job-read-failure');
assertRegression(
  deliveryReadFailure?.code === 'DELIVERY_READ_FAILED',
  'image response read failures must stay recoverable'
);

// Two coordinators may discover the same job, but only one poll request may run at a time.
let releaseConcurrentPoll;
const concurrentPollGate = new Promise((resolve) => { releaseConcurrentPoll = resolve; });
const concurrentHarness = createRunnerHarness({
  seedPending: [{ id: 'pending-concurrent', jobId: 'job-concurrent', model: 'gpt-image-2', startedAt: Date.now() }],
  getGenerationJob: async () => {
    await concurrentPollGate;
    return { ok: true, data: { status: 'completed', imageUrl: 'https://img.test/concurrent.png' } };
  },
  savePoll: async () => true
});
const concurrentA = concurrentHarness.runner.pollGenerationJobUntilDone(
  'job-concurrent',
  'pending-concurrent',
  { model: 'gpt-image-2', startedAt: Date.now() }
);
const concurrentB = concurrentHarness.runner.pollGenerationJobUntilDone(
  'job-concurrent',
  'pending-concurrent',
  { model: 'gpt-image-2', startedAt: Date.now() }
);
assertRegression(concurrentHarness.pollCalls() === 1, 'concurrent poll calls must share one API request');
releaseConcurrentPoll();
await Promise.all([concurrentA, concurrentB]);
assertRegression(concurrentHarness.pollCalls() === 1, 'concurrent poll lock must suppress duplicate requests');

// Standard 1K jobs must also get a bounded settle query so an open page can
// recover quickly when background queue delivery is delayed.
let standardPollOptions = null;
const standardSettleHarness = createRunnerHarness({
  seedPending: [{ id: 'pending-standard-settle', jobId: 'job-standard-settle', model: 'gpt-image-2', resolution: '1k', startedAt: Date.now() - 20_000 }],
  getGenerationJob: async (_jobId, opts) => {
    standardPollOptions = opts;
    return { ok: true, data: { status: 'completed', imageUrl: 'https://img.test/standard-settle.png' } };
  },
  savePoll: async () => true
});
await standardSettleHarness.runner.pollGenerationJobUntilDone(
  'job-standard-settle',
  'pending-standard-settle',
  { model: 'gpt-image-2', resolution: '1k', startedAt: Date.now() - 20_000 }
);
assertRegression(standardPollOptions?.settle === true, 'standard 1K polling must use bounded settle after the initial grace period');

// A completed job without a public URL must fetch the authenticated result and persist that URL.
let deliveredImageUrl = null;
const deliveryHarness = createRunnerHarness({
  seedPending: [{ id: 'pending-delivery', jobId: 'job-delivery', model: 'gpt-image-2', startedAt: Date.now() }],
  getGenerationJob: async () => ({ ok: true, data: { status: 'completed', imageUrl: null } }),
  getDelivery: async () => ({ ok: true, data: { imageUrl: 'blob:delivered-image' } }),
  savePoll: async (poll) => {
    deliveredImageUrl = poll.data.imageUrl;
    return true;
  }
});
await deliveryHarness.runner.pollGenerationJobUntilDone(
  'job-delivery',
  'pending-delivery',
  { model: 'gpt-image-2', startedAt: Date.now() }
);
assertRegression(deliveryHarness.deliveryCalls() === 1, 'completed jobs without URLs must use delivery fallback');
assertRegression(deliveredImageUrl === 'blob:delivered-image', 'delivered image URL must reach local persistence');

// Delivery object URLs are one-shot inputs: archive first, persist only the durable ref, then revoke.
let deliveryCreations = [];
let persistedDeliveryCreations = 0;
let archivedDeliverySource = null;
const revokedDeliveryUrls = [];
window.URL = {
  revokeObjectURL: (url) => revokedDeliveryUrls.push(url)
};
window.SupabaseSync = {
  isLoggedIn: () => true,
  isStorageRef: (value) => String(value || '').startsWith('storage://'),
  archiveGeneratedCardImage: async (_creationId, source) => {
    archivedDeliverySource = source;
    return 'storage://generation/job-delivery-owned.png';
  }
};
const ownedFinishApi = window.ImageGenFinishRun.init({
  getCreations: () => deliveryCreations,
  setCreations: (next) => { deliveryCreations = next; },
  genId: () => 'creation-delivery-owned',
  isGenerationJobDeleted: () => false,
  setImageGenLastResult: () => {},
  getImageGenRefImages: () => [],
  getImageGenPrimaryRef: () => null,
  isDisplayableImage: (value) => !!value,
  dedupeCreationsByJobId: (list) => list,
  setImageGenActiveHistoryId: () => {},
  persistCreations: () => { persistedDeliveryCreations += 1; },
  switchImageGenFeedToRecent: () => {},
  updateImageGenFeedHint: () => {},
  removePendingJob: () => {},
  prunePendingJobsWithCreations: () => {},
  renderImageGenFeed: () => {},
  renderImageGenMobileResult: () => {},
  clearSessionGenJob: () => {},
  genRetentionMs: () => 60_000,
  toast: () => {}
});
const ownedPollApi = window.ImageGenPollWarehouse.init({
  getCreations: () => deliveryCreations,
  isDisplayableImage: (value) => !!value,
  isImageGenMidjourneyModel: () => false,
  finishImageGenRun: ownedFinishApi.finishImageGenRun,
  removePendingJob: () => {},
  clearSessionGenJob: () => {},
  renderImageGenFeed: () => {},
  toast: () => {}
});
const ownedDeliverySaved = await ownedPollApi.ensureGenJobCreationsFromPoll(
  { data: { status: 'completed', imageUrl: 'blob:delivery-owned', deliveryObjectUrl: true } },
  { jobId: 'job-delivery-owned', model: 'gpt-image-2', silentToast: true },
  'pending-delivery-owned'
);
assertRegression(ownedDeliverySaved === true, 'delivery Blob should save after durable archival');
assertRegression(archivedDeliverySource === 'blob:delivery-owned', 'the Blob must be archived before persistence');
assertRegression(deliveryCreations[0]?.image === 'storage://generation/job-delivery-owned.png', 'durable storage ref must replace the Blob');
assertRegression(persistedDeliveryCreations === 1, 'durable delivery should persist exactly once');
assertRegression(revokedDeliveryUrls.includes('blob:delivery-owned'), 'saved delivery Blob must be revoked');

// If archival fails, keep the task recoverable; a later refresh fetches a fresh object URL.
deliveryCreations = [];
persistedDeliveryCreations = 0;
window.SupabaseSync.archiveGeneratedCardImage = async () => {
  throw new Error('temporary archive failure');
};
const failedDeliverySaved = await ownedPollApi.ensureGenJobCreationsFromPoll(
  { data: { status: 'completed', imageUrl: 'blob:delivery-expired', deliveryObjectUrl: true } },
  { jobId: 'job-delivery-owned', model: 'gpt-image-2', silentToast: true },
  'pending-delivery-owned'
);
assertRegression(failedDeliverySaved === false, 'failed Blob archival must remain recoverable');
assertRegression(deliveryCreations.length === 0 && persistedDeliveryCreations === 0, 'failed Blob archival must not persist a creation');
assertRegression(revokedDeliveryUrls.includes('blob:delivery-expired'), 'failed delivery Blob must also be revoked');

window.SupabaseSync.archiveGeneratedCardImage = async (_creationId, source) => {
  archivedDeliverySource = source;
  return 'storage://generation/job-delivery-refreshed.png';
};
const refreshedDeliverySaved = await ownedPollApi.ensureGenJobCreationsFromPoll(
  { data: { status: 'completed', imageUrl: 'blob:delivery-after-refresh', deliveryObjectUrl: true } },
  { jobId: 'job-delivery-owned', model: 'gpt-image-2', silentToast: true, isRecovery: true },
  'pending-delivery-owned'
);
assertRegression(refreshedDeliverySaved === true, 'refresh recovery should save a freshly fetched delivery Blob');
assertRegression(archivedDeliverySource === 'blob:delivery-after-refresh', 'refresh must not reuse the expired Blob URL');

const compactState = window.ImageGenJobState.create(() => ({
  getPendingJobs: () => [{
    id: 'pending-blob-state',
    jobId: 'job-delivery-owned',
    image: 'blob:pending-image',
    imageUrl: 'blob:pending-image-url',
    refImage: 'blob:pending-ref',
    deliveryObjectUrl: true
  }]
}));
const [compactPending] = compactState.compactPendingJobsForStorage(compactState.pendingList());
assertRegression(compactPending.jobId === 'job-delivery-owned', 'refresh state must retain the task ID');
assertRegression(compactPending.image === null && compactPending.imageUrl === null, 'refresh state must not retain Blob URLs');
assertRegression(!('deliveryObjectUrl' in compactPending), 'refresh state must not retain Blob ownership flags');

const compactCreation = window.ImageGenJobState.compactPersistedCreation({
  id: 'creation-blob-state',
  jobId: 'job-delivery-owned',
  image: 'blob:creation-image',
  mjCompositeUrl: 'blob:creation-composite',
  cardImages: ['blob:creation-card', 'storage://generation/durable-card.png'],
  mjGridUrls: ['blob:creation-grid', 'https://img.test/durable-grid.png']
});
assertRegression(compactCreation.jobId === 'job-delivery-owned', 'creation refresh state must retain the task ID');
assertRegression(compactCreation.image === null && compactCreation.mjCompositeUrl === null, 'creation refresh state must strip Blob image fields');
assertRegression(compactCreation.cardImages.length === 1, 'creation galleries must discard Blob entries');
assertRegression(compactCreation.mjGridUrls.length === 1, 'Midjourney grids must discard Blob entries');

// A null progress note from the server must clear stale submission copy immediately.
const originalPollDelay = window.ImageGenGenErrors.genJobPollDelayMs;
window.ImageGenGenErrors.genJobPollDelayMs = () => 0;
let releaseProgressPoll;
let markSecondProgressPoll;
const progressPollGate = new Promise((resolve) => { releaseProgressPoll = resolve; });
const secondProgressPollStarted = new Promise((resolve) => { markSecondProgressPoll = resolve; });
const progressHarness = createRunnerHarness({
  seedPending: [{
    id: 'pending-progress',
    jobId: 'job-progress',
    model: 'gpt-image-2',
    startedAt: Date.now(),
    pendingNote: '正在提交'
  }],
  getGenerationJob: async (_jobId, _opts, callNumber) => {
    if (callNumber === 1) return { ok: true, data: { status: 'processing', progressNote: null } };
    markSecondProgressPoll();
    await progressPollGate;
    return { ok: true, data: { status: 'completed', imageUrl: 'https://img.test/progress.png' } };
  },
  savePoll: async () => true
});
const progressPoll = progressHarness.runner.pollGenerationJobUntilDone(
  'job-progress',
  'pending-progress',
  { model: 'gpt-image-2', startedAt: Date.now() }
);
await secondProgressPollStarted;
assertRegression(progressHarness.pendingJobs()[0]?.pendingNote === '', 'null progress notes must clear stale text');
releaseProgressPoll();
await progressPoll;
window.ImageGenGenErrors.genJobPollDelayMs = originalPollDelay;

// Recovery must attach only by the exact client request ID and then start normal polling.
const exactRequestId = 'web.image.exact-request-001';
const exactHarness = createRunnerHarness({
  seedPending: [{
    id: 'pending-exact',
    clientRequestId: exactRequestId,
    model: 'gpt-image-2',
    prompt: 'exact prompt',
    startedAt: Date.now(),
    pendingNote: '正在提交'
  }],
  getByRequestId: async () => ({ ok: true, data: { jobId: 'job-exact', status: 'processing' } }),
  getGenerationJob: async () => ({ ok: true, data: { status: 'completed', imageUrl: 'https://img.test/exact.png' } }),
  savePoll: async () => true
});
const exactAttach = await exactHarness.runner.attachPendingJobByClientRequestId(exactHarness.pendingJobs()[0]);
assertRegression(exactAttach.attached === true, 'exact request-ID recovery must attach the job');
assertRegression(exactHarness.requestLookupCalls() === 1, 'exact request-ID recovery must issue one lookup');
assertRegression(exactHarness.requestLookupValue() === exactRequestId, 'request-ID lookup must preserve the exact ID');
assertRegression(exactHarness.pendingJobs()[0]?.jobId === 'job-exact', 'attached job ID must be persisted');
await waitUntil(
  () => exactHarness.runner.getActivePollJobIds().size === 0,
  'exact request-ID follow-up polling did not finish'
);

// Local preprocessing failures are terminal locally; only an exception after POST begins is recoverable.
async function runSubmitExceptionCase(postStarted) {
  let capturedPending = null;
  let failed = 0;
  let deferred = 0;
  let postCalls = 0;
  const submitButton = elStub();
  submitButton.disabled = false;
  window.AuthGate = { requireAuth: () => true };
  window.document.getElementById = (id) => {
    if (id === 'imageGenModel') return { value: 'gpt-image-2' };
    if (id === 'imageGenSubmit') return submitButton;
    return null;
  };
  window.PointsSystem = {
    getCredits: () => 100,
    getImageGenCost: () => 10,
    getImageGenModel: () => ({ label: 'Image 2' }),
    useApiForAccount: () => true,
    refreshCreditsFromServer: async () => {},
    updateCreditsUI: () => {}
  };
  window.PromptHubApi = {
    generateImage: async () => {
      postCalls += 1;
      throw new Error('submit connection interrupted');
    }
  };
  const api = window.ImageGenSubmit.init({
    getImageGenFormMeta: () => ({ model: 'gpt-image-2', resolution: '1k', quality: 'standard', size: '1:1' }),
    isImageGenMidjourneyModel: () => false,
    getImageGenMjMode: () => 'imagine',
    getImageGenRefImages: () => [],
    getImageGenPrimaryRef: () => null,
    getImageGenReferenceAssets: () => [],
    getImageGenBatchCount: () => 1,
    getImageGenModelCatalogReady: () => true,
    getImageGenBatchRunning: () => false,
    genId: () => `pending-${postStarted ? 'post' : 'local'}`,
    toast: () => {},
    restoreImageGenSubmitLabel: () => {},
    saveImageGenDraft: () => {},
    getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
    unshiftPendingJob: (pending) => { capturedPending = pending; },
    persistPendingGenJobs: () => {},
    switchImageGenFeedToRecent: () => {},
    updateImageGenFeedHint: () => {},
    renderImageGenFeed: () => {},
    safeRenderImageGenFeed: () => {},
    isMobileViewport: () => false,
    quoteGenerationCost: async () => ({ cost: 10, fromApi: false }),
    getGenCostQuoteTimeoutMs: () => 10,
    resolveRefUrlsFromList: async () => {
      if (!postStarted) throw new Error('local reference preprocessing failed');
      return [];
    },
    removePendingJob: () => {},
    failPendingJob: () => { failed += 1; },
    tryRecoverOrphanGenJobAfterSubmitError: async () => false,
    deferPendingJobRecovery: () => { deferred += 1; },
    pendingJobToPollCtx: () => ({}),
    trackSessionGenJob: () => {},
    resolveMjPollImages: () => ({ tiles: [], primary: null, composite: null }),
    saveMjToWarehouse: async () => true,
    finishImageGenRun: async () => true,
    pollGenerationJobUntilDone: async () => true
  });
  await api.runImageGenWithPrompt('test prompt');
  return { capturedPending, failed, deferred, postCalls };
}

const localSubmitFailure = await runSubmitExceptionCase(false);
assertRegression(localSubmitFailure.capturedPending?.generationPhase === 'submitting', 'new pending jobs must start in submitting phase');
assertRegression(localSubmitFailure.postCalls === 0, 'local preprocessing failure must happen before POST');
assertRegression(localSubmitFailure.failed === 1 && localSubmitFailure.deferred === 0, 'local failure must not linger in recovery');
const interruptedSubmit = await runSubmitExceptionCase(true);
assertRegression(interruptedSubmit.postCalls === 1, 'POST interruption test must begin submission');
assertRegression(interruptedSubmit.failed === 0 && interruptedSubmit.deferred === 1, 'POST interruption must retain exact-ID recovery');

// Result persistence must return its actual outcome instead of throwing on an undefined local.
const pollSaveSuccessApi = window.ImageGenPollWarehouse.init({
  finishImageGenRun: async () => true,
  removePendingJob: () => {},
  clearSessionGenJob: () => {},
  renderImageGenFeed: () => {},
  toast: () => {},
  isDisplayableImage: () => true,
  isImageGenMidjourneyModel: () => false
});
const pollSaveSuccess = await pollSaveSuccessApi.ensureGenJobCreationsFromPoll(
  { data: { status: 'completed', imageUrl: 'https://img.test/persist.png' } },
  { jobId: 'job-persist', model: 'gpt-image-2', silentToast: true },
  'pending-persist'
);
assertRegression(pollSaveSuccess === true, 'successful local persistence must resolve true');
const pollSaveFailureApi = window.ImageGenPollWarehouse.init({
  finishImageGenRun: async () => false,
  removePendingJob: () => {},
  clearSessionGenJob: () => {},
  renderImageGenFeed: () => {},
  toast: () => {},
  isDisplayableImage: () => true,
  isImageGenMidjourneyModel: () => false
});
const pollSaveFailure = await pollSaveFailureApi.ensureGenJobCreationsFromPoll(
  { data: { status: 'completed', imageUrl: 'https://img.test/persist-failed.png' } },
  { jobId: 'job-persist-failed', model: 'gpt-image-2', silentToast: true },
  'pending-persist-failed'
);
assertRegression(pollSaveFailure === false, 'failed local persistence must remain retryable');

console.log('imagegen-bundle-vm-smoke OK:', checks.map(([n]) => n).join(', '));
