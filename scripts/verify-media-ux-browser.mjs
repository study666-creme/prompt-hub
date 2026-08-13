import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 媒体 UX 回归：卡片库瀑布流几何、图片加载占位/去重、一次性入场动画与
// reduced-motion，以及模型目录公开真源（canonical id、退役清理、stale LKG）。
// 不发送真实生成请求；fixture 端口即 127.0.0.1:8787（api-config 的本地 API 基址）。

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(process.env.APP_ROOT || join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 8787);
const base = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : '';
const evidenceFile = process.env.MEDIA_UX_EVIDENCE_FILE ? resolve(process.env.MEDIA_UX_EVIDENCE_FILE) : '';
const cardCount = Number(process.env.MEDIA_UX_CARD_COUNT || 96);
const browserExecutable = process.env.BROWSER_EXECUTABLE_PATH || '';

const now = Date.now();
const images = [
  '/assets/studio-preset/scene.png',
  '/assets/studio-preset/peishen.png',
  '/assets/studio-preset/linche.png',
  '/assets/studio-preset/shenmei.png'
];
const imageBodies = await Promise.all(images.map((pathname) => readFile(join(root, pathname.replace(/^\/+/, '')))));
const cdnAssets = new Map(images.map((_, index) => {
  const token = Buffer.from(`guest/generated/mediaux-fixture-${index}_grid.jpg`).toString('base64url');
  return [token, imageBodies[index]];
}));
const slowBodies = new Map();
function cdnToken(index) {
  return Buffer.from(`guest/generated/mediaux-fixture-${index % images.length}_grid.jpg`).toString('base64url');
}
function cdnUrl(index) { return `${base}/api/v1/media/c/${cdnToken(index)}`; }
function slowToken(index) {
  const token = Buffer.from(`guest/slow/mediaux-fixture-${index}_grid.jpg`).toString('base64url');
  if (!slowBodies.has(token)) slowBodies.set(token, imageBodies[index % imageBodies.length]);
  return token;
}
function missingUrl(index) {
  return `${base}/api/v1/media/c/${Buffer.from(`guest/missing/mediaux-fixture-${index}_grid.jpg`).toString('base64url')}`;
}

const groups = ['电影分镜', '角色设定', '产品视觉', '灵感收集', '场景氛围', '未分类'];
const fixtureModels = [
  { id: 'image2-economy', label: '全能模型2 · 特价 1K', uiFamily: 'gim2', sortOrder: 20, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 2.2, creditsFinal: 2.2, creditsByResolution: { '1k': 2.2 }, resolutions: ['1k'] },
  { id: 'image2', label: '全能模型2 · 1K', uiFamily: 'gim2', sortOrder: 21, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 5.5, creditsFinal: 5.5, creditsByResolution: { '1k': 5.5 }, resolutions: ['1k'] },
  { id: 'image2-pro', label: '全能模型2 · 高质量 1K/2K/4K', uiFamily: 'gim2', sortOrder: 22, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 8, creditsFinal: 8, creditsByResolution: { '1k': 8, '2k': 15, '4k': 20 }, resolutions: ['1k', '2k', '4k'] },
  { id: 'image2-A', label: '全能模型2-A', uiFamily: 'gim2', sortOrder: 24, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 6, creditsFinal: 6, creditsByResolution: { '4k': 6 }, resolutions: ['4k'] },
  { id: 'lingtu-fast', label: '香蕉 · Fast 1K', uiFamily: 'banana', sortOrder: 41, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 4.2, creditsFinal: 4.2, creditsByResolution: { '1k': 4.2 }, resolutions: ['1k'] },
  { id: 'lingtu', label: '香蕉 · Standard 1K', uiFamily: 'banana', sortOrder: 40, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 6, creditsFinal: 6, creditsByResolution: { '1k': 6 }, resolutions: ['1k'] },
  { id: 'mj-v81', label: 'MJ v8.1', uiFamily: 'midjourney', sortOrder: 110, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 40, creditsFinal: 40, creditsBySpeed: { relax: 40, fast: 40, turbo: 40 }, resolutions: ['1k'] },
  { id: 'mj-v7', label: 'MJ v7', uiFamily: 'midjourney', sortOrder: 111, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 40, creditsFinal: 40, creditsBySpeed: { relax: 40, fast: 40, turbo: 40 }, resolutions: ['1k'] },
  { id: 'mj-niji7', label: 'MJ Niji 7', uiFamily: 'midjourney', sortOrder: 113, status: 'active', selectable: true, refundOnViolation: true, creditsPerCall: 40, creditsFinal: 40, creditsBySpeed: { relax: 40, fast: 40, turbo: 40 }, resolutions: ['1k'] }
];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function buildCards(count) {
  return Array.from({ length: count }, (_, index) => {
    const kind = index % 8;
    const image = kind === 0
      ? ''
      : kind === 3 ? missingUrl(index)
      : kind === 7 ? `${base}/api/v1/media/c/${slowToken(index)}`
      : cdnUrl(index);
    const cardImages = kind === 0 ? [] : (kind === 2 ? [cdnUrl(index), cdnUrl(index + 7)] : [image]);
    return {
      id: `mediaux-fixture-${index}`,
      title: `媒体回归卡 ${index + 1}`,
      prompt: image
        ? `Media UX fixture ${index + 1} with deterministic geometry for waterfall and entrance regression.`
        : `纯文字提示词 ${index + 1}：用于验证文字卡片在瀑布流中的稳定行高。`,
      group: groups[index % groups.length],
      tags: index % 2 ? ['构图', '光影'] : ['电影感', '收藏'],
      image,
      cardImages,
      pinnedAt: index === 0 ? now : null,
      createdAt: now - index * 3_600_000,
      updatedAt: now - index * 1_800_000
    };
  });
}

