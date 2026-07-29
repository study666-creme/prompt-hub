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
const featureModelUi = read('legacy/features-draft/part-11.js');
const featureSubmit = read('legacy/features-draft/part-12.js');
const assetStudioHtml = read('asset-studio.html');
const assetStudioRuntime = read('legacy/asset-studio/part-02.js');
const pointsSystem = read('points-system.js');
const imagegenBundle = read('pack-imagegen.js');
const cacheKey = 'promptrepo_imagegen_models_cache_v4';
const expectedVersion = 19;
const forbiddenModelKeys = new Set([
  'provider',
  'creditsBase',
  'listPrice',
  'promoPrice',
  'costByResolution',
  'costBySpeed',
  'cost'
]);

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

const normalizeEntrySource = extractBetween(
  featureCatalog,
  '  function normalizeImageGenModelEntry(m) {',
  '\n\n  function imageGenModelDisplayName(m) {'
);
assert(!normalizeEntrySource.includes('...m'), 'feature catalog normalization must not spread raw API models');

console.log('verify-imagegen-catalog-cache OK');

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
    setTimeout,
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
  const testSetTimeout = (...args) => {
    const timer = setTimeout(...args);
    timer.unref?.();
    return timer;
  };
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: { protocol: 'https:' },
    setTimeout: testSetTimeout,
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
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `unable to extract ${startMarker.trim()}`);
  return source.slice(start, end);
}

function assert(condition, message) {
  if (condition) return;
  console.error(`verify-imagegen-catalog-cache: ${message}`);
  process.exit(1);
}
