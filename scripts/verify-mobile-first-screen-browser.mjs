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

const root = resolve(process.env.APP_ROOT || join(import.meta.dirname, '..'));
const expectConsolidatedRuntime = !!process.env.APP_ROOT;
const port = Number(process.env.PORT || 5581);
const base = `http://127.0.0.1:${port}`;
const imageRequests = [];
const now = Date.now();

const cards = Array.from({ length: 36 }, (_, index) => ({
  id: `mobile-card-${index}`,
  title: `Card ${index}`,
  prompt: `Mobile first-screen warehouse card ${index}`,
  tags: ['mobile-budget'],
  image: `${base}/__img/warehouse-${index}.png?kind=warehouse`,
  cardImages: [`${base}/__img/warehouse-${index}.png?kind=warehouse`],
  publishedToCommunity: false,
  createdAt: now - index * 1000,
  updatedAt: now - index * 1000
}));

const posts = Array.from({ length: 72 }, (_, index) => ({
  id: `mobile-post-${index}`,
  sourceCardId: `public-card-${index}`,
  authorId: `11111111-2222-4333-8444-${String((index % 8) + 1).padStart(12, '0')}`,
  authorName: `Author ${index % 8}`,
  title: `Community ${index}`,
  prompt: `Mobile first-screen community post ${index}`,
  image: `${base}/__img/community-${index}.png?kind=community`,
  likes: index,
  createdAt: now - index * 1000,
  updatedAt: now - index * 1000
}));

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAACXBIWXMAAAsSAAALEgHS3X78AAABFUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg1QAAAXyJ+YAAAAASUVORK5CYII=',
  'base64'
);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function seedHtml(target) {
  const app = target === 'warehouse' ? 'warehouse' : 'community';
  const href = target === 'warehouse' ? '/' : '/community';
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(cards)};
const posts = ${JSON.stringify(posts)};
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
(async () => {
  indexedDB.deleteDatabase('PromptRepoDB');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const open = indexedDB.open('PromptRepoDB', 3);
  open.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('card_image_backups')) db.createObjectStore('card_image_backups', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('data_backups')) db.createObjectStore('data_backups', { keyPath: 'id' });
  };
  const db = await reqToPromise(open);
  const tx = db.transaction(['cards'], 'readwrite');
  cards.forEach((card) => tx.objectStore('cards').put(card));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem('promptrepo_idb_owner_uid', 'guest');
  localStorage.setItem('promptrepo_app_page', ${JSON.stringify(app)});
  localStorage.setItem('promptrepo_community_posts', '[]');
  localStorage.setItem('promptrepo_public_feed_cache', JSON.stringify({
    v: 7,
    posts,
    cachedAt: Date.now()
  }));
  location.href = ${JSON.stringify(href)};
})().catch((error) => {
  document.body.textContent = String(error && error.stack || error);
});
</script>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(url.searchParams.get('target') || 'community'));
      return;
    }
    if (url.pathname.startsWith('/__img/')) {
      imageRequests.push(url.href);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': png.length
      });
      res.end(png);
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (
      path === '/'
      || path === '/prompts'
      || path === '/prompts/'
      || path === '/community'
      || path === '/community/'
      || path === '/profile'
      || path === '/profile/'
      || path === '/generate'
      || path === '/generate/'
    ) {
      path = '/index.html';
    }
    const file = resolve(join(root, path.replace(/^\/+/, '')));
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
    res.end(String(error && error.stack || error));
  }
});

function countImageRequests(kind) {
  return imageRequests.filter((href) => href.includes(`kind=${kind}`)).length;
}

async function openSeededPage(browser, target) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const events = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      events.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => events.push(`pageerror: ${error.message}`));
  await page.goto(`${base}/__seed.html?target=${target}`, { waitUntil: 'domcontentloaded' });
  return { context, page, events };
}

