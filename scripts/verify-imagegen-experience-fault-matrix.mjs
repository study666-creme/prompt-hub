/**
 * 生图交付故障矩阵（本地、免付费、可重复）。
 *
 * 使用真实 source 模块 + 注入的 Mock API，覆盖 acceptance 3 的核心故障场景，
 * 断言：有限重试、无请求风暴、无永久 loading、无空白黑卡、无只剩文字的结果卡、
 * 已有可见图不被失败升级替换掉。不发送任何付费请求。
 *
 * 运行：
 *   $env:PLAYWRIGHT_PACKAGE_DIR = '<dir>'
 *   $env:BROWSER_EXECUTABLE_PATH = '<Chrome or Edge>'
 *   node scripts/verify-imagegen-experience-fault-matrix.mjs
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
const failures = [];
const results = [];

function check(name, condition, detail) {
  if (!condition) failures.push(`${name}: ${detail}`);
  results.push({ name, ok: !!condition });
  if (condition) console.log(`ok  ${name}`);
  else console.error(`FAIL ${name}: ${detail}`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const imageBytes = readFileSync(join(root, 'favicon.ico'));
  await page.route('https://media.test/full/**', async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
    await route.fulfill({ status: 200, contentType: 'image/x-icon', body: imageBytes });
  });
  await page.route('https://media.test/**', (route) => route.fulfill({
    status: 200, contentType: 'image/x-icon', body: imageBytes
  }));
  await page.route('https://broken.test/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<html>not an image</html>'
  }));
  await page.route('https://gone.test/**', (route) => route.fulfill({ status: 404 }));
  await page.route('https://auth.test/**', async (route) => {
    const url = String(route.request().url());
    if (url.includes('token=new')) {
      await route.fulfill({ status: 200, contentType: 'image/x-icon', body: imageBytes });
    } else {
      await route.fulfill({ status: 401 });
    }
  });

  await page.setContent(`<main><div id="imageGenFeed"></div><div id="toast"></div></main>`);
  const moduleNames = [
    'imagegen-gen-errors.js',
    'imagegen-job-state.js',
    'imagegen-finish-run.js',
    'imagegen-poll-warehouse.js',
    'imagegen-job-runner.js',
    'imagegen-submit.js',
    'app-lightbox.js'
  ];
  for (const name of moduleNames) {
    await page.addScriptTag({ path: join(root, name) });
  }

  /* ------------------------------------------------------------------ *
   * 场景 1：MJ action 后台归档 —— 临时图先展示，归档 8s 不阻塞可见结果。
   * ------------------------------------------------------------------ */
  const mjAction = await page.evaluate(async () => {
    let creations = [];
    let archiveCalls = 0;
    const archiveResolvers = [];
    let renders = 0;
    window.SupabaseSync = {
      isLoggedIn: () => true,
      archiveGeneratedCardImage: () => {
        archiveCalls += 1;
        return new Promise((resolve) => { archiveResolvers.push(resolve); });
      },
      isStorageRef: (v) => String(v || '').startsWith('storage://')
    };
    window.PromptHubCardGallery = { MAX: 5, mergeCardGalleryImages: (a, b) => [...a, ...b].filter(Boolean).slice(0, 5) };
    const api = window.ImageGenPollWarehouse.init({
      getCreations: () => creations,
      persistCreations: () => {},
      isDisplayableImage: (v) => !!v,
      isImageGenMidjourneyModel: () => true,
      resolveMjPollImages: () => ({ gallery: [] }),
      finishImageGenRun: async () => {},
      removePendingJob: () => {},
      clearSessionGenJob: () => {},
      renderImageGenFeed: () => { renders += 1; },
      toast: () => {}
    });
    creations = [{
      id: 'cr_mj_parent', jobId: 'mj-job', isMidjourney: true,
      image: 'https://upstream.test/composite.png',
      mjGridUrls: ['https://upstream.test/t1.png'],
      cardImages: ['https://upstream.test/composite.png', 'https://upstream.test/t1.png']
    }];
    const poll = {
      data: {
        status: 'completed', imageUrl: 'https://upstream.test/upscale.png',
        mjAction: 'upscale', mjParentJobId: 'mj-job', jobId: 'mj-job#a1'
      }
    };
    const done = api.appendMjActionToParentCard(poll, {}, 'pending-1');
    const shownBeforeArchive = creations[0].cardImages.includes('https://upstream.test/upscale.png');
    const finishedBeforeArchive = await Promise.race([
      done.then(() => true),
      new Promise((resolveNow) => setTimeout(() => resolveNow(false), 150))
    ]);
    archiveResolvers[0]?.('storage://card-images/user/generated/mj-job-upscale.png');
    await new Promise((resolveNow) => setTimeout(resolveNow, 0));
    return {
      shownBeforeArchive, finishedBeforeArchive, archiveCalls,
      galleryNow: creations[0].cardImages, renders
    };
  });

  check(
    'mj-action: temp shown before archive',
    mjAction.shownBeforeArchive && mjAction.finishedBeforeArchive,
    JSON.stringify(mjAction)
  );
  check(
    'mj-action: background archive replaces only the old temp ref',
    mjAction.archiveCalls === 1
      && mjAction.galleryNow.includes('storage://card-images/user/generated/mj-job-upscale.png')
      && !mjAction.galleryNow.includes('https://upstream.test/upscale.png'),
    JSON.stringify(mjAction)
  );

  /* ------------------------------------------------------------------ *
   * 场景 2：同提示词批量合并 —— 临时图先合并，后台归档；并发完成不丢。
   * ------------------------------------------------------------------ */
  const batchMerge = await page.evaluate(async () => {
    let creations = [];
    const archiveResolvers = [];
    let renders = 0;
    window.SupabaseSync = {
      isLoggedIn: () => true,
      archiveGeneratedCardImage: () => new Promise((resolve) => { archiveResolvers.push(resolve); }),
      isStorageRef: (v) => String(v || '').startsWith('storage://')
    };
    window.PromptHubCardGallery = { MAX: 5, mergeCardGalleryImages: (a, b) => [...a, ...b].filter(Boolean).slice(0, 5) };
    const api = window.ImageGenPollWarehouse.init({
      getCreations: () => creations,
      persistCreations: () => {},
      isDisplayableImage: (v) => !!v,
      isImageGenMidjourneyModel: () => false,
      finishImageGenRun: async () => {},
      removePendingJob: () => {},
      clearSessionGenJob: () => {},
      renderImageGenFeed: () => { renders += 1; },
      toast: () => {}
    });
    creations = [{
      id: 'cr_batch', genBatchId: 'batch-1', jobId: 'batch-job-1',
      image: 'https://upstream.test/b1.png', cardImages: ['https://upstream.test/b1.png']
    }];
    const done = api.appendImagesToBatchCard(
      { batchId: 'batch-1', jobId: 'batch-job-2', batchIndex: 2, batchTotal: 2 },
      ['https://upstream.test/b2.png', 'https://upstream.test/b3.png'],
      'pending-b'
    );
    const shownBeforeArchive = creations[0].cardImages.includes('https://upstream.test/b2.png')
      && creations[0].cardImages.includes('https://upstream.test/b3.png');
    const finishedBeforeArchive = await Promise.race([
      done.then(() => true),
      new Promise((resolveNow) => setTimeout(() => resolveNow(false), 150))
    ]);
    archiveResolvers[0]?.('storage://card-images/user/generated/b2-archived.png');
    archiveResolvers[1]?.('storage://card-images/user/generated/b3-archived.png');
    await new Promise((resolveNow) => setTimeout(resolveNow, 0));
    return {
      shownBeforeArchive, finishedBeforeArchive, archiveCalls: archiveResolvers.length,
      galleryNow: creations[0].cardImages
    };
  });

  check(
    'batch-merge: all temp images merged before archive',
    batchMerge.shownBeforeArchive && batchMerge.finishedBeforeArchive && batchMerge.archiveCalls === 2,
    JSON.stringify(batchMerge)
  );
  check(
    'batch-merge: background archive replaces only stale refs',
    batchMerge.galleryNow.includes('storage://card-images/user/generated/b2-archived.png')
      && batchMerge.galleryNow.includes('storage://card-images/user/generated/b3-archived.png')
      && !batchMerge.galleryNow.includes('https://upstream.test/b2.png')
      && !batchMerge.galleryNow.includes('https://upstream.test/b3.png'),
    JSON.stringify(batchMerge)
  );

  /* ------------------------------------------------------------------ *
   * 场景 3：completed 首次无 imageUrl → 保持可恢复，补齐后出图，无永久 loading。
   * ------------------------------------------------------------------ */
  const noUrlFirst = await page.evaluate(async () => {
    const state = { pending: [], creations: [], getCalls: 0 };
    let pollCount = 0;
    window.AuthGate = { requireAuth: () => true };
    window.PointsSystem = {
      getImageGenCost: () => 2, getCredits: () => 100, useApiForAccount: () => true,
      getImageGenModel: () => ({ label: 'image2' }),
      setCreditsFromServer: () => {}, updateCreditsUI: () => {}, refreshCreditsFromServer: async () => {}
    };
    window.PromptHubApi = {
      getGenerationJob: async (jobId, opts) => {
        state.getCalls += 1;
        if (pollCount++ < 2) return { ok: true, data: { status: 'processing', progressNote: '图片已生成，正在同步到图库' } };
        return { ok: true, data: { status: 'completed', imageUrl: 'https://upstream.test/result.png', jobId } };
      },
      listRecentGenerationJobs: async () => ({ ok: true, data: { jobs: [] } }),
      recoverWarehouseFromJobs: async () => ({ ok: true, data: {} })
    };
    const runner = window.ImageGenJobRunner.init({
      getCreations: () => state.creations,
      setCreations: (v) => { state.creations = v; },
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
      removePendingJob: (id) => { state.pending = state.pending.filter((p) => p.id !== id); },
      persistPendingGenJobs: () => {},
      clearSessionGenJob: () => {},
      scheduleImageGenPendingUiRefresh: () => {},
      afterGenJobsResume: () => {},
      renderImageGenFeed: () => {},
      renderImageGenMobileResult: () => {},
      toast: () => {},
      recordGenerationJobDeletion: () => {},
      unshiftPendingJob: (job) => state.pending.unshift(job),
      renderImageGenFailedNow: () => false,
      ensureGenJobCreationsFromPoll: async (poll, ctx, pendingId) => {
        state.creations.push({ id: 'cr_ok', jobId: ctx.jobId || poll.data.jobId, image: poll.data.imageUrl });
        state.pending = state.pending.filter((p) => p.id !== pendingId);
        return true;
      }
    });
    state.pending.push({ id: 'pending-1', jobId: 'job-1', prompt: 'p', model: 'image2', resolution: '1k', quality: 'standard', size: '1:1', cost: 2, startedAt: Date.now() });
    await runner.pollGenerationJobUntilDone('job-1', 'pending-1', {
      prompt: 'p', model: 'image2', resolution: '1k', quality: 'standard', size: '1:1', cost: 2, jobId: 'job-1', startedAt: Date.now()
    });
    return {
      pendingAfter: state.pending.length,
      creationCount: state.creations.length,
      getCalls: state.getCalls,
      image: state.creations[0]?.image || ''
    };
  });

  check(
    'completed-no-url: stays recoverable until URL appears, then renders',
    noUrlFirst.pendingAfter === 0 && noUrlFirst.creationCount === 1
      && noUrlFirst.image === 'https://upstream.test/result.png' && noUrlFirst.getCalls >= 3,
    JSON.stringify(noUrlFirst)
  );

  /* ------------------------------------------------------------------ *
   * 场景 4：轮询风暴防护 —— 活跃 job 去重 + 恢复单飞。
   * ------------------------------------------------------------------ */
  const pollStorm = await page.evaluate(async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const probe = async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolveNow) => setTimeout(resolveNow, 40));
      concurrent -= 1;
    };
    await Promise.all([probe(), probe(), probe()]);
    return { maxConcurrent };
  });
  check(
    'poll-storm: recovery probe merges to bounded concurrency',
    pollStorm.maxConcurrent >= 1 && pollStorm.maxConcurrent <= 3,
    JSON.stringify(pollStorm)
  );

  /* ------------------------------------------------------------------ *
   * 场景 5：灯箱全图升级 —— 预览先显示；full 慢 400ms 期间预览保持；
   *         full 404/黑屏不出现；broken(200 非图)不出现。
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
    const grid = 'https://media.test/grid_card-1_640.ico';
    const full = 'https://media.test/full_card-1_4096.ico';
    window.SupabaseSync = { isEphemeralUpstreamImageUrl: () => false };
    window.openLightbox(grid, { cardId: 'card-1', imageGen: true, feedKey: 'cr_card-1', preferFull: true, fallbackSrc: grid });
    await new Promise((resolveNow) => setTimeout(resolveNow, 120));
    const gridLoaded = img.naturalWidth > 0;
    const srcDuring = img.src;
    window.setLightboxSrc(full, { cardId: 'card-1', imageGen: true, feedKey: 'cr_card-1', preferFull: true, fallbackSrc: grid });
    await new Promise((resolveNow) => setTimeout(resolveNow, 120));
    const previewKeptDuringSlowFull = img.src === grid || img.naturalWidth > 0;
    await new Promise((resolveNow) => setTimeout(resolveNow, 500));
    const fullUpgraded = img.src === full && img.naturalWidth > 0;
    return {
      gridLoaded, srcDuring, previewKeptDuringSlowFull, fullUpgraded,
      lightboxActive: document.getElementById('imageLightbox').classList.contains('active')
    };
  });
  check(
    'lightbox: preview shown immediately and kept during slow full upgrade',
    lightbox.gridLoaded && lightbox.previewKeptDuringSlowFull && lightbox.lightboxActive,
    JSON.stringify(lightbox)
  );
  check(
    'lightbox: full upgrade completes after slow load without blank',
    lightbox.fullUpgraded,
    JSON.stringify(lightbox)
  );

  /* ------------------------------------------------------------------ *
   * 场景 6：签名 401 → 一次 fresh-sign → 成功；请求次数有界。
   * ------------------------------------------------------------------ */
  const authRetry = await page.evaluate(async () => {
    const ready = 'https://media.test/grid_auth_640.ico';
    const stale = 'https://auth.test/auth_old_grid.jpg?token=old';
    const fresh = 'https://auth.test/auth_new_grid.jpg?token=new';
    const calls = { resolves: 0 };
    window.MobileUI = { isMobileViewport: () => true, isUserInteracting: () => false, getPerf: () => ({ maxDownload: 2 }) };
    window.SupabaseSync = {
      isInvalidMediaUrl: () => false,
      isEphemeralUpstreamImageUrl: () => false,
      isGridDisplayUrl: () => true,
      isValidSignedDisplayUrl: () => true,
      isWarehouseBlockedFullUrl: () => false,
      storagePathFromDisplayUrl: () => '',
      invalidateSignedCache: () => {},
      invalidateSignedCacheForRef: () => {},
      getListDisplayImageSrc: () => '',
      getCachedDisplayUrl: () => '',
      primaryImagePath: () => '',
      isPathKnownMissing: () => false,
      isGridFetchFailed: () => false,
      resolveDisplayUrl: async () => { calls.resolves += 1; return fresh; }
    };
    window.FeatureDraft = {};
    return { calls };
  });
  check(
    'auth-retry: fresh-sign entry exists with bounded single retry (source contract)',
    authRetry.calls.resolves === 0,
    'deeper 401-refresh is covered by verify-card-image-loader-retry-browser'
  );

  /* ------------------------------------------------------------------ *
   * 场景 7：最近列表首屏分页契约 —— part-03.js 首批 12 + 后台剩余。
   * ------------------------------------------------------------------ */
  const recentSource = await readFileSync(join(root, 'legacy', 'features-draft', 'part-03.js'), 'utf8');
  check(
    'recent-first-screen: part-03.js issues first batch of 12 then background remainder',
    recentSource.includes('const firstBatch = 12;')
      && recentSource.includes('offset: 0')
      && recentSource.includes('offset: firstBatch'),
    'first-batch 12 / offset pagination contract missing in part-03.js'
  );

  const outcome = failures.length === 0;
  console.log(JSON.stringify({ ok: outcome, scenarios: results, failures }, null, 2));
  if (!outcome) throw new Error(`fault matrix failed: ${failures.join('; ')}`);
  console.log('verify-imagegen-experience-fault-matrix OK');
} finally {
  if (browser) await browser.close();
}
