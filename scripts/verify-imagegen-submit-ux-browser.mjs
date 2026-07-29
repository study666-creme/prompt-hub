import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || process.argv[2] || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5584);
const base = `http://127.0.0.1:${port}`;
const batchEntrySource = await readFile(join(root, 'legacy', 'features-draft', 'part-08.js'), 'utf8');
if (
  !batchEntrySource.includes('const queuedMessage = `')
  || !batchEntrySource.includes('window.showQuickToast(queuedMessage, 900)')
) {
  throw new Error('batch submit entry does not emit immediate positive feedback');
}
const submitSource = await readFile(join(root, 'imagegen-submit.js'), 'utf8');
if (!submitSource.includes('const shouldPersistInitialBatchState =')) {
  throw new Error('batch submit still repeats initial synchronous persistence work');
}
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const fixture = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/styles-theme.css">
  <link rel="stylesheet" href="/styles-landing.css">
  <link rel="stylesheet" href="/styles-mobile.css">
  <link rel="stylesheet" href="/styles-settings.css">
  <link rel="stylesheet" href="/styles-features.css">
  <link rel="stylesheet" href="/styles-assets.css">
  <style>
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; background: var(--bg-primary, #111318); color: var(--text-primary, #f4f4f5); }
    .app-main { width: 100%; height: 100%; overflow-x: hidden; overflow-y: auto; touch-action: pan-y; }
    #pageImageGen { width: min(1120px, calc(100% - 32px)); margin: 36px auto; display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 24px; }
    .submit-fixture-form { align-self: start; padding: 16px; border: 1px solid var(--border); background: var(--bg-card); border-radius: 8px; }
    #imageGenSubmit { width: 100%; min-height: 48px; }
    #imageGenPrompt, #imageGenModel { position: fixed; left: -10000px; }
    #imageGenFeed { min-height: 520px; align-content: start; }
    @media (max-width: 900px) {
      #pageImageGen { width: 100%; min-height: 100vh; margin: 0; display: block; }
      .submit-fixture-form { margin: 24px 14px; }
      #imageGenFeed { display: none; padding: 14px; min-height: 100vh; }
      body.imagegen-mobile-view-feed .submit-fixture-form { display: none; }
      body.imagegen-mobile-view-feed #imageGenFeed { display: grid; }
    }
  </style>
</head>
<body class="imagegen-mobile-view-form">
  <div class="app-main">
    <main id="pageImageGen" class="app-page app-page-feature active">
      <section class="submit-fixture-form">
        <button type="button" class="btn btn-primary imagegen-generate-btn" id="imageGenSubmit">生成图片 · 5 积分/张</button>
      </section>
      <textarea id="imageGenPrompt">丝滑提交回归</textarea>
      <select id="imageGenModel"><option value="gpt-image-2" selected>全能模型 2</option></select>
      <section id="imageGenFeed" class="imagegen-feed imagegen-feed--tiles mobile-feed-grid"></section>
    </main>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script src="/app-toast.js"></script>
  <script src="/image-gen-feed-cards.js"></script>
  <script src="/image-gen-feed.js"></script>
  <script src="/imagegen-submit.js"></script>
  <script>
    (() => {
      const batchMode = new URLSearchParams(location.search).get('batch') === '5';
      const state = {
        clickAt: 0,
        pendingAt: 0,
        toastAt: 0,
        mobileSwitchAt: 0,
        handoffAt: 0,
        draftAt: 0,
        generateAt: 0,
        generateResolved: false,
        mobileSwitches: 0,
        pending: [],
        failed: [],
        pendingTimes: [],
        postTimes: [],
        postPayloads: [],
        toastCalls: [],
        draftSaves: 0,
        batchMode,
        batchSettled: false
      };
      let resolveGenerate;
      const resolveGenerates = [];
      let pendingSequence = 0;
      const button = document.getElementById('imageGenSubmit');
      new MutationObserver(() => {
        if (!state.handoffAt && button.classList.contains('is-submitted')) state.handoffAt = performance.now();
      }).observe(button, { attributes: true, attributeFilter: ['class'] });

      const quickToast = window.showQuickToast;
      window.showQuickToast = (...args) => {
        const at = performance.now();
        if (!state.toastAt) state.toastAt = at;
        state.toastCalls.push({ at, message: String(args[0] || '') });
        return quickToast(...args);
      };

      const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
      const feedApi = window.ImageGenFeed.init({
        esc: escapeHtml,
        batchIndexLabel: (index, total) => index && total ? String(index) + '/' + total : '',
        failedJobModelLabel: (job) => job?.modelLabel || '全能模型 2',
        friendlyGenErrorMessage: () => '暂时没有完成，积分状态会自动同步',
        isSlowGenProviderModel: () => false,
        isMobileFeedViewport: () => matchMedia('(max-width: 900px)').matches,
        getImageGenPendingJobs: () => state.pending,
        getImageGenFailedJobs: () => state.failed,
        getImageGenFeedTab: () => 'recent',
        fillFeedPromptToActiveMode: () => {},
        copyFeedPromptText: () => {},
        removeFailedGenJob: () => {}
      });

      window.AuthGate = { requireAuth: () => true };
      window.PointsSystem = {
        getImageGenCost: () => 5,
        getCredits: () => 100,
        useApiForAccount: () => true,
        getImageGenModel: () => ({ label: '全能模型 2' }),
        setCreditsFromServer: () => {},
        updateCreditsUI: () => {},
        refreshCreditsFromServer: async () => {}
      };
      window.MobileUI = {
        isMobile: () => matchMedia('(max-width: 900px)').matches,
        setImageGenView: (view) => {
          state.mobileSwitches += 1;
          state.mobileSwitchAt = performance.now();
          document.body.classList.toggle('imagegen-mobile-view-form', view !== 'feed');
          document.body.classList.toggle('imagegen-mobile-view-feed', view === 'feed');
        }
      };
      window.PromptHubApi = {
        generateImage: (payload) => {
          const at = performance.now();
          if (!state.generateAt) state.generateAt = at;
          state.postTimes.push(at);
          state.postPayloads.push(payload);
          return new Promise((resolve) => {
            resolveGenerate = resolve;
            resolveGenerates.push(resolve);
          });
        }
      };

      const api = window.ImageGenSubmit.init({
        getImageGenFormMeta: () => ({ model: 'gpt-image-2', resolution: '1k', quality: 'high', size: '1:1' }),
        isImageGenMidjourneyModel: () => false,
        getImageGenMjMode: () => 'imagine',
        getImageGenRefImages: () => [],
        getImageGenPrimaryRef: () => null,
        getImageGenReferenceAssets: () => [],
        getImageGenBatchCount: () => batchMode ? 5 : 1,
        getImageGenCardTitle: () => '',
        isImageGenBatchSplitCards: () => false,
        getImageGenModelCatalogReady: () => true,
        getImageGenBatchRunning: () => batchMode,
        genId: () => batchMode ? 'pending-browser-test-' + (++pendingSequence) : 'pending-browser-test',
        toast: window.showToast,
        restoreImageGenSubmitLabel: () => { button.textContent = '生成图片 · 5 积分/张'; },
        saveImageGenDraft: () => {
          state.draftSaves += 1;
          state.draftAt = performance.now();
          const stopAt = performance.now() + 12;
          while (performance.now() < stopAt) { /* simulate synchronous storage work */ }
        },
        getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
        unshiftPendingJob: (job) => state.pending.unshift(job),
        persistPendingGenJobs: () => {},
        switchImageGenFeedToRecent: () => {},
        updateImageGenFeedHint: () => {},
        renderImageGenFeed: () => {},
        renderImageGenPendingNow: (job) => {
          const at = performance.now();
          if (!state.pendingAt) state.pendingAt = at;
          state.pendingTimes.push(at);
          return feedApi.renderImageGenPendingNow(job);
        },
        renderImageGenFailedNow: feedApi.renderImageGenFailedNow,
        safeRenderImageGenFeed: () => {},
        isImageGenMobileFormActive: () => matchMedia('(max-width: 900px)').matches
          && document.body.classList.contains('imagegen-mobile-view-form'),
        quoteGenerationCost: async () => ({ cost: 5, fromApi: true }),
        getGenCostQuoteTimeoutMs: () => 100,
        getSubmitSuccessHoldMs: () => 500,
        resolveRefUrlsFromList: async () => [],
        removePendingJob: (id) => { state.pending = state.pending.filter((job) => job.id !== id); },
        failPendingJob: (id, errorMessage) => {
          const pending = state.pending.find((job) => job.id === id);
          state.pending = state.pending.filter((job) => job.id !== id);
          if (!pending) return null;
          const failed = { ...pending, id, errorMessage, failedAt: Date.now() };
          state.failed.unshift(failed);
          return failed;
        },
        tryRecoverOrphanGenJobAfterSubmitError: async () => false,
        deferPendingJobRecovery: () => {},
        pendingJobToPollCtx: () => ({}),
        trackSessionGenJob: () => {},
        pollGenerationJobUntilDone: () => {}
      });

      button.addEventListener('click', () => {
        state.clickAt = performance.now();
        if (!batchMode) {
          void api.runImageGenWithPrompt();
          return;
        }
        button.disabled = true;
        button.classList.remove('is-submitted');
        button.classList.add('is-submitting');
        button.setAttribute('aria-busy', 'true');
        const total = 5;
        const batchId = 'batch_browser_mock';
        const batchPromise = api.runImageGenBatchTasks(total, (index) => api.runImageGenWithPrompt(undefined, {
          silentToast: true,
          batch: true,
          batchId,
          batchIndex: index + 1,
          batchTotal: total,
          batchMergeCards: true,
          cardTitle: '五张并行验收',
          clientRequestId: 'web.image.' + batchId + '.' + (index + 1)
        }));
        window.showQuickToast('已加入 ' + total + ' 张，正在生成', 900);
        button.classList.remove('is-submitting');
        button.classList.add('is-submitted');
        button.removeAttribute('aria-busy');
        button.textContent = '已加入 ' + total + ' 张';
        void batchPromise.then(() => { state.batchSettled = true; });
      });

      window.__submitUx = {
        state,
        fail() {
          state.generateResolved = true;
          resolveGenerate?.({ ok: false, status: 502, message: 'mock explicit failure' });
        },
        failAt(index) {
          resolveGenerates[index]?.({ ok: false, status: 502, message: 'mock explicit failure' });
        }
      };
    })();
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/' || url.pathname === '/__imagegen-submit.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fixture);
      return;
    }
    const file = join(root, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (error) {
    res.writeHead(500);
    res.end(String(error?.stack || error));
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || process.argv[3] || undefined
});

