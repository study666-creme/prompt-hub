import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unrefTimeout(fn, ms, ...args) {
  const timer = setTimeout(fn, ms, ...args);
  timer.unref?.();
  return timer;
}

function browserContext(extra = {}) {
  const context = {
    AbortController,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    location: { protocol: 'https:', pathname: '/' },
    setTimeout: unrefTimeout,
    ...extra
  };
  context.window = context;
  context.globalThis = context;
  context.dispatchEvent ||= () => {};
  context.CustomEvent ||= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return vm.createContext(context);
}

function runScript(context, file) {
  vm.runInContext(read(file), context, { filename: file });
}

function storageStub() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

async function runKeyedRecoveryScenario({ exactLookup, ageMs = 0 }) {
  let pending = [{
    id: 'pending-keyed-unit',
    clientRequestId: 'web.image.keyed-unit.1',
    prompt: 'identical concurrent prompt',
    model: 'gpt-image-2',
    resolution: '1k',
    quality: 'high',
    size: '1:1',
    startedAt: Date.now() - ageMs
  }];
  let failed = [];
  const exactCalls = [];
  const polledJobIds = [];
  let generatedId = 0;
  const wrongJob = {
    id: 'job-fuzzy-wrong',
    status: 'processing',
    prompt: 'identical concurrent prompt',
    model: 'gpt-image-2',
    resolution: '1k',
    quality: 'high',
    size: '1:1',
    createdAt: new Date().toISOString()
  };
  const context = browserContext({
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    localStorage: storageStub(),
    sessionStorage: storageStub(),
    __promptHubCards: []
  });
  context.PointsSystem = {
    useApiForAccount: () => true,
    refreshCreditsFromServer: async () => {},
    setCreditsFromServer: () => {},
    updateCreditsUI: () => {}
  };
  context.ImageGenGenErrors = {
    genActivePollMaxMs: () => 5 * 60 * 1000,
    genRecoveringDeferGiveUpMs: () => 22 * 60 * 1000,
    genJobPollDelayMs: () => 60_000,
    isLongRunningGenJob: () => false,
    isSlowGenProviderModel: () => false,
    isDefinitiveGenFailure: () => false,
    isLikelyRecoverableGenFailure: () => false,
    friendlyGenErrorMessage: (message) => String(message || '本次未完成'),
    stringifyGenErrorRaw: (message) => String(message || '')
  };
  context.PromptHubApi = {
    getGenerationJobByClientRequestId: async (clientRequestId) => {
      exactCalls.push(clientRequestId);
      if (exactLookup instanceof Error) throw exactLookup;
      return exactLookup;
    },
    listRecentGenerationJobs: async () => ({ ok: true, data: { jobs: [wrongJob] } }),
    getGenerationJob: async (jobId) => {
      polledJobIds.push(jobId);
      return { ok: true, data: { status: 'processing' } };
    }
  };
  runScript(context, 'imagegen-job-state.js');
  runScript(context, 'imagegen-job-runner.js');

  const api = context.ImageGenJobRunner.init({
    getPendingJobs: () => pending,
    setPendingJobs: (next) => { pending = next; },
    getFailedJobs: () => failed,
    setFailedJobs: (next) => { failed = next; },
    getCreations: () => [],
    genId: (prefix) => `${prefix}-${++generatedId}`,
    toast: () => {},
    batchIndexLabel: () => '',
    normalizeImageGenModelId: (model) => model,
    imageGenModelLabel: (model) => model,
    renderImageGenFeed: () => {},
    renderImageGenFailedNow: () => {},
    ensureGenJobCreationsFromPoll: async () => true,
    finishImageGenRun: async () => true,
    allGenCreationSlotsSaved: () => false,
    isDisplayableImage: Boolean,
    isGenerationJobDeleted: () => false,
    isMobileViewport: () => false,
    isGeneratedWarehouseCard: () => false,
    isImageGenMidjourneyModel: () => false,
    syncMissingBonusImagesForJob: async () => false,
    repairWarehouseCardImageFromJob: async () => false,
    needsApiImageRecovery: () => false
  });

  await api.resumePendingGenerationJobs({ force: true });
  return {
    keyed: pending.find((job) => job.id === 'pending-keyed-unit'),
    exactCalls,
    polledJobIds,
    failed
  };
}

