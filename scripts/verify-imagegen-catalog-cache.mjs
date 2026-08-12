import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const apiClient = read('api-client.js');
const indexHtml = read('index.html');
const featureBoot = read('legacy/features-draft/part-01.js');
const featureCatalog = read('legacy/features-draft/part-10.js');
const featureDraftPart02 = read('legacy/features-draft/part-02.js');
const featureModelUi = read('legacy/features-draft/part-11.js');
const featureSubmit = read('legacy/features-draft/part-12.js');
const assetStudioHtml = read('asset-studio.html');
const assetStudioRuntime = read('legacy/asset-studio/part-02.js');
const pointsSystem = read('points-system.js');
const imagegenBundle = read('pack-imagegen.js');
const cacheKey = 'promptrepo_imagegen_models_cache_v4';
const expectedVersion = 20;
const forbiddenModelKeys = new Set([
  'provider',
  'creditsBase',
  'listPrice',
  'promoPrice',
  'costByResolution',
  'costBySpeed',
  'cost'
]);

const unrefSetTimeout = (...args) => {
  const timer = setTimeout(...args);
  timer.unref?.();
  return timer;
};

const mjOnly = [{ id: 'mj-v81', label: 'MJ v8.1' }];
const { result: staleResult } = await generationModelsFromCache(expectedVersion - 1, mjOnly);
assert(staleResult.ok === false, 'stale MJ-only cache must be rejected');

const { result: currentResult } = await generationModelsFromCache(expectedVersion, mjOnly);
assert(currentResult.ok === true, 'current cache must remain available when the API is unavailable');
assert(currentResult.data?.models?.[0]?.id === 'mj-v81', 'current cache returned unexpected models');

const retiredResult = await generationModelsFromCache(expectedVersion, [
  { id: 'image2-economy', label: 'public economy model' },
  { id: 'image2-free', label: 'retired model' },
  { id: 'image2-4k-fast', label: 'public fast 4K model' },
  { id: 'image2', label: '全能模型2 · 1K', creditsFinal: 5.5 }
]);
assert(
  retiredResult.result.data?.models?.map(model => model.id).join(',') === 'image2-economy,image2-4k-fast,image2',
  'only retired models must be removed from a current browser cache'
);
assert(
  indexHtml.includes("model.id === 'image2-free'"),
  'first-paint fallback must filter every retired model'
);
assert(
  featureCatalog.includes("new Set(['image2-free'])"),
  'feature fallback must filter every retired model'
);
assert(
  !featureCatalog.includes("id: 'image2-free'") && !featureCatalog.includes("'mj-v61'"),
  'feature fallback must not hardcode retired public entries (image2-free / mj-v61)'
);
assert(
  !indexHtml.includes("id: 'image2-free'") && !indexHtml.includes("'mj-v61'"),
  'first-paint fallback must not hardcode retired public entries'
);
assert(
  featureModelUi.includes("'gpt-image-2-chat': 'image2-economy'"),
  'legacy image aliases must normalize to canonical public ids'
);
assert(
  !pointsSystem.includes("model.id === 'image2-free'"),
  'retired image2-free must not keep a special price path'
);
assert(
  !assetStudioHtml.includes('<option value="image2-free">'),
  'asset studio must not expose a retired public image model option'
);

const inFlightResult = await generationModelsInFlight([
  { id: 'image2-4k-fast', label: 'public fast 4K model' }
]);
assert(inFlightResult.samePromise, 'concurrent catalog reads must share one in-flight promise');
assert(inFlightResult.catalogFetchCount === 1, 'concurrent catalog reads must issue one network request');
assert(
  inFlightResult.results.every(result => result.data?.models?.[0]?.id === 'image2-4k-fast'),
  'the shared catalog result must retain the public fast 4K model'
);

