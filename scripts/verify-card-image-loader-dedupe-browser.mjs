import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// CardImageLoader 浏览器去重/失败占位/慢图证据：
// - 最小本地 HTTP fixture 真实载入 CardImageLoader 所需依赖（queues + loader），
//   并显式调用 CardImageLoader.loadImg。
// - 相同 ref 对应两个 img；另有一个 404 与一个延迟成功响应。
// - 硬断言 __PH_IMAGE_STATS__.requests > 0、deduped > 0、相同 ref 的服务端真实
//   请求数少于对应 DOM img 数、404 显示稳定 placeholder + 重试、慢图最终
//   complete 且 naturalWidth > 0。不用原生 img 的零统计冒充 loader 证据。
// - browser/context/server 在成功与异常路径的 finally 中关闭，打印 OK 后自然退出 0。

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(process.env.APP_ROOT || join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 8792);
const base = `http://127.0.0.1:${port}`;
const browserExecutable = process.env.BROWSER_EXECUTABLE_PATH || '';

const readyImageBytes = readFileSync(join(root, 'favicon.ico'));
const loaderQueuesSource = readFileSync(join(root, 'card-image-loader-queues.js'), 'utf8');
const loaderSource = readFileSync(join(root, 'card-image-loader.js'), 'utf8');

const requestCounts = new Map();
const sharedUrl = `${base}/img/shared.jpg?delay=300`;
const missingUrl = `${base}/img/missing.jpg`;
const slowUrl = `${base}/img/slow.jpg?delay=700`;

const fixtureHtml = `<!doctype html><meta charset="utf-8"><title>card-image-loader dedupe fixture</title>
<style>
  .card-media { position: relative; width: 160px; height: 120px; overflow: hidden; }
  .card-media img { width: 100%; height: 100%; object-fit: cover; }
</style>
<div id="loaderFixture">
  <div class="card-media" data-card="sharedA"><img id="sharedA" class="card-img" data-image-ref="storage://dedupe-shared" alt=""></div>
  <div class="card-media" data-card="sharedB"><img id="sharedB" class="card-img" data-image-ref="storage://dedupe-shared" alt=""></div>
  <div class="card-media" data-card="missing"><img id="missingImg" class="card-img" data-image-ref="storage://missing-ref" alt=""></div>
  <div class="card-media" data-card="slow"><img id="slowImg" class="card-img" data-image-ref="storage://slow-ref" alt=""></div>
</div>
<script>
  const SHARED_URL = ${JSON.stringify(sharedUrl)};
  window.__SHARED_URL = SHARED_URL;
  window.__phResolveCalls = [];
  const urlForRef = (ref) => {
    const key = String(ref || '');
    if (key === 'storage://dedupe-shared') return SHARED_URL;
    if (key === 'storage://missing-ref') return ${JSON.stringify(missingUrl)};
    if (key === 'storage://slow-ref') return ${JSON.stringify(slowUrl)};
    return '';
  };
  window.MobileUI = {
    isMobileViewport: () => false,
    isUserInteracting: () => false,
    getPerf: () => ({ maxDownload: 8, maxResolve: 10 })
  };
  window.SupabaseSync = {
    isInvalidMediaUrl: () => false,
    isEphemeralUpstreamImageUrl: () => false,
    isGridDisplayUrl: () => true,
    isValidSignedDisplayUrl: () => true,
    isWarehouseBlockedFullUrl: () => false,
    isStorageRef: (ref) => String(ref || '').startsWith('storage://'),
    storagePathFromDisplayUrl: () => '',
    storagePathFromRef: () => '',
    primaryImagePath: () => '',
    getListDisplayImageSrc: () => '',
    getCachedDisplayUrl: () => '',
    resolveDisplayUrl: async (ref) => {
      window.__phResolveCalls.push(String(ref || ''));
      return urlForRef(ref);
    }
  };
  window.MediaPipeline = {};
  window.FeatureDraft = {};
  window.retryWarehouseCardImage = (img) => {
    window.__retryCalls = (window.__retryCalls || 0) + 1;
    window.CardImageLoader.loadImg(img);
  };
</script>
<script src="/card-image-loader-queues.js"></script>
<script src="/card-image-loader.js"></script>
`;

