import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5581);
const base = `http://127.0.0.1:${port}`;

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
    .imagegen-feed-card { width: 220px; }
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
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
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
  console.log('verify-imagegen-card-actions-layout OK: 1x2 actions hidden in preview mode');
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
