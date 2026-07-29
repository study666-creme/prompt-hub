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
const readyImage = 'https://media.test/ready.ico';
const readyImageBytes = readFileSync(join(root, 'favicon.ico'));
const readyDataUrl = `data:image/x-icon;base64,${readyImageBytes.toString('base64')}`;
const storageRef = 'storage://card-images/user/generated/job.png';
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(readyImage, (route) => route.fulfill({
    status: 200,
    contentType: 'image/x-icon',
    body: readyImageBytes
  }));
  await page.setContent(`
    <div id="imageGenFeed">
      <article class="imagegen-feed-card" data-feed-id="cr_one">
        <div class="imagegen-feed-media is-loading">
          <img data-image-ref="${storageRef}" data-source-card-id="one" data-job-id="job" alt="">
        </div>
      </article>
    </div>
  `);
  await page.evaluate(({ readyImage, storageRef }) => {
    window.__calls = { list: 0, archive: 0, job: 0, proxy: 0 };
    window.FeatureDraft = {
      findCreationById: () => ({ id: 'one', jobId: 'job', image: storageRef }),
      creationFeedImageCandidates: () => [storageRef]
    };
    window.MobileUI = {
      isMobileViewport: () => true,
      isUserInteracting: () => false
    };
    window.MediaPipeline = {
      resolveListUrl: async () => {
        window.__calls.list += 1;
        return '';
      }
    };
    window.SupabaseSync = {
      isStorageRef: (ref) => String(ref).startsWith('storage://'),
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: (url) => String(url).includes('expired.example'),
      resolvePreviewFullUrl: async () => {
        window.__calls.archive += 1;
        return readyImage;
      }
    };
    window.PromptHubApi = {
      getGenerationImageUrl: async () => {
        window.__calls.job += 1;
        return { ok: true, data: { url: 'https://expired.example/image.png' } };
      },
      fetchMediaAsBlobUrl: async () => {
        window.__calls.proxy += 1;
        return '';
      }
    };
  }, { readyImage, storageRef });
  await page.addScriptTag({ path: join(root, 'card-image-loader-queues.js') });
  await page.addScriptTag({ path: join(root, 'card-image-loader.js') });
  await page.evaluate(() => {
    window.CardImageLoader.loadImg(document.querySelector('#imageGenFeed img'));
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('#imageGenFeed img');
    return img?.complete && img.naturalWidth > 8;
  });
  const result = await page.evaluate(() => ({
    calls: window.__calls,
    loaded: document.querySelector('#imageGenFeed img')?.naturalWidth > 8
  }));
  if (!result.loaded || result.calls.list !== 1 || result.calls.archive !== 1) {
    throw new Error(`Storage archive was not resolved first: ${JSON.stringify(result)}`);
  }
  if (result.calls.job !== 0 || result.calls.proxy !== 0) {
    throw new Error(`Expired job URL was requested before Storage: ${JSON.stringify(result)}`);
  }

  await page.evaluate(() => {
    window.__blobScenario = { calls: 0, revoked: [] };
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.__blobScenario.revoked.push(url);
      nativeRevoke(url);
    };
    document.querySelector('#imageGenFeed').innerHTML = `
      <article class="imagegen-feed-card" data-feed-id="cr_blob">
        <div class="imagegen-feed-media is-loading">
          <img data-image-ref="https://source.example.test/blob.png" data-source-card-id="blob" data-job-id="blob-job" alt="">
        </div>
      </article>
    `;
    window.FeatureDraft = {
      findCreationById: () => ({ id: 'blob', jobId: 'blob-job', image: 'https://source.example.test/blob.png' }),
      creationFeedImageCandidates: () => ['https://source.example.test/blob.png']
    };
    window.MediaPipeline = { resolveListUrl: async () => '' };
    window.SupabaseSync = {
      isStorageRef: () => false,
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: () => false
    };
    window.PromptHubApi = {
      fetchMediaAsBlobUrl: async () => {
        window.__blobScenario.calls += 1;
        const response = await fetch('https://media.test/ready.ico');
        return URL.createObjectURL(await response.blob());
      }
    };
    window.CardImageLoader.loadImg(document.querySelector('#imageGenFeed img'));
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('#imageGenFeed img');
    return img?.src.startsWith('blob:') && img.complete && img.naturalWidth > 8;
  });
  const blobBeforeRemoval = await page.evaluate(async () => {
    const img = document.querySelector('#imageGenFeed img');
    const src = img?.src || '';
    const reusable = await new Promise((resolve) => {
      const preview = new Image();
      preview.onload = () => resolve(true);
      preview.onerror = () => resolve(false);
      preview.src = src;
    });
    return {
      src,
      reusable,
      calls: window.__blobScenario.calls,
      revoked: window.__blobScenario.revoked.slice()
    };
  });
  if (
    !blobBeforeRemoval.src.startsWith('blob:')
    || !blobBeforeRemoval.reusable
    || blobBeforeRemoval.calls !== 1
    || blobBeforeRemoval.revoked.length !== 0
  ) {
    throw new Error(`Blob fallback was not kept usable: ${JSON.stringify(blobBeforeRemoval)}`);
  }
  await page.evaluate(() => document.querySelector('#imageGenFeed .imagegen-feed-card')?.remove());
  await page.waitForFunction((url) => window.__blobScenario.revoked.includes(url), blobBeforeRemoval.src);

  await page.evaluate(({ readyDataUrl }) => {
    document.querySelector('#imageGenFeed').innerHTML = `
      <article class="imagegen-feed-card" data-feed-id="cr_data">
        <div class="imagegen-feed-media is-loading">
          <img data-image-ref="${readyDataUrl}" data-source-card-id="data" data-job-id="data-job" alt="">
        </div>
      </article>
    `;
    window.FeatureDraft = {
      findCreationById: () => ({ id: 'data', jobId: 'data-job', image: readyDataUrl }),
      creationFeedImageCandidates: () => [readyDataUrl]
    };
    window.MediaPipeline = { resolveListUrl: async () => '' };
    window.SupabaseSync = {
      isStorageRef: () => false,
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: () => false
    };
    window.PromptHubApi = {};
    window.CardImageLoader.loadImg(document.querySelector('#imageGenFeed img'));
  }, { readyDataUrl });
  await page.waitForFunction(() => {
    const img = document.querySelector('#imageGenFeed img');
    return img?.src.startsWith('data:image/') && img.complete && img.naturalWidth > 8;
  });

  await page.addScriptTag({ path: join(root, 'image-gen-feed-cards.js') });
  await page.evaluate(() => {
    window.__placeholderFinishCalls = 0;
    window.finishCardMediaShine = (media) => {
      window.__placeholderFinishCalls += 1;
      media?.classList.remove('is-loading');
    };
    window.SupabaseSync = {};
    const cards = window.ImageGenFeedCards.create({
      getDeps: () => ({
        IMG_LOADING_PLACEHOLDER: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E',
        esc: (value) => String(value || ''),
        isDisplayableImage: () => true
      })
    });
    document.querySelector('#imageGenFeed').innerHTML = cards.buildFeedCardHtml({
      id: 'cr_placeholder',
      image: 'storage://card-images/user/generated/placeholder.jpg',
      prompt: 'placeholder',
      title: ''
    });
  });
  await page.waitForTimeout(50);
  const placeholderBefore = await page.evaluate(() => ({
    loading: document.querySelector('#imageGenFeed .imagegen-feed-media')?.classList.contains('is-loading'),
    finishCalls: window.__placeholderFinishCalls
  }));
  if (!placeholderBefore.loading || placeholderBefore.finishCalls !== 0) {
    throw new Error(`SVG placeholder incorrectly finished loading: ${JSON.stringify(placeholderBefore)}`);
  }
  await page.evaluate((url) => {
    document.querySelector('#imageGenFeed img').src = url;
  }, readyImage);
  await page.waitForFunction(() => window.__placeholderFinishCalls === 1);

  console.log('verify-recent-image-resolution-browser OK:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
}