const taintedModel = {
  id: 'image2',
  label: '渠道内部模型',
  provider: 'private-provider',
  upstreamModel: 'private-upstream-model',
  channelId: 17,
  creditsBase: 1,
  listPrice: 2,
  promoPrice: 1.5,
  costByResolution: { '1k': { base: 1, final: 5.5 } },
  creditsFinal: 5.5,
  parameters: [
    { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
    { name: 'provider_key', path: 'provider_key', label: '内部参数', type: 'string', required: false }
  ]
};
const taintedCacheResult = await generationModelsFromCache(expectedVersion, [taintedModel]);
assert(taintedCacheResult.result.ok === true, 'tainted current cache should remain usable after projection');
assertPublicModelProjection(taintedCacheResult.result.data?.models, 'cached API result');
assertPublicModelProjection(taintedCacheResult.cached?.models, 'persisted browser cache');
assert(
  taintedCacheResult.result.data?.models?.[0]?.creditsByResolution?.['1k'] === 5.5,
  'legacy final resolution price must project to creditsByResolution'
);

assert(
  apiClient.includes(`const IMAGE_GEN_CATALOG_CACHE_VERSION = ${expectedVersion};`),
  'api-client catalog cache version is out of sync'
);
assert(
  indexHtml.includes(`if (Number(raw.version) < ${expectedVersion}) return null;`),
  'first-paint catalog cache gate is out of sync'
);
assert(
  featureBoot.includes(`const IMAGE_GEN_CATALOG_CACHE_VERSION = ${expectedVersion};`),
  'feature catalog cache gate is out of sync'
);

const privateIdentities = [
  'apimart',
  'grsai',
  'thinkai',
  'ithink',
  'mooko',
  'newapi',
  'aitohumanize',
  'filesystem.site'
];

for (const [name, source] of Object.entries({
  apiClient,
  indexHtml,
  featureCatalog,
  featureModelUi,
  featureSubmit,
  assetStudioHtml,
  assetStudioRuntime,
  pointsSystem,
  imagegenBundle
})) {
  for (const identity of privateIdentities) {
    assert(!source.toLowerCase().includes(identity), `${name} exposes a private provider identity: ${identity}`);
  }
}

const applyCatalog = extractBetween(
  featureCatalog,
  '  function applyImageGenModelCatalog(models, opts = {}) {',
  '\n\n  function warmImageGenModelCatalog() {'
);
const catalogContext = { window: {} };
catalogContext.globalThis = catalogContext;
let persistedCatalog = null;
const projectedModels = taintedCacheResult.result.data.models;
vm.runInNewContext(`
  let imageGenModelCatalog = [];
  let imageGenModelCatalogReady = false;
  const projectedModels = ${JSON.stringify(projectedModels)};
  function normalizeImageGenModelEntry(model) { return model; }
  const RETIRED_IMAGE_GEN_MODEL_IDS = new Set(['image2-free']);
  function invalidateImageGenFamilyCache() {}
  function persistCachedImageGenModels(models) { globalThis.persistedCatalog = models; }
  function isImageGenPageVisible() { return false; }
  function setImageGenModelSelectLoading() {}
  function rebuildImageGenModelFamilyTabs() {}
  function renderImageGenModelSelect() {}
  function flushImageGenModelUiRefresh() {}
${applyCatalog}
  applyImageGenModelCatalog([
    { id: 'image2', status: 'offline' },
    projectedModels[0],
    { id: 'image2-4k-fast', status: 'active' }
  ], { source: 'api', renderUi: false });
`, catalogContext, { filename: 'imagegen-catalog-apply.vm.js' });

const appliedIds = Array.from(catalogContext.window.__IMAGE_GEN_MODELS__ || [], (model) => model.id);
assert(
  appliedIds.join(',') === 'image2,image2-4k-fast',
  'API catalog must replace fallback models while retaining every public model'
);
assertPublicModelProjection(catalogContext.window.__IMAGE_GEN_MODELS__, 'window image model catalog');
assertPublicModelProjection(catalogContext.persistedCatalog, 'feature catalog persistence');

// Trusted live payloads must become the current catalog even when empty or
// fully hidden — an empty trusted catalog clears the applied list and the
// persisted cache instead of resurrecting old models.
const emptyCatalogContext = { window: {} };
emptyCatalogContext.globalThis = emptyCatalogContext;
vm.runInNewContext(`
  let imageGenModelCatalog = [
    { id: 'image2', status: 'active' },
    { id: 'image2-4k-fast', status: 'active' }
  ];
  let imageGenModelCatalogStale = false;
  let imageGenModelCatalogReady = false;
  function normalizeImageGenModelEntry(model) { return model; }
  const RETIRED_IMAGE_GEN_MODEL_IDS = new Set(['image2-free']);
  function invalidateImageGenFamilyCache() {}
  function persistCachedImageGenModels(models) { globalThis.persistedCatalog = models; }
  function isImageGenPageVisible() { return false; }
  function setImageGenModelSelectLoading() {}
  function rebuildImageGenModelFamilyTabs() {}
  function renderImageGenModelSelect() {}
  function flushImageGenModelUiRefresh() {}
${applyCatalog}
  applyImageGenModelCatalog([], { source: 'api', catalogStale: false, renderUi: false });
`, emptyCatalogContext, { filename: 'imagegen-catalog-empty.vm.js' });
const emptyIds = Array.from(emptyCatalogContext.window.__IMAGE_GEN_MODELS__ || [], (model) => model.id);
assert(emptyIds.length === 0, 'trusted empty live catalog must clear the applied catalog');
assert(
  emptyCatalogContext.window.__IMAGE_GEN_CATALOG_STALE__ === false,
  'trusted empty live catalog must not be marked stale'
);
assert(
  Array.isArray(emptyCatalogContext.persistedCatalog) && emptyCatalogContext.persistedCatalog.length === 0,
  'trusted empty live catalog must persist an empty cache'
);

// A successful live catalog that omits image2-economy must drop that option.
const omissionContext = { window: {} };
omissionContext.globalThis = omissionContext;
vm.runInNewContext(`
  let imageGenModelCatalog = [
    { id: 'image2-economy', status: 'active' },
    { id: 'image2', status: 'active' }
  ];
  let imageGenModelCatalogStale = false;
  let imageGenModelCatalogReady = false;
  function normalizeImageGenModelEntry(model) { return model; }
  const RETIRED_IMAGE_GEN_MODEL_IDS = new Set(['image2-free']);
  function invalidateImageGenFamilyCache() {}
  function persistCachedImageGenModels(models) { globalThis.persistedCatalog = models; }
  function isImageGenPageVisible() { return false; }
  function setImageGenModelSelectLoading() {}
  function rebuildImageGenModelFamilyTabs() {}
  function renderImageGenModelSelect() {}
  function flushImageGenModelUiRefresh() {}
${applyCatalog}
  applyImageGenModelCatalog([
    { id: 'image2', status: 'active' },
    { id: 'image2-4k-fast', status: 'active' }
  ], { source: 'api', catalogStale: false, renderUi: false });
`, omissionContext, { filename: 'imagegen-catalog-omission.vm.js' });
const omissionIds = Array.from(omissionContext.window.__IMAGE_GEN_MODELS__ || [], (model) => model.id);
assert(
  !omissionIds.includes('image2-economy'),
  'success omission must remove image2-economy from the applied catalog'
);
assert(
  omissionIds.includes('image2') && omissionIds.includes('image2-4k-fast'),
  'success omission must keep the remaining public models'
);
assert(
  omissionContext.window.__IMAGE_GEN_CATALOG_STALE__ === false,
  'success omission must not be treated as a stale catalog'
);

// catalogStale=true empty/fully-hidden payloads and failed requests keep LKG.
const lkgContext = { window: {} };
lkgContext.globalThis = lkgContext;
vm.runInNewContext(`
  let imageGenModelCatalog = [
    { id: 'image2', status: 'active' },
    { id: 'image2-4k-fast', status: 'active' }
  ];
  let imageGenModelCatalogStale = false;
  let imageGenModelCatalogReady = false;
  function normalizeImageGenModelEntry(model) { return model; }
  const RETIRED_IMAGE_GEN_MODEL_IDS = new Set(['image2-free']);
  function invalidateImageGenFamilyCache() {}
  function persistCachedImageGenModels(models) { globalThis.persistedCatalog = models; }
  function isImageGenPageVisible() { return false; }
  function setImageGenModelSelectLoading() {}
  function rebuildImageGenModelFamilyTabs() {}
  function renderImageGenModelSelect() {}
  function flushImageGenModelUiRefresh() {}
${applyCatalog}
  applyImageGenModelCatalog([], { source: 'api', catalogStale: true, renderUi: false });
  applyImageGenModelCatalog([{ id: 'image2', status: 'offline' }], { source: 'api', catalogStale: true, renderUi: false });
`, lkgContext, { filename: 'imagegen-catalog-stale-lkg.vm.js' });
const lkgIds = Array.from(lkgContext.window.__IMAGE_GEN_MODELS__ || [], (model) => model.id);
assert(
  lkgIds.join(',') === 'image2,image2-4k-fast',
  'stale empty or fully-hidden payload must keep the last known-good catalog'
);
assert(
  lkgContext.window.__IMAGE_GEN_CATALOG_STALE__ === true,
  'LKG preservation must surface the stale catalog state'
);
assert(
  lkgContext.persistedCatalog === undefined,
  'stale payloads must not re-persist the catalog over the verified cache'
);

// api-client cache semantics against a live (trusted or stale) response.
const trustedEmpty = await generationModelsLive({
  storage: freshCache([{ id: 'image2-economy', label: 'economy' }, { id: 'image2', label: 'standard' }]),
  responseData: { models: [], catalogStale: false }
});
assert(trustedEmpty.result.ok === true, 'trusted empty live catalog response must be ok');
assert(
  Array.isArray(trustedEmpty.result.data?.models) && trustedEmpty.result.data.models.length === 0,
  'success + catalogStale=false + models=[] must clear the memory cache'
);
assert(
  trustedEmpty.result.data.catalogStale === false,
  'success + catalogStale=false + models=[] must not be marked stale'
);
const trustedEmptyPersisted = JSON.parse(trustedEmpty.storage.get(cacheKey) || 'null');
assert(
  trustedEmptyPersisted
  && Array.isArray(trustedEmptyPersisted.models)
  && trustedEmptyPersisted.models.length === 0
  && Number(trustedEmptyPersisted.version) === expectedVersion,
  'success + catalogStale=false + models=[] must overwrite the persisted catalog with the same-version empty list'
);

const omissionLive = await generationModelsLive({
  storage: freshCache([{ id: 'image2-economy', label: 'economy' }, { id: 'image2', label: 'standard' }]),
  responseData: { models: [{ id: 'image2', label: 'standard' }, { id: 'image2-4k-fast', label: '4k' }], catalogStale: false }
});
assert(
  !(omissionLive.result.data?.models || []).some((m) => m.id === 'image2-economy'),
  'success omission must drop image2-economy from the api-client catalog'
);
assert(
  omissionLive.result.data?.models?.some((m) => m.id === 'image2'),
  'success omission must keep the remaining public models in the api-client catalog'
);

const staleEmptyLive = await generationModelsLive({
  storage: freshCache([{ id: 'image2', label: 'standard' }, { id: 'image2-4k-fast', label: '4k' }]),
  responseData: { models: [], catalogStale: true }
});
assert(
  (staleEmptyLive.result.data?.models || []).map((m) => m.id).join(',') === 'image2,image2-4k-fast',
  'catalogStale=true empty payload must keep the last verified LKG'
);
assert(
  staleEmptyLive.result.data.catalogStale === true,
  'kept LKG after a stale empty payload must be marked stale'
);
const staleEmptyPersisted = JSON.parse(staleEmptyLive.storage.get(cacheKey) || 'null');
assert(
  staleEmptyPersisted?.models?.length > 0,
  'catalogStale=true empty payload must not wipe the persisted LKG'
);

const failedLive = await generationModelsLive({
  storage: freshCache([{ id: 'image2', label: 'standard' }, { id: 'image2-4k-fast', label: '4k' }]),
  fetchImpl: async () => { throw new Error('network down'); }
});
assert(
  failedLive.result.ok === true && (failedLive.result.data?.models || []).length > 0,
  'a failed request must keep the last verified LKG'
);

// Picker selection: after an omission catalog, image2-economy is removed and
// an invalid previous selection falls back to a still-valid model; a trusted
// empty catalog clears the selection and shows 暂无可用模型.
const pickerContext = runPickerContext();
const picker = pickerContext.run(`
  imageGenModelCatalog = [
    { id: 'image2-economy', label: '全能模型2 · 特价 1K', uiFamily: 'gim2', sortOrder: 20, status: 'active', selectable: true },
    { id: 'image2', label: '全能模型2 · 1K', uiFamily: 'gim2', sortOrder: 21, status: 'active', selectable: true },
    { id: 'image2-pro', label: '全能模型2 · 高质量 1K/2K/4K', uiFamily: 'gim2', sortOrder: 22, status: 'active', selectable: true },
    { id: 'lingtu', label: '香蕉 · Standard 1K', uiFamily: 'banana', sortOrder: 40, status: 'active', selectable: true },
    { id: 'mj-v81', label: 'MJ v8.1', uiFamily: 'midjourney', sortOrder: 110, status: 'active', selectable: true }
  ];
  // trusted live catalog omits image2-economy
  imageGenModelCatalog = imageGenModelCatalog.filter((m) => m.id !== 'image2-economy');
  pickerGetEl('imageGenModel').value = 'image2-economy';
  renderImageGenModelSelect({ skipUiRefresh: true });
  globalThis.__result = { value: pickerGetEl('imageGenModel').value,
    options: pickerGetEl('imageGenModel').options.map((o) => o.value),
    html: pickerGetEl('imageGenModel').innerHTML };
`);
assert(picker.value !== 'image2-economy', 'omission picker must not keep the removed model selected');
assert(!!picker.value && picker.options.includes(picker.value), 'omission picker must fall back to a valid option');
assert(!picker.options.includes('image2-economy'), 'omission picker must remove the image2-economy option');
assert(picker.options[0] === 'image2' || picker.options.includes(picker.value), 'fallback stays inside the current public catalog');

const pickerEmpty = pickerContext.run(`
  imageGenModelCatalog = [];
  pickerGetEl('imageGenModel').value = 'image2-economy';
  renderImageGenModelSelect({ skipUiRefresh: true });
  globalThis.__result = { value: pickerGetEl('imageGenModel').value,
    disabled: pickerGetEl('imageGenModel').disabled,
    html: pickerGetEl('imageGenModel').innerHTML };
`);
assert(pickerEmpty.disabled === true, 'trusted empty catalog must disable the model picker');
assert(pickerEmpty.value === '', 'trusted empty catalog must clear the invalid select value');
assert(/暂无可用模型/.test(pickerEmpty.html), 'trusted empty catalog must show 暂无可用模型');

const normalizeEntrySource = extractBetween(
  featureCatalog,
  '  function normalizeImageGenModelEntry(m) {',
  '\n\n  function imageGenModelDisplayName(m) {'
);
assert(!normalizeEntrySource.includes('...m'), 'feature catalog normalization must not spread raw API models');

console.log('verify-imagegen-catalog-cache OK');

function freshCache(models) {
  return new Map([
    [cacheKey, JSON.stringify({ ts: Date.now(), version: expectedVersion, models })]
  ]);
}

async function generationModelsLive({ storage, responseData, fetchImpl, apiBase = 'https://catalog.test' }) {
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: { protocol: 'https:' },
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    JSON,
    fetch: fetchImpl
      || (async () => ({ ok: true, json: async () => ({ ok: true, data: responseData }) }))
  };
  context.window = context;
  context.globalThis = context;
  context.API_BASE_URL = apiBase;
  vm.runInNewContext(apiClient, context, { filename: 'api-client.js' });
  const result = await context.PromptHubApi.getGenerationModels();
  return { result, storage };
}

