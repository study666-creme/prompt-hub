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
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <div id="imageGenFeed">
      <article class="imagegen-feed-card" data-feed-id="cr_failed">
        <div class="imagegen-feed-media is-loading">
          <img data-image-ref="storage://card-images/user/generated/cr-failed.jpg" alt="">
        </div>
        <div class="imagegen-feed-body">Recent generation</div>
      </article>
      <article class="imagegen-feed-card" data-feed-id="wh_failed">
        <div class="imagegen-feed-media is-loading">
          <img data-image-ref="storage://card-images/user/generated/wh-failed.jpg" alt="">
        </div>
        <div class="imagegen-feed-body">Warehouse card</div>
      </article>
    </div>
  `);
  await page.addScriptTag({ path: join(root, 'feed-images.js') });

  const result = await page.evaluate(() => {
    const feedImages = window.FeedImages.init({ isDisplayableImage: () => true });
    const scope = document.getElementById('imageGenFeed');
    scope.querySelectorAll('img').forEach((img) => feedImages.finalizeFeedImageFailure(img));
    feedImages.stripFailedFeedMedia(scope);

    return [...scope.querySelectorAll('.imagegen-feed-card')].map((card) => ({
      feedId: card.dataset.feedId,
      noMedia: card.classList.contains('imagegen-feed-card--no-media'),
      hasMedia: !!card.querySelector('.imagegen-feed-media'),
      hasImg: !!card.querySelector('img'),
      failedMedia: !!card.querySelector('.card-media--load-failed'),
      bodyText: card.querySelector('.imagegen-feed-body')?.textContent || ''
    }));
  });

  const failures = ['cr_', 'wh_'].flatMap((prefix) => {
    const card = result.find((item) => item.feedId.startsWith(prefix));
    if (!card) return [`${prefix} card was removed`];
    const cardFailures = [];
    if (!card.noMedia) cardFailures.push('missing imagegen-feed-card--no-media');
    if (card.hasMedia) cardFailures.push('retained imagegen-feed-media');
    if (card.hasImg) cardFailures.push('retained broken img');
    if (card.failedMedia) cardFailures.push('retained failed black media slot');
    if (!card.bodyText.trim()) cardFailures.push('lost text content');
    return cardFailures.map((failure) => `${prefix} ${failure}`);
  });
  if (failures.length) {
    throw new Error(`failed media collapse contract: ${failures.join('; ')}; DOM=${JSON.stringify(result)}`);
  }

  console.log('verify-imagegen-failed-media-collapse-browser OK:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
}
