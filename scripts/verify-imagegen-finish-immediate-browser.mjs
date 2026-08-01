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
  const page = await browser.newPage();
  await page.setContent('<main><div id="imageGenFeed"></div></main>');
  await page.addScriptTag({ path: join(root, 'imagegen-finish-run.js') });

  const result = await page.evaluate(async () => {
    let creations = [];
    let archiveResolve;
    let archiveStarted = 0;
    let pendingRemoved = 0;
    let renders = 0;
    const rawImage = 'https://upstream.test/generated/immediate.png';
    const archivedImage = 'storage://card-images/user-1/generated/job-immediate.png';

    window.SupabaseSync = {
      isLoggedIn: () => true,
      archiveGeneratedCardImage: () => {
        archiveStarted += 1;
        return new Promise((resolve) => { archiveResolve = resolve; });
      },
      isStorageRef: (value) => String(value || '').startsWith('storage://')
    };
    window.PointsSystem = { getImageGenModel: () => ({ label: 'Test model' }) };

    const api = window.ImageGenFinishRun.init({
      getCreations: () => creations,
      setCreations: (value) => { creations = value; },
      genId: () => 'creation-immediate',
      isGenerationJobDeleted: () => false,
      isDisplayableImage: (value) => !!value,
      getImageGenRefImages: () => [],
      getImageGenPrimaryRef: () => '',
      dedupeCreationsByJobId: (value) => value,
      setImageGenLastResult: () => {},
      setImageGenActiveHistoryId: () => {},
      persistCreations: () => {},
      switchImageGenFeedToRecent: () => {},
      updateImageGenFeedHint: () => {},
      removePendingJob: () => { pendingRemoved += 1; },
      clearSessionGenJob: () => {},
      prunePendingJobsWithCreations: () => {},
      renderImageGenFeed: () => { renders += 1; },
      renderImageGenMobileResult: () => {},
      genRetentionMs: () => 60_000,
      toast: () => {}
    });

    const finish = api.finishImageGenRun({
      prompt: 'immediate result',
      model: 'image2-economy',
      resolution: '1k',
      quality: 'medium',
      size: '1:1',
      image: rawImage,
      cost: 2,
      jobId: 'job-immediate',
      pendingId: 'pending-immediate',
      silentToast: true
    });
    const completedBeforeArchive = await Promise.race([
      finish.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 150))
    ]);
    await finish;
    await Promise.resolve();

    const beforeArchive = {
      completedBeforeArchive,
      archiveStarted,
      pendingRemoved,
      renders,
      image: creations[0]?.image || ''
    };

    archiveResolve(archivedImage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterArchive = {
      image: creations[0]?.image || '',
      renders
    };
    return { beforeArchive, afterArchive };
  });

  if (
    !result.beforeArchive.completedBeforeArchive
    || result.beforeArchive.archiveStarted !== 1
    || result.beforeArchive.pendingRemoved !== 1
    || result.beforeArchive.renders < 1
    || result.beforeArchive.image !== 'https://upstream.test/generated/immediate.png'
    || result.afterArchive.image !== 'storage://card-images/user-1/generated/job-immediate.png'
    || result.afterArchive.renders < 2
  ) {
    throw new Error(`finish immediate contract failed: ${JSON.stringify(result)}`);
  }

  console.log('verify-imagegen-finish-immediate-browser OK:', JSON.stringify(result));
} finally {
  if (browser) await browser.close();
}
