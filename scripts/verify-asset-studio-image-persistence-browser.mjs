import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
for (let index = 1; index <= 7; index += 1) {
  parts.push(await readFile(
    join(root, 'legacy', 'asset-studio', `part-${String(index).padStart(2, '0')}.js`),
    'utf8'
  ));
}
const source = parts.join('\n');
const bootMarker = "  if (document.readyState === 'loading')";
const bootIndex = source.lastIndexOf(bootMarker);
if (bootIndex < 0) throw new Error('asset studio boot marker is missing');
const testSource = `${source.slice(0, bootIndex)}
  window.__assetStudioPersistenceTest = {
    addCardToMainWarehouse,
    loadMainSiteCardsList
  };
})();`;

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body></body></html>');
});
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function preparePage(browser, syncOverrides = {}, initialCards = []) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(async (cards) => {
    await new Promise((resolveDb, rejectDb) => {
      const request = indexedDB.open('PromptRepoDB', 3);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('cards')) {
          request.result.createObjectStore('cards', { keyPath: 'id' });
        }
      };
      request.onerror = () => rejectDb(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['cards'], 'readwrite');
        const store = transaction.objectStore('cards');
        cards.forEach((card) => store.put(card));
        transaction.oncomplete = () => resolveDb();
        transaction.onerror = () => rejectDb(transaction.error);
      };
    });
  }, initialCards);
  await page.evaluate((overrides) => {
    const calls = { full: [], upload: [], archive: [], persist: [], push: [] };
    window.__assetStudioCalls = calls;
    window.PromptHubApi = {
      getGenerationImageUrl: async (jobId, options) => {
        calls.full.push({ jobId, options });
        return overrides.fullResult || { ok: true, data: { url: 'https://cdn.example.test/full.jpg' } };
      }
    };
    window.SupabaseSync = {
      isLoggedIn: () => true,
      getUserId: () => 'user-1',
      isStorageRef: (value) => String(value || '').startsWith('storage://'),
      verifyStorageRef: async () => overrides.verify !== false,
      uploadCardImage: async (cardId, image) => {
        calls.upload.push({ cardId, image });
        if (overrides.uploadError) throw new Error(overrides.uploadError);
        return overrides.uploadResult || `storage://user-1/cards/${cardId}.jpg`;
      },
      archiveGeneratedCardImage: async (cardId, image, options) => {
        calls.archive.push({ cardId, image, options });
        return overrides.archiveResult ?? image;
      },
      persistGenerationImage: async (cardId, image, options) => {
        calls.persist.push({ cardId, image, options });
        return overrides.persistResult ?? image;
      },
      pushCloudData: async (...args) => {
        calls.push.push(args);
        return { ok: true };
      }
    };
  }, syncOverrides);
  await page.addScriptTag({ content: testSource });
  return { context, page };
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  const success = await preparePage(browser);
  const successResult = await success.page.evaluate(async () => {
    const result = await window.__assetStudioPersistenceTest.addCardToMainWarehouse({
      prompt: 'durable canvas image',
      image: 'https://temporary-upstream.example/result.png',
      jobId: 'job-success'
    });
    const cards = await window.__assetStudioPersistenceTest.loadMainSiteCardsList();
    return { result, cards, calls: window.__assetStudioCalls };
  });
  if (
    !successResult.result.ok
    || successResult.cards.length !== 1
    || !String(successResult.cards[0].image).startsWith('storage://')
    || successResult.calls.full[0]?.options?.variant !== 'full'
    || successResult.calls.upload[0]?.image !== 'https://cdn.example.test/full.jpg'
  ) {
    throw new Error(`durable studio save failed: ${JSON.stringify(successResult)}`);
  }
  await success.context.close();

  const repair = await preparePage(browser, {}, [{
    id: 'card-existing',
    prompt: 'old canvas image',
    image: 'https://expired-upstream.example/result.png',
    genJobId: 'job-existing',
    createdAt: 1,
    updatedAt: 1
  }]);
  const repairResult = await repair.page.evaluate(async () => {
    const result = await window.__assetStudioPersistenceTest.addCardToMainWarehouse({
      prompt: 'repaired canvas image',
      image: 'https://temporary-upstream.example/new.png',
      jobId: 'job-existing'
    });
    const cards = await window.__assetStudioPersistenceTest.loadMainSiteCardsList();
    return { result, cards, calls: window.__assetStudioCalls };
  });
  if (
    !repairResult.result.ok
    || !repairResult.result.duplicate
    || !repairResult.result.repaired
    || repairResult.cards.length !== 1
    || repairResult.cards[0].id !== 'card-existing'
    || !String(repairResult.cards[0].image).startsWith('storage://')
  ) {
    throw new Error(`existing studio card was not repaired: ${JSON.stringify(repairResult)}`);
  }
  await repair.context.close();

  const failure = await preparePage(browser, {
    uploadError: 'temporary upload failure',
    archiveResult: 'https://temporary-upstream.example/result.png',
    persistResult: 'https://temporary-upstream.example/result.png'
  });
  const failureResult = await failure.page.evaluate(async () => {
    const result = await window.__assetStudioPersistenceTest.addCardToMainWarehouse({
      prompt: 'must not save a temporary ref',
      image: 'https://temporary-upstream.example/result.png',
      jobId: 'job-failure'
    });
    const cards = await window.__assetStudioPersistenceTest.loadMainSiteCardsList();
    return { result, cards, calls: window.__assetStudioCalls };
  });
  if (
    failureResult.result.ok
    || failureResult.cards.length !== 0
    || failureResult.calls.push.length !== 0
  ) {
    throw new Error(`temporary studio ref was persisted as success: ${JSON.stringify(failureResult)}`);
  }
  await failure.context.close();

  console.log('verify-asset-studio-image-persistence-browser OK');
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
