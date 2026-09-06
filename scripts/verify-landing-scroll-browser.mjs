// Verify the landing page scrolls through all narrative sections on desktop
// and mobile viewports. Run with: node scripts/verify-landing-scroll-browser.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright-core';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(process.env.APP_ROOT || join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5599);
const base = `http://127.0.0.1:${port}`;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = join(root, pathname.replace(/^\/+/, ''));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath });
const failures = [];

async function checkViewport(name, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Desktop uses the fixed self-scrolling .landing-shell; mobile falls back to
  // the page scroller (.app-page-landing) because the shell is a plain
  // document-flow column there.
  const scrollerInfo = await page.evaluate(() => {
    const shell = document.querySelector('.landing-shell');
    const pageEl = document.getElementById('pageLanding');
    const style = getComputedStyle(shell);
    const fixed = style.position === 'fixed';
    const el = fixed ? shell : pageEl;
    return {
      mode: fixed ? 'shell' : 'page',
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight
    };
  });
  if (scrollerInfo.scrollHeight <= scrollerInfo.clientHeight + 200) {
    failures.push(`${name}: landing is not scrollable (${JSON.stringify(scrollerInfo)})`);
  }

  // Scroll like a real user: mouse wheel on desktop, direct scroller delta on
  // mobile (the headless context has no touch, and the shell is the single
  // unified scroller on both form factors).
  if (width > 900) {
    await page.mouse.move(Math.round(width / 2), Math.round(height / 2));
    await page.mouse.wheel(0, 1200);
  } else {
    await page.evaluate(() => {
      document.querySelector('.landing-shell').scrollTop = 1200;
    });
  }
  await page.waitForTimeout(700);
  const afterWheel = await page.evaluate((mode) => {
    const el = mode === 'shell' ? document.querySelector('.landing-shell') : document.getElementById('pageLanding');
    return el.scrollTop;
  }, scrollerInfo.mode);
  if (afterWheel < 400) {
    failures.push(`${name}: user scroll did not move the ${scrollerInfo.mode} scroller (scrollTop=${afterWheel})`);
  }

  // Every narrative section must be reachable inside the active scroller and
  // end up within the viewport after scrolling to it.
  const sections = ['#landingFlowTitle', '#landingPillarsTitle', '#landingCtaTitle', '.landing-footer'];
  for (const selector of sections) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const state = await page.evaluate((sel) => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        viewport: window.innerHeight,
        height: Math.round(rect.height)
      };
    }, selector);
    const inView = state.bottom > 0 && state.top < state.viewport && state.height > 10;
    if (!inView) failures.push(`${name}: ${selector} not reachable in view (${JSON.stringify(state)})`);
  }

  const bottom = await page.evaluate((mode) => {
    const el = mode === 'shell' ? document.querySelector('.landing-shell') : document.getElementById('pageLanding');
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  }, scrollerInfo.mode);
  if (bottom < 400) failures.push(`${name}: cannot scroll to bottom (scrollTop=${bottom})`);

  await page.screenshot({ path: join(root, 'debug-landing-scroll-' + name + '.png') });
  await page.close();
  return { name, scroller: scrollerInfo, afterWheel, bottom };
}

const results = [];
results.push(await checkViewport('desktop', 1600, 1000));
results.push(await checkViewport('mobile', 390, 844));

await browser.close();
server.close();

for (const r of results) {
  console.log(`landing-scroll ${r.name}: shell=${r.scroller.clientHeight}/${r.scroller.scrollHeight} wheel->${r.afterWheel} bottom->${r.bottom}`);
}
if (failures.length) {
  console.error('verify-landing-scroll FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('verify-landing-scroll OK');
