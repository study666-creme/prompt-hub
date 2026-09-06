import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5577);
const base = `http://127.0.0.1:${port}`;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let j = 0; j < 8; j += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  tb.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tb, data])), 8 + data.length);
  return out;
}

function makePngBuffer(index) {
  const w = 220;
  const h = 160;
  const palettes = [
    [[235, 67, 53], [251, 188, 5], [52, 168, 83], [66, 133, 244]],
    [[236, 72, 153], [244, 114, 182], [190, 24, 93], [251, 207, 232]],
    [[34, 197, 94], [132, 204, 22], [21, 128, 61], [220, 252, 231]],
    [[59, 130, 246], [14, 165, 233], [30, 64, 175], [219, 234, 254]],
    [[250, 204, 21], [249, 115, 22], [180, 83, 9], [254, 249, 195]]
  ][index];
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x += 1) {
      const q = index === 0 ? ((x >= w / 2 ? 1 : 0) + (y >= h / 2 ? 2 : 0)) : ((Math.floor((x + y) / 26) + index) % 4);
      const col = palettes[q];
      const off = row + 1 + x * 4;
      raw[off] = col[0];
      raw[off + 1] = col[1];
      raw[off + 2] = col[2];
      raw[off + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const pngBuffers = [0, 1, 2, 3, 4].map(makePngBuffer);
const galleryPaths = pngBuffers.map((_, index) => `guest/codex-gallery-browser-${index}_grid.png`);
const gallery = galleryPaths.map((path) => `${base}/api/v1/media/c/${Buffer.from(path).toString('base64url')}`);
const seedCard = {
  id: 'codex-gallery-browser-card',
  title: 'Codex gallery browser check',
  prompt: 'gallery paging browser regression',
  tags: ['browser-check', '图片生成'],
  genJobId: '11111111-1111-4111-8111-111111111111',
  genSourceId: 'codex-gallery-browser-source',
  image: gallery[0],
  cardImages: gallery,
  createdAt: Date.now(),
  updatedAt: Date.now()
};
const seedCards = [
  seedCard,
  ...Array.from({ length: 35 }, (_, index) => ({
    id: `codex-mobile-load-card-${index + 1}`,
    title: `Mobile first load ${index + 1}`,
    prompt: `mobile first load browser regression card ${index + 1}`,
    tags: ['browser-check'],
    image: gallery[(index + 1) % gallery.length],
    cardImages: [gallery[(index + 1) % gallery.length]],
    createdAt: Date.now() - index - 1,
    updatedAt: Date.now() - index - 1
  }))
];

function seedHtml(target = 'warehouse') {
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(seedCards)};
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
(async () => {
  indexedDB.deleteDatabase('PromptRepoDB');
  await new Promise((resolve) => setTimeout(resolve, 120));
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
  localStorage.setItem('promptrepo_app_page', ${JSON.stringify(target)});
  location.href = ${JSON.stringify(target)} === 'community' ? '/community' : '/prompts';
})().catch((err) => {
  document.body.textContent = String(err && err.stack || err);
});
</script>`;
}

async function touchScroll(page, fromY = 700, toY = 260, x = 195) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: fromY, radiusX: 4, radiusY: 4, force: 1 }]
  });
  for (let y = fromY - 70; y >= toY; y -= 70) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }]
    });
    await page.waitForTimeout(18);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}

async function verifyMobileFirstLoad(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/__seed.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/prompts', { timeout: 15000 });
    await page.waitForFunction(() => window.MobileUI?.getPerf?.()?.cardEagerCap === 24, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#cardsContainer .card[data-id]').length >= 24, null, { timeout: 15000 });
    await page.waitForFunction(() => (
      [...document.querySelectorAll('#cardsContainer img.card-img')]
        .filter((img) => img.complete && img.naturalWidth > 8).length >= 20
    ), null, { timeout: 15000 });

    const warehouseBefore = await page.evaluate(() => {
      const main = document.querySelector('.app-main');
      const grid = document.getElementById('cardsContainer');
      const perf = window.MobileUI?.getPerf?.();
      main.scrollTop = 0;
      return {
        mainOverflow: getComputedStyle(main).overflowY,
        mainScrollHeight: main.scrollHeight,
        mainClientHeight: main.clientHeight,
        gridOverflow: getComputedStyle(grid).overflowY,
        cards: grid.querySelectorAll('.card[data-id]').length,
        loaded: [...grid.querySelectorAll('img.card-img')].filter((img) => img.complete && img.naturalWidth > 8).length,
        perf,
        blockingClasses: ['mobile-nav-open', 'mobile-groups-open', 'panel-open', 'app-modal-open']
          .filter((name) => document.body.classList.contains(name)),
        criticalResources: performance.getEntriesByType('resource')
          .filter((entry) => /(?:partials\/index-body|legacy\/script)\/part-/.test(entry.name))
          .map((entry) => ({
            path: new URL(entry.name).pathname,
            initiator: entry.initiatorType,
            transferSize: entry.transferSize
          }))
      };
    });
    if (!/auto|scroll|overlay/.test(warehouseBefore.mainOverflow)) {
      throw new Error(`mobile app-main is not scrollable: ${JSON.stringify(warehouseBefore)}`);
    }
    if (warehouseBefore.mainScrollHeight <= warehouseBefore.mainClientHeight + 40) {
      throw new Error(`mobile warehouse does not overflow app-main: ${JSON.stringify(warehouseBefore)}`);
    }
    if (warehouseBefore.blockingClasses.length) {
      throw new Error(`mobile first load left blocking body classes: ${JSON.stringify(warehouseBefore)}`);
    }
    await touchScroll(page);
    const warehouseScrollTop = await page.locator('.app-main').evaluate((main) => main.scrollTop);
    if (warehouseScrollTop < 40) {
      throw new Error(`mobile first touch did not scroll warehouse: ${JSON.stringify({ warehouseScrollTop, warehouseBefore })}`);
    }

    await page.close();
    const communityPage = await context.newPage();
    await communityPage.goto(`${base}/__seed.html?target=community`, { waitUntil: 'domcontentloaded' });
    await communityPage.waitForURL('**/community', { timeout: 15000 });
    await communityPage.waitForFunction(() => document.getElementById('pageCommunity')?.classList.contains('active'), null, { timeout: 10000 });
    await communityPage.waitForTimeout(700);
    const communityBefore = await communityPage.evaluate(() => {
      const main = document.querySelector('.app-main');
      const grid = document.getElementById('communityGrid');
      const shell = document.querySelector('#pageCommunity .feature-shell');
      grid.innerHTML = `<div class="community-feed-col">${Array.from({ length: 32 }, (_, index) => (
        `<article class="card community-post-card" style="min-height:${150 + (index % 3) * 35}px"><div class="card-body">Card ${index + 1}</div></article>`
      )).join('')}</div>`;
      main.scrollTop = 0;
      shell.scrollTop = 100;
      const normal = {
        shellOverflow: getComputedStyle(shell).overflowY,
        shellScrollTop: shell.scrollTop,
        shellStyle: shell.getAttribute('style') || '',
        shellClass: shell.className,
        overflowRules: [...document.styleSheets].flatMap((sheet) => {
          try {
            return [...sheet.cssRules].flatMap((rule) => {
              const rules = rule.cssRules ? [...rule.cssRules] : [rule];
              return rules
                .filter((item) => item.selectorText && shell.matches(item.selectorText) && item.style?.overflowY)
                .map((item) => `${item.selectorText} => ${item.style.overflowY}${item.style.getPropertyPriority('overflow-y') ? ' !important' : ''}`);
            });
          } catch (e) {
            return [];
          }
        }),
        gridOverflow: getComputedStyle(grid).overflowY,
        mainScrollHeight: main.scrollHeight,
        mainClientHeight: main.clientHeight
      };
      document.body.classList.add('efficiency-mode');
      const efficiency = {
        shellOverflow: getComputedStyle(shell).overflowY,
        gridOverflow: getComputedStyle(grid).overflowY,
        gridFlex: getComputedStyle(grid).flex
      };
      document.body.classList.remove('efficiency-mode');
      return { normal, efficiency };
    });
    if (communityBefore.normal.shellOverflow !== 'visible' || communityBefore.normal.shellScrollTop !== 0) {
      throw new Error(`community created a nested mobile scroll root: ${JSON.stringify(communityBefore)}`);
    }
    if (communityBefore.efficiency.gridOverflow !== 'visible') {
      throw new Error(`efficiency mode created a nested mobile grid scroll root: ${JSON.stringify(communityBefore)}`);
    }
    if (communityBefore.normal.mainScrollHeight <= communityBefore.normal.mainClientHeight + 40) {
      throw new Error(`mobile community does not overflow app-main: ${JSON.stringify(communityBefore)}`);
    }
    let communityScrollTop = 0;
    for (const x of [195, 28, 362]) {
      await touchScroll(communityPage, 700, 260, x);
      communityScrollTop = await communityPage.locator('.app-main').evaluate((main) => main.scrollTop);
      if (communityScrollTop >= 40) break;
    }
    if (communityScrollTop < 40) {
      throw new Error(`mobile first touch did not scroll community: ${JSON.stringify({ communityScrollTop, communityBefore })}`);
    }

    const transferredByPath = new Map();
    for (const entry of warehouseBefore.criticalResources) {
      if (entry.transferSize <= 0) continue;
      transferredByPath.set(entry.path, (transferredByPath.get(entry.path) || 0) + 1);
    }
    const duplicateTransfers = [...transferredByPath].filter(([, count]) => count > 1);
    if (duplicateTransfers.length) {
      throw new Error(`critical preload resources transferred more than once: ${JSON.stringify(duplicateTransfers)}`);
    }

    return {
      cards: warehouseBefore.cards,
      loaded: warehouseBefore.loaded,
      warehouseScrollTop,
      communityScrollTop,
      criticalRequests: warehouseBefore.criticalResources.length
    };
  } finally {
    await context.close();
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(url.searchParams.get('target') || 'warehouse'));
      return;
    }
    const cdnMatch = url.pathname.match(/^\/api\/v1\/media\/c\/([^/]+)$/);
    if (cdnMatch) {
      const decodedPath = Buffer.from(cdnMatch[1], 'base64url').toString('utf8');
      const idx = galleryPaths.indexOf(decodedPath);
      const body = pngBuffers[idx];
      if (body) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(body);
        return;
      }
    }
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '/prompts' || path === '/community') path = '/index.html';
    const file = resolve(join(root, path.replace(/^\/+/, '')));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err && err.stack || err));
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(`${base}/__seed.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/prompts', { timeout: 15000 });
  await page.waitForFunction(() => typeof window.inspectCardLibraryRecovery === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  try {
    await page.waitForSelector('.card[data-id="codex-gallery-browser-card"]', { state: 'attached', timeout: 15000 });
  } catch (err) {
    const diag = await page.evaluate(async () => {
      const recovery = await window.inspectCardLibraryRecovery?.();
      const dbRows = await new Promise((resolve) => {
        const open = indexedDB.open('PromptRepoDB', 3);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['cards'], 'readonly');
          const req = tx.objectStore('cards').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        };
        open.onerror = () => resolve([]);
      });
      return {
        href: location.href,
        label: document.getElementById('appBuildLabel')?.textContent || '',
        recovery,
        galleryMeta: (() => {
          const card = (window.__promptHubCards || []).find((c) => c.id === 'codex-gallery-browser-card');
          return {
            usable: window.FeatureDraft?.isUsableWarehouseImage?.(card),
            cover: window.PromptHubCardGallery?.getCardCoverImage?.(card),
            feedCover: window.PromptHubCardGallery?.getCardFeedCoverImage?.(card),
            listMeta: window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, { skipEnsure: true })
          };
        })(),
        dbRows: dbRows.map((c) => ({ id: c.id, images: c.cardImages?.length || 0, image: !!c.image })),
        renderedCards: [...document.querySelectorAll('.card[data-id]')].map((el) => el.dataset.id)
          .slice(0, 8),
        seededCardHtml: document.querySelector('.card[data-id="codex-gallery-browser-card"]')?.outerHTML?.slice(0, 1200) || ''
      };
    });
    throw new Error(`seeded card did not render: ${JSON.stringify(diag)}`);
  }
  const galleryMeta = await page.evaluate(() => {
    const card = (window.__promptHubCards || []).find((c) => c.id === 'codex-gallery-browser-card');
    return {
      cover: window.PromptHubCardGallery?.getCardCoverImage?.(card) || '',
      feedCover: window.PromptHubCardGallery?.getCardFeedCoverImage?.(card) || '',
      listRef: window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, { skipEnsure: true })?.ref || ''
    };
  });
  if (galleryMeta.cover !== gallery[0] || galleryMeta.feedCover !== gallery[0] || galleryMeta.listRef !== gallery[0]) {
    throw new Error(`warehouse card cover is not gallery index 0: ${JSON.stringify(galleryMeta)}`);
  }
  const listRef = await page.locator('.card[data-id="codex-gallery-browser-card"] img.card-img').first().getAttribute('data-image-ref').catch(() => '');
  if (listRef && listRef !== gallery[0]) throw new Error(`warehouse DOM cover is not gallery index 0: ${listRef}`);

  await page.locator('.card[data-id="codex-gallery-browser-card"]').click();
  try {
    await page.waitForSelector('#editPanel:not(.hidden)', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('panelGalleryCounter')?.textContent?.trim() === '1 / 5', null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const img = document.getElementById('previewImage');
      return !!(img?.currentSrc || img?.src);
    }, null, { timeout: 15000 });
  } catch (err) {
    const diag = await page.evaluate(() => ({
      panelClass: document.getElementById('editPanel')?.className || '',
      dropClass: document.getElementById('dropArea')?.className || '',
      counter: document.getElementById('panelGalleryCounter')?.textContent?.trim() || '',
      previewSrc: document.getElementById('previewImage')?.getAttribute('src') || '',
      previewCurrentSrc: document.getElementById('previewImage')?.currentSrc || '',
      galleryNavClass: document.getElementById('panelGalleryNav')?.className || '',
      selectedCardClass: document.querySelector('.card[data-id="codex-gallery-browser-card"]')?.className || '',
      activePage: [...document.querySelectorAll('.page.active')].map((el) => el.id),
      bodyClass: document.body.className
    }));
    throw new Error(`edit panel did not show first preview: ${JSON.stringify(diag)}`);
  }

  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    await page.waitForFunction((idx) => document.getElementById('panelGalleryCounter')?.textContent?.trim() === `${idx + 1} / 5`, i, { timeout: 15000 });
    await page.waitForFunction(() => {
      const img = document.getElementById('previewImage');
      return !!(img?.currentSrc || img?.src);
    }, null, { timeout: 15000 });
    const src = await page.locator('#previewImage').evaluate((img) => img.currentSrc || img.src || '');
    seen.push(src);
    if (i < 4) await page.locator('#panelGalleryNext').click();
  }

  const hashes = seen.map((src) => createHash('sha1').update(src).digest('hex'));
  if (new Set(hashes).size !== 5) {
    throw new Error(`panel preview did not change for every gallery page: ${hashes.join(',')}`);
  }
  const mobile = await verifyMobileFirstLoad(browser);
  console.log(
    'verify-edit-panel-gallery-browser OK:',
    hashes.map((h) => h.slice(0, 8)).join(' -> '),
    `mobile ${mobile.loaded}/${mobile.cards}, scroll ${mobile.warehouseScrollTop}/${mobile.communityScrollTop}, resources ${mobile.criticalRequests}`
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
