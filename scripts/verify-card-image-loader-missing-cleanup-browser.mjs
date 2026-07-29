import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const readyImage = 'https://media.test/recovered.ico';
const readyImageBytes = readFileSync(join(root, 'favicon.ico'));
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
  await page.setContent('<!doctype html><html><body><div id="imageGenFeed"></div></body></html>');
  await page.evaluate(({ readyImage }) => {
    window.__startRecentMissingScenario = (kind) => {
      const id = `creation-${kind}`;
      const jobId = `job-${kind}`;
      const recoverable = kind === 'recoverable-candidate';
      const creation = {
        id,
        jobId,
        image: recoverable ? `storage://user/generated/${jobId}.jpg` : '',
        createdAt: Date.now()
      };
      const calls = {
        imageVariants: [],
        job: 0,
        list: 0,
        removed: []
      };
      window.__recentMissingScenario = { kind, creation, calls };

      const feed = document.getElementById('imageGenFeed');
      feed.innerHTML = `
        <article class="imagegen-feed-card" data-feed-id="cr_${id}">
          <div class="imagegen-feed-media is-loading">
            <img data-image-ref="${creation.image}" data-job-id="${jobId}" alt="">
          </div>
        </article>
      `;

      window.FeatureDraft = {
        findCreationById: (candidateId) => candidateId === id ? creation : null,
        getCreations: () => [creation],
        creationFeedImageCandidates: () => creation.image ? [creation.image] : [],
        removePermanentlyMissingCreation: (candidateId, evidence) => {
          calls.removed.push({ id: candidateId, status: evidence?.status, code: evidence?.code });
          return true;
        }
      };
      window.MediaPipeline = {
        resolveListUrl: async () => {
          calls.list += 1;
          return recoverable && calls.list >= 2 ? readyImage : '';
        }
      };
      window.SupabaseSync = {
        isStorageRef: (value) => String(value || '').startsWith('storage://'),
        isInvalidMediaUrl: () => false,
        isEphemeralUpstreamImageUrl: () => false,
        resolvePreviewFullUrl: async () => ''
      };
      window.PromptHubApi = {
        getGenerationImageUrl: async (_candidateJobId, options) => {
          const variant = options?.variant || 'full';
          calls.imageVariants.push(variant);
          if (variant === 'grid') return { ok: false, status: 503, code: 'UNAVAILABLE' };
          if (kind === 'image-gone') return { ok: false, status: 410, code: 'GONE' };
          return { ok: false, status: 503, code: 'UNAVAILABLE' };
        },
        getGenerationJob: async () => {
          calls.job += 1;
          if (kind === 'job-missing') return { ok: false, status: 404, code: 'NOT_FOUND' };
          return { ok: false, status: 503, code: 'UNAVAILABLE' };
        }
      };

      window.CardImageLoader.loadImg(feed.querySelector('img'));
    };
  }, { readyImage });
  await page.addScriptTag({ path: join(root, 'card-image-loader-queues.js') });
  await page.addScriptTag({ path: join(root, 'card-image-loader.js') });

  await page.evaluate(() => window.__startRecentMissingScenario('image-gone'));
  await page.waitForFunction(() => window.__recentMissingScenario.calls.removed.length === 1);
  const imageGone = await page.evaluate(() => window.__recentMissingScenario.calls);
  if (
    imageGone.removed[0]?.id !== 'creation-image-gone'
    || imageGone.removed[0]?.status !== 410
    || imageGone.imageVariants.join(',') !== 'grid,full'
    || imageGone.job !== 0
  ) {
    throw new Error(`full-image missing cleanup failed: ${JSON.stringify(imageGone)}`);
  }

  await page.evaluate(() => window.__startRecentMissingScenario('job-missing'));
  await page.waitForFunction(() => window.__recentMissingScenario.calls.removed.length === 1);
  const jobMissing = await page.evaluate(() => window.__recentMissingScenario.calls);
  if (
    jobMissing.removed[0]?.id !== 'creation-job-missing'
    || jobMissing.removed[0]?.status !== 404
    || jobMissing.imageVariants.join(',') !== 'grid,full'
    || jobMissing.job !== 1
  ) {
    throw new Error(`job missing cleanup failed: ${JSON.stringify(jobMissing)}`);
  }

  await page.evaluate(() => window.__startRecentMissingScenario('transient'));
  await page.waitForFunction(() => window.__recentMissingScenario.calls.job === 1);
  const transient = await page.evaluate(() => ({
    calls: window.__recentMissingScenario.calls,
    failed: document.querySelector('.imagegen-feed-media')?.classList.contains('card-media--load-failed')
  }));
  if (
    transient.calls.removed.length !== 0
    || transient.calls.imageVariants.join(',') !== 'grid,full'
    || !transient.failed
  ) {
    throw new Error(`transient failure removed a card: ${JSON.stringify(transient)}`);
  }

  await page.evaluate(() => window.__startRecentMissingScenario('recoverable-candidate'));
  await page.waitForFunction(() => {
    const img = document.querySelector('#imageGenFeed img');
    return img?.complete && img.naturalWidth > 8;
  });
  const recovered = await page.evaluate(() => ({
    calls: window.__recentMissingScenario.calls,
    failed: document.querySelector('.imagegen-feed-media')?.classList.contains('card-media--load-failed'),
    loaded: document.querySelector('#imageGenFeed img')?.naturalWidth > 8
  }));
  if (
    !recovered.loaded
    || recovered.failed
    || recovered.calls.removed.length !== 0
    || recovered.calls.list !== 2
    || recovered.calls.imageVariants.join(',') !== 'grid'
    || recovered.calls.job !== 0
  ) {
    throw new Error(`recoverable candidate was not restored first: ${JSON.stringify(recovered)}`);
  }

  console.log('verify-card-image-loader-missing-cleanup-browser OK');
} finally {
  if (browser) await browser.close();
}