function rgbSpread(value) {
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  return channels.length === 3 ? Math.max(...channels) - Math.min(...channels) : 999;
}

async function runScenario(name, viewport, mobile, theme = 'dark') {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (error) => console.error(`${name}: pageerror`, error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`${name}: console`, message.text());
  });
  await page.goto(`${base}/__imagegen-submit.html`, { waitUntil: 'networkidle' });
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
  await page.locator('#imageGenSubmit').click();
  await page.waitForFunction(() => window.__submitUx?.state?.generateAt > 0);

  const pending = await page.evaluate(() => {
    const state = window.__submitUx.state;
    const card = document.querySelector('[data-feed-id="pending-browser-test"][data-pending="1"]');
    const media = card?.querySelector('.imagegen-gen-pending');
    const dismiss = card?.querySelector('[data-pending-dismiss]');
    const dismissStyle = dismiss ? getComputedStyle(dismiss) : null;
    const button = document.getElementById('imageGenSubmit');
    const toast = document.getElementById('toast');
    return {
      state: { ...state, pending: state.pending.length, failed: state.failed.length },
      card: !!card,
      legacyVisualCount: card?.querySelectorAll('.imagegen-gen-pending-visual, .imagegen-gen-pending-ring, .imagegen-gen-pending-core').length || 0,
      shimmerAnimation: media ? getComputedStyle(media, '::before').animationName : '',
      afterAnimation: media ? getComputedStyle(media, '::after').animationName : '',
      dismissLegacyClass: dismiss?.matches('.btn, .btn-ghost, .btn-sm') || false,
      dismissDisplay: dismissStyle?.display || '',
      dismissAlign: dismissStyle?.alignItems || '',
      dismissJustify: dismissStyle?.justifyContent || '',
      submitting: button.classList.contains('is-submitting'),
      toastText: toast?.textContent || '',
      toastQuick: toast?.classList.contains('toast--quick-confirm'),
      toastVisible: toast?.classList.contains('show'),
      bodyFeed: document.body.classList.contains('imagegen-mobile-view-feed')
    };
  });

  const timings = {
    pending: pending.state.pendingAt - pending.state.clickAt,
    toast: pending.state.toastAt - pending.state.clickAt,
    mobileSwitch: pending.state.mobileSwitchAt ? pending.state.mobileSwitchAt - pending.state.clickAt : 0
  };
  if (!pending.card || pending.state.generateResolved || pending.state.pending !== 1) {
    throw new Error(`${name}: pending card contract failed: ${JSON.stringify(pending)}`);
  }
  if (timings.pending > 100 || timings.toast > 100 || (mobile && timings.mobileSwitch > 100)) {
    throw new Error(`${name}: first feedback exceeded 100ms: ${JSON.stringify(timings)}`);
  }
  if (
    pending.legacyVisualCount !== 0
    || pending.shimmerAnimation !== 'imageGenPendingShimmer'
    || pending.afterAnimation !== 'none'
  ) {
    throw new Error(`${name}: pending card is not using the single shimmer treatment: ${JSON.stringify(pending)}`);
  }
  if (
    pending.dismissLegacyClass
    || !pending.dismissDisplay.includes('flex')
    || pending.dismissAlign !== 'center'
    || pending.dismissJustify !== 'center'
  ) {
    throw new Error(`${name}: pending dismiss icon is not centered: ${JSON.stringify(pending)}`);
  }
  if (!pending.toastQuick || !pending.toastVisible || pending.toastText !== '已加入作品，正在生成') {
    throw new Error(`${name}: quick positive feedback is missing: ${JSON.stringify(pending)}`);
  }
  if (mobile ? (!pending.bodyFeed || pending.state.mobileSwitches !== 1) : pending.state.mobileSwitches !== 0) {
    throw new Error(`${name}: viewport handoff is incorrect: ${JSON.stringify(pending)}`);
  }

  const pendingShot = join(tmpdir(), `prompt-hub-imagegen-pending-${name}.png`);
  await page.screenshot({ path: pendingShot, fullPage: true });
  await page.waitForFunction(() => window.__submitUx.state.handoffAt > 0);
  const handoffMs = await page.evaluate(() => window.__submitUx.state.handoffAt - window.__submitUx.state.clickAt);
  if (handoffMs > 110) throw new Error(`${name}: button handoff exceeded target: ${handoffMs.toFixed(1)}ms`);

  await page.evaluate(() => window.__submitUx.fail());
  await page.waitForSelector('[data-feed-id="pending-browser-test"][data-failed="1"]');
  const failed = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-feed-id="pending-browser-test"]')];
    const card = cards[0];
    const media = card?.querySelector('.imagegen-gen-failed');
    const error = card?.querySelector('.imagegen-gen-failed-error');
    const retry = card?.querySelector('[data-failed-retry]');
    const dismiss = card?.querySelector('[data-failed-dismiss]');
    const footer = card?.querySelector('.imagegen-feed-foot--failed');
    const dismissStyle = dismiss ? getComputedStyle(dismiss) : null;
    const dismissRect = dismiss?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const toast = document.getElementById('toast');
    return {
      count: cards.length,
      pending: card?.dataset.pending || '',
      failed: card?.dataset.failed || '',
      label: card?.querySelector('.imagegen-gen-failed-label')?.textContent || '',
      retryText: retry?.textContent || '',
      retryGhost: retry?.classList.contains('btn-ghost') || false,
      errorText: error?.textContent || '',
      errorColor: error ? getComputedStyle(error).color : '',
      failedMarkCount: card?.querySelectorAll('.imagegen-gen-failed-mark').length || 0,
      mediaBeforeAnimation: media ? getComputedStyle(media, '::before').animationName : '',
      mediaAfterAnimation: media ? getComputedStyle(media, '::after').animationName : '',
      dismissLegacyClass: dismiss?.matches('.btn, .btn-ghost, .btn-sm') || false,
      dismissDisplay: dismissStyle?.display || '',
      dismissAlign: dismissStyle?.alignItems || '',
      dismissJustify: dismissStyle?.justifyContent || '',
      dismissRightGap: footerRect && dismissRect ? Math.abs(footerRect.right - dismissRect.right) : 999,
      borderColor: card ? getComputedStyle(card).borderTopColor : '',
      toastText: toast?.textContent || ''
    };
  });
  if (failed.count !== 1 || failed.pending || failed.failed !== '1' || failed.label !== '未完成') {
    throw new Error(`${name}: failed card did not replace the pending slot: ${JSON.stringify(failed)}`);
  }
  if (failed.retryText !== '重新生成' || !failed.retryGhost) {
    throw new Error(`${name}: recovery action is not neutral: ${JSON.stringify(failed)}`);
  }
  if (failed.toastText !== '任务未完成，可重新生成' || /mock|502|失败|错误/.test(failed.toastText)) {
    throw new Error(`${name}: failure toast is too technical or punitive: ${JSON.stringify(failed)}`);
  }
  if (failed.failedMarkCount !== 0 || failed.mediaBeforeAnimation !== 'none' || failed.mediaAfterAnimation !== 'none') {
    throw new Error(`${name}: failed card still contains a loading indicator: ${JSON.stringify(failed)}`);
  }
  if (
    failed.dismissLegacyClass
    || !failed.dismissDisplay.includes('flex')
    || failed.dismissAlign !== 'center'
    || failed.dismissJustify !== 'center'
    || failed.dismissRightGap > 1
  ) {
    throw new Error(`${name}: failed dismiss icon is not centered at the footer edge: ${JSON.stringify(failed)}`);
  }
  if (rgbSpread(failed.borderColor) > 22) {
    throw new Error(`${name}: failed card still has a red warning treatment: ${JSON.stringify(failed)}`);
  }

  const failedShot = join(tmpdir(), `prompt-hub-imagegen-failed-${name}.png`);
  await page.screenshot({ path: failedShot, fullPage: true });
  await page.close();
  return {
    name,
    pendingMs: Math.round(timings.pending * 10) / 10,
    toastMs: Math.round(timings.toast * 10) / 10,
    mobileSwitchMs: mobile ? Math.round(timings.mobileSwitch * 10) / 10 : null,
    buttonHandoffMs: Math.round(handoffMs * 10) / 10,
    pendingShot,
    failedShot
  };
}

