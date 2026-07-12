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
const imageDataUrl = `data:image/x-icon;base64,${readFileSync(join(root, 'favicon.ico')).toString('base64')}`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const browserEvents = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserEvents.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserEvents.push(`pageerror: ${error.message}`));
  await page.setContent('<main><div id="imageGenFeed"></div></main>');
  await page.addScriptTag({ path: join(root, 'image-gen-feed-cards.js') });
  await page.addScriptTag({ path: join(root, 'image-gen-feed.js') });

  await page.evaluate((image) => {
    const state = {
      creations: [{
        id: 'existing',
        prompt: 'existing image',
        image,
        model: 'image2-economy',
        modelLabel: 'Special 1K',
        createdAt: Date.now()
      }],
      pending: [],
      failed: []
    };
    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    window.SupabaseSync = {
      getListDisplayImageSrc: (ref) => ref,
      getCachedDisplayUrl: () => ''
    };
    window.CardImageLoader = {
      bindFeed: async () => {},
      boostImageGenRecentImages: () => {},
      boostImageGenWarehouseImages: () => {},
      disconnect: () => {},
      observeContainer: () => {}
    };
    window.MediaPipeline = { patchContainerFromCache: () => {} };

    window.__feedState = state;
    window.__feedApi = window.ImageGenFeed.init({
      IMG_LOADING_PLACEHOLDER: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      esc: escapeHtml,
      failedJobModelLabel: () => 'Special 1K',
      filterAndSortPosts: (posts) => posts || [],
      formatExpiryLabel: () => '',
      friendlyGenErrorMessage: (message) => message,
      getCommunityFeedForDisplay: () => [],
      getCommunityRandomEpoch: () => 0,
      getCommunityScope: () => 'all',
      getCommunitySort: () => 'latest',
      getImageGenFailedJobs: () => state.failed,
      getImageGenFeedTab: () => 'recent',
      getImageGenPendingJobs: () => state.pending,
      getRecentCreationsForFeed: () => state.creations,
      imageGenModelLabel: () => 'Special 1K',
      isDisplayableImage: (ref) => typeof ref === 'string' && ref.length > 0,
      isMobileFeedViewport: () => true,
      isSlowGenProviderModel: () => false,
      pickCreationFeedImage: (creation) => creation.image,
      prunePendingJobsWithCreations: () => {},
      setFeedLayoutPending: () => {},
      syncImageGenCommunityFiltersUI: () => {},
      syncImageGenWarehouseFiltersUI: () => {}
    });
  }, imageDataUrl);

  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ force: true }));
  try {
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-feed-id="cr_existing"] img');
      return img?.complete && img.naturalWidth > 8;
    });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const img = document.querySelector('[data-feed-id="cr_existing"] img');
      return {
        html: document.getElementById('imageGenFeed')?.innerHTML || '',
        src: img?.getAttribute('src') || '',
        complete: img?.complete || false,
        naturalWidth: img?.naturalWidth || 0
      };
    });
    throw new Error(`Initial feed image did not load: ${JSON.stringify({ diagnostics, browserEvents })}`, { cause: error });
  }
  await page.evaluate(() => {
    window.__originalFeedImage = document.querySelector('[data-feed-id="cr_existing"] img');
    window.__feedState.pending = [{ id: 'pending-1', prompt: 'new request', model: 'image2-economy' }];
  });

  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true, force: true }));
  await page.waitForSelector('[data-feed-id="pending-1"][data-pending="1"]');
  const pendingState = await page.evaluate(() => {
    const img = document.querySelector('[data-feed-id="cr_existing"] img');
    return {
      sameNode: img === window.__originalFeedImage,
      loaded: !!img?.complete && img.naturalWidth > 8,
      mediaClass: img?.closest('.imagegen-feed-media')?.className || ''
    };
  });

  await page.evaluate(() => {
    window.__feedState.pending = [];
    window.__feedState.failed = [{
      id: 'failed-1',
      prompt: 'new request',
      model: 'image2-economy',
      errorMessage: 'insufficient upstream balance'
    }];
  });
  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true, force: true }));
  await page.waitForSelector('[data-feed-id="failed-1"][data-failed="1"]');
  const failedState = await page.evaluate(() => {
    const img = document.querySelector('[data-feed-id="cr_existing"] img');
    return {
      sameNode: img === window.__originalFeedImage,
      loaded: !!img?.complete && img.naturalWidth > 8,
      mediaClass: img?.closest('.imagegen-feed-media')?.className || ''
    };
  });

  for (const [phase, result] of Object.entries({ pendingState, failedState })) {
    if (!result.sameNode || !result.loaded || /is-loading|load-failed|await/.test(result.mediaClass)) {
      throw new Error(`${phase} replaced or blanked the existing image: ${JSON.stringify(result)}`);
    }
  }

  await page.evaluate(() => {
    const img = window.__originalFeedImage;
    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>';
    img.dataset.feedLoadToken = 'in-flight';
    delete img.dataset.feedLoadDone;
    img.closest('.imagegen-feed-media')?.classList.add('is-loading');
  });
  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true, force: true }));
  const loadingState = await page.evaluate(() => {
    const img = document.querySelector('[data-feed-id="cr_existing"] img');
    return {
      sameNode: img === window.__originalFeedImage,
      token: img?.dataset.feedLoadToken || '',
      done: img?.dataset.feedLoadDone || '',
      mediaClass: img?.closest('.imagegen-feed-media')?.className || ''
    };
  });
  if (!loadingState.sameNode || loadingState.token !== 'in-flight' || loadingState.done || !loadingState.mediaClass.includes('is-loading')) {
    throw new Error(`force render replaced an in-flight image: ${JSON.stringify(loadingState)}`);
  }

  console.log('verify-imagegen-feed-retention-browser OK:', JSON.stringify({ pendingState, failedState, loadingState }));
} finally {
  if (browser) await browser.close();
}