async function generationModelsFromCache(version, models) {
  const storage = new Map([
    [cacheKey, JSON.stringify({ ts: Date.now(), version, models })]
  ]);
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: { protocol: 'https:' },
    setTimeout: unrefSetTimeout,
    clearTimeout,
    Date,
    JSON
  };
  context.window = context;
  context.globalThis = context;
  context.API_BASE_URL = 'disabled';
  vm.runInNewContext(apiClient, context, { filename: 'api-client.js' });
  const result = await context.PromptHubApi.getGenerationModels();
  return {
    result,
    cached: JSON.parse(storage.get(cacheKey) || 'null')
  };
}

async function generationModelsInFlight(models) {
  const storage = new Map();
  let resolveResponse;
  let catalogFetchCount = 0;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: { protocol: 'https:' },
    setTimeout: unrefSetTimeout,
    clearTimeout,
    AbortController,
    Date,
    JSON,
    fetch: async (url) => {
      if (String(url).includes('/api/v1/generate/models?')) catalogFetchCount += 1;
      return response;
    }
  };
  context.window = context;
  context.globalThis = context;
  context.API_BASE_URL = 'https://catalog.test';
  vm.runInNewContext(apiClient, context, { filename: 'api-client.js' });
  const first = context.PromptHubApi.getGenerationModels();
  const second = context.PromptHubApi.getGenerationModels();
  resolveResponse({
    ok: true,
    json: async () => ({ ok: true, data: { models } })
  });
  const results = await Promise.all([first, second]);
  return { samePromise: first === second, catalogFetchCount, results };
}