async function verifyKeyedPendingRecovery() {
  const unavailable = await runKeyedRecoveryScenario({
    exactLookup: { ok: false, status: 404 },
    ageMs: 45 * 60 * 1000
  });
  if (!unavailable.keyed || unavailable.keyed.jobId || unavailable.failed.length) {
    throw new Error(`keyed pending was fuzzy-matched or discarded after an unavailable lookup: ${JSON.stringify(unavailable)}`);
  }
  if (unavailable.exactCalls.length !== 1 || unavailable.exactCalls[0] !== 'web.image.keyed-unit.1') {
    throw new Error(`keyed pending did not use its exact recovery endpoint: ${JSON.stringify(unavailable)}`);
  }

  const recovered = await runKeyedRecoveryScenario({
    exactLookup: { ok: true, data: { jobId: 'job-keyed-exact', status: 'processing' } }
  });
  if (recovered.keyed?.jobId !== 'job-keyed-exact') {
    throw new Error(`keyed pending attached to the wrong job: ${JSON.stringify(recovered)}`);
  }
  if (!recovered.polledJobIds.includes('job-keyed-exact')) {
    throw new Error(`exactly recovered job was not polled: ${JSON.stringify(recovered)}`);
  }
  return {
    unavailableRetained: true,
    fuzzyFallbackBlocked: true,
    attachedJobId: recovered.keyed.jobId
  };
}

async function verifyGeneratePostIsNeverRetried() {
  const requests = [];
  const context = browserContext({
    API_BASE_URL: 'https://api.unit.test',
    SupabaseSync: {
      getValidAccessToken: async () => 'unit-token'
    },
    fetch: async (url, opts) => {
      requests.push({ url: String(url), method: opts?.method, body: opts?.body });
      throw new TypeError('Failed to fetch');
    }
  });
  runScript(context, 'api-client.js');

  const result = await context.PromptHubApi.generateImage({
    clientRequestId: 'web.image.batch-unit.1',
    prompt: 'non-billable mock',
    model: 'gpt-image-2',
    resolution: '1k',
    quality: 'high',
    size: '1:1'
  });

  const generationPosts = requests.filter((request) => (
    request.method === 'POST' && request.url.endsWith('/api/v1/generate')
  ));
  if (result?.code !== 'NETWORK_ERROR' || generationPosts.length !== 1) {
    throw new Error(`generation POST retried after an unknown outcome: ${JSON.stringify({ result, requests })}`);
  }
  const sent = JSON.parse(generationPosts[0].body || '{}');
  if (sent.clientRequestId !== 'web.image.batch-unit.1') {
    throw new Error(`generation POST lost its client request id: ${JSON.stringify(sent)}`);
  }
  return { postCount: generationPosts.length, healthChecks: requests.length - generationPosts.length, code: result.code };
}

