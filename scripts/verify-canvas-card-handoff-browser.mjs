import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const playwrightPackageDir = String(process.env.PLAYWRIGHT_PACKAGE_DIR || '').trim();
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright-core';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH
  || (existsSync(edge) ? edge : undefined);
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fixture = `<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8"></head><body>
      <button id="handoff" type="button">到画布</button>
      <div class="card-mobile-actions" style="width:180px">
        <button class="card-mobile-btn">编辑</button>
        <button class="card-mobile-btn">复制</button>
        <button class="card-mobile-btn">填入生图</button>
        <button class="card-mobile-btn">到画布</button>
      </div>
    </body></html>`;
  await page.route('http://canvas-bridge.test/', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixture
  }));
  await page.goto('http://canvas-bridge.test/', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ path: join(root, 'styles-mobile.css') });
  await page.addScriptTag({ path: join(root, 'app-router.js') });
  await page.evaluate(() => {
    window.PROMPT_CANVAS_URL = 'https://canvas.prompt-hubs.com/canvas?keep=1';
    window.__canvasOpened = [];
    window.open = (url, target, features) => {
      window.__canvasOpened.push({ url, target, features });
      return { closed: false };
    };
    document.getElementById('handoff').addEventListener('click', () => {
      window.openPromptCanvasCard('card_browser_123');
    });
  });

  await page.locator('#handoff').click();
  const result = await page.evaluate(() => ({
    opened: window.__canvasOpened,
    refreshPending: window.PromptCanvasBridge.shouldRefreshAfterCanvas()
  }));
  assert.equal(result.opened.length, 1);
  const url = new URL(result.opened[0].url);
  assert.equal(url.origin, 'https://canvas.prompt-hubs.com');
  assert.equal(url.pathname, '/canvas');
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.searchParams.get('phSource'), 'prompt-hub');
  assert.equal(url.searchParams.get('phVersion'), '1');
  assert.equal(url.searchParams.get('phIntent'), 'insert-card');
  assert.equal(url.searchParams.get('phCardId'), 'card_browser_123');
  assert.equal(result.opened[0].target, '_blank');
  assert.equal(result.opened[0].features, 'noopener,noreferrer');
  assert.equal(result.refreshPending, true);

  const layout = await page.locator('.card-mobile-actions').evaluate((container) => {
    const parent = container.getBoundingClientRect();
    const buttons = [...container.querySelectorAll('.card-mobile-btn')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        textFits: button.scrollWidth <= button.clientWidth
      };
    });
    return { parent: { left: parent.left, right: parent.right }, buttons };
  });
  assert.equal(layout.buttons.length, 4);
  assert.equal(new Set(layout.buttons.map((button) => Math.round(button.top))).size, 2);
  for (const button of layout.buttons) {
    assert(button.left >= layout.parent.left - 0.5 && button.right <= layout.parent.right + 0.5);
    assert.equal(button.textFits, true);
  }
  for (let i = 0; i < layout.buttons.length; i += 1) {
    for (let j = i + 1; j < layout.buttons.length; j += 1) {
      const a = layout.buttons[i];
      const b = layout.buttons[j];
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      assert.equal(overlaps, false);
    }
  }

  console.log('verify-canvas-card-handoff-browser OK');
} finally {
  await browser.close();
}
