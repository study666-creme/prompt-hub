import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = join(import.meta.dirname, '..');
const readyImageBytes = readFileSync(join(root, 'favicon.ico'));
const heldRoutes = [];
let browser;

async function waitForRouteCount(count, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (heldRoutes.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (heldRoutes.length < count) {
    throw new Error(`Expected ${count} image requests, received ${heldRoutes.length}`);
  }
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://queue.test/**', (route) => {
    heldRoutes.push(route);
  });
  await page.setContent(`
    <div id="imageGenFeed">
      ${[1, 2, 3].map((id) => `
        <article class="imagegen-feed-card" data-feed-id="cr_${id}">
          <div class="imagegen-feed-media is-loading">
            <img data-image-ref="https://queue.test/${id}.jpg" alt="">
          </div>
        </article>
      `).join('')}
    </div>
  `);
  await page.evaluate(() => {
    window.MobileUI = {
      getPerf: () => ({ maxDownload: 2 }),
      isMobileViewport: () => true,
      isUserInteracting: () => false
    };
    window.SupabaseSync = {
      isInvalidMediaUrl: () => false,
      isWarehouseBlockedFullUrl: () => false,
      storagePathFromDisplayUrl: () => ''
    };
    window.FeatureDraft = {};
  });
  await page.addScriptTag({ path: join(root, 'card-image-loader-queues.js') });
  await page.addScriptTag({ path: join(root, 'card-image-loader.js') });
  await page.evaluate(() => {
    [...document.querySelectorAll('#imageGenFeed img')].forEach((img, index) => {
      window.CardImageLoader.applyUrlToImg(img, `https://queue.test/${index + 1}.jpg`);
    });
  });

  await waitForRouteCount(2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (heldRoutes.length !== 2) {
    throw new Error(`Third download started before a slot was released: ${heldRoutes.length}`);
  }

  await heldRoutes[0].fulfill({
    status: 200,
    contentType: 'image/x-icon',
    body: readyImageBytes
  });
  await waitForRouteCount(3);
  await Promise.all(heldRoutes.slice(1).map((route) => route.fulfill({
    status: 200,
    contentType: 'image/x-icon',
    body: readyImageBytes
  })));
  await page.waitForFunction(() => [...document.querySelectorAll('#imageGenFeed img')]
    .every((img) => img.complete && img.naturalWidth > 8));

  console.log('verify-card-image-loader-download-queue-browser OK');
} finally {
  if (browser) await browser.close();
}
