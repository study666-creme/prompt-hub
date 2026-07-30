import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
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
const port = Number(process.env.PORT || 5593);
const base = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '';

const now = Date.now();
const images = [
  '/assets/studio-preset/scene.png',
  '/assets/studio-preset/peishen.png',
  '/assets/studio-preset/linche.png',
  '/assets/studio-preset/shenmei.png'
];
const imageBodies = await Promise.all(images.map((pathname) => (
  readFile(join(root, pathname.replace(/^\/+/, '')))
)));
const cdnAssets = new Map(images.map((_, index) => {
  const token = Buffer.from(`guest/generated/warehouse-ui-${index}_grid.jpg`).toString('base64url');
  return [token, imageBodies[index]];
}));
const imageCdnUrls = [...cdnAssets.keys()].map((token) => `${base}/api/v1/media/c/${token}`);
const groups = ['电影分镜', '角色设定', '产品视觉', '灵感收集'];
const cards = Array.from({ length: 12 }, (_, index) => {
  const image = index % 3 === 2 ? '' : imageCdnUrls[index % imageCdnUrls.length];
  return {
    id: `warehouse-ui-${index}`,
    title: [
      '雨夜列车的电影感镜头',
      '冷色调角色肖像研究',
      '品牌叙事的文案结构',
      '未来城市的空间氛围'
    ][index % 4],
    prompt: image
      ? `Cinematic visual study ${index + 1}, layered lighting, restrained palette, detailed composition.`
      : `A reusable prompt framework for building a clear visual narrative. Keep the hierarchy concise, describe the subject first, then light, lens, material and atmosphere. Variation ${index + 1}.`,
    group: groups[index % groups.length],
    tags: index % 2 ? ['构图', '光影'] : ['电影感', '收藏'],
    image,
    cardImages: image ? [image] : [],
    pinnedAt: index === 0 ? now : null,
    createdAt: now - index * 3_600_000,
    updatedAt: now - index * 1_800_000
  };
});

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function seedHtml(empty) {
  const rows = empty ? [] : cards;
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(rows)};
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
  localStorage.setItem('promptrepo_idb_owner_uid', 'guest');
  localStorage.setItem('promptrepo_app_page', 'warehouse');
  localStorage.setItem('promptrepo_view_mode', 'grid');
  location.href = '/prompts/';
})().catch((error) => { document.body.textContent = String(error?.stack || error); });
</script>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(url.searchParams.get('empty') === '1'));
      return;
    }
    if (url.pathname.startsWith('/api/v1/media/c/')) {
      const token = url.pathname.split('/').pop() || '';
      const body = cdnAssets.get(token);
      if (body) {
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': body.length
        });
        res.end(body);
        return;
      }
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '/prompts' || pathname === '/prompts/') {
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

function assertBetween(label, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${label} expected ${min}-${max}, got ${value}`);
  }
}

async function openWarehouse(browser, viewport, empty = false) {
  const mobile = viewport.width <= 480;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.goto(`${base}/__seed.html${empty ? '?empty=1' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expectEmpty) => {
    if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return false;
    return expectEmpty
      ? !!document.querySelector('.warehouse-grid-empty')
      : document.querySelectorAll('#cardsContainer .card[data-id]').length >= 12;
  }, empty, { timeout: 20000 });
  await page.waitForTimeout(900);
  if (!empty) {
    await page.waitForFunction(() => (
      document.querySelectorAll('#cardsContainer .card-media img').length === 8
    ), null, { timeout: 5000 });
  }
  return { context, page };
}

async function inspectWarehouse(page, mobile) {
  return page.evaluate((isMobile) => {
    const hero = document.getElementById('warehouseHero');
    const grid = document.getElementById('cardsContainer');
    const header = document.querySelector('.app-page-warehouse .main-header');
    const metaRows = [...document.querySelectorAll('#cardsContainer .card-meta-row')];
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')];
    const viewportWidth = document.documentElement.clientWidth;
    const overflowNodes = [...document.querySelectorAll('.app-page-warehouse.active *')].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return style.position !== 'fixed'
        && rect.left < viewportWidth - 1
        && rect.right > viewportWidth + 1
        && rect.width > 1;
    }).slice(0, 8).map((node) => ({
      tag: node.tagName,
      id: node.id,
      className: String(node.className || '').slice(0, 120),
      right: Math.round(node.getBoundingClientRect().right)
    }));
    return {
      heroHeight: Math.round(hero?.getBoundingClientRect().height || 0),
      headerHeight: Math.round(header?.getBoundingClientRect().height || 0),
      cardCount: cards.length,
      metaCount: metaRows.length,
      textKinds: document.querySelectorAll('.card-kind.is-text').length,
      visualKinds: document.querySelectorAll('.card-kind.is-visual').length,
      mediaCount: document.querySelectorAll('#cardsContainer .card-media img').length,
      loadedMediaCount: [...document.querySelectorAll('#cardsContainer .card-media img')]
        .filter((img) => img.complete && img.naturalWidth > 8).length,
      heroImageWidths: [...document.querySelectorAll('.warehouse-hero-card img')].map((img) => img.naturalWidth),
      warehouseStylesheet: [...document.styleSheets].some((sheet) => /styles-warehouse\.css/.test(sheet.href || '')),
      gridWidth: Math.round(grid?.getBoundingClientRect().width || 0),
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      draggableCards: grid?.querySelectorAll('.card[draggable="true"]').length || 0,
      overflowNodes,
      mobileActions: document.querySelectorAll('.card-mobile-actions').length,
      cardData: (window.__promptHubCards || []).slice(0, 3).map((card) => ({
        id: card.id,
        image: String(card.image || '').slice(0, 80),
        cardImages: (card.cardImages || []).map((value) => String(value).slice(0, 80)),
        hasThumb: window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, { skipEnsure: true })?.hasImage === true
      })),
      isMobile
    };
  }, mobile);
}

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

