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

function seedHtml() {
  return `<!doctype html><meta charset="utf-8"><script>
const card = ${JSON.stringify(seedCard)};
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
  tx.objectStore('cards').put(card);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem('promptrepo_idb_owner_uid', 'guest');
  localStorage.setItem('promptrepo_app_page', 'warehouse');
  location.href = '/prompts';
})().catch((err) => {
  document.body.textContent = String(err && err.stack || err);
});
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
  console.log('verify-edit-panel-gallery-browser OK:', hashes.map((h) => h.slice(0, 8)).join(' -> '));
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
