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
const port = Number(process.env.PORT || 5591);
const base = `http://127.0.0.1:${port}`;
const mime = { '.css': 'text/css; charset=utf-8' };
const featureSource = await readFile(join(root, 'legacy/features-draft/part-11.js'), 'utf8');
const binderStart = featureSource.indexOf('  function bindImageGenMjRange(');
const binderEnd = featureSource.indexOf('  function getImageGenMjParams(', binderStart);
if (binderStart < 0 || binderEnd < 0) throw new Error('bindImageGenMjRange source is unavailable');
const mjRangeBinderSource = featureSource.slice(binderStart, binderEnd);

const rangeCss = await readFile(join(root, 'styles/features/part-04.css'), 'utf8');
for (const selector of [
  '::-webkit-slider-runnable-track',
  '::-webkit-slider-thumb',
  '::-moz-range-track',
  '::-moz-range-progress',
  '::-moz-range-thumb'
]) {
  if (!rangeCss.includes(selector)) throw new Error(`MJ range CSS is missing ${selector}`);
}

const fixture = `<!doctype html>
<html data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/styles-theme.css">
  <link rel="stylesheet" href="/styles-settings.css">
  <link rel="stylesheet" href="/styles-features.css">
  <style>
    body { margin: 0; padding: 40px; }
    .imagegen-mj-params { width: 300px; }
  </style>
</head>
<body>
  <div class="imagegen-mj-params">
    <input type="range" id="imageGenMjStylize" class="settings-input imagegen-field-compact"
      aria-label="风格化" min="0" max="1000" step="10" value="100">
    <span id="imageGenMjStylizeVal"></span>
  </div>
  <script>
    ${mjRangeBinderSource}
    bindImageGenMjRange('imageGenMjStylize', 'imageGenMjStylizeVal');
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/') {
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.goto(base, { waitUntil: 'networkidle' });

  const range = page.locator('#imageGenMjStylize');
  const style = await range.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      appearance: computed.appearance,
      webkitAppearance: computed.webkitAppearance,
      backgroundColor: computed.backgroundColor,
      borderTopWidth: computed.borderTopWidth,
      boxShadow: computed.boxShadow,
      cursor: computed.cursor,
      height: parseFloat(computed.height),
      touchAction: computed.touchAction,
      progress: computed.getPropertyValue('--imagegen-mj-range-progress').trim()
    };
  });

  if (style.appearance !== 'none' && style.webkitAppearance !== 'none') {
    throw new Error(`MJ range still uses native appearance: ${JSON.stringify(style)}`);
  }
  if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderTopWidth !== '0px') {
    throw new Error(`generic input chrome leaked into MJ range: ${JSON.stringify(style)}`);
  }
  if (style.boxShadow !== 'none' || style.cursor !== 'pointer' || style.height < 32) {
    throw new Error(`MJ range hit target or interaction style regressed: ${JSON.stringify(style)}`);
  }
  if (style.touchAction !== 'pan-y') {
    throw new Error(`MJ range touch action regressed: ${JSON.stringify(style)}`);
  }
  if (style.progress !== '10%') {
    throw new Error(`MJ range initial progress regressed: ${JSON.stringify(style)}`);
  }

  await range.focus();
  await page.keyboard.press('ArrowRight');
  const keyboardValue = Number(await range.inputValue());
  if (keyboardValue !== 110) throw new Error(`keyboard range input failed: ${keyboardValue}`);

  const box = await range.boundingBox();
  if (!box) throw new Error('MJ range has no layout box');
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  const pointerValue = Number(await range.inputValue());
  if (pointerValue < 700) throw new Error(`pointer range input failed: ${pointerValue}`);

  await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
  const touchValue = Number(await range.inputValue());
  if (touchValue > 300) throw new Error(`touch range input failed: ${touchValue}`);
  const touchProgress = parseFloat(await range.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--imagegen-mj-range-progress')
  )));
  if (Math.abs(touchProgress - touchValue / 10) > 0.01) {
    throw new Error(`MJ range fill did not follow value: value=${touchValue} progress=${touchProgress}`);
  }

  const screenshotPath = join(tmpdir(), 'prompt-hub-mj-range-style.png');
  await page.screenshot({ path: screenshotPath });
  console.log('verify-mj-range-style-browser OK:', {
    style,
    keyboardValue,
    pointerValue,
    touchValue,
    touchProgress,
    screenshotPath
  });
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