if (process.env.PREVIEW_ONLY === '1') {
  console.log(`Warehouse preview: ${base}/__seed.html`);
  console.log(`Warehouse empty state: ${base}/__seed.html?empty=1`);
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise(() => {});
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  const desktop = await openWarehouse(browser, { width: 1440, height: 900 });
  const desktopState = await inspectWarehouse(desktop.page, false);
  assertBetween('desktop hero height', desktopState.heroHeight, 150, 190);
  assertBetween('desktop header height', desktopState.headerHeight, 48, 60);
  if (desktopState.cardCount !== 12 || desktopState.metaCount !== 12) {
    throw new Error(`desktop cards/meta mismatch: ${JSON.stringify(desktopState)}`);
  }
  if (!desktopState.textKinds || !desktopState.visualKinds) {
    throw new Error(`desktop card type hierarchy missing: ${JSON.stringify(desktopState)}`);
  }
  if (desktopState.mediaCount !== 8 || desktopState.loadedMediaCount !== 8) {
    throw new Error(`desktop card media incomplete: ${JSON.stringify(desktopState)}`);
  }
  if (!desktopState.warehouseStylesheet || desktopState.heroImageWidths.some((width) => width <= 0)) {
    throw new Error(`warehouse visual assets did not load: ${JSON.stringify(desktopState)}`);
  }
  if (desktopState.pageOverflow > 1 || desktopState.overflowNodes.length) {
    throw new Error(`desktop horizontal overflow: ${JSON.stringify(desktopState.overflowNodes)}`);
  }
  if (screenshotDir) {
    await desktop.page.screenshot({ path: join(screenshotDir, 'warehouse-desktop.png'), fullPage: false });
  }
  await desktop.context.close();

  const mobile = await openWarehouse(browser, { width: 390, height: 844 });
  const mobileState = await inspectWarehouse(mobile.page, true);
  assertBetween('mobile hero height', mobileState.heroHeight, 120, 145);
  assertBetween('mobile header height', mobileState.headerHeight, 50, 58);
  if (mobileState.cardCount !== 12 || mobileState.metaCount !== 12 || mobileState.mobileActions !== 12) {
    throw new Error(`mobile cards/meta/actions mismatch: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.mediaCount !== 8 || mobileState.loadedMediaCount < 6) {
    throw new Error(`mobile card media incomplete: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.draggableCards !== 0) {
    throw new Error(`mobile cards expose native drag: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.pageOverflow > 1 || mobileState.overflowNodes.length) {
    throw new Error(`mobile horizontal overflow: ${JSON.stringify(mobileState.overflowNodes)}`);
  }
  if (screenshotDir) {
    await mobile.page.screenshot({ path: join(screenshotDir, 'warehouse-mobile.png'), fullPage: false });
  }
  await mobile.context.close();

  const empty = await openWarehouse(browser, { width: 1440, height: 900 }, true);
  const emptyState = await empty.page.evaluate(() => ({
    heading: document.querySelector('.warehouse-grid-empty h4')?.textContent?.trim() || '',
    actions: document.querySelectorAll('.warehouse-empty-actions button').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  if (!emptyState.heading || emptyState.actions !== 2 || emptyState.overflow > 1) {
    throw new Error(`warehouse empty state incomplete: ${JSON.stringify(emptyState)}`);
  }
  if (screenshotDir) {
    await empty.page.screenshot({ path: join(screenshotDir, 'warehouse-empty.png'), fullPage: false });
  }
  await empty.context.close();

  console.log('verify-warehouse-ui-browser OK', JSON.stringify({ desktopState, mobileState, emptyState }));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
