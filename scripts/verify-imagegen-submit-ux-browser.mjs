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
const screenshotPath = join(tmpdir(), 'prompt-hub-imagegen-submit-running.png');

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const fixture = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/styles-features.css">
  <style>
    body { margin: 0; min-height: 100vh; background: #f5f5f7; color: #18181a; }
    .submit-fixture { width: min(100% - 28px, 430px); margin: 96px auto; }
    .submit-fixture .imagegen-form-dock { position: static; padding: 14px; background: #fff; }
    #imageGenSubmit { width: 100%; min-height: 48px; }
    #imageGenPrompt, #imageGenModel, #imageGenFeed { display: none; }
  </style>
</head>
<body class="imagegen-mobile-view-form">
  <main id="pageImageGen" class="app-page app-page-feature active submit-fixture">
    <div class="imagegen-form-dock">
      <button type="button" class="btn btn-primary imagegen-generate-btn" id="imageGenSubmit">生成图片 · 5 积分/张</button>
    </div>
    <textarea id="imageGenPrompt">丝滑提交回归</textarea>
    <select id="imageGenModel"><option value="gpt-image-2" selected>全能模型2</option></select>
    <div id="imageGenFeed"></div>
  </main>
  <script src="/pack-imagegen.js"></script>
  <script>
    (() => {
      const state = {
        clickAt: 0,
        firstFrameAt: 0,
        firstFrameSubmitting: false,
        draftAt: 0,
        generateAt: 0,
        feedRenders: 0,
        mobileSwitches: 0,
        toasts: 0,
        pending: []
      };
      let resolveGenerate;
      const button = document.getElementById('imageGenSubmit');

      window.AuthGate = { requireAuth: () => true };
      window.PointsSystem = {
        getImageGenCost: () => 5,
        getCredits: () => 100,
        useApiForAccount: () => true,
        setCreditsFromServer: () => {},
        updateCreditsUI: () => {}
      };
      window.MobileUI = {
        setImageGenView: () => { state.mobileSwitches += 1; }
      };
      window.PromptHubApi = {
        generateImage: () => {
          state.generateAt = performance.now();
          return new Promise((resolve) => { resolveGenerate = resolve; });
        }
      };

      const api = window.ImageGenSubmit.init({
        getImageGenFormMeta: () => ({ model: 'gpt-image-2', resolution: '1k', quality: 'standard', size: '1:1' }),
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
        genId: () => 'pending-browser-test',
        toast: () => { state.toasts += 1; },
        restoreImageGenSubmitLabel: () => { button.textContent = '生成图片 · 5 积分/张'; },
        saveImageGenDraft: () => {
          state.draftAt = performance.now();
          const stopAt = performance.now() + 12;
          while (performance.now() < stopAt) { /* simulate synchronous draft/storage work */ }
        },
        getImageGenSaveTarget: () => ({ targetGroup: null, targetTags: null }),
        unshiftPendingJob: (job) => state.pending.unshift(job),
        persistPendingGenJobs: () => {},
        switchImageGenFeedToRecent: () => {},
        updateImageGenFeedHint: () => {},
        renderImageGenFeed: () => { state.feedRenders += 1; },
        safeRenderImageGenFeed: () => { state.feedRenders += 1; },
        isImageGenMobileFormActive: () => matchMedia('(max-width: 900px)').matches
          && document.body.classList.contains('imagegen-mobile-view-form'),
        quoteGenerationCost: async () => ({ cost: 5, fromApi: true }),
        getGenCostQuoteTimeoutMs: () => 100,
        getSubmitSuccessHoldMs: () => 1800,
        resolveRefUrlsFromList: async () => [],
        removePendingJob: () => {},
        failPendingJob: () => {},
        tryRecoverOrphanGenJobAfterSubmitError: async () => false,
        deferPendingJobRecovery: () => {},
        pendingJobToPollCtx: () => ({}),
        trackSessionGenJob: () => {},
        pollGenerationJobUntilDone: () => {}
      });

      button.addEventListener('click', () => {
        state.clickAt = performance.now();
        requestAnimationFrame(() => {
          state.firstFrameAt = performance.now();
          state.firstFrameSubmitting = button.classList.contains('is-submitting');
        });
        void api.runImageGenWithPrompt();
      });

      window.__submitUx = {
        state,
        complete() {
          resolveGenerate?.({
            ok: true,
            data: { status: 'processing', jobId: 'job-browser-test', creditsCharged: 5 }
          });
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

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/__imagegen-submit.html`, { waitUntil: 'networkidle' });
  const button = page.locator('#imageGenSubmit');
  const before = await button.boundingBox();
  await button.click();
  await page.waitForFunction(() => window.__submitUx?.state?.firstFrameAt > 0);
  const firstFrame = await page.evaluate(() => ({ ...window.__submitUx.state }));
  await page.waitForFunction(() => window.__submitUx?.state?.generateAt > 0);

  const queued = await page.evaluate(() => {
    const btn = document.getElementById('imageGenSubmit');
    const buttonStyle = getComputedStyle(btn);
    return {
      text: btn.textContent,
      disabled: btn.disabled,
      busy: btn.getAttribute('aria-busy'),
      submitting: btn.classList.contains('is-submitting'),
      submitted: btn.classList.contains('is-submitted'),
      justifyContent: buttonStyle.justifyContent,
      bodyForm: document.body.classList.contains('imagegen-mobile-view-form'),
      bodyFeed: document.body.classList.contains('imagegen-mobile-view-feed'),
      ...window.__submitUx.state
    };
  });
  const during = await button.boundingBox();

  if (!firstFrame.firstFrameSubmitting || firstFrame.firstFrameAt <= firstFrame.clickAt || firstFrame.draftAt < firstFrame.firstFrameAt) {
    throw new Error(`submit work started before first feedback frame: ${JSON.stringify(firstFrame)}`);
  }
  if (firstFrame.firstFrameAt - firstFrame.clickAt > 80) {
    throw new Error(`first submit feedback frame was too slow: ${Math.round(firstFrame.firstFrameAt - firstFrame.clickAt)}ms`);
  }
  if (
    !queued.submitted
    || queued.submitting
    || queued.disabled
    || queued.busy != null
    || queued.text !== '已加入生成队列'
    || queued.pending.length !== 1
  ) {
    throw new Error(`queued submit feedback is incorrect: ${JSON.stringify(queued)}`);
  }
  if (queued.justifyContent !== 'center') {
    throw new Error(`submit feedback is not centered: ${JSON.stringify(queued)}`);
  }
  if (!queued.bodyForm || queued.bodyFeed || queued.mobileSwitches !== 0 || queued.feedRenders !== 0 || queued.toasts !== 0) {
    throw new Error(`mobile submit caused unrelated UI feedback: ${JSON.stringify(queued)}`);
  }
  if (!before || !during || Math.abs(before.height - during.height) > 0.5 || Math.abs(before.width - during.width) > 0.5) {
    throw new Error(`submit button shifted while loading: before=${JSON.stringify(before)} during=${JSON.stringify(during)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.evaluate(() => window.__submitUx.complete());
  await page.waitForFunction(() => document.getElementById('imageGenSubmit')?.classList.contains('is-submitted'));
  const accepted = await page.evaluate(() => {
    const btn = document.getElementById('imageGenSubmit');
    return {
      text: btn.textContent,
      submitted: btn.classList.contains('is-submitted'),
      mobileSwitches: window.__submitUx.state.mobileSwitches,
      feedRenders: window.__submitUx.state.feedRenders
    };
  });
  if (!accepted.submitted || accepted.text !== '已加入生成队列' || accepted.mobileSwitches !== 0 || accepted.feedRenders !== 0) {
    throw new Error(`accepted submit feedback is incorrect: ${JSON.stringify(accepted)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    firstFeedbackMs: Math.round((firstFrame.firstFrameAt - firstFrame.clickAt) * 10) / 10,
    requestStartedMs: Math.round((queued.generateAt - queued.clickAt) * 10) / 10,
    screenshotPath
  }));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
