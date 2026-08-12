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
    <div id="communityGrid">
      <article class="card community-post-card community-post-card--visual" data-post-id="community_failed">
        <div class="card-media is-loading">
          <img class="card-img" data-image-ref="storage://card-images/user/generated/community-failed.jpg" alt="">
        </div>
        <div class="card-body">Community post</div>
      </article>
    </div>
  `);
  await page.addScriptTag({ path: join(root, 'feed-images.js') });

  const result = await page.evaluate(() => {
    const feedImages = window.FeedImages.init({ isDisplayableImage: () => true });
    document.querySelectorAll('#imageGenFeed img').forEach((img) => feedImages.finalizeFeedImageFailure(img));
    feedImages.stripFailedFeedMedia(document.getElementById('imageGenFeed'));
    const communityImg = document.querySelector('#communityGrid img');
    if (communityImg) feedImages.finalizeFeedImageFailure(communityImg);

    return {
      feed: [...document.querySelectorAll('#imageGenFeed .imagegen-feed-card')].map((card) => ({
        feedId: card.dataset.feedId,
        noMedia: card.classList.contains('imagegen-feed-card--no-media'),
        hasMedia: !!card.querySelector('.imagegen-feed-media'),
        hasImg: !!card.querySelector('img'),
        failedMedia: !!card.querySelector('.imagegen-feed-media.card-media--load-failed'),
        hasPlaceholder: !!card.querySelector('.imagegen-feed-media .card-media-placeholder'),
        retryButton: !!card.querySelector('.imagegen-feed-media .card-media-placeholder-retry'),
        bodyText: card.querySelector('.imagegen-feed-body')?.textContent || ''
      })),
      community: (() => {
        const media = document.querySelector('#communityGrid .card-media');
        return {
          hasMedia: !!media,
          failedMedia: !!media?.classList.contains('card-media--load-failed'),
          hasPlaceholder: !!media?.querySelector('.card-media-placeholder'),
          retryButton: !!media?.querySelector('.card-media-placeholder-retry')
        };
      })()
    };
  });

  const failures = ['cr_', 'wh_'].flatMap((prefix) => {
    const card = result.feed.find((item) => item.feedId.startsWith(prefix));
    if (!card) return [`${prefix} card was removed`];
    const cardFailures = [];
    if (card.noMedia) cardFailures.push('unexpected imagegen-feed-card--no-media');
    if (!card.hasMedia) cardFailures.push('media slot was removed (text-only regression)');
    if (!card.failedMedia) cardFailures.push('missing card-media--load-failed state');
    if (!card.hasPlaceholder) cardFailures.push('missing stable media placeholder');
    if (!card.retryButton) cardFailures.push('missing retry button');
    if (!card.bodyText.trim()) cardFailures.push('lost text content');
    return cardFailures.map((failure) => `${prefix} ${failure}`);
  });
  const c = result.community;
  if (!c.hasMedia) failures.push('community media slot removed (text-only regression)');
  if (!c.failedMedia) failures.push('community missing card-media--load-failed state');
  if (!c.hasPlaceholder) failures.push('community missing stable media placeholder');
  if (!c.retryButton) failures.push('community missing retry button');
  if (failures.length) {
    throw new Error(`failed media placeholder contract: ${failures.join('; ')}; DOM=${JSON.stringify(result)}`);
  }

  console.log('verify-imagegen-failed-media-collapse-browser OK:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
}