function countRequest(pathname) {
  requestCounts.set(pathname, (requestCounts.get(pathname) || 0) + 1);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', base);
  const pathname = url.pathname;
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml);
    return;
  }
  if (pathname === '/card-image-loader-queues.js') {
    countRequest(pathname);
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(loaderQueuesSource);
    return;
  }
  if (pathname === '/card-image-loader.js') {
    countRequest(pathname);
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(loaderSource);
    return;
  }
  if (pathname === '/img/shared.jpg') {
    countRequest(pathname);
    const delay = Number(url.searchParams.get('delay') || 0);
    const respond = () => {
      res.writeHead(200, {
        'Content-Type': 'image/x-icon',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': readyImageBytes.length
      });
      res.end(readyImageBytes);
    };
    if (delay > 0) setTimeout(respond, delay);
    else respond();
    return;
  }
  if (pathname === '/img/missing.jpg') {
    countRequest(pathname);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('missing');
    return;
  }
  if (pathname === '/img/slow.jpg') {
    countRequest(pathname);
    const delay = Math.min(3000, Number(url.searchParams.get('delay') || 700));
    setTimeout(() => {
      res.writeHead(200, {
        'Content-Type': 'image/x-icon',
        'Cache-Control': 'no-store',
        'Content-Length': readyImageBytes.length
      });
      res.end(readyImageBytes);
    }, delay);
    return;
  }
  if (pathname === '/__counts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(requestCounts)));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

let browser = null;
const openContexts = new Set();
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  browser = await chromium.launch({
    executablePath: browserExecutable || undefined,
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
  openContexts.add(context);
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.CardImageLoader?.loadImg === 'function', null, { timeout: 20000 });

  // 相同 ref（storage://dedupe-shared）对应两个 img：sharedA / sharedB。
  const sharedCount = await page.evaluate(() => document.querySelectorAll('img[data-image-ref="storage://dedupe-shared"]').length);
  if (sharedCount !== 2) throw new Error(`expected 2 imgs for the shared ref, got ${sharedCount}`);

  // 1) 显式调用 loadImg(sharedA)：resolve 后 applyUrlToImg 开始下载 shared.jpg
  //    （带 250ms 延迟，给去重留出窗口）。
  await page.evaluate(() => window.CardImageLoader.loadImg(document.getElementById('sharedA')));
  await page.waitForFunction(() => window.__PH_IMAGE_STATS__?.requests >= 1, null, { timeout: 20000 });

  // 2) 同一 img 仍在请求中时再次走 loader 的 applyUrlToImg 去重路径。
  await page.evaluate(() => window.CardImageLoader.applyUrlToImg(document.getElementById('sharedA'), window.__SHARED_URL));
  const dedupedAfter = await page.evaluate(() => window.__PH_IMAGE_STATS__?.deduped || 0);
  if (dedupedAfter < 1) throw new Error(`loader dedupe stat not bumped (deduped=${dedupedAfter})`);

  // 3) 等 sharedA 下载完成；随后显式 loadImg(sharedB)，浏览器 HTTP 缓存应
  //    直接命中，服务端不再收到该 ref 的真实请求。
  await page.waitForFunction(() => {
    const img = document.getElementById('sharedA');
    return img?.complete && img.naturalWidth > 8;
  }, null, { timeout: 20000 });
  await page.evaluate(() => window.CardImageLoader.loadImg(document.getElementById('sharedB')));
  await page.waitForFunction(() => {
    const img = document.getElementById('sharedB');
    return img?.complete && img.naturalWidth > 8;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);

  // 4) 404：稳定 placeholder + 重试按钮。
  await page.evaluate(() => window.CardImageLoader.loadImg(document.getElementById('missingImg')));
  await page.waitForFunction(() => {
    const media = document.getElementById('missingImg')?.closest('.card-media');
    return media?.classList.contains('card-media--load-failed')
      && !!media.querySelector(':scope > .card-media-placeholder')
      && !!media.querySelector('.card-media-placeholder-retry');
  }, null, { timeout: 20000 });
  const missingPlaceholder = await page.evaluate(() => {
    const media = document.getElementById('missingImg')?.closest('.card-media');
    return {
      failed: media?.classList.contains('card-media--load-failed') === true,
      label: media?.querySelector('.card-media-placeholder-label')?.textContent?.trim() || '',
      hasRetry: !!media?.querySelector('.card-media-placeholder-retry')
    };
  });
  if (!missingPlaceholder.failed || missingPlaceholder.label !== '图片加载失败' || !missingPlaceholder.hasRetry) {
    throw new Error(`404 did not show stable placeholder + retry: ${JSON.stringify(missingPlaceholder)}`);
  }
  const missingRequestsBefore = serverCount('/img/missing.jpg');
  await page.evaluate(() => {
    document.querySelector('.card-media-placeholder-retry')?.click();
  });
  await page.waitForFunction(async (expected) => {
    const counts = await fetch('/__counts').then((res) => res.json());
    return (counts['/img/missing.jpg'] || 0) >= expected;
  }, missingRequestsBefore + 1, { timeout: 20000 });
  if (serverCount('/img/missing.jpg') < missingRequestsBefore + 1) {
    throw new Error('404 retry did not re-request the missing image');
  }

  // 5) 慢图：延迟成功后最终 complete 且 naturalWidth > 0。
  await page.evaluate(() => window.CardImageLoader.loadImg(document.getElementById('slowImg')));
  await page.waitForFunction(() => {
    const img = document.getElementById('slowImg');
    return img?.complete && img.naturalWidth > 8;
  }, null, { timeout: 20000 });

  const stats = await page.evaluate(() => window.__PH_IMAGE_STATS__ || {});
  const requests = Number(stats.requests) || 0;
  const deduped = Number(stats.deduped) || 0;
  const sharedServerRequests = serverCount('/img/shared.jpg');
  const slowServerRequests = serverCount('/img/slow.jpg');

  if (requests <= 0) throw new Error(`loader requests stat must be > 0 (requests=${requests})`);
  if (deduped <= 0) throw new Error(`loader dedupe stat must be > 0 (deduped=${deduped})`);
  if (sharedServerRequests >= sharedCount) {
    throw new Error(`server served the shared ref ${sharedServerRequests} times for ${sharedCount} DOM imgs (expected < ${sharedCount})`);
  }
  if (slowServerRequests < 1) throw new Error('slow image was never requested from the server');

  const result = {
    stats,
    sharedRefDomImgs: sharedCount,
    sharedServerRequests,
    slowServerRequests,
    sharedA: await page.evaluate(() => {
      const img = document.getElementById('sharedA');
      return { src: img?.src || '', complete: img?.complete ?? false, naturalWidth: img?.naturalWidth ?? 0 };
    }),
    sharedB: await page.evaluate(() => {
      const img = document.getElementById('sharedB');
      return { src: img?.src || '', complete: img?.complete ?? false, naturalWidth: img?.naturalWidth ?? 0 };
    }),
    missing: missingPlaceholder,
    slow: await page.evaluate(() => {
      const img = document.getElementById('slowImg');
      return { complete: img?.complete ?? false, naturalWidth: img?.naturalWidth ?? 0 };
    })
  };
  console.log('verify-card-image-loader-dedupe-browser OK', JSON.stringify(result));
} finally {
  for (const context of openContexts) {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
  openContexts.clear();
  if (browser) {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
  await new Promise((resolveClose) => {
    try {
      server.close(() => resolveClose());
    } catch (e) {
      resolveClose();
    }
  });
}

function serverCount(pathname) {
  return requestCounts.get(pathname) || 0;
}
