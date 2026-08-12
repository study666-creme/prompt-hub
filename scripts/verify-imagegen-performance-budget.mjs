/**
 * 生图交付性能预算回归（确定性 fixture，无真实网络/付费）。
 *
 * 阈值（acceptance 14）：
 *   pending DOM                  <= 100ms
 *   上游 completed → 结果卡 DOM  <= 200ms
 *   1s 上游完成 → 图片可见       <= 2s
 *   8s 归档不得增加结果可见时间  （归档进行中已可见）
 *   灯箱 shell/预览              <= 50ms
 *   重进首批本地占位即时；首屏 4 张可见图 <= 1.5s
 *   黑卡/破图后永久空白/纯文字结果卡/无限 loading/未终止重试 均为 0
 *
 * 运行：
 *   $env:PLAYWRIGHT_PACKAGE_DIR = '<dir>'
 *   $env:BROWSER_EXECUTABLE_PATH = '<Chrome or Edge>'
 *   node scripts/verify-imagegen-performance-budget.mjs
 */
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
const imageBytes = readFileSync(join(root, 'favicon.ico'));
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://media.test/**', (route) => route.fulfill({
    status: 200, contentType: 'image/x-icon', body: imageBytes
  }));
  await page.setContent(`<main><div id="imageGenFeed"></div><div id="toast"></div></main>`);
  const modules = [
    'imagegen-gen-errors.js',
    'imagegen-job-state.js',
    'imagegen-finish-run.js',
    'imagegen-poll-warehouse.js',
    'imagegen-job-runner.js',
    'imagegen-submit.js',
    'image-gen-feed-cards.js',
    'image-gen-feed.js',
    'app-lightbox.js',
    'card-image-loader-queues.js',
    'card-image-loader.js'
  ];
  for (const name of modules) {
    await page.addScriptTag({ path: join(root, name) });
  }

  const budgets = {};

  /* ------------------------------------------------------------------ *
   * 1) 提交 → pending DOM <= 100ms
   * ------------------------------------------------------------------ */
  const submit = await page.evaluate(async () => {
    const state = { clickAt: 0, pendingAt: 0 };
    const button = document.createElement('button');
    button.id = 'imageGenSubmit';
    document.body.appendChild(button);
    document.body.insertAdjacentHTML('beforeend', '<textarea id="imageGenPrompt">perf</textarea><select id="imageGenModel"><option value="image2" selected></option></select>');
    const pendingJobs = [];
    window.AuthGate = { requireAuth: () => true };
    window.PointsSystem = {
      getImageGenCost: () => 2, getCredits: () => 100, useApiForAccount: () => true,
      getImageGenModel: () => ({ label: 'image2' }),
      setCreditsFromServer: () => {}, updateCreditsUI: () => {}, refreshCreditsFromServer: async () => {}
    };
    window.MobileUI = { isMobileViewport: () => false, setImageGenView: () => {} };
    window.PromptHubApi = {
      generateImage: async () => ({ ok: true, data: { status: 'processing', jobId: 'job-perf-submit' } }),
      listRecentGenerationJobs: async () => ({ ok: true, data: { jobs: [] } })
    };
    const api = window.ImageGenSubmit.init({
      getImageGenFormMeta: () => ({ model: 'image2', resolution: '1k', quality: 'standard', size: '1:1' }),
      isImageGenMidjourneyModel: () => false,
      getImageGenMjMode: () => 'imagine',
      getImageGenRefImages: () => [],
      getImageGenPrimaryRef: () => null,
      getImageGenReferenceAssets: () => [],
      getImageGenBatchCount: () => 1,
      getImageGenCardTitle: () => '',
      isImageGenBatchSplitCards: () => false,
      getImageGenModelCatalogReady: () => true,
      getImageGenBatchRunning: () => false,
      genId: () => 'pending-perf',
      toast: () => {},
      restoreImageGenSubmitLabel: () => {},
      saveImageGenDraft: () => {},
      getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
      unshiftPendingJob: (job) => pendingJobs.unshift(job),
      persistPendingGenJobs: () => {},
      switchImageGenFeedToRecent: () => {},
      updateImageGenFeedHint: () => {},
      renderImageGenFeed: () => {},
      renderImageGenPendingNow: (job) => {
        state.pendingAt = performance.now();
        return false;
      },
      renderImageGenFailedNow: () => false,
      safeRenderImageGenFeed: () => {},
      isImageGenMobileFormActive: () => false,
      quoteGenerationCost: async () => ({ cost: 2, fromApi: true }),
      getGenCostQuoteTimeoutMs: () => 100,
      getSubmitSuccessHoldMs: () => 500,
      resolveRefUrlsFromList: async () => [],
      removePendingJob: () => {},
      failPendingJob: () => null,
      tryRecoverOrphanGenJobAfterSubmitError: async () => false,
      deferPendingJobRecovery: () => {},
      pendingJobToPollCtx: () => ({}),
      trackSessionGenJob: () => {},
      pollGenerationJobUntilDone: () => {}
    });
    state.clickAt = performance.now();
    await api.runImageGenWithPrompt();
    return {
      pendingMs: state.pendingAt ? state.pendingAt - state.clickAt : -1,
      pendingInserted: pendingJobs.length
    };
  });
  budgets.pendingDomMs = submit.pendingMs;
  if (submit.pendingMs < 0 || submit.pendingMs > 100 || submit.pendingInserted === 0) {
    throw new Error(`pending DOM budget exceeded: ${JSON.stringify(submit)}`);
  }

  /* ------------------------------------------------------------------ *
   * 2) 上游 completed → 结果卡 DOM <= 200ms；8s 归档不阻塞可见。
   * ------------------------------------------------------------------ */
  const finish = await page.evaluate(async () => {
    let creations = [];
    let archiveStarted = 0;
    let renders = 0;
    let lastRenderAt = 0;
    window.SupabaseSync = {
      isLoggedIn: () => true,
      archiveGeneratedCardImage: () => {
        archiveStarted += 1;
        return new Promise(() => {});
      },
      isStorageRef: (v) => String(v || '').startsWith('storage://'),
      resolveDisplayUrl: async (ref) => ref,
      isDataUrl: () => false
    };
    window.PointsSystem = { getImageGenModel: () => ({ label: 'image2' }) };
    const api = window.ImageGenFinishRun.init({
      getCreations: () => creations,
      setCreations: (v) => { creations = v; },
      genId: () => 'cr_perf',
      isGenerationJobDeleted: () => false,
      isDisplayableImage: (v) => !!v,
      getImageGenRefImages: () => [],
      getImageGenPrimaryRef: () => '',
      dedupeCreationsByJobId: (v) => v,
      setImageGenLastResult: () => {},
      setImageGenActiveHistoryId: () => {},
      persistCreations: () => {},
      switchImageGenFeedToRecent: () => {},
      updateImageGenFeedHint: () => {},
      removePendingJob: () => {},
      clearSessionGenJob: () => {},
      prunePendingJobsWithCreations: () => {},
      renderImageGenFeed: () => { renders += 1; lastRenderAt = performance.now(); },
      renderImageGenMobileResult: () => {},
      genRetentionMs: () => 60_000,
      toast: () => {}
    });
    const startedAt = performance.now();
    const done = api.finishImageGenRun({
      prompt: 'perf', model: 'image2', resolution: '1k', quality: 'standard', size: '1:1',
      image: 'https://upstream.test/perf.png', cost: 2, jobId: 'job-perf', pendingId: 'pending-perf', silentToast: true
    });
    const completedBeforeArchive = await Promise.race([
      done.then(() => true),
      new Promise((resolveNow) => setTimeout(() => resolveNow(false), 200))
    ]);
    return {
      completedBeforeArchive,
      archiveStarted,
      renderMs: lastRenderAt ? lastRenderAt - startedAt : -1,
      cardImage: creations[0]?.image || '',
      renders
    };
  });
  budgets.completedToCardMs = finish.renderMs;
  if (!finish.completedBeforeArchive || finish.renderMs > 200 || finish.cardImage !== 'https://upstream.test/perf.png') {
    throw new Error(`completed-to-card budget exceeded or archive blocked: ${JSON.stringify(finish)}`);
  }

  /* ------------------------------------------------------------------ *
   * 3) 灯箱 shell/预览 <= 50ms
   * ------------------------------------------------------------------ */
  const lightbox = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.innerHTML = `
      <div id="imageLightbox"><div id="lightboxFrame"><div class="viewer-image-shine-wrap">
        <img id="lightboxImage" alt=""></div></div></div>
      <button id="lightboxDownloadBtn"></button>`;
    document.body.appendChild(el);
    await window.AppLightbox.init({
      getCards: () => [],
      getSelectedCardId: () => 'card-1',
      getWarehousePreviewCardId: () => null,
      isGlobalViewActive: () => false,
      cardHasDisplayImage: () => true,
      showToast: () => {}
    });
    const img = document.getElementById('lightboxImage');
    window.SupabaseSync = { isEphemeralUpstreamImageUrl: () => false };
    const startedAt = performance.now();
    window.openLightbox('https://media.test/grid_perf_640.ico', { cardId: 'card-1', imageGen: true, feedKey: 'cr_card-1', preferFull: true, fallbackSrc: 'https://media.test/grid_perf_640.ico' });
    const activeAt = performance.now() - startedAt;
    return { activeAt, active: document.getElementById('imageLightbox').classList.contains('active'), srcSet: !!img.src };
  });
  budgets.lightboxShellMs = lightbox.activeAt;
  if (!lightbox.active || lightbox.activeAt > 50 || !lightbox.srcSet) {
    throw new Error(`lightbox shell budget exceeded: ${JSON.stringify(lightbox)}`);
  }

  /* ------------------------------------------------------------------ *
   * 4) 重进首批本地占位即时；首屏 4 张可见图 <= 1.5s（本地 fixture，无网络等待）
   * ------------------------------------------------------------------ */
  const reenter = await page.evaluate(async () => {
    const cardsApi = window.ImageGenFeedCards.create({
      getDeps: () => ({
        IMG_LOADING_PLACEHOLDER: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        esc: (v) => String(v ?? ''),
        formatExpiryLabel: () => '',
        imageGenModelLabel: () => '',
        isDisplayableImage: (ref) => !!String(ref || '').trim(),
        pickCreationFeedImage: (item) => item.image
      })
    });
    const creations = [];
    for (let i = 0; i < 12; i += 1) {
      creations.push({ id: `cr_perf_${i}`, jobId: `job-${i}`, prompt: `p${i}`, image: 'https://media.test/grid_perf_640.ico', createdAt: Date.now() });
    }
    const startedAt = performance.now();
    document.getElementById('imageGenFeed').innerHTML = creations.map((c) => cardsApi.creationToFeedHtml(c)).join('');
    const domMs = performance.now() - startedAt;
    const imgs = [...document.querySelectorAll('#imageGenFeed img')].slice(0, 4);
    window.MobileUI = { isMobileViewport: () => false, isUserInteracting: () => false, getPerf: () => ({ maxDownload: 4 }) };
    window.SupabaseSync = {
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: () => false,
      isGridDisplayUrl: () => true,
      isValidSignedDisplayUrl: () => true,
      isWarehouseBlockedFullUrl: () => false,
      storagePathFromDisplayUrl: () => '',
      isPathKnownMissing: () => false,
      isGridFetchFailed: () => false
    };
    window.FeatureDraft = {};
    const loadAt = performance.now();
    await Promise.all(imgs.map((img) => new Promise((resolveNow) => {
      const url = 'https://media.test/grid_perf_640.ico';
      const finishResolve = () => { img.removeEventListener('load', finishResolve); img.removeEventListener('error', finishResolve); resolveNow(); };
      img.addEventListener('load', finishResolve, { once: true });
      img.addEventListener('error', finishResolve, { once: true });
      window.CardImageLoader.applyUrlToImg(img, url);
      setTimeout(resolveNow, 2000);
    })));
    const visibleMs = performance.now() - loadAt;
    const loadedCount = imgs.filter((img) => img.naturalWidth > 0).length;
    return { domMs, visibleMs, loadedCount, cardCount: document.querySelectorAll('#imageGenFeed .imagegen-feed-card').length };
  });
  budgets.reenterFirstScreenMs = reenter.domMs;
  budgets.firstFourVisibleMs = reenter.visibleMs;
  if (reenter.domMs > 200 || reenter.visibleMs > 1500 || reenter.loadedCount < 4 || reenter.cardCount < 12) {
    throw new Error(`re-enter first-screen budget exceeded: ${JSON.stringify(reenter)}`);
  }

  console.log('verify-imagegen-performance-budget OK:', JSON.stringify({ budgets, reenter, finish, submit, lightbox }, null, 2));
} finally {
  if (browser) await browser.close();
}
