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
const port = Number(process.env.PORT || 5581);
const base = `http://127.0.0.1:${port}`;
const screenshotPath = join(tmpdir(), 'prompt-hub-imagegen-grid-single-card.png');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const fixture = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/styles-features.css">
  <style>
    body { margin: 0; background: #101115; color: #fff; }
    #pageImageGen { width: 980px; padding: 24px; }
    .imagegen-side { width: 980px; }
  </style>
</head>
<body>
  <div id="pageImageGen" class="app-page app-page-feature active">
    <div class="imagegen-side">
      <div id="imageGenFeed" class="imagegen-feed imagegen-feed--desktop-grid">
        <article class="imagegen-feed-card imagegen-feed-card-tile" tabindex="0">
          <button type="button" class="imagegen-feed-del imagegen-feed-card-del" data-delete-feed="1" title="删除" aria-label="删除">×</button>
          <div class="imagegen-feed-media">
            <button type="button" class="imagegen-feed-thumb-btn" title="放大预览">
              <img class="card-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='%23475569'/%3E%3C/svg%3E" alt="">
            </button>
          </div>
          <div class="imagegen-feed-content">
            <p class="imagegen-feed-prompt">测试图片生成卡片按钮布局</p>
            <div class="imagegen-feed-action-stack">
              <div class="imagegen-feed-quick-actions imagegen-feed-action-grid" aria-label="生图快捷操作">
                <button type="button" class="imagegen-feed-quick-btn imagegen-feed-quick-btn--primary" data-feed-fill-gen>填入生图</button>
                <button type="button" class="imagegen-feed-quick-btn imagegen-feed-save-btn" data-save-feed="1">存入库</button>
              </div>
            </div>
          </div>
        </article>
      </div>
      <aside class="imagegen-preview-panel hidden"></aside>
    </div>
  </div>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/' || url.pathname === '/__imagegen-actions.html') {
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
    const ext = extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(500);
    res.end(String(err?.stack || err));
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || process.argv[3] || undefined
});

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 820 } });
  await page.goto(`${base}/__imagegen-actions.html`, { waitUntil: 'networkidle' });
  const layout = await page.locator('.imagegen-feed-action-grid').evaluate((grid) => {
    const style = getComputedStyle(grid);
    const items = Array.from(grid.children).map((el) => {
      const rect = el.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    return { display: style.display, columns: style.gridTemplateColumns, items };
  });
  const feedLayout = await page.locator('#imageGenFeed').evaluate((feed) => {
    const card = feed.querySelector('.imagegen-feed-card');
    const feedStyle = getComputedStyle(feed);
    const cardRect = card?.getBoundingClientRect();
    return {
      display: feedStyle.display,
      columns: feedStyle.gridTemplateColumns,
      feedWidth: feed.getBoundingClientRect().width,
      cardWidth: cardRect?.width || 0
    };
  });
  if (feedLayout.display !== 'grid') throw new Error(`expected desktop feed grid, got ${JSON.stringify(feedLayout)}`);
  if (feedLayout.cardWidth <= 180 || feedLayout.cardWidth > 340) {
    throw new Error(`single feed card must stay column-sized, got ${JSON.stringify(feedLayout)}`);
  }
  if (layout.display !== 'grid') throw new Error(`expected grid display, got ${layout.display}`);
  if (layout.items.length !== 2) throw new Error(`expected 2 action buttons, got ${layout.items.length}`);
  const legacyActions = await page.locator('[data-feed-fill-prompt], [data-feed-fill-ref], [data-feed-regenerate]').count();
  if (legacyActions !== 0) throw new Error(`expected legacy split actions to be absent, got ${legacyActions}`);
  const rows = new Map();
  for (const item of layout.items) {
    rows.set(item.top, (rows.get(item.top) || 0) + 1);
    if (item.width < 80 || item.height < 28) throw new Error(`action button too small: ${JSON.stringify(item)}`);
  }
  if (rows.size !== 1 || [...rows.values()][0] !== 2) {
    throw new Error(`expected 1x2 action layout, got ${JSON.stringify(layout.items)}`);
  }
  await page.locator('.imagegen-side').evaluate((el) => el.classList.add('imagegen-preview-open'));
  const hidden = await page.evaluate(() => {
    const stack = document.querySelector('.imagegen-feed-action-stack');
    const del = document.querySelector('.imagegen-feed-card-del');
    return {
      stack: getComputedStyle(stack).display,
      del: getComputedStyle(del).display
    };
  });
  if (hidden.stack !== 'none' || hidden.del !== 'none') {
    throw new Error(`expected actions hidden while preview is open, got ${JSON.stringify(hidden)}`);
  }
  await page.locator('.imagegen-side').evaluate((el) => el.classList.remove('imagegen-preview-open'));
  const multiLayout = await page.locator('#imageGenFeed').evaluate(async (feed) => {
    const first = feed.querySelector('.imagegen-feed-card');
    for (let i = 1; i < 6; i += 1) {
      const clone = first.cloneNode(true);
      clone.dataset.feedId = `fixture-${i}`;
      feed.appendChild(clone);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rects = [...feed.querySelectorAll('.imagegen-feed-card')].map((card) => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        bottom: Math.round(rect.bottom),
        offsetHeight: card.offsetHeight,
        offsetTop: card.offsetTop,
        transform: style.transform,
        zoom: style.zoom
      };
    });
    const rowTops = [...new Set(rects.map((rect) => rect.top))].sort((a, b) => a - b);
    const firstRow = rects.filter((rect) => rect.top === rowTops[0]);
    return {
      rects,
      columns: [...new Set(rects.map((rect) => rect.left))].length,
      rows: rowTops.length,
      rowGap: rowTops.length > 1 ? rowTops[1] - Math.max(...firstRow.map((rect) => rect.bottom)) : null,
      computedRowGap: getComputedStyle(feed).rowGap,
      gridTemplateRows: getComputedStyle(feed).gridTemplateRows
    };
  });
  if (multiLayout.columns !== 3 || multiLayout.rows !== 2 || multiLayout.rowGap < 8) {
    throw new Error(`expected a filled 3x2 desktop feed, got ${JSON.stringify(multiLayout)}`);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ok: true, feedLayout, multiLayout, screenshotPath }));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