function seedHtml(cards) {
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(cards)};
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
(async () => {
  indexedDB.deleteDatabase('PromptRepoDB');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const open = indexedDB.open('PromptRepoDB', 3);
  open.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('card_image_backups')) db.createObjectStore('card_image_backups', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('data_backups')) db.createObjectStore('data_backups', { keyPath: 'id' });
  };
  const db = await requestResult(open);
  const tx = db.transaction(['cards'], 'readwrite');
  cards.forEach((card) => tx.objectStore('cards').put(card));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem('promptrepo_idb_owner_uid', 'guest');
  localStorage.setItem('promptrepo_app_page', 'warehouse');
  localStorage.setItem('promptrepo_view_mode', 'grid');
  localStorage.setItem('promptrepo_imagegen_models_cache_v4', JSON.stringify({
    ts: Date.now(), version: 20, models: ${JSON.stringify(fixtureModels)}
  }));
  localStorage.setItem('promptrepo_settings', JSON.stringify({ cardColumns: 3, viewMode: 'grid' }));
  location.href = '/prompts/';
})().catch((error) => { document.body.textContent = String(error?.stack || error); });
</script>`;
}

function modelPayload() {
  return { ok: true, data: { catalogStale: false, models: fixtureModels } };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__mediaux_seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(buildCards(cardCount)));
      return;
    }
    if (url.pathname.startsWith('/api/v1/media/c/')) {
      const token = url.pathname.split('/').pop() || '';
      const body = cdnAssets.get(token);
      if (body) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Content-Length': body.length });
        res.end(body);
        return;
      }
      const slowBody = slowBodies.get(token);
      if (slowBody) {
        const delay = Number(url.searchParams.get('delay') || 600);
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Content-Length': slowBody.length });
          res.end(slowBody);
        }, delay);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
      return;
    }
    if (url.pathname === '/api/v1/generate/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(modelPayload()));
      return;
    }
    if (url.pathname === '/api/v1/generate/cost') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { final: 5.5 } }));
      return;
    }
    if (url.pathname.startsWith('/api/v1/media/sign-batch') || url.pathname.startsWith('/api/v1/media/community/sign')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { urls: {}, refMap: {}, expiresIn: 300 } }));
      return;
    }
    if (url.pathname === '/api/v1/community/feed' || url.pathname === '/api/v1/generate/jobs/recent') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { posts: [], items: [], hasMore: false } }));
      return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/supabase/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: [] }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '/prompts' || pathname === '/prompts/') {
      pathname = '/index.html';
    }
    const file = resolve(join(root, pathname.replace(/^\/+/, '')));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack || error));
  }
});

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1024x768', width: 1024, height: 768, mobile: false },
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true }
];

function fail(message) {
  throw new Error(message);
}

async function inspectGeometry(page, viewport) {
  return page.evaluate(({ isMobile }) => {
    const container = document.getElementById('cardsContainer');
    if (!container) return { missing: true };
    const cards = [...container.querySelectorAll('.card[data-id]')];
    const rects = cards.map((card) => {
      const r = card.getBoundingClientRect();
      return { id: card.dataset.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }).filter((r) => r.width > 0 && r.height > 0);
    const cr = container.getBoundingClientRect();
    const overflow = rects.some((r) => r.left < cr.left - 1 || r.right > cr.right + 1);
    const overlaps = (() => {
      let count = 0;
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (xOverlap > 2 && yOverlap > 2) count += 1;
        }
      }
      return count;
    })();
    const columns = isMobile ? 2 : 3;
    const sorted = [...rects].sort((a, b) => a.left - b.left);
    const columnLefts = [];
    for (const r of sorted) {
      if (!columnLefts.some((c) => Math.abs(c - r.left) < 8)) columnLefts.push(r.left);
    }
    columnLefts.sort((a, b) => a - b);
    const colRects = columnLefts.map((left) => rects.filter((r) => Math.abs(r.left - left) < 8));
    const tops = colRects.map((col) => Math.min(...col.map((r) => r.top)));
    const topDelta = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    const maxInColumnGap = Math.max(
      0,
      ...colRects.map((col) => {
        const sortedCol = [...col].sort((a, b) => a.top - b.top);
        let maxGap = 0;
        for (let i = 1; i < sortedCol.length; i += 1) {
          maxGap = Math.max(maxGap, sortedCol[i].top - sortedCol[i - 1].bottom);
        }
        return maxGap;
      })
    );
    const colBottoms = colRects.map((col) => Math.max(...col.map((r) => r.bottom)));
    const maxColumnDelta = colBottoms.length ? Math.max(...colBottoms) - Math.min(...colBottoms) : 0;
    const mediaStates = [...container.querySelectorAll('.card-media')].map((m) => ({
      failed: m.classList.contains('card-media--load-failed'),
      hasPlaceholder: !!m.querySelector(':scope > .card-media-placeholder'),
      revealed: m.classList.contains('media-revealed')
    }));
    const decoded = [...container.querySelectorAll('.card-img')].filter((img) => img.complete && img.naturalWidth > 0).length;
    const placeholderImgs = [...container.querySelectorAll('.card-img')].filter((img) => !img.complete || img.naturalWidth === 0).length;
    return {
      cardCount: cards.length,
      columnCount: columnLefts.length,
      overflow,
      overlaps,
      topDelta,
      maxInColumnGap,
      maxColumnDelta,
      decoded,
      placeholderImgs,
      mediaStates: {
        failed: mediaStates.filter((s) => s.failed).length,
        withPlaceholder: mediaStates.filter((s) => s.hasPlaceholder).length,
        revealed: mediaStates.filter((s) => s.revealed).length
      }
    };
  }, { isMobile: viewport.mobile });
}

async function openFixture(browser, viewport, { reducedMotion = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__phMediaEnterEvents = {};
    window.__phMediaEnterTotal = 0;
    // 自然 animationstart 证据：在 document 捕获阶段监听，只记录
    // animationName === 'ph-media-enter'，按稳定 media key（卡片 id /
    // post id / feed id）汇总，证明入场动画真的由浏览器播放且每张卡一次。
    document.addEventListener('animationstart', (e) => {
      if (!e || e.animationName !== 'ph-media-enter') return;
      const target = e.target;
      const media = target && target.closest
        ? target.closest('.card-media, .imagegen-feed-media')
        : target;
      const card = media && media.closest
        ? media.closest('[data-id], [data-post-id], [data-feed-id]')
        : null;
      const key = (card && (card.dataset.id || card.dataset.postId || card.dataset.feedId))
        || (media && media.dataset.mediaRevealKey)
        || '';
      if (!key) return;
      window.__phMediaEnterEvents[key] = (window.__phMediaEnterEvents[key] || 0) + 1;
      window.__phMediaEnterTotal += 1;
    }, true);
    if (typeof window.PerformanceObserver !== 'undefined') {
      window.__phMediaUxLcp = null;
      window.__phMediaUxLongTasks = [];
      window.__phMediaUxCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'largest-contentful-paint') {
              window.__phMediaUxLcp = Math.round(entry.startTime);
            }
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) { /* ignore */ }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__phMediaUxLongTasks.push(Math.round(entry.duration));
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch (e) { /* ignore */ }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            window.__phMediaUxCls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) { /* ignore */ }
    }
  });
  await page.goto(`${base}/__mediaux_seed.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#cardsContainer .card[data-id]').length > 10, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

