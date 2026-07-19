import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5587);
const base = `http://127.0.0.1:${port}`;
const ownerUid = '11111111-2222-4333-8444-555555555555';
const privateCards = Array.from({ length: 120 }, (_, index) => ({
  id: `private-card-${index}`,
  title: `PRIVATE ACCOUNT CARD ${index}`,
  prompt: `This card must never render for a signed-out visitor ${index}`,
  tags: ['private'],
  createdAt: Date.now() - index,
  updatedAt: Date.now() - index
}));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function seedHtml() {
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(privateCards)};
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
(async () => {
  indexedDB.deleteDatabase('PromptRepoDB');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const open = indexedDB.open('PromptRepoDB', 3);
  open.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('card_image_backups')) db.createObjectStore('card_image_backups', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('data_backups')) db.createObjectStore('data_backups', { keyPath: 'id' });
  };
  const db = await requestResult(open);
  const tx = db.transaction(['cards'], 'readwrite');
  cards.forEach((card) => tx.objectStore('cards').put(card));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem('promptrepo_idb_owner_uid', ${JSON.stringify(ownerUid)});
  localStorage.setItem('promptrepo_last_uid', ${JSON.stringify(ownerUid)});
  localStorage.setItem('promptrepo_app_page', 'warehouse');
  localStorage.setItem('promptrepo_credits', '0.1');
  localStorage.setItem('promptrepo_imagegen_draft', JSON.stringify({
    model: 'image2-pro', resolution: '2k', quality: 'standard', prompt: 'PRIVATE DRAFT'
  }));
  localStorage.setItem('promptrepo_creations', JSON.stringify([{ id: 'private-creation', prompt: 'PRIVATE CREATION' }]));
  location.href = '/prompts/';
})().catch((error) => { document.body.textContent = String(error?.stack || error); });
</script>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml());
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (['/', '/prompts', '/prompts/', '/community', '/community/', '/generate', '/generate/'].includes(pathname)) {
      pathname = '/index.html';
    }
    const file = resolve(join(root, pathname.replace(/^\/+/, '')));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack || error));
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__maxPrivateCardsRendered = 0;
    document.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        const count = document.querySelectorAll('#cardsContainer .card[data-id]').length;
        window.__maxPrivateCardsRendered = Math.max(window.__maxPrivateCardsRendered || 0, count);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  });
  await page.route('**/api/v1/generate/models', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data: {
        models: [
          { id: 'image2-economy', label: '全能模型2 · 特价 1K', uiFamily: 'gim2', selectable: true, status: 'active', resolutions: ['1k'], creditsFinal: 2, creditsBase: 2, creditsPerCall: 2 },
          { id: 'image2-4k-fast', label: '全能模型2 · 极速 4K', uiFamily: 'gim2', selectable: true, status: 'active', resolutions: ['4k'], creditsFinal: 6.5, creditsBase: 6.5, creditsPerCall: 6.5, parameters: [{ name: 'quality', path: 'quality', type: 'string', fixed: 'standard' }] },
          { id: 'image2-pro', label: '全能模型2 · 高质量 1K/2K/4K', uiFamily: 'gim2', selectable: true, status: 'active', resolutions: ['1k', '2k', '4k'], pricingByResolution: true, creditsByResolution: { '1k': 7, '2k': 15, '4k': 20 } }
        ]
      }
    })
  }));
  await page.route('**/api/v1/community/feed**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { posts: [], page: 1, hasMore: false } })
  }));
  await page.goto(`${base}/__seed.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/prompts/' && window.__PROMPT_HUB_AUTH_RESOLVED__ === true, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('PromptRepoDB', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const savedCards = await new Promise((resolve, reject) => {
      const request = db.transaction(['cards'], 'readonly').objectStore('cards').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return {
      maxRendered: window.__maxPrivateCardsRendered || 0,
      memoryCards: window.__promptHubCards?.length || 0,
      domCards: document.querySelectorAll('#cardsContainer .card[data-id]').length,
      privateTextVisible: document.body.textContent.includes('PRIVATE ACCOUNT CARD') || document.body.textContent.includes('PRIVATE CREATION'),
      savedCards: savedCards.length,
      owner: localStorage.getItem('promptrepo_idb_owner_uid'),
      draft: localStorage.getItem('promptrepo_imagegen_draft'),
      credits: [...document.querySelectorAll('[data-credits-display]')].map((node) => node.textContent?.trim()),
      qqButton: !![...document.querySelectorAll('.app-nav-item')].find((node) => node.textContent?.includes('QQ 交流群'))
    };
  });
  if (result.maxRendered || result.memoryCards || result.domCards || result.privateTextVisible) {
    throw new Error(`signed-out visitor saw private data: ${JSON.stringify(result)}`);
  }
  if (result.savedCards !== privateCards.length || result.owner !== ownerUid) {
    throw new Error(`sign-out bootstrap deleted account data: ${JSON.stringify(result)}`);
  }
  if (result.draft !== null) throw new Error(`private image draft survived sign-out bootstrap: ${result.draft}`);
  if (!result.credits.includes('--')) throw new Error(`signed-out balance was not masked: ${JSON.stringify(result.credits)}`);
  if (!result.qqButton) throw new Error('QQ community entry is missing');

  await page.evaluate(() => window.switchAppPage?.('imagegen'));
  await page.waitForFunction(() => document.getElementById('pageImageGen')?.classList.contains('active') && document.getElementById('imageGenModel')?.value, null, { timeout: 10000 });
  const imagegen = await page.evaluate(() => ({
    model: document.getElementById('imageGenModel')?.value,
    cost: document.getElementById('imageGenCostHint')?.textContent || '',
    submit: document.getElementById('imageGenSubmit')?.textContent || '',
    catalogIds: (window.__IMAGE_GEN_MODELS__ || []).map((model) => model.id),
    detailFinal: window.PointsSystem?.getImageGenCostDetail?.('image2-economy', '1k')?.final
  }));
  if (imagegen.model !== 'image2-economy' || !/2\s*积分/.test(`${imagegen.cost} ${imagegen.submit}`)) {
    throw new Error(`guest image model did not use the low-cost default: ${JSON.stringify(imagegen)}`);
  }
  await page.evaluate(() => {
    const model = document.getElementById('imageGenModel');
    model.value = 'image2-4k-fast';
    model.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const selected = document.getElementById('imageGenModel')?.value;
    const resolution = document.getElementById('imageGenResolution')?.value;
    const cost = document.getElementById('imageGenCostHint')?.textContent || '';
    const referencesHidden = document.querySelector('.imagegen-ref-block')?.hidden === true;
    const qualityHidden = document.getElementById('imageGenQuality')?.closest('.imagegen-param')?.hidden === true;
    return selected === 'image2-4k-fast' && resolution === '4k' && /6\.5\s*积分/.test(cost) && referencesHidden && qualityHidden;
  }, null, { timeout: 5000 });
  const fast4k = await page.evaluate(() => ({

    resolution: document.getElementById('imageGenResolution')?.value,
    cost: document.getElementById('imageGenCostHint')?.textContent || '',
    referencesHidden: document.querySelector('.imagegen-ref-block')?.hidden === true,
    qualityHidden: document.getElementById('imageGenQuality')?.closest('.imagegen-param')?.hidden === true
  }));
  if (fast4k.resolution !== '4k' || !/6\.5\s*积分/.test(fast4k.cost) || !fast4k.referencesHidden || !fast4k.qualityHidden) {
    throw new Error(`fixed 4K model contract is not reflected in the UI: ${JSON.stringify(fast4k)}`);
  }
  await page.evaluate(() => {
    const model = document.getElementById('imageGenModel');
    model.value = 'image2-pro';
    model.dispatchEvent(new Event('change', { bubbles: true }));
    const resolution = document.getElementById('imageGenResolution');
    resolution.value = '1k';
    resolution.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const selected = document.getElementById('imageGenModel')?.value;
    const resolution = document.getElementById('imageGenResolution')?.value;
    const cost = document.getElementById('imageGenCostHint')?.textContent || '';
    return selected === 'image2-pro' && resolution === '1k' && /7\s*积分/.test(cost);
  }, null, { timeout: 5000 });
  if (errors.length) throw new Error(`browser page errors: ${JSON.stringify(errors)}`);
  console.log('verify-guest-isolation-browser OK', JSON.stringify({ result, imagegen, fast4k }));
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
