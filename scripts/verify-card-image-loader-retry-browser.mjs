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
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://media.test/stale/**', (route) => route.fulfill({ status: 404 }));
  await page.route('https://media.test/delayed/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 404 });
  });
  await page.route('https://media.test/fresh/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/x-icon',
    body: readyImageBytes
  }));

  const galleryMarkup = [0, 1, 2, 3, 4].map((slot) => `
    <article class="card" data-id="mj-card">
      <div class="card-media card-media--load-failed">
        <img
          class="card-img img-load-failed"
          data-image-ref="storage://mj-slot-${slot}"
          data-job-id="mj-job${slot ? `#${slot + 1}` : ''}"
          src="https://media.test/stale/mj-slot-${slot}_grid.jpg?token=old"
          alt=""
        >
      </div>
    </article>
  `).join('');
  await page.setContent(`<div id="cardsContainer">${galleryMarkup}</div>`);
  await page.waitForFunction(() => [...document.querySelectorAll('#cardsContainer img')]
    .every((img) => img.complete && img.naturalWidth === 0));

  await page.evaluate(() => {
    const calls = {
      directResolve: [],
      mediaCache: 0,
      mediaResolve: 0,
      listCache: 0,
      genericCache: 0,
      invalidatedPaths: [],
      invalidatedRefs: []
    };
    window.__retryCalls = calls;
    window.MobileUI = {
      isMobileViewport: () => true,
      isUserInteracting: () => false,
      getPerf: () => ({ maxDownload: 2 })
    };
    window.MediaPipeline = {
      getListCached: () => {
        calls.mediaCache += 1;
        return 'https://media.test/stale/cached_grid.jpg?token=old';
      },
      resolveListUrl: async () => {
        calls.mediaResolve += 1;
        return 'https://media.test/stale/resolved_grid.jpg?token=old';
      }
    };
    window.SupabaseSync = {
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: () => false,
      isGridDisplayUrl: (url) => /_grid\.jpg/i.test(String(url || '')),
      isValidSignedDisplayUrl: (url) => /^https:\/\/media\.test\//i.test(String(url || '')),
      isWarehouseBlockedFullUrl: () => false,
      storagePathFromDisplayUrl: (url) => {
        if (!String(url || '').includes('/stale/')) return '';
        const match = String(url || '').match(/\/([^/?]+_grid\.jpg)/i);
        return match ? `cards/${match[1]}` : '';
      },
      invalidateSignedCache: (path) => calls.invalidatedPaths.push(path),
      invalidateSignedCacheForRef: (ref, cardId) => calls.invalidatedRefs.push([ref, cardId]),
      primaryImagePath: () => '',
      getListDisplayImageSrc: () => {
        calls.listCache += 1;
        return 'https://media.test/stale/supabase_grid.jpg?token=old';
      },
      getCachedDisplayUrl: () => {
        calls.genericCache += 1;
        return 'https://media.test/stale/generic_grid.jpg?token=old';
      },
      resolveDisplayUrl: async (ref, opts) => {
        calls.directResolve.push({ ref, opts });
        const slot = String(ref).replace(/^storage:\/\/(?:mj-slot-)?/, '');
        return `https://media.test/fresh/mj-slot-${slot}_grid.jpg?token=new`;
      }
    };
    window.FeatureDraft = {};
  });
  await page.addScriptTag({ path: join(root, 'card-image-loader-queues.js') });
  await page.addScriptTag({ path: join(root, 'card-image-loader.js') });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="pendingContainer">
      <article class="card" data-id="pending-card">
        <div class="card-media card-media--load-failed">
          <img class="card-img img-load-failed" data-image-ref="storage://pending-slot"
            src="https://media.test/delayed/pending-slot_grid.jpg?token=old" alt="">
        </div>
      </article>
      </div>
    `);
    window.CardImageLoader.observeContainer(document.getElementById('pendingContainer'));
  });
  await page.evaluate(() => {
    document.querySelectorAll('#cardsContainer img').forEach((img) => {
      window.CardImageLoader.loadImg(img);
      window.CardImageLoader.loadImg(img);
    });
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#cardsContainer img')]
    .every((img) => img.complete && img.naturalWidth > 8));
  await page.waitForFunction(() => {
    const img = document.querySelector('#pendingContainer img');
    return img?.complete && img.naturalWidth > 8;
  });

  const result = await page.evaluate(() => ({
    calls: window.__retryCalls,
    images: [...document.querySelectorAll('#cardsContainer img')].map((img) => ({
      src: img.src,
      loaded: img.naturalWidth > 8,
      forceFresh: img.dataset.feedForceFresh || '',
      failed: img.classList.contains('img-load-failed')
    }))
  }));
  if (
    result.calls.directResolve.length !== 6
    || result.calls.mediaCache !== 0
    || result.calls.mediaResolve !== 0
    || result.calls.listCache !== 0
    || result.calls.genericCache !== 0
    || result.calls.invalidatedPaths.length !== 5
    || result.calls.invalidatedRefs.length !== 6
    || result.calls.directResolve.some((call) => call.opts?.bypassSignBudget !== true)
    || JSON.stringify(result.calls.directResolve.slice(0, 5).map((call) => call.opts?.jobId).sort())
      !== JSON.stringify(['mj-job', 'mj-job#2', 'mj-job#3', 'mj-job#4', 'mj-job#5'])
    || result.images.some((img) => !img.loaded || !img.src.includes('/fresh/') || img.forceFresh || img.failed)
  ) {
    throw new Error(`broken MJ gallery URLs were not freshly resolved: ${JSON.stringify(result)}`);
  }
  const pendingResult = await page.evaluate(() => {
    const img = document.querySelector('#pendingContainer img');
    return { src: img?.src || '', loaded: (img?.naturalWidth || 0) > 8 };
  });
  if (!pendingResult.loaded || !pendingResult.src.includes('/fresh/')) {
    throw new Error(`pending signed URL did not recover after delayed 404: ${JSON.stringify(pendingResult)}`);
  }

  await page.evaluate(() => {
    window.__race = { calls: 0, releaseOld: null };
    window.SupabaseSync.resolveDisplayUrl = async () => {
      window.__race.calls += 1;
      if (window.__race.calls === 1) {
        return new Promise((resolve) => {
          window.__race.releaseOld = () => resolve('https://media.test/fresh/race-old_grid.jpg?token=old');
        });
      }
      return 'https://media.test/fresh/race-new_grid.jpg?token=new';
    };
    document.getElementById('cardsContainer').insertAdjacentHTML('beforeend', `
      <article class="card" data-id="race-card">
        <div class="card-media card-media--load-failed">
          <img class="card-img img-load-failed" data-image-ref="storage://race-slot"
            src="https://media.test/stale/race-slot_grid.jpg?token=old" alt="">
        </div>
      </article>
    `);
  });
  const raceImg = page.locator('[data-id="race-card"] img');
  await raceImg.evaluate((img) => new Promise((resolve) => {
    if (img.complete) return resolve();
    img.addEventListener('error', resolve, { once: true });
  }));
  await raceImg.evaluate((img) => window.CardImageLoader.loadImg(img));
  await page.waitForFunction(() => window.__race.calls === 1);
  await raceImg.evaluate((img) => { img.src = 'https://media.test/stale/race-slot-2_grid.jpg?token=old'; });
  await raceImg.evaluate((img) => new Promise((resolve) => {
    if (img.complete) return resolve();
    img.addEventListener('error', resolve, { once: true });
  }));
  await raceImg.evaluate((img) => window.CardImageLoader.loadImg(img));
  await page.waitForFunction(() => window.__race.calls === 2);
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-id="race-card"] img');
    return img?.complete && img.naturalWidth > 8 && img.src.includes('race-new');
  });
  await page.evaluate(() => window.__race.releaseOld?.());
  await page.waitForTimeout(100);
  const raceResult = await raceImg.evaluate((img) => ({
    src: img.src,
    loaded: img.naturalWidth > 8,
    calls: window.__race.calls
  }));
  if (!raceResult.loaded || !raceResult.src.includes('race-new') || raceResult.calls !== 2) {
    throw new Error(`stale image resolver overwrote a newer result: ${JSON.stringify(raceResult)}`);
  }

  await page.addScriptTag({ path: join(root, 'image-gen-feed-cards.js') });
  await page.evaluate(() => {
    const creation = {
      id: 'recent-card',
      jobId: 'recent-job',
      image: 'storage://recent-card'
    };
    const calls = { directResolve: 0, mediaResolve: 0, jobResolve: 0 };
    window.__recentRetryCalls = calls;
    window.SupabaseSync.getListDisplayImageSrc = () => 'https://media.test/stale/recent-card_grid.jpg?token=old';
    const cards = window.ImageGenFeedCards.create({
      getDeps: () => ({
        IMG_LOADING_PLACEHOLDER: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        esc: (value) => String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'),
        formatExpiryLabel: () => '',
        imageGenModelLabel: () => '',
        isDisplayableImage: (ref) => !!String(ref || '').trim(),
        pickCreationFeedImage: (item) => item.image
      })
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="imageGenFeed">${cards.creationToFeedHtml(creation)}</div>`
    );
    document.querySelector('[data-feed-id="cr_recent-card"] .imagegen-feed-media')
      ?.classList.add('card-media--load-failed');
    const recentImg = document.querySelector('[data-feed-id="cr_recent-card"] img');
    recentImg?.classList.add('img-load-failed');
    if (recentImg) {
      recentImg.loading = 'eager';
      recentImg.src = recentImg.src;
    }
    window.FeatureDraft = {
      findCreationById: (id) => id === creation.id ? creation : null,
      getCreations: () => [creation],
      creationFeedImageCandidates: () => [creation.image]
    };
    window.MediaPipeline.resolveListUrl = async () => {
      calls.mediaResolve += 1;
      return 'https://media.test/stale/recent-cached_grid.jpg?token=old';
    };
    window.SupabaseSync.isStorageRef = (ref) => String(ref || '').startsWith('storage://');
    window.SupabaseSync.resolveDisplayUrl = async (ref, opts) => {
      calls.directResolve += 1;
      calls.lastRef = ref;
      calls.lastOpts = opts;
      return 'https://media.test/fresh/recent-card_grid.jpg?token=new';
    };
    window.PromptHubApi = {
      getGenerationImageUrl: async () => {
        calls.jobResolve += 1;
        return { ok: false, status: 503 };
      }
    };
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-feed-id="cr_recent-card"] img');
    return img?.complete && img.naturalWidth === 0;
  });
  await page.evaluate(() => {
    const img = document.querySelector('[data-feed-id="cr_recent-card"] img');
    window.CardImageLoader.loadImg(img);
    window.CardImageLoader.loadImg(img);
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-feed-id="cr_recent-card"] img');
    return img?.complete && img.naturalWidth > 8;
  });
  const recentResult = await page.evaluate(() => {
    const card = document.querySelector('[data-feed-id="cr_recent-card"]');
    const img = card?.querySelector('img');
    const media = card?.querySelector('.imagegen-feed-media');
    const content = card?.querySelector('.imagegen-feed-content');
    return {
      calls: window.__recentRetryCalls,
      src: img?.src || '',
      loaded: (img?.naturalWidth || 0) > 8,
      forceFresh: img?.dataset.feedForceFresh || '',
      mediaBeforeContent: media?.nextElementSibling === content
    };
  });
  if (
    recentResult.calls.directResolve !== 1
    || recentResult.calls.mediaResolve !== 0
    || recentResult.calls.jobResolve !== 0
    || recentResult.calls.lastRef !== 'storage://recent-card'
    || recentResult.calls.lastOpts?.bypassSignBudget !== true
    || !recentResult.loaded
    || !recentResult.src.includes('/fresh/')
    || recentResult.forceFresh
    || !recentResult.mediaBeforeContent
  ) {
    throw new Error(`broken recent image did not recover in card order: ${JSON.stringify(recentResult)}`);
  }

  const timeoutPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await timeoutPage.route('https://timeout.test/**', () => {});
  await timeoutPage.setContent(`
    <div id="imageGenFeed">
      <article class="imagegen-feed-card" data-feed-id="feed-timeout">
        <div class="imagegen-feed-media is-loading">
          <img class="card-img" data-image-ref="https://timeout.test/image.jpg" alt="">
        </div>
      </article>
    </div>
  `);
  await timeoutPage.evaluate(() => {
    window.__PH_TEST_DOWNLOAD_TIMEOUT_MS__ = 120;
    window.MobileUI = {
      isMobileViewport: () => true,
      isUserInteracting: () => false,
      getPerf: () => ({ maxDownload: 2 })
    };
    window.SupabaseSync = {
      isInvalidMediaUrl: () => false,
      isValidSignedDisplayUrl: () => true,
      isWarehouseBlockedFullUrl: () => false,
      storagePathFromDisplayUrl: () => ''
    };
    window.FeatureDraft = {};
  });
  await timeoutPage.addScriptTag({ path: join(root, 'card-image-loader-queues.js') });
  await timeoutPage.addScriptTag({ path: join(root, 'card-image-loader.js') });
  await timeoutPage.evaluate(() => {
    const img = document.querySelector('#imageGenFeed img');
    window.CardImageLoader.applyUrlToImg(img, 'https://timeout.test/image.jpg');
  });
  await timeoutPage.waitForTimeout(600);
  const timeoutResult = await timeoutPage.evaluate(() => {
    const img = document.querySelector('#imageGenFeed img');
    const media = img?.closest('.imagegen-feed-media');
    return {
      src: img?.src || '',
      loading: media?.classList.contains('is-loading'),
      failed: media?.classList.contains('card-media--load-failed'),
      token: img?.dataset.feedLoadToken || '',
      loadingUrl: img?.dataset.feedLoadingUrl || ''
    };
  });
  await timeoutPage.close();
  if (timeoutResult.loading || !timeoutResult.failed || timeoutResult.token || timeoutResult.loadingUrl || timeoutResult.src.includes('timeout.test')) {
    throw new Error(`timed-out image stayed pending: ${JSON.stringify(timeoutResult)}`);
  }

  console.log('verify-card-image-loader-retry-browser OK');
} finally {
  if (browser) await browser.close();
}