if (screenshotDir) {
  await mkdir(screenshotDir, { recursive: true });
}
const evidence = { viewports: {}, reducedMotion: null, catalog: null };
const openContexts = new Set();
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', rejectListen);
    resolveListen();
  });
});
let browser = null;

try {
  browser = await chromium.launch({
    executablePath: browserExecutable || undefined,
    headless: true
  });

  for (const viewport of viewports) {
    const { context, page } = await openFixture(browser, viewport);
    openContexts.add(context);
    const tracePath = screenshotDir ? join(screenshotDir, `mediaux-${viewport.name}.zip`) : '';
    if (tracePath) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    try {
      const geometry = await inspectGeometry(page, viewport);
      const debugMedia = await page.evaluate(() => ({
        samples: [...document.querySelectorAll('#cardsContainer .card-media')].slice(0, 3).map((m) => ({
          cls: m.className,
          entered: m.dataset.phMediaEntered || '',
          revealKey: m.dataset.mediaRevealKey || ''
        }))
      }));
      const entrance = await page.evaluate(() => [...document.querySelectorAll('#cardsContainer .card-media[data-ph-media-entered="1"]')].length);
      const entranceEvents = await page.evaluate(() => ({
        total: window.__phMediaEnterTotal || 0,
        perKey: window.__phMediaEnterEvents || {}
      }));
      // 人工重新 add class + computed animationName 只是辅助证据；主要通过
      // document 捕获阶段监听到的自然 animationstart（animationName ===
      // 'ph-media-enter'，按稳定 media key 汇总）证明入场动画真实播放一次。
      const entranceAnimation = await page.evaluate(() => {
        const media = document.querySelector('#cardsContainer .card-media[data-ph-media-entered="1"]');
        if (!media) return 'none';
        media.classList.add('ph-media-enter');
        const name = getComputedStyle(media).animationName || 'none';
        media.classList.remove('ph-media-enter');
        return name;
      });
      const stats = await page.evaluate(() => window.__PH_IMAGE_STATS__ || {});
      const lcp = await page.evaluate(() => window.__phMediaUxLcp || null);
      const longTasks = await page.evaluate(() => window.__phMediaUxLongTasks || []);
      const cls = await page.evaluate(() => window.__phMediaUxCls || 0);
      const catalog = await page.evaluate(() => ({
        modelIds: (window.__IMAGE_GEN_MODELS__ || []).map((m) => m.id),
        stale: window.__IMAGE_GEN_CATALOG_STALE__ === true,
        source: window.__IMAGE_GEN_CATALOG_SOURCE__ || ''
      }));
      if (screenshotDir) {
        await page.screenshot({ path: join(screenshotDir, `mediaux-${viewport.name}.png`), fullPage: false });
      }

      evidence.viewports[viewport.name] = {
        geometry,
        entranceCount: entrance,
        entranceEvents,
        entranceAnimation,
        stats,
        lcp,
        longTasks,
        cls,
        debugMedia,
        layoutShiftRisk: viewport.mobile
          ? `mobile CLS measured ${cls.toFixed(3)} remains a residual layout-shift risk on this fixture; this task does not claim zero layout shift`
          : ''
      };
      if (viewport.name === 'desktop-1440x900') evidence.catalog = catalog;

      if (geometry.missing) fail(`${viewport.name}: cardsContainer missing`);
      if (geometry.cardCount < 10) fail(`${viewport.name}: too few cards rendered (${geometry.cardCount})`);
      if (geometry.columnCount !== (viewport.mobile ? 2 : 3)) {
        fail(`${viewport.name}: expected ${viewport.mobile ? 2 : 3} columns, got ${geometry.columnCount}`);
      }
      if (geometry.overlaps > 0) fail(`${viewport.name}: ${geometry.overlaps} overlapping card pairs`);
      if (geometry.overflow) fail(`${viewport.name}: horizontal overflow detected`);
      if (geometry.topDelta > 3) fail(`${viewport.name}: first-row top delta ${geometry.topDelta}px > 3px`);
      const maxCardHeight = Math.max(1, ...(await page.evaluate(() => {
        return [...document.querySelectorAll('#cardsContainer .card[data-id]')].map((c) => c.offsetHeight || 0);
      })));
      const holeThreshold = Math.round(maxCardHeight * 1.25 + 40);
      if (geometry.maxInColumnGap > holeThreshold) {
        fail(`${viewport.name}: fillable column gap ${geometry.maxInColumnGap}px > ${holeThreshold}px`);
      }
      if (viewport.mobile && geometry.maxColumnDelta > maxCardHeight * 3) {
        fail(`${viewport.name}: mobile column delta too large (${geometry.maxColumnDelta}px)`);
      }
      if (!viewport.mobile && entrance < geometry.mediaStates.revealed) {
        fail(`${viewport.name}: media entrance marker on ${entrance} of ${geometry.mediaStates.revealed} revealed cards`);
      }
      if (entranceEvents.total < 1) {
        fail(`${viewport.name}: no natural ph-media-enter animationstart event (total=${entranceEvents.total})`);
      }
      const repeated = Object.values(entranceEvents.perKey).filter((count) => count > 1);
      if (repeated.length) {
        const repeatKeys = Object.entries(entranceEvents.perKey).filter(([, count]) => count > 1).map(([key]) => key);
        const repeatDetail = await page.evaluate((keys) => {
          const out = [];
          for (const key of keys) {
            const cards = [...document.querySelectorAll(`#cardsContainer .card[data-id="${key}"]`)];
            out.push({
              key,
              cardsInDom: cards.length,
              mediaStates: cards.map((c) => {
                const media = c.querySelector('.card-media');
                const img = c.querySelector('img');
                return {
                  className: media?.className || '',
                  phEntered: media?.dataset?.phMediaEntered || '',
                  revealKey: media?.dataset?.mediaRevealKey || '',
                  src: img ? (img.currentSrc || img.src || '') : '',
                  complete: img?.complete ?? null,
                  naturalWidth: img?.naturalWidth ?? null
                };
              })
            });
          }
          return out;
        }, repeatKeys);
        fail(`${viewport.name}: media entrance replayed: ${JSON.stringify(repeatDetail)}`);
      }
      if (entranceAnimation !== 'ph-media-enter') {
        fail(`${viewport.name}: ph-media-enter animation not bound (computed=${entranceAnimation})`);
      }
      if (viewport.mobile && geometry.decoded < 6) fail(`${viewport.name}: too few decoded media on mobile`);
      if (!viewport.mobile && geometry.decoded < 16) fail(`${viewport.name}: too few decoded media on desktop`);
      const clsLimit = viewport.mobile ? 0.3 : 0.15;
      if (cls > clsLimit) fail(`${viewport.name}: layout shift CLS=${cls.toFixed(4)} > ${clsLimit}`);
      if (longTasks.some((duration) => duration > 500)) {
        fail(`${viewport.name}: long tasks over 500ms: ${longTasks.join(',')}`);
      }
    } finally {
      if (tracePath) {
        try { await context.tracing.stop({ path: tracePath }); } catch (e) { /* ignore */ }
      }
      try { await context.close(); } catch (e) { /* ignore */ }
      openContexts.delete(context);
    }
  }

  // reduced-motion：入场动画必须被禁用（立即显示最终态），自然 animationstart
  // 事件数必须为 0；computed animationName 只是辅助证据。
  {
    const viewport = viewports[0];
    const { context, page } = await openFixture(browser, viewport, { reducedMotion: true });
    openContexts.add(context);
    try {
      const entrance = await page.evaluate(() => [...document.querySelectorAll('#cardsContainer .card-media[data-ph-media-entered="1"]')].length);
      const entranceEvents = await page.evaluate(() => ({
        total: window.__phMediaEnterTotal || 0,
        perKey: window.__phMediaEnterEvents || {}
      }));
      const animated = await page.evaluate(() => {
        const medias = [...document.querySelectorAll('#cardsContainer .card-media[data-ph-media-entered="1"]')].slice(0, 20);
        return medias.map((m) => {
          m.classList.add('ph-media-enter');
          const name = getComputedStyle(m).animationName || 'none';
          m.classList.remove('ph-media-enter');
          return name;
        });
      });
      evidence.reducedMotion = {
        entranceCount: entrance,
        entranceEventsTotal: entranceEvents.total,
        computedAnimationNames: animated.slice(0, 5)
      };
      if (entranceEvents.total !== 0) {
        fail(`reduced-motion: natural ph-media-enter events = ${entranceEvents.total} (expected 0)`);
      }
      if (animated.some((name) => name.includes('ph-media-enter'))) {
        fail(`reduced-motion: computed animation still ph-media-enter: ${animated.filter((n) => n.includes('ph-media-enter')).slice(0, 3).join(',')}`);
      }
    } finally {
      try { await context.close(); } catch (e) { /* ignore */ }
      openContexts.delete(context);
    }
  }

  // 模型目录公开真源：canonical id、退役清理、stale LKG 与合法 fallback
  {
    const viewport = viewports[0];
    const { context, page } = await openFixture(browser, viewport);
    openContexts.add(context);
    try {
      await page.evaluate(() => {
        window.__PROMPT_HUB_AUTH_RESOLVED__ = true;
        const pageEl = document.getElementById('pageImageGen');
        if (pageEl) pageEl.classList.add('active');
        window.FeatureDraft?.onAppChange?.('imagegen');
      });
      await page.waitForFunction(() => {
        const sel = document.getElementById('imageGenModel');
        return sel && sel.options.length > 1;
      }, null, { timeout: 20000 }).catch(() => {});
      const picker = await page.evaluate(() => {
        const sel = document.getElementById('imageGenModel');
        const catalog = window.__IMAGE_GEN_MODELS__ || [];
        const options = sel ? [...sel.options].map((o) => o.value) : [];
        const label = document.getElementById('imageGenModelTriggerLabel')?.textContent?.trim() || '';
        return {
          catalogIds: catalog.map((m) => m.id),
          options,
          value: sel?.value || '',
          label,
          stale: window.__IMAGE_GEN_CATALOG_STALE__ === true
        };
      });
      evidence.catalogPicker = picker;
      const banned = picker.catalogIds.filter((id) => id === 'image2-free' || id === 'mj-v61');
      if (banned.length) fail(`catalog leaks retired ids: ${banned.join(',')}`);
      if (picker.catalogIds.length < 5) fail('catalog too small (expected the reviewed public LKG)');
      if (picker.value && !picker.options.includes(picker.value)) {
        fail(`select value ${picker.value} has no matching option`);
      }
      if (picker.options.length > 0 && picker.label === '选择模型' && !picker.value) {
        fail('picker shows 选择模型 while options exist');
      }
      if (!picker.value && picker.options.length > 1) {
        fail('select is empty while canonical options exist');
      }

      // 选择持久性：目录刷新后保持已选 canonical id。
      const persistence = await page.evaluate(async () => {
        const sel = document.getElementById('imageGenModel');
        const result = { before: '', afterRefresh: '', note: '' };
        if (!sel) return result;
        const option = sel.querySelector('option[value="image2-pro"]');
        if (!option) {
          result.note = 'image2-pro not in options';
          return result;
        }
        sel.value = 'image2-pro';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        result.before = sel.value;
        await window.FeatureDraft?.refreshImageGenModelCatalog?.({ force: true }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 400));
        result.afterRefresh = sel.value;
        return result;
      });
      evidence.selectionPersistence = persistence;
      if (persistence.afterRefresh && persistence.afterRefresh !== 'image2-pro') {
        fail(`selection not preserved across catalog refresh: ${persistence.afterRefresh}`);
      }
    } finally {
      try { await context.close(); } catch (e) { /* ignore */ }
      openContexts.delete(context);
    }
  }
} finally {
  for (const context of openContexts) {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
  openContexts.clear();
  if (browser) {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch (e) {
      resolve();
    }
  });
}

if (evidenceFile) {
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
}
console.log('verify-media-ux-browser OK', JSON.stringify(evidence));
