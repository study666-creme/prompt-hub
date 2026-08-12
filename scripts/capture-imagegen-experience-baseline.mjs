/**
 * 生图体验前后基线捕获（acceptance 2/16）。
 *
 * 在 1440x900 与 390x844 视口记录 JSON 时间线和请求统计：
 *   点击提交 → pending DOM、第一次状态请求、上游 completed 响应、结果卡插入、
 *   图片 load、图片 decode/可见、归档完成、_grid 可用、灯箱打开、灯箱 full 解码。
 *   重复请求数、最大并发、图片字节、失败/取消请求、控制台错误、布局位移。
 *
 * 产物写入被 Git 忽略的临时目录（默认 node_modules/.dsflash-tmp 下 evidence/），
 * 由报告给出路径。使用 Mock API，不发送任何付费请求。
 *
 * 运行：
 *   $env:PLAYWRIGHT_PACKAGE_DIR = '<dir>'
 *   $env:BROWSER_EXECUTABLE_PATH = '<Chrome or Edge>'
 *   $env:IMAGE_GEN_EVIDENCE_DIR = '<git-ignored dir>'  # 可选
 *   node scripts/capture-imagegen-experience-baseline.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const evidenceDir = process.env.IMAGE_GEN_EVIDENCE_DIR
  || join(root, 'node_modules', '.dsflash-tmp', 'TASK-20260812-PROMPT-IMAGEGEN-EXPERIENCE-P0-001', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

const imageBytes = readFileSync(join(root, 'favicon.ico'));
let browser;
const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844 }
];
const reports = [];

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  // 浏览器级预热页：吸收首个页面/首个 evaluate 的冷启动成本，保证两个视口都在热状态下测量。
  {
    const warmPage = await browser.newPage();
    await warmPage.setContent('<div></div>');
    for (const name of [
      'imagegen-gen-errors.js', 'imagegen-job-state.js', 'imagegen-finish-run.js',
      'imagegen-poll-warehouse.js', 'imagegen-job-runner.js', 'imagegen-submit.js',
      'image-gen-feed-cards.js', 'image-gen-feed.js', 'app-lightbox.js',
      'card-image-loader-queues.js', 'card-image-loader.js'
    ]) {
      await warmPage.addScriptTag({ path: join(root, name) });
    }
    await warmPage.evaluate(() => {
      window.ImageGenGenErrors?.genActivePollMaxMs?.({});
      window.ImageGenGenErrors?.genJobPollDelayMs?.({}, 0);
      window.ImageGenGenErrors?.isLongRunningGenJob?.({});
      window.ImageGenFinishRun?.init?.({});
      window.ImageGenPollWarehouse?.init?.({});
      window.AppLightbox?.init?.({});
    });
    await warmPage.close();
  }

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const stats = {
      requests: [],
      duplicateRequests: 0,
      maxConcurrency: 0,
      activeRequests: 0,
      imageBytes: 0,
      failedRequests: [],
      cancelledRequests: 0,
      consoleErrors: [],
      layoutShiftScore: 0
    };
    page.on('request', (req) => {
      stats.activeRequests += 1;
      stats.maxConcurrency = Math.max(stats.maxConcurrency, stats.activeRequests);
      stats.requests.push({ url: req.url(), method: req.method() });
    });
    page.on('response', (res) => {
      const contentType = String(res.headers()?.['content-type'] || '');
      if (contentType.includes('image')) {
        stats.imageBytes += Number(res.headers()?.['content-length'] || 0);
      }
    });
    page.on('requestfinished', (req) => {
      stats.activeRequests -= 1;
    });
    page.on('requestfailed', (req) => {
      stats.activeRequests -= 1;
      stats.cancelledRequests += 1;
      stats.failedRequests.push({ url: req.url(), error: req.failure()?.errorText || 'cancelled' });
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        stats.consoleErrors.push({ type: msg.type(), text: String(msg.text()).slice(0, 240) });
      }
    });
    page.on('pageerror', (err) => {
      stats.consoleErrors.push({ type: 'pageerror', text: String(err?.message || err).slice(0, 240) });
    });

    await page.route('https://media.test/**', (route) => route.fulfill({
      status: 200, contentType: 'image/x-icon', body: imageBytes
    }));
    await page.addInitScript(() => {
      window.__layoutObserver = null;
      if (typeof PerformanceObserver === 'function') {
        try {
          window.__layoutObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__layoutShiftTotal = (window.__layoutShiftTotal || 0) + (entry.value || 0);
            }
          });
          window.__layoutObserver.observe({ type: 'layout-shift', buffered: true });
        } catch (e) { /* ignore */ }
      }
    });

    await page.setContent(`
      <main>
        <textarea id="imageGenPrompt">baseline prompt</textarea>
        <select id="imageGenModel"><option value="image2" selected>image2</option></select>
        <button id="imageGenSubmit"></button>
        <div id="imageGenFeed"></div>
        <div id="toast"></div>
      </main>
    `);
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

    const timeline = await page.evaluate(async () => {
      const t = {};
      const mark = (name) => { t[name] = performance.now(); };
      const pendingJobs = [];
      const creations = [];

      window.AuthGate = { requireAuth: () => true };
      window.PointsSystem = {
        getImageGenCost: () => 2, getCredits: () => 100, useApiForAccount: () => true,
        getImageGenModel: () => ({ label: 'image2' }),
        setCreditsFromServer: () => {}, updateCreditsUI: () => {}, refreshCreditsFromServer: async () => {}
      };
      window.MobileUI = { isMobileViewport: () => false, setImageGenView: () => {} };
      const apiCalls = { generate: 0, poll: 0, recent: 0, archive: 0 };
      const mockState = { warmup: false };
      window.PromptHubApi = {
        generateImage: async () => {
          apiCalls.generate += 1;
          mark('upstreamAccepted');
          return { ok: true, data: { status: 'processing', jobId: 'job-baseline' } };
        },
        getGenerationJob: async () => {
          apiCalls.poll += 1;
          if (apiCalls.poll === 1) mark('firstStatusRequest');
          if (!mockState.warmup && apiCalls.poll < 3) {
            return { ok: true, data: { status: 'processing', progressNote: '生成中' } };
          }
          mark('upstreamCompleted');
          return { ok: true, data: { status: 'completed', imageUrl: 'https://media.test/grid_perf_640.ico', jobId: 'job-baseline' } };
        },
        listRecentGenerationJobs: async () => { apiCalls.recent += 1; return { ok: true, data: { jobs: [] } }; },
        listRecentGeneratedCreations: async () => ({ ok: true, data: { jobs: [] } }),
        recoverWarehouseFromJobs: async () => ({ ok: true, data: {} })
      };
      const submitApi = window.ImageGenSubmit.init({
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
        genId: () => 'pending-baseline',
        toast: () => {},
        restoreImageGenSubmitLabel: () => {},
        saveImageGenDraft: () => {},
        getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
        unshiftPendingJob: (job) => pendingJobs.unshift(job),
        persistPendingGenJobs: () => {},
        switchImageGenFeedToRecent: () => {},
        updateImageGenFeedHint: () => {},
        renderImageGenFeed: () => {},
        renderImageGenPendingNow: () => { mark('pendingDom'); return false; },
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
        pollGenerationJobUntilDone: async () => {}
      });

      const runner = window.ImageGenJobRunner.init({
        getCreations: () => creations,
        setCreations: (v) => { creations.length = 0; creations.push(...v); },
        genId: (p) => `pending-${p}`,
        isGenerationJobDeleted: () => false,
        isDisplayableImage: (v) => !!v,
        isImageGenMidjourneyModel: () => false,
        imageGenModelLabel: () => 'image2',
        normalizeImageGenModelId: (m) => m || 'image2',
        pendingPromptsMatch: () => false,
        findBestApiJobForPrompt: () => null,
        syncMissingBonusImagesForJob: async () => false,
        repairWarehouseCardImageFromJob: async () => false,
        needsApiImageRecovery: () => true,
        removePendingJob: (id) => { pendingJobs.length = 0; },
        persistPendingGenJobs: () => {},
        clearSessionGenJob: () => {},
        scheduleImageGenPendingUiRefresh: () => {},
        afterGenJobsResume: () => {},
        renderImageGenFeed: () => {},
        renderImageGenMobileResult: () => {},
        toast: () => {},
        recordGenerationJobDeletion: () => {},
        unshiftPendingJob: (job) => pendingJobs.unshift(job),
        renderImageGenFailedNow: () => false,
        ensureGenJobCreationsFromPoll: async (poll, ctx, pendingId) => {
          creations.push({ id: 'cr_baseline', jobId: ctx.jobId || poll.data.jobId, image: poll.data.imageUrl });
          mark('resultCardInserted');
          return true;
        }
      });
      window.__baselineRunner = runner;

      // 冷启动预热：真实跑一次提交+轮询，丢弃结果，让 JIT 先编译。
      mockState.warmup = true;
      await submitApi.runImageGenWithPrompt();
      await runner.pollGenerationJobUntilDone('job-baseline', 'pending-warmup', {
        prompt: 'baseline', model: 'image2', resolution: '1k', quality: 'standard', size: '1:1', cost: 2,
        jobId: 'job-baseline', startedAt: Date.now()
      });
      // 恢复测量用计数
      mockState.warmup = false;
      apiCalls.generate = 0;
      apiCalls.poll = 0;
      pendingJobs.length = 0;
      creations.length = 0;

      const startedAt = performance.now();
      mark('clickSubmit');
      await submitApi.runImageGenWithPrompt();
      const activeBefore = runner.getActivePollJobIds().has('job-baseline');
      // 模拟 poll：job-runner 的 poll 循环由 mock API 提供 completed
      let pollResult;
      try {
        pollResult = await runner.pollGenerationJobUntilDone('job-baseline', 'pending-baseline', {
          prompt: 'baseline', model: 'image2', resolution: '1k', quality: 'standard', size: '1:1', cost: 2,
          jobId: 'job-baseline', startedAt: Date.now()
        });
      } catch (pollErr) {
        console.error('[baseline] poll threw', pollErr);
        pollResult = 'THREW:' + String(pollErr?.message || pollErr);
      }
      window.__baselineDebug = {
        pollResult,
        activeBefore,
        activeSize: runner.getActivePollJobIds().size,
        pendingAfter: pendingJobs.length,
        polls: apiCalls.poll,
        hasGenErrors: !!window.ImageGenGenErrors,
        hasGenJobRunner: !!window.ImageGenJobRunner
      };
      // 结果卡图片 load + decode/可见
      const feed = document.getElementById('imageGenFeed');
      feed.innerHTML = '<div class="imagegen-feed-card"><div class="imagegen-feed-media"><img id="baselineImg" src="https://media.test/grid_perf_640.ico" alt=""></div></div>';
      const img = document.getElementById('baselineImg');
      await new Promise((resolveNow) => {
        if (img.complete && img.naturalWidth > 0) { mark('imageVisible'); resolveNow(); return; }
        img.addEventListener('load', () => { mark('imageVisible'); resolveNow(); }, { once: true });
        img.addEventListener('error', resolveNow, { once: true });
        setTimeout(resolveNow, 2000);
      });
      // 灯箱打开 + full 解码
      const el = document.createElement('div');
      el.innerHTML = '<div id="imageLightbox"><div id="lightboxFrame"><div class="viewer-image-shine-wrap"><img id="lightboxImage" alt=""></div></div></div><button id="lightboxDownloadBtn"></button>';
      document.body.appendChild(el);
      await window.AppLightbox.init({
        getCards: () => [], getSelectedCardId: () => 'card-1', getWarehousePreviewCardId: () => null,
        isGlobalViewActive: () => false, cardHasDisplayImage: () => true, showToast: () => {}
      });
      window.SupabaseSync = { isEphemeralUpstreamImageUrl: () => false };
      mark('lightboxOpenStart');
      window.openLightbox('https://media.test/grid_perf_640.ico', { cardId: 'card-1', imageGen: true, feedKey: 'cr_baseline', preferFull: true, fallbackSrc: 'https://media.test/grid_perf_640.ico' });
      mark('lightboxOpen');
      const lbImg = document.getElementById('lightboxImage');
      await new Promise((resolveNow) => {
        if (lbImg.complete && lbImg.naturalWidth > 0) { mark('lightboxFullDecoded'); resolveNow(); return; }
        lbImg.addEventListener('load', () => { mark('lightboxFullDecoded'); resolveNow(); }, { once: true });
        lbImg.addEventListener('error', resolveNow, { once: true });
        setTimeout(resolveNow, 2000);
      });

      const keys = ['clickSubmit', 'pendingDom', 'firstStatusRequest', 'upstreamAccepted', 'upstreamCompleted', 'resultCardInserted', 'imageVisible', 'lightboxOpenStart', 'lightboxOpen', 'lightboxFullDecoded'];
      const rel = {};
      const base = t.clickSubmit;
      for (const key of keys) {
        rel[key] = typeof t[key] === 'number' ? Math.round((t[key] - base) * 10) / 10 : null;
      }
      return { timeline: t, rel, apiCalls, layoutShift: window.__layoutShiftTotal || 0, debug: window.__baselineDebug };
    });

    stats.layoutShiftScore = timeline.layoutShift;
    const duplicateCounts = {};
    for (const req of stats.requests) {
      duplicateCounts[req.url] = (duplicateCounts[req.url] || 0) + 1;
    }
    stats.duplicateRequests = Object.values(duplicateCounts).filter((count) => count > 1).reduce((a, b) => a + (b - 1), 0);

    reports.push({
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      timelineRelMs: timeline.rel,
      apiCalls: timeline.apiCalls,
      stats: {
        totalRequests: stats.requests.length,
        duplicateRequests: stats.duplicateRequests,
        maxConcurrency: stats.maxConcurrency,
        imageBytes: stats.imageBytes,
        failedRequests: stats.failedRequests.length,
        cancelledRequests: stats.cancelledRequests,
        consoleErrors: stats.consoleErrors.length,
        layoutShiftScore: stats.layoutShiftScore
      },
      consoleErrors: stats.consoleErrors
    });
    await page.close();
  }

  const outFile = join(evidenceDir, 'imagegen-experience-timeline.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    branch: process.env.GIT_BRANCH || '',
    commit: process.env.GIT_COMMIT || '',
    mode: 'mock-api',
    viewports: reports
  };
  writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`capture-imagegen-experience-baseline OK -> ${outFile}`);
  console.log(JSON.stringify(reports, null, 2));
} finally {
  if (browser) await browser.close();
}
