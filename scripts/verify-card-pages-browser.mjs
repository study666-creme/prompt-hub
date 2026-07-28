import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const router = read('app-router.js');
const mobile = read('mobile.js');
const cardCss = read('styles/base/part-04.css');
const mobileCss = read('styles-mobile.css');
const cardRuntime = read('legacy/script/part-09.js');
const cardEvents = read('legacy/script/part-10.js');

for (const token of [
  'class="card-canvas-btn"',
  'data-card-canvas="${escapeHtml(card.id)}"',
  '>\u5230\u753b\u5e03</button>',
  'div.draggable = !globalViewActive && !mobileGrid',
  "label: '\u63d2\u5165\u65e0\u9650\u753b\u5e03'"
]) {
  assert.ok(cardRuntime.includes(token), `missing card runtime contract: ${token}`);
}
assert.ok(cardEvents.includes("closest('[data-card-canvas]')"), 'missing delegated Canvas action');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/card.css"><link rel="stylesheet" href="/mobile.css">
<style>
  html, body { margin: 0; }
  .app-main { height: 320px; overflow-y: auto; }
  .card { position: relative; width: 260px; min-height: 140px; }
  .scroll-spacer { height: 1200px; }
</style></head><body>
<div class="app-chrome">
  <button class="app-nav-item" data-app="warehouse">Cards</button>
  <button class="app-nav-item active" data-app="community">Community</button>
</div>
<div id="userProfileOverlay"></div>
<main class="app-main" style="pointer-events:none">
  <section class="app-page" id="pageWarehouse">
    <div id="cardsContainer" class="cards-container mobile-grid">
      <article class="card" data-id="card-42" draggable="false">
        <button type="button" class="card-canvas-btn" data-card-canvas="card-42"
          onclick="openPromptCanvasCard(this.dataset.cardCanvas)" aria-label="Open in Canvas">C</button>
        <button type="button" class="card-copy-btn" aria-label="Copy">X</button>
        <div class="card-mobile-actions">
          <button type="button" class="card-mobile-btn">Edit</button>
          <button type="button" class="card-mobile-btn">Copy</button>
          <button type="button" class="card-mobile-btn">Generate</button>
          <button type="button" class="card-mobile-btn" data-card-canvas="card-42"
            onclick="openPromptCanvasCard(this.dataset.cardCanvas)">Canvas</button>
        </div>
      </article>
    </div>
    <div class="scroll-spacer"></div>
  </section>
  <section class="app-page active" id="pageCommunity"></section>
  <section class="app-page" id="pageImageGen"></section>
  <section class="app-page" id="pageCreations"></section>
  <section class="app-page" id="pageDevLab"></section>
</main>
<script>
  if (matchMedia('(max-width: 900px)').matches) {
    document.body.classList.add('app-modal-open', 'user-profile-open');
  } else {
    document.querySelector('.app-main').style.removeProperty('pointer-events');
  }
</script>
<script src="/app-router.js"></script><script src="/mobile.js"></script>
</body></html>`;

const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const assets = {
    '/app-router.js': ['application/javascript', router],
    '/mobile.js': ['application/javascript', mobile],
    '/card.css': ['text/css', cardCss],
    '/mobile.css': ['text/css', mobileCss]
  };
  const asset = assets[path];
  response.writeHead(200, { 'content-type': asset?.[0] || 'text/html; charset=utf-8' });
  response.end(asset?.[1] || html);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const packageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const importTarget = packageDir ? pathToFileURL(join(packageDir, 'index.js')).href : 'playwright';
const playwright = await import(importTarget);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

let browser;
try {
  browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.addInitScript(() => {
    window.__opened = [];
    window.open = (...args) => { window.__opened.push(args); return null; };
  });
  await desktop.goto(`${baseUrl}/prompts/`, { waitUntil: 'load' });
  assert.equal(await desktop.locator('#pageWarehouse').evaluate((node) => node.classList.contains('active')), true);
  const desktopButton = desktop.locator('.card-canvas-btn');
  const desktopStyle = await desktopButton.evaluate((node) => {
    const style = getComputedStyle(node);
    return { width: style.width, height: style.height, right: style.right };
  });
  assert.deepEqual(desktopStyle, { width: '28px', height: '28px', right: '44px' });
  await desktop.locator('.card').hover();
  await desktopButton.click();
  const desktopOpen = await desktop.evaluate(() => window.__opened.at(-1));
  assert.equal(new URL(desktopOpen[0]).searchParams.get('phCardId'), 'card-42');
  assert.deepEqual(desktopOpen.slice(1), ['_blank', 'noopener,noreferrer']);
  await desktop.close();

  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  await mobilePage.addInitScript(() => {
    window.__opened = [];
    window.open = (...args) => { window.__opened.push(args); return null; };
  });
  await mobilePage.goto(`${baseUrl}/prompts/`, { waitUntil: 'load' });
  await mobilePage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const mobileState = await mobilePage.evaluate(() => {
    const main = document.querySelector('.app-main');
    const card = document.querySelector('.card');
    const profile = document.querySelector('#userProfileOverlay');
    main.scrollTop = 240;
    return {
      active: document.querySelector('#pageWarehouse').classList.contains('active'),
      bodyLocked: document.body.classList.contains('app-modal-open')
        || document.body.classList.contains('user-profile-open'),
      mainPointerEvents: main.style.pointerEvents,
      mainTouchAction: getComputedStyle(main).touchAction,
      cardTouchAction: getComputedStyle(card).touchAction,
      draggable: card.draggable,
      profileHidden: profile.hidden,
      profilePointerEvents: profile.style.pointerEvents,
      actionCount: card.querySelectorAll('.card-mobile-btn').length,
      scrollTop: main.scrollTop
    };
  });
  assert.deepEqual(mobileState, {
    active: true,
    bodyLocked: false,
    mainPointerEvents: '',
    mainTouchAction: 'pan-y',
    cardTouchAction: 'pan-y',
    draggable: false,
    profileHidden: true,
    profilePointerEvents: 'none',
    actionCount: 4,
    scrollTop: 240
  });
  await mobilePage.locator('.card-mobile-btn[data-card-canvas]').click();
  assert.equal(await mobilePage.evaluate(() => window.__opened.length), 1);
  await mobilePage.close();
  console.log('verify-card-pages-browser OK');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
