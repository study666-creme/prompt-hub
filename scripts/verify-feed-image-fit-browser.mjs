import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
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
const port = Number(process.env.PORT || 5578);
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

function makeTallPngBuffer() {
  const w = 240;
  const h = 820;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x += 1) {
      const stripe = Math.floor(y / 68) % 4;
      const edge = x < 22 || x > w - 23;
      const colors = [
        edge ? [29, 78, 216] : [96, 165, 250],
        edge ? [5, 150, 105] : [110, 231, 183],
        edge ? [190, 24, 93] : [244, 114, 182],
        edge ? [180, 83, 9] : [251, 191, 36]
      ];
      const col = colors[stripe];
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

const ownerEmail = 'codex-fit@example.com';
const ownerId = '11111111-2222-4333-8444-555555555555';
const tallPath = 'guest/codex-long-card_grid.png';
const tallUrl = `${base}/api/v1/media/c/${Buffer.from(tallPath).toString('base64url')}`;
const tallPng = makeTallPngBuffer();

const now = Date.now();
const ownPost = {
  id: 'codex-long-post',
  sourceCardId: 'codex-long-card',
  authorId: ownerId,
  authorName: 'Codex Fit',
  title: 'Long image fit check',
  prompt: 'A deliberately tall generated image used to verify feed cards do not crop long artwork.',
  image: tallUrl,
  likes: 3,
  createdAt: now,
  updatedAt: now
};
const publicPosts = Array.from({ length: 24 }, (_, index) => ({
  ...ownPost,
  id: `codex-public-long-${index}`,
  sourceCardId: `codex-public-long-card-${index}`,
  likes: index,
  createdAt: now - index * 1000,
  updatedAt: now - index * 1000
}));
const seedCard = {
  id: ownPost.sourceCardId,
  title: ownPost.title,
  prompt: ownPost.prompt,
  tags: ['image-fit'],
  image: tallUrl,
  cardImages: [tallUrl],
  publishedToCommunity: true,
  communityPostId: ownPost.id,
  createdAt: now,
  updatedAt: now
};
const browserEvents = [];

function seedHtml(target) {
  const appPage = target === 'home' ? 'creations' : 'community';
  const href = target === 'home' ? '/profile' : '/community';
  return `<!doctype html><meta charset="utf-8"><script>
const card = ${JSON.stringify(seedCard)};
const ownPost = ${JSON.stringify(ownPost)};
const publicPosts = ${JSON.stringify(publicPosts)};
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
  localStorage.setItem('promptrepo_app_page', ${JSON.stringify(appPage)});
  localStorage.setItem('promptrepo_community_posts', JSON.stringify([ownPost]));
  localStorage.setItem('promptrepo_public_feed_cache', JSON.stringify({
    v: 7,
    posts: publicPosts,
    cachedAt: Date.now()
  }));
  location.href = ${JSON.stringify(href)};
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
      res.end(seedHtml(url.searchParams.get('target') || 'community'));
      return;
    }
    const cdnMatch = url.pathname.match(/^\/api\/v1\/media\/c\/([^/]+)$/);
    if (cdnMatch) {
      const decodedPath = Buffer.from(cdnMatch[1], 'base64url').toString('utf8');
      if (decodedPath === tallPath) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(tallPng);
        return;
      }
    }
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '/community' || path === '/profile' || path === '/home' || path === '/creations') {
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
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err && err.stack || err));
  }
});

function measureFeedImage(gridId) {
  const rootEl = document.getElementById(gridId);
  const card = rootEl?.querySelector('.community-post-card--visual');
  const media = card?.querySelector('.card-media');
  const img = media?.querySelector('img.card-img');
  const imgStyle = img ? getComputedStyle(img) : null;
  const mediaStyle = media ? getComputedStyle(media) : null;
  const imgRect = img?.getBoundingClientRect();
  const mediaRect = media?.getBoundingClientRect();
  return {
    gridId,
    cardClass: card?.className || '',
    mediaClass: media?.className || '',
    src: img?.currentSrc || img?.src || '',
    complete: !!img?.complete,
    naturalWidth: img?.naturalWidth || 0,
    naturalHeight: img?.naturalHeight || 0,
    imgWidth: imgRect?.width || 0,
    imgHeight: imgRect?.height || 0,
    mediaWidth: mediaRect?.width || 0,
    mediaHeight: mediaRect?.height || 0,
    objectFit: imgStyle?.objectFit || '',
    position: imgStyle?.position || '',
    maxHeight: imgStyle?.maxHeight || '',
    aspectRatio: mediaStyle?.aspectRatio || '',
    overflow: mediaStyle?.overflow || ''
  };
}

async function waitForTallImage(page, gridId) {
  try {
    await page.waitForFunction((id) => {
      const img = document.querySelector(`#${id} .community-post-card--visual img.card-img`);
      return !!(
        img
        && img.complete
        && img.naturalWidth > 0
        && img.naturalHeight / img.naturalWidth > 3
        && (img.currentSrc || img.src || '').startsWith('http')
      );
    }, gridId, { timeout: 25000 });
    await page.waitForFunction((id) => {
      const img = document.querySelector(`#${id} .community-post-card--visual img.card-img`);
      const rect = img?.getBoundingClientRect();
      return !!(rect && rect.width > 80 && rect.height / rect.width > 2.6);
    }, gridId, { timeout: 25000 });
  } catch (err) {
    const diag = await page.evaluate((id) => {
      const grid = document.getElementById(id);
      const imgs = [...(grid?.querySelectorAll('img.card-img') || [])].slice(0, 3).map((img) => ({
        src: img.getAttribute('src') || '',
        currentSrc: img.currentSrc || '',
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        cardClass: img.closest('.card')?.className || '',
        mediaClass: img.closest('.card-media')?.className || ''
      }));
      return {
        href: location.href,
        appBuild: document.getElementById('appBuildLabel')?.textContent || '',
        activePages: [...document.querySelectorAll('.app-page.active')].map((el) => el.id),
        gridClass: grid?.className || '',
        cardCount: grid?.querySelectorAll('.community-post-card').length || 0,
        skeletonCount: grid?.querySelectorAll('.community-feed-skeleton').length || 0,
        imgCount: grid?.querySelectorAll('img.card-img').length || 0,
        displayCount: window.FeatureDraft?.getCommunityFeedForDisplay?.()?.length ?? null,
        pagedDebug: window.FeatureDraft?.getCommunityFeedPagedDebug?.(id) || null,
        browserEvents: window.__codexBrowserEvents || [],
        imgs,
        html: grid?.innerHTML?.slice(0, 1000) || ''
      };
    }, gridId);
    throw new Error(`${gridId} tall image did not load: ${JSON.stringify(diag)}`);
  }
  return page.evaluate(measureFeedImage, gridId);
}