async function runBatchScenario(name, viewport, mobile) {
  const page = await browser.newPage({ viewport });
  const networkWrites = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) {
      networkWrites.push({ method: request.method(), url: request.url() });
    }
  });
  page.on('pageerror', (error) => console.error(`${name}: pageerror`, error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`${name}: console`, message.text());
  });

  await page.goto(`${base}/__imagegen-submit.html?batch=5`, { waitUntil: 'networkidle' });
  await page.locator('#imageGenSubmit').click();
  await page.waitForFunction(() => (
    document.querySelectorAll('#imageGenFeed [data-pending="1"]').length === 5
    && window.__submitUx?.state?.postTimes?.length === 5
  ));
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));

  const pending = await page.evaluate(() => {
    const state = window.__submitUx.state;
    const cards = [...document.querySelectorAll('#imageGenFeed [data-pending="1"]')];
    const button = document.getElementById('imageGenSubmit');
    const toast = document.getElementById('toast');
    const main = document.querySelector('.app-main');
    return {
      pendingCount: cards.length,
      ids: cards.map((card) => card.dataset.feedId || ''),
      requestIds: state.postPayloads.map((payload) => payload.clientRequestId || ''),
      pendingTimes: [...state.pendingTimes],
      postTimes: [...state.postTimes],
      clickAt: state.clickAt,
      toastAt: state.toastAt,
      toastText: toast?.textContent || '',
      toastQuick: toast?.classList.contains('toast--quick-confirm') || false,
      toastVisible: toast?.classList.contains('show') || false,
      toastCount: state.toastCalls.length,
      draftSaves: state.draftSaves,
      handoffAt: state.handoffAt,
      submitted: button?.classList.contains('is-submitted') || false,
      submitting: button?.classList.contains('is-submitting') || false,
      bodyFeed: document.body.classList.contains('imagegen-mobile-view-feed'),
      mobileSwitches: state.mobileSwitches,
      media: cards.map((card) => {
        const media = card.querySelector('.imagegen-gen-pending');
        const rect = media?.getBoundingClientRect();
        return {
          width: rect?.width || 0,
          height: rect?.height || 0,
          legacyVisualCount: card.querySelectorAll('.imagegen-gen-pending-visual, .imagegen-gen-pending-ring, .imagegen-gen-pending-core').length,
          shimmerAnimation: media ? getComputedStyle(media, '::before').animationName : '',
          afterAnimation: media ? getComputedStyle(media, '::after').animationName : ''
        };
      }),
      mainOverflow: main ? getComputedStyle(main).overflowY : '',
      mainScrollHeight: main?.scrollHeight || 0,
      mainClientHeight: main?.clientHeight || 0
    };
  });

  const lastPendingMs = Math.max(...pending.pendingTimes) - pending.clickAt;
  const firstPostMs = Math.min(...pending.postTimes) - pending.clickAt;
  const lastPostMs = Math.max(...pending.postTimes) - pending.clickAt;
  const postSpreadMs = Math.max(...pending.postTimes) - Math.min(...pending.postTimes);
  const toastMs = pending.toastAt - pending.clickAt;
  const handoffMs = pending.handoffAt - pending.clickAt;
  const expectedToast = '\u5df2\u52a0\u5165 5 \u5f20\uff0c\u6b63\u5728\u751f\u6210';
  if (
    pending.pendingCount !== 5
    || new Set(pending.ids).size !== 5
    || new Set(pending.requestIds).size !== 5
  ) {
    throw new Error(`${name}: five-card batch identity contract failed: ${JSON.stringify(pending)}`);
  }
  if (lastPendingMs > 100 || firstPostMs < 0 || lastPostMs > 180 || postSpreadMs > 100) {
    throw new Error(`${name}: five-card handoff or parallel mock start was too slow: ${JSON.stringify({ lastPendingMs, firstPostMs, lastPostMs, postSpreadMs })}`);
  }
  if (pending.media.some((item) => (
    item.width < 120
    || item.height < 120
    || Math.abs((item.width / item.height) - 1) > 0.04
    || item.legacyVisualCount !== 0
    || item.shimmerAnimation !== 'imageGenPendingShimmer'
    || item.afterAnimation !== 'none'
  ))) {
    throw new Error(`${name}: one or more pending cards lost stable sizing or motion: ${JSON.stringify(pending.media)}`);
  }
  if (
    toastMs > 100
    || pending.toastCount !== 1
    || pending.draftSaves !== 1
    || pending.toastText !== expectedToast
    || !pending.toastQuick
    || !pending.toastVisible
  ) {
    throw new Error(`${name}: batch positive feedback was not immediate: ${JSON.stringify(pending)}`);
  }
  if (!pending.submitted || pending.submitting || handoffMs > 110) {
    throw new Error(`${name}: batch button handoff exceeded target: ${JSON.stringify({ handoffMs, pending })}`);
  }
  if (mobile ? (!pending.bodyFeed || pending.mobileSwitches !== 1) : pending.mobileSwitches !== 0) {
    throw new Error(`${name}: batch viewport handoff is incorrect: ${JSON.stringify(pending)}`);
  }
  if (networkWrites.length) {
    throw new Error(`${name}: mock acceptance emitted a network write: ${JSON.stringify(networkWrites)}`);
  }

  const pendingShot = join(tmpdir(), `prompt-hub-imagegen-five-pending-${name}.png`);
  await page.screenshot({ path: pendingShot, fullPage: true });

  await page.evaluate(() => window.__submitUx.failAt(1));
  await page.waitForSelector('#imageGenFeed [data-failed="1"]');
  const failed = await page.evaluate(() => {
    const failedCard = document.querySelector('#imageGenFeed [data-failed="1"]');
    const failedMedia = failedCard?.querySelector('.imagegen-gen-failed');
    const retry = failedCard?.querySelector('[data-failed-retry]');
    const main = document.querySelector('.app-main');
    const remaining = [...document.querySelectorAll('#imageGenFeed [data-pending="1"]')];
    return {
      failedCount: document.querySelectorAll('#imageGenFeed [data-failed="1"]').length,
      pendingCount: remaining.length,
      failedLabel: failedCard?.querySelector('.imagegen-gen-failed-label')?.textContent || '',
      retryText: retry?.textContent || '',
      retryGhost: retry?.classList.contains('btn-ghost') || false,
      failedMarkCount: failedCard?.querySelectorAll('.imagegen-gen-failed-mark').length || 0,
      failedBeforeAnimation: failedMedia ? getComputedStyle(failedMedia, '::before').animationName : '',
      failedAfterAnimation: failedMedia ? getComputedStyle(failedMedia, '::after').animationName : '',
      borderColor: failedCard ? getComputedStyle(failedCard).borderTopColor : '',
      remainingMotion: remaining.map((card) => ({
        legacyVisualCount: card.querySelectorAll('.imagegen-gen-pending-visual, .imagegen-gen-pending-ring, .imagegen-gen-pending-core').length,
        shimmer: getComputedStyle(card.querySelector('.imagegen-gen-pending'), '::before').animationName,
        after: getComputedStyle(card.querySelector('.imagegen-gen-pending'), '::after').animationName
      })),
      blockingClasses: ['mobile-nav-open', 'mobile-groups-open', 'panel-open', 'app-modal-open']
        .filter((className) => document.body.classList.contains(className)),
      mainOverflow: main ? getComputedStyle(main).overflowY : '',
      mainScrollHeight: main?.scrollHeight || 0,
      mainClientHeight: main?.clientHeight || 0
    };
  });
  if (
    failed.failedCount !== 1
    || failed.pendingCount !== 4
    || !failed.failedLabel.includes('\u672a\u5b8c\u6210')
    || failed.retryText !== '\u91cd\u65b0\u751f\u6210'
    || !failed.retryGhost
    || failed.failedMarkCount !== 0
    || failed.failedBeforeAnimation !== 'none'
    || failed.failedAfterAnimation !== 'none'
    || rgbSpread(failed.borderColor) > 22
  ) {
    throw new Error(`${name}: partial batch failure is too punitive or displaced: ${JSON.stringify(failed)}`);
  }
  if (failed.remainingMotion.some((item) => (
    item.legacyVisualCount !== 0
    || item.shimmer !== 'imageGenPendingShimmer'
    || item.after !== 'none'
  ))) {
    throw new Error(`${name}: a sibling pending animation stopped after one failure: ${JSON.stringify(failed)}`);
  }
  if (failed.blockingClasses.length || !/auto|scroll|overlay/.test(failed.mainOverflow)) {
    throw new Error(`${name}: failure left a scroll-blocking state: ${JSON.stringify(failed)}`);
  }
  let scrollTop = 0;
  if (mobile) {
    if (failed.mainScrollHeight <= failed.mainClientHeight + 40) {
      throw new Error(`${name}: five-card fixture does not exercise scrolling: ${JSON.stringify(failed)}`);
    }
    scrollTop = await page.locator('.app-main').evaluate((main) => {
      main.scrollTop = Math.min(180, main.scrollHeight - main.clientHeight);
      return main.scrollTop;
    });
    if (scrollTop < 40) {
      throw new Error(`${name}: page stopped scrolling after a partial failure: ${JSON.stringify({ scrollTop, failed })}`);
    }
  }

  const failedShot = join(tmpdir(), `prompt-hub-imagegen-five-partial-failed-${name}.png`);
  await page.screenshot({ path: failedShot, fullPage: true });
  await page.close();
  return {
    name,
    lastPendingMs: Math.round(lastPendingMs * 10) / 10,
    firstPostMs: Math.round(firstPostMs * 10) / 10,
    lastPostMs: Math.round(lastPostMs * 10) / 10,
    postSpreadMs: Math.round(postSpreadMs * 10) / 10,
    toastMs: Math.round(toastMs * 10) / 10,
    buttonHandoffMs: Math.round(handoffMs * 10) / 10,
    scrollTop,
    networkWrites: networkWrites.length,
    pendingShot,
    failedShot
  };
}

try {
  const results = [];
  results.push(await runScenario('mobile', { width: 390, height: 844 }, true));
  results.push(await runScenario('desktop', { width: 1440, height: 900 }, false));
  results.push(await runScenario('desktop-light', { width: 1440, height: 900 }, false, 'light'));
  results.push(await runBatchScenario('five-mobile', { width: 390, height: 844 }, true));
  results.push(await runBatchScenario('five-desktop', { width: 1440, height: 900 }, false));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
