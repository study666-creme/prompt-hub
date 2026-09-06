import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const parts = [];
for (let index = 1; index <= 13; index += 1) {
  parts.push(await readFile(
    join(root, 'legacy', 'features-draft', `part-${String(index).padStart(2, '0')}.js`),
    'utf8'
  ));
}
const source = parts.join('\n');
const bootMarker = '  if (!feedPacksReady()) {';
const bootIndex = source.lastIndexOf(bootMarker);
if (bootIndex < 0) throw new Error('feature draft boot marker is missing');
const testSource = `${source.slice(0, bootIndex)}
  window.__recentCleanupTest = {
    setCreations: (value) => { creations = value; },
    getCreations: () => creations,
    removePermanentlyMissingCreation,
    repairRecentCreationImagesQuiet
  };
})();`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="creationsGrid"></div></body></html>');
  await page.evaluate(() => {
    const calls = { creationTombs: [], jobTombs: [], purges: [], pushes: [] };
    window.__recentCleanupCalls = calls;
    window.recordCreationDeletionGlobal = (id, jobId) => calls.creationTombs.push({ id, jobId });
    window.recordGenerationJobDeletion = (jobId) => calls.jobTombs.push(jobId);
    window.getDeletedCreationTombstones = () => ({});
    window.getDeletedGenerationJobTombstones = () => ({});
    window.SyncOrchestrator = { schedulePush: (...args) => calls.pushes.push(args) };
    window.SupabaseSync = {
      isLoggedIn: () => true,
      isStorageRef: (value) => String(value || '').startsWith('storage://'),
      storagePathFromRef: (value) => String(value || '').replace(/^storage:\/\//, ''),
      isPathKnownMissing: () => false,
      isEphemeralUpstreamImageUrl: (value) => String(value || '').includes('temporary'),
      getListDisplayImageSrc: () => '',
      archiveGeneratedCardImage: async (_id, image) => image,
      deleteCardImageByUrl: async (...args) => calls.purges.push(args)
    };
    window.PromptHubApi = {
      getGenerationImageUrl: async () => ({ ok: false, status: 500, code: 'SERVER_ERROR' })
    };
  });
  await page.addScriptTag({ content: testSource });

  const direct = await page.evaluate(() => {
    const api = window.__recentCleanupTest;
    const creation = {
      id: 'creation-direct',
      jobId: 'job-direct#2',
      image: 'https://temporary.example/direct.png',
      prompt: 'direct cleanup',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000
    };
    api.setCreations([creation]);
    const serverKept = api.removePermanentlyMissingCreation(creation.id, {
      ok: false,
      status: 500,
      code: 'SERVER_ERROR'
    });
    const networkKept = api.removePermanentlyMissingCreation(creation.id, {
      ok: false,
      code: 'NETWORK_ERROR'
    });
    const removed = api.removePermanentlyMissingCreation(creation.id, {
      ok: false,
      status: 404,
      code: 'NOT_FOUND'
    });
    return {
      serverKept,
      networkKept,
      removed,
      remaining: api.getCreations().length,
      calls: window.__recentCleanupCalls
    };
  });
  if (
    direct.serverKept
    || direct.networkKept
    || !direct.removed
    || direct.remaining !== 0
    || direct.calls.creationTombs[0]?.jobId !== 'job-direct'
    || direct.calls.jobTombs[0] !== 'job-direct'
    || direct.calls.purges.length !== 0
  ) {
    throw new Error(`explicit missing cleanup contract failed: ${JSON.stringify(direct)}`);
  }

  const transient = await page.evaluate(async () => {
    const api = window.__recentCleanupTest;
    api.setCreations([{
      id: 'creation-transient',
      jobId: 'job-transient',
      image: 'https://temporary.example/transient.png',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000
    }]);
    window.PromptHubApi.getGenerationImageUrl = async () => ({
      ok: false,
      status: 503,
      code: 'UNAVAILABLE'
    });
    const result = await api.repairRecentCreationImagesQuiet({ force: true, max: 8, skipThumbCheck: true });
    return { result, remaining: api.getCreations().map((item) => item.id) };
  });
  if (transient.result.removed !== 0 || !transient.remaining.includes('creation-transient')) {
    throw new Error(`transient failure deleted a recent creation: ${JSON.stringify(transient)}`);
  }

  const missing = await page.evaluate(async () => {
    const api = window.__recentCleanupTest;
    api.setCreations([{
      id: 'creation-missing',
      jobId: 'job-missing',
      image: '',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000
    }]);
    window.PromptHubApi.getGenerationImageUrl = async (_jobId, options) => ({
      ok: false,
      status: options?.variant === 'full' ? 410 : 500,
      code: options?.variant === 'full' ? 'GONE' : 'SERVER_ERROR'
    });
    const result = await api.repairRecentCreationImagesQuiet({ force: true, max: 8, skipThumbCheck: true });
    return { result, remaining: api.getCreations().length };
  });
  if (missing.result.removed !== 1 || missing.remaining !== 0) {
    throw new Error(`permanently missing creation was retained: ${JSON.stringify(missing)}`);
  }

  const olderMissing = await page.evaluate(async () => {
    const api = window.__recentCleanupTest;
    const now = Date.now();
    const healthy = Array.from({ length: 12 }, (_, index) => ({
      id: `creation-healthy-${index}`,
      jobId: `job-healthy-${index}`,
      image: `storage://user-1/generated/job-healthy-${index}.jpg`,
      createdAt: now - index,
      expiresAt: now + 60000
    }));
    api.setCreations([...healthy, {
      id: 'creation-older-missing',
      jobId: 'job-older-missing',
      image: '',
      createdAt: now - 1000,
      expiresAt: now + 60000
    }]);
    window.PromptHubApi.getGenerationImageUrl = async () => ({
      ok: false,
      status: 404,
      code: 'NOT_FOUND'
    });
    const result = await api.repairRecentCreationImagesQuiet({ force: true, max: 8, skipThumbCheck: true });
    return { result, ids: api.getCreations().map((item) => item.id) };
  });
  if (
    olderMissing.result.removed !== 1
    || olderMissing.ids.includes('creation-older-missing')
    || olderMissing.ids.filter((id) => id.startsWith('creation-healthy-')).length !== 12
  ) {
    throw new Error(`older missing creation was starved by healthy records: ${JSON.stringify(olderMissing)}`);
  }

  console.log('verify-imagegen-missing-cleanup-browser OK');
} finally {
  if (browser) await browser.close();
}