function assertTallFit(label, metrics) {
  const ratio = metrics.imgHeight / Math.max(metrics.imgWidth, 1);
  if (metrics.objectFit !== 'contain') {
    throw new Error(`${label} image object-fit is not contain: ${JSON.stringify(metrics)}`);
  }
  if (metrics.position !== 'static') {
    throw new Error(`${label} image is still absolutely positioned: ${JSON.stringify(metrics)}`);
  }
  if (metrics.maxHeight !== 'none') {
    throw new Error(`${label} image max-height is constrained: ${JSON.stringify(metrics)}`);
  }
  if (ratio < 2.6) {
    throw new Error(`${label} image is cropped or fixed-ratio: ${JSON.stringify(metrics)}`);
  }
  if (metrics.mediaHeight + 2 < metrics.imgHeight) {
    throw new Error(`${label} media wrapper is shorter than image: ${JSON.stringify(metrics)}`);
  }
}

async function installTallCardFixture(page, gridId) {
  await page.evaluate(({ id, src }) => {
    const grid = document.getElementById(id);
    if (!grid) throw new Error(`${id} not found`);
    grid.className = 'cards-container community-cards community-feed-columns';
    if (id === 'communityGrid') grid.classList.add('community-feed-grid');
    grid.style.width = '360px';
    grid.style.maxWidth = '360px';
    grid.innerHTML = `
      <div class="community-feed-col">
        <div class="card community-post-card community-post-card--visual community-feed-image-only">
          <div class="card-media media-revealed">
            <img class="card-img" src="${src}" data-image-ref="${src}" loading="eager" decoding="async" alt="">
          </div>
        </div>
      </div>`;
  }, { id: gridId, src: tallUrl });
}

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      browserEvents.push(`${msg.type()}: ${msg.text()}`);
      if (browserEvents.length > 30) browserEvents.shift();
    }
  });
  page.on('pageerror', (err) => {
    browserEvents.push(`pageerror: ${err.message}`);
    if (browserEvents.length > 30) browserEvents.shift();
  });
  await page.addInitScript(() => {
    window.__codexBrowserEvents = [];
    window.addEventListener('error', (event) => {
      window.__codexBrowserEvents.push(`error: ${event.message}`);
      if (window.__codexBrowserEvents.length > 30) window.__codexBrowserEvents.shift();
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__codexBrowserEvents.push(`unhandledrejection: ${event.reason?.message || event.reason || ''}`);
      if (window.__codexBrowserEvents.length > 30) window.__codexBrowserEvents.shift();
    });
  });

  await page.goto(`${base}/__seed.html?target=community`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/community', { timeout: 15000 });
  await page.waitForFunction(() => !!window.FeatureDraft?.isDisplayableImage, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const grid = document.getElementById('communityGrid');
    return !!(grid && (grid.classList.contains('feed-layout-ready') || grid.querySelector('.feature-empty, .feed-page-sentinel')));
  }, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await installTallCardFixture(page, 'communityGrid');
  const communityMetrics = await waitForTallImage(page, 'communityGrid');
  assertTallFit('communityGrid', communityMetrics);

  await page.goto(`${base}/__seed.html?target=home`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/profile', { timeout: 15000 });
  await page.waitForFunction(() => !!window.FeatureDraft?.renderCreations, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await installTallCardFixture(page, 'creationsGrid');
  const creationsMetrics = await waitForTallImage(page, 'creationsGrid');
  assertTallFit('creationsGrid', creationsMetrics);

  console.log(
    'verify-feed-image-fit-browser OK:',
    `community ${Math.round(communityMetrics.imgWidth)}x${Math.round(communityMetrics.imgHeight)}`,
    `creations ${Math.round(creationsMetrics.imgWidth)}x${Math.round(creationsMetrics.imgHeight)}`
  );
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
