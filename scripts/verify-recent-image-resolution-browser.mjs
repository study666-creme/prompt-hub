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
  console.log('verify-recent-image-resolution-browser OK:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
}