async function verifyFiveConcurrentSubmissions() {
  const promptEl = { value: 'five concurrent non-billable mocks' };
  const modelEl = { value: 'gpt-image-2' };
  const pending = [];
  const posts = [];
  const polls = [];
  let pendingRenderCount = 0;
  let idSeq = 0;
  let releaseAll;
  const allStarted = new Promise((resolve) => { releaseAll = resolve; });

  const context = browserContext({
    document: {
      getElementById(id) {
        if (id === 'imageGenPrompt') return promptEl;
        if (id === 'imageGenModel') return modelEl;
        return null;
      }
    }
  });
  context.AuthGate = { requireAuth: () => true };
  context.ImageGenGenErrors = { isSlowGenProviderModel: () => false };
  context.PointsSystem = {
    getImageGenCost: () => 5,
    getCredits: () => 100,
    getImageGenModel: () => ({ label: '全能模型 2' }),
    useApiForAccount: () => true,
    setCreditsFromServer: () => {},
    updateCreditsUI: () => {}
  };
  context.PromptHubApi = {
    generateImage: async (payload) => {
      const callIndex = posts.length;
      posts.push(payload);
      if (posts.length === 5) releaseAll();
      await allStarted;
      return {
        ok: true,
        data: {
          status: 'processing',
          jobId: `job-concurrent-${callIndex + 1}`,
          creditsCharged: 5
        }
      };
    }
  };
  runScript(context, 'imagegen-submit.js');

  const api = context.ImageGenSubmit.init({
    getImageGenFormMeta: () => ({ model: 'gpt-image-2', resolution: '1k', quality: 'high', size: '1:1' }),
    isImageGenMidjourneyModel: () => false,
    getImageGenMjMode: () => 'imagine',
    getImageGenRefImages: () => [],
    getImageGenPrimaryRef: () => null,
    getImageGenReferenceAssets: () => [],
    getImageGenBatchCount: () => 5,
    getImageGenCardTitle: () => '并发批次',
    isImageGenBatchSplitCards: () => false,
    getImageGenModelCatalogReady: () => true,
    getImageGenBatchRunning: () => true,
    genId: () => `pending-concurrent-${++idSeq}`,
    toast: () => {},
    restoreImageGenSubmitLabel: () => {},
    saveImageGenDraft: () => {},
    getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
    unshiftPendingJob: (job) => pending.unshift(job),
    persistPendingGenJobs: () => {},
    switchImageGenFeedToRecent: () => {},
    updateImageGenFeedHint: () => {},
    renderImageGenFeed: () => {},
    safeRenderImageGenFeed: () => {},
    renderImageGenPendingNow: () => {
      pendingRenderCount += 1;
      return {};
    },
    isImageGenMobileFormActive: () => false,
    quoteGenerationCost: async () => ({ cost: 5, fromApi: true }),
    getGenCostQuoteTimeoutMs: () => 20,
    resolveRefUrlsFromList: async () => [],
    removePendingJob: () => {},
    failPendingJob: () => null,
    tryRecoverOrphanGenJobAfterSubmitError: async () => false,
    deferPendingJobRecovery: () => {},
    pendingJobToPollCtx: (job) => ({ ...job }),
    trackSessionGenJob: () => {},
    pollGenerationJobUntilDone: (jobId, pendingId, pollCtx) => {
      polls.push({ jobId, pendingId, pollCtx });
    }
  });

  const batchId = 'batch_concurrent_unit';
  const batchPromise = api.runImageGenBatchTasks(5, (index) => api.runImageGenWithPrompt(undefined, {
    silentToast: true,
    batch: true,
    batchId,
    batchIndex: index + 1,
    batchTotal: 5,
    batchMergeCards: true,
    cardTitle: '并发批次',
    clientRequestId: `web.image.${batchId}.${index + 1}`
  }));

  if (pending.length !== 5 || pendingRenderCount !== 5) {
    throw new Error(`five pending cards were not inserted synchronously: ${JSON.stringify({
      pending: pending.length,
      pendingRenderCount
    })}`);
  }

  const settled = await batchPromise;
  const requestIds = posts.map((payload) => payload.clientRequestId);
  const persistedIds = pending.map((job) => job.clientRequestId);
  if (settled.some((entry) => entry.status !== 'fulfilled' || !entry.value?.ok)) {
    throw new Error(`concurrent submit did not settle cleanly: ${JSON.stringify(settled)}`);
  }
  if (posts.length !== 5 || new Set(requestIds).size !== 5 || new Set(persistedIds).size !== 5) {
    throw new Error(`concurrent requests were duplicated or lost ids: ${JSON.stringify({ requestIds, persistedIds })}`);
  }
  if (polls.length !== 5 || polls.some((entry) => (
    entry.pollCtx.batchMergeCards !== true
    || entry.pollCtx.batchId !== batchId
    || entry.pollCtx.cardTitle !== '并发批次'
  ))) {
    throw new Error(`batch merge context was not forwarded to polling: ${JSON.stringify(polls)}`);
  }
  return {
    pendingAtLaunch: 5,
    postCount: posts.length,
    uniqueClientRequestIds: new Set(requestIds).size,
    pollCount: polls.length
  };
}

async function verifyOutOfOrderBatchMerge() {
  const creations = [];
  const removedPending = [];
  const clearedJobs = [];
  let finishCalls = 0;
  const context = browserContext();
  context.PromptHubCardGallery = {
    MAX: 5,
    mergeCardGalleryImages(current, next) {
      return [...new Set([...(current || []), ...(next || [])].filter(Boolean))].slice(0, 5);
    }
  };
  context.SupabaseSync = {
    archiveGeneratedCardImage: async (_creationId, imageUrl) => {
      await delay(4);
      return `stored:${imageUrl}`;
    }
  };
  runScript(context, 'imagegen-poll-warehouse.js');

  const api = context.ImageGenPollWarehouse.init({
    getCreations: () => creations,
    isDisplayableImage: Boolean,
    isImageGenMidjourneyModel: () => false,
    finishImageGenRun: async (opts) => {
      finishCalls += 1;
      await delay(20);
      creations.unshift({
        id: `creation-${opts.jobId}`,
        jobId: opts.jobId,
        genBatchId: opts.genBatchId,
        image: opts.image,
        cardImages: [opts.image]
      });
      removedPending.push(opts.pendingId);
      clearedJobs.push(opts.jobId);
    },
    persistCreations: () => {},
    removePendingJob: (id) => removedPending.push(id),
    clearSessionGenJob: (id) => clearedJobs.push(id),
    renderImageGenFeed: () => {},
    toast: () => {}
  });

  const completionOrder = [
    { index: 1, delayMs: 36 },
    { index: 2, delayMs: 2 },
    { index: 3, delayMs: 18 },
    { index: 4, delayMs: 8 },
    { index: 5, delayMs: 27 }
  ];
  await Promise.all(completionOrder.map(async ({ index, delayMs }) => {
    await delay(delayMs);
    return api.saveBatchMergedFromPoll(
      { data: { status: 'completed', imageUrl: `image-${index}` } },
      {
        batchMergeCards: true,
        batchId: 'batch-merge-unit',
        batchIndex: index,
        batchTotal: 5,
        model: 'gpt-image-2',
        jobId: `job-${index}`,
        cost: 5,
        silentToast: true
      },
      `pending-${index}`
    );
  }));

  const cards = creations.filter((creation) => creation.genBatchId === 'batch-merge-unit');
  const gallery = cards[0]?.cardImages || [];
  const normalizedImages = gallery.map((image) => String(image).replace(/^stored:/, ''));
  if (finishCalls !== 1 || cards.length !== 1 || gallery.length !== 5) {
    throw new Error(`out-of-order results produced duplicate cards or lost images: ${JSON.stringify({
      finishCalls,
      cards,
      gallery,
      removedPending,
      clearedJobs
    })}`);
  }
  if (new Set(normalizedImages).size !== 5 || !completionOrder.every(({ index }) => normalizedImages.includes(`image-${index}`))) {
    throw new Error(`merged gallery does not contain every result: ${JSON.stringify(normalizedImages)}`);
  }
  return { finishCalls, cardCount: cards.length, galleryCount: gallery.length, normalizedImages };
}