function assertWithin(label, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${label} expected ${min}-${max}, got ${value}`);
  }
}

async function splitRuntimeRequests(page) {
  return page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => (
      /\/legacy\/(?:script|features-draft|supabase-sync)\/part-\d+\.js/i.test(name)
      || /\/styles\/(?:base|features)\/part-\d+\.css/i.test(name)
      || /\/partials\/index-body\/part-\d+\.html/i.test(name)
    )));
}

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  const warehouse = await openSeededPage(browser, 'warehouse');
  await warehouse.page.waitForFunction(() => location.pathname === '/prompts/', null, { timeout: 20000 });
  await warehouse.page.waitForFunction(() => {
    return document.getElementById('pageWarehouse')?.classList.contains('active')
      && document.querySelectorAll('#cardsContainer .card[data-id]').length >= 12;
  }, null, { timeout: 20000 });
  await warehouse.page.waitForTimeout(1200);
  const warehouseCards = await warehouse.page.locator('#cardsContainer .card[data-id]').count();
  assertWithin('mobile warehouse initial cards', warehouseCards, 12, 12);
  assertWithin('mobile warehouse initial image requests', countImageRequests('warehouse'), 0, 14);
  const runtimeParts = await splitRuntimeRequests(warehouse.page);
  if (expectConsolidatedRuntime && runtimeParts.length) {
    throw new Error(`deployment runtime requested split parts: ${JSON.stringify(runtimeParts)}`);
  }
  await warehouse.page.reload({ waitUntil: 'domcontentloaded' });
  await warehouse.page.waitForFunction(() => (
    location.pathname === '/prompts/'
    && typeof window.openAuthModal === 'function'
    && document.getElementById('pageWarehouse')?.classList.contains('active')
    && document.querySelectorAll('#cardsContainer .card[data-id]').length === 12
  ), null, { timeout: 20000 });
  await warehouse.context.close();

  const community = await openSeededPage(browser, 'community');
  await community.page.waitForFunction(() => location.pathname === '/community/', null, { timeout: 20000 });
  try {
    await community.page.waitForFunction(() => {
      return document.getElementById('pageCommunity')?.classList.contains('active')
        && document.querySelectorAll('#communityGrid .card[data-post-id]').length >= 12;
    }, null, { timeout: 20000 });
  } catch (error) {
    const diagnostics = await community.page.evaluate(() => ({
      href: location.href,
      activePages: [...document.querySelectorAll('.app-page.active')].map((node) => node.id),
      cards: document.querySelectorAll('#communityGrid .card[data-post-id]').length,
      skeletons: document.querySelectorAll('#communityGrid .community-feed-skeleton').length,
      displayPosts: window.FeatureDraft?.getCommunityFeedForDisplay?.()?.length ?? null,
      cache: JSON.parse(localStorage.getItem('promptrepo_public_feed_cache') || 'null'),
      html: document.getElementById('communityGrid')?.innerHTML?.slice(0, 800) || ''
    }));
    throw new Error(`community initial render timed out: ${JSON.stringify({ diagnostics, events: community.events })}`, { cause: error });
  }
  await community.page.waitForTimeout(1500);
  const initialCommunityCards = await community.page.locator('#communityGrid .card[data-post-id]').count();
  assertWithin('mobile community idle cards', initialCommunityCards, 12, 12);
  const initialCommunityImages = countImageRequests('community');
  assertWithin('mobile community initial image requests', initialCommunityImages, 0, 14);

  await community.page.evaluate(() => {
    window.__feedAppendAnimations = [];
    const grid = document.getElementById('communityGrid');
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const cards = node.matches?.('.card[data-post-id]')
            ? [node]
            : [...node.querySelectorAll?.('.card[data-post-id]') || []];
          cards.forEach((card) => {
            if (card.classList.contains('feed-card-enter')) {
              window.__feedAppendAnimations.push(getComputedStyle(card).animationName);
            }
          });
        }
      }
    });
    observer.observe(grid, { childList: true, subtree: true });
    window.__feedAppendObserver = observer;
    const main = document.querySelector('.app-main');
    main.scrollTop = main.scrollHeight;
    main.dispatchEvent(new Event('scroll'));
  });

  await community.page.waitForFunction(() => {
    return document.querySelectorAll('#communityGrid .card[data-post-id]').length >= 24;
  }, null, { timeout: 12000 });
  await community.page.waitForTimeout(900);
  const appendedCommunityCards = await community.page.locator('#communityGrid .card[data-post-id]').count();
  assertWithin('mobile community one scroll batch', appendedCommunityCards, 24, 24);
  assertWithin('mobile community image requests after scroll', countImageRequests('community'), initialCommunityImages, 28);
  const animationNames = await community.page.evaluate(() => window.__feedAppendAnimations || []);
  if (!animationNames.includes('communityFeedCardIn')) {
    throw new Error(`community append animation was not observed: ${JSON.stringify(animationNames)}`);
  }
  await community.context.close();

  console.log(
    'verify-mobile-first-screen-browser OK:',
    `warehouse cards=${warehouseCards} images=${countImageRequests('warehouse')}`,
    `community cards=${initialCommunityCards}->${appendedCommunityCards}`,
    `images=${initialCommunityImages}->${countImageRequests('community')}`,
    `runtime-parts=${runtimeParts.length}`
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
