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
      creations: [],
      initialCreation: {
        id: 'existing',
        prompt: 'existing image',
        image,
        model: 'image2-economy',
        modelLabel: 'Special 1K',
        createdAt: Date.now()
      },
      mobile: true,
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
      isMobileFeedViewport: () => state.mobile,
      isSlowGenProviderModel: () => false,
      pickCreationFeedImage: (creation) => creation.image,
      prunePendingJobsWithCreations: () => {},
      setFeedLayoutPending: () => {},
      syncImageGenCommunityFiltersUI: () => {},
      syncImageGenWarehouseFiltersUI: () => {}
    });
  }, imageDataUrl);

  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ force: true, recentSyncing: true }));
  await page.waitForSelector('.imagegen-feed-syncing[role="status"]');
  await page.evaluate(() => {
    window.__feedState.creations = [window.__feedState.initialCreation];
    window.__feedApi.renderImageGenFeed({ preserveScroll: true });
  });
  await page.waitForFunction(() => !document.querySelector('.imagegen-feed-empty-wrap'));
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

  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true }));
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
  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true }));
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

  await page.evaluate((image) => {
    window.__feedState.failed = [];
    window.__feedState.creations.unshift({
      id: 'completed-new',
      prompt: 'completed image',
      image,
      model: 'image2-economy',
      modelLabel: 'Special 1K',
      createdAt: Date.now() + 1000
    });
  }, imageDataUrl);
  await page.evaluate(() => window.__feedApi.renderImageGenFeed({ preserveScroll: true }));
  await page.waitForSelector('[data-feed-id="cr_completed-new"]');
  const completedState = await page.evaluate(() => {
    const oldImg = document.querySelector('[data-feed-id="cr_existing"] img');
    const newCard = document.querySelector('[data-feed-id="cr_completed-new"]');
    return {
      sameOldNode: oldImg === window.__originalFeedImage,
      cardCount: document.querySelectorAll('#imageGenFeed [data-feed-id^="cr_"]').length,
      isFirst: newCard === document.querySelector('#imageGenFeed [data-feed-id^="cr_"]'),
      animated: newCard?.classList.contains('imagegen-feed-card--just-added') || false
    };
  });
  if (!completedState.sameOldNode || completedState.cardCount !== 2 || !completedState.isFirst || !completedState.animated) {
    throw new Error(`completed creation did not patch incrementally: ${JSON.stringify(completedState)}`);
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
  if (!loadingState.sameNode || loadingState.token !== 'in-flight' || loadingState.done) {
    throw new Error(`force render replaced an in-flight image: ${JSON.stringify(loadingState)}`);
  }

  await page.addStyleTag({ content: `
    #imageGenFeed { display: grid; grid-template-columns: 1fr 1fr; height: 280px; overflow-y: auto; }
    #imageGenFeed .imagegen-feed-card { min-height: 130px; }
    #imageGenFeed .imagegen-feed-media { min-height: 80px; }
    #imageGenFeed .imagegen-feed-library-cta { grid-column: 1 / -1; min-height: 80px; }
  ` });
  await page.evaluate(async (image) => {
    window.__feedState.mobile = false;
    window.__feedState.pending = [];
    window.__feedState.failed = [];
    window.__feedState.creations = Array.from({ length: 13 }, (_, index) => ({
      id: `page-${index + 1}`,
      prompt: `paginated image ${index + 1}`,
      image,
      model: 'image2-economy',
      modelLabel: 'Special 1K',
      createdAt: Date.now() - index
    }));
    await window.__feedApi.renderImageGenFeed({ force: true, scrollToTop: true });
  }, imageDataUrl);
  await page.waitForFunction(() => document.querySelectorAll('#imageGenFeed [data-feed-id^="cr_page-"]').length === 12);
  const priorityState = await page.evaluate(() => (
    [...document.querySelectorAll('#imageGenFeed [data-feed-id^="cr_page-"] img')]
      .slice(0, 6)
      .map((img) => ({ loading: img.loading, fetchPriority: img.fetchPriority }))
  ));
  if (priorityState.length !== 6
    || priorityState.some((item) => item.loading !== 'eager')
    || priorityState.slice(0, 4).some((item) => item.fetchPriority !== 'high')) {
    throw new Error(`recent first-screen images were not prioritized: ${JSON.stringify(priorityState)}`);
  }
  await page.evaluate(() => {
    const feed = document.getElementById('imageGenFeed');
    const last = window.__feedState.creations[12];
    const temp = document.createElement('div');
    temp.innerHTML = window.__feedApi.creationToFeedHtml(last);
    window.__feedApi.appendImageGenFeedCards(feed, [temp.firstElementChild]);
  });
  const paginationState = await page.evaluate(() => {
    const feed = document.getElementById('imageGenFeed');
    const footer = feed.querySelector(':scope > [data-imagegen-feed-footer="recent"]');
    const cards = [...feed.querySelectorAll(':scope > .imagegen-feed-card[data-feed-id^="cr_page-"]')];
    return {
      cardCount: cards.length,
      footerCount: feed.querySelectorAll(':scope > [data-imagegen-feed-footer="recent"]').length,
      footerAfterEveryCard: cards.every((card) => (
        !!(card.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING)
      )),
      lastCardId: cards.at(-1)?.dataset.feedId || ''
    };
  });
  if (paginationState.cardCount !== 13 || paginationState.footerCount !== 1
    || !paginationState.footerAfterEveryCard || paginationState.lastCardId !== 'cr_page-13') {
    throw new Error(`recent feed footer split paginated images: ${JSON.stringify(paginationState)}`);
  }

  console.log('verify-imagegen-feed-retention-browser OK:', JSON.stringify({
    pendingState,
    failedState,
    completedState,
    loadingState,
    priorityState,
    paginationState
  }));
} finally {
  if (browser) await browser.close();
}