function verifyPendingStatusProjection() {
  const context = browserContext({
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    ImageGenFeedCards: { create: () => ({}) }
  });
  runScript(context, 'image-gen-feed.js');
  const api = context.ImageGenFeed.init({
    esc: (value) => String(value ?? ''),
    batchIndexLabel: () => '',
    isSlowGenProviderModel: () => false
  });
  const base = {
    id: 'pending-projection-unit',
    prompt: 'non-billable mock',
    model: 'gpt-image-2',
    modelLabel: '全能模型 2',
    resolution: '1k'
  };
  const pendingHtml = api.buildFeedPendingCardHtml({
    ...base,
    pendingNote: '服务商线路 provider route api.secret.example 正在排队'
  });
  const recoveringHtml = api.buildFeedPendingCardHtml({
    ...base,
    recovering: true,
    recoverNote: '上游 channel https://secret.example/jobs/1 正在同步'
  });
  const ordinaryHtml = api.buildFeedPendingCardHtml({
    ...base,
    pendingNote: '正在排队 · 已等 2 分钟'
  });
  const privatePattern = /上游|服务商|线路|provider|channel|route|secret\.example/i;
  if (privatePattern.test(pendingHtml) || !pendingHtml.includes('生成服务正在处理')) {
    throw new Error(`pending status leaked internal routing: ${pendingHtml}`);
  }
  if (privatePattern.test(recoveringHtml) || !recoveringHtml.includes('任务正在恢复')) {
    throw new Error(`recovery status leaked internal routing: ${recoveringHtml}`);
  }
  if (!ordinaryHtml.includes('正在排队 · 已等 2 分钟')) {
    throw new Error(`ordinary public progress note was not preserved: ${ordinaryHtml}`);
  }
  return { pendingSanitized: true, recoverySanitized: true, ordinaryPreserved: true };
}

function verifySourceContracts() {
  const batchSource = read('legacy/features-draft/part-08.js');
  const submitSource = read('imagegen-submit.js');
  const promptToolsSource = read('imagegen-prompt-tools.js');
  const demoStart = batchSource.indexOf('async function runImageGenDemo()');
  const demoEnd = batchSource.indexOf('async function finishImageGenRun', demoStart);
  const demo = batchSource.slice(demoStart, demoEnd);
  if (!demo.includes("ig('runImageGenBatchTasks'") || !submitSource.includes('return Promise.allSettled(tasks);')) {
    throw new Error('ordinary multi-image submit is not wired through Promise.allSettled');
  }
  if (/2200\s*\+|batch submit gap/i.test(demo)) {
    throw new Error('ordinary multi-image submit still contains a serial gap');
  }
  if (submitSource.includes('for (let attempt = 0; attempt < 2 && !gen.ok')) {
    throw new Error('batch generation still contains a paid POST retry loop');
  }
  if (promptToolsSource.includes('红色卡片')) {
    throw new Error('prompt tools still describe failed results as red cards');
  }
  return { ordinaryBatchUsesAllSettled: true, staleRedCopyRemoved: true };
}

const results = {
  source: verifySourceContracts(),
  pendingStatusProjection: verifyPendingStatusProjection(),
  noRetry: await verifyGeneratePostIsNeverRetried(),
  concurrent: await verifyFiveConcurrentSubmissions(),
  outOfOrderMerge: await verifyOutOfOrderBatchMerge(),
  keyedRecovery: await verifyKeyedPendingRecovery()
};

console.log(`verify-imagegen-batch-reliability OK ${JSON.stringify(results)}`);