function runPickerContext() {
  const elements = {
    imageGenModel: makeElement('imageGenModel'),
    imageGenModelMenu: makeElement('imageGenModelMenu'),
    imageGenModelTrigger: makeElement('imageGenModelTrigger'),
    imageGenModelTriggerLabel: makeElement('imageGenModelTriggerLabel'),
    imageGenModelFamilyTabs: makeElement('imageGenModelFamilyTabs'),
    imageGenModelHint: makeElement('imageGenModelHint'),
    imageGenResolution: makeElement('imageGenResolution'),
    imageGenCatalogStaleHint: makeElement('imageGenCatalogStaleHint')
  };
  const pickerDocument = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(String(tag)),
    addEventListener: () => {},
    removeEventListener: () => {},
    currentScript: null,
    body: makeElement('body')
  };
  const pickerContext = {
    console,
    document: pickerDocument,
    localStorage: { getItem: () => null, setItem: () => {} },
    Date,
    Math,
    JSON,
    pickerGetEl: (id) => elements[id],
    requestAnimationFrame: (fn) => 0
  };
  pickerContext.window = pickerContext;
  pickerContext.globalThis = pickerContext;
  const pickerSource = [
    extractBetween(featureModelUi, '  const LEGACY_IMAGE_GEN_MODEL_ALIASES = {', '\n\n  function normalizeImageGenModelId'),
    extractFunction(featureModelUi, 'normalizeImageGenModelId'),
    extractFunction(featureModelUi, 'imageGenModelUiFamily'),
    extractFunction(featureModelUi, 'imageGenModelSortKey'),
    extractFunction(featureModelUi, 'imageGenModelsInFamily'),
    extractFunction(featureModelUi, 'resolveImageGenModelFamily'),
    extractFunction(featureModelUi, 'updateImageGenModelFamilyTabsActive'),
    extractFunction(featureModelUi, 'imageGenModelPickerButtons'),
    extractFunction(featureModelUi, 'closeImageGenModelMenu'),
    extractFunction(featureModelUi, 'syncImageGenModelPicker'),
    extractFunction(featureModelUi, 'renderImageGenModelPickerOptions'),
    extractFunction(featureModelUi, 'renderImageGenModelSelect'),
    extractFunction(featureCatalog, 'imageGenModelDisplayName'),
    extractBetween(featureCatalog, '  const IMAGE_GEN_MODEL_FAMILIES = [', '\n\n  const RETIRED_IMAGE_GEN_MODEL_IDS'),
    "  const RETIRED_IMAGE_GEN_MODEL_IDS = new Set(['image2-free']);",
    extractFunction(featureDraftPart02, 'esc'),
    extractFunction(featureDraftPart02, 'loadJson')
  ].join('\n');
  vm.runInNewContext(`
  let imageGenModelCatalog = [];
  let imageGenModelsByFamilyCache = null;
  let imageGenModelFamily = 'gim2';
  let imageGenModelUiRefreshRaf = 0;
  let imageGenModelPickerActiveIndex = -1;
  const LS_IMAGEGEN = 'promptrepo_imagegen_draft';
${pickerSource}
`, pickerContext, { filename: 'imagegen-picker.vm.js' });
  return {
    run(code) {
      vm.runInNewContext(code, pickerContext, { filename: 'imagegen-picker-run.vm.js' });
      return pickerContext.__result;
    }
  };
}

function makeElement(id) {
  const el = {
    id,
    dataset: {},
    _innerHTML: '',
    _textContent: '',
    _textMode: false,
    hidden: false,
    disabled: false,
    value: '',
    options: [],
    selectedOptions: [],
    attrs: {},
    style: {},
    children: [],
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    focus() {},
    getBoundingClientRect() {
      return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
    },
    scrollIntoView() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      return child;
    },
    matches() { return false; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) {
      el._textContent = v == null ? '' : String(v);
      el._textMode = true;
    }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() {
      if (el._textMode) return escapeHtml(el._textContent);
      return el._innerHTML;
    },
    set(v) {
      el._textMode = false;
      el._innerHTML = String(v);
      el.options = [...el._innerHTML.matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => ({
        value: m[1],
        textContent: m[3].replace(/<[^>]+>/g, ''),
        disabled: / disabled/.test(m[2])
      }));
      const match = el.options.find((o) => o.value === el.value)
        || el.options.find((o) => !o.disabled)
        || el.options[0]
        || null;
      el.selectedOptions = match ? [match] : [];
      if (match && el.value && !el.options.some((o) => o.value === el.value)) el.value = match.value;
      else if (match && !el.value) el.value = match.value;
    }
  });
  return el;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractFunction(source, name) {
  const candidates = [
    new RegExp(`function\\s+${name}\\s*\\(`),
    new RegExp(`async\\s+function\\s+${name}\\s*\\(`)
  ];
  let start = -1;
  for (const pattern of candidates) {
    start = source.search(pattern);
    if (start >= 0) break;
  }
  assert(start >= 0, `unable to find function ${name}`);
  // Skip the parameter list so a default value such as `opts = {}` is not
  // mistaken for the function body.
  const parenOpen = source.indexOf('(', start);
  assert(parenOpen > start, `unable to find parameter list for ${name}`);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  assert(parenEnd > parenOpen, `unable to close parameter list for ${name}`);
  const open = source.indexOf('{', parenEnd);
  assert(open > parenEnd, `unable to find body for ${name}`);
  let depth = 0;
  let i = open;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert(i < source.length, `unbalanced body for ${name}`);
  return source.slice(start, i + 1);
}

function assertPublicModelProjection(value, name) {
  assert(Array.isArray(value), `${name} must be an array`);
  const visit = (item, path) => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert(!forbiddenModelKeys.has(key), `${name} exposes ${path}.${key}`);
      assert(!/^upstream/i.test(key), `${name} exposes ${path}.${key}`);
      assert(!/^channel/i.test(key), `${name} exposes ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  value.forEach((model, index) => visit(model, `models[${index}]`));
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const normalizedEndMarker = endMarker.replaceAll('\n', '\r\n');
  let end = source.indexOf(endMarker, start);
  if (end < 0) end = source.indexOf(normalizedEndMarker, start);
  assert(start >= 0 && end > start, `unable to extract ${startMarker.trim()}`);
  return source.slice(start, end);
}

function assert(condition, message) {
  if (condition) return;
  console.error(`verify-imagegen-catalog-cache: ${message}`);
  process.exit(1);
}
