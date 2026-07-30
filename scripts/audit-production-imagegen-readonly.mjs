import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const site = 'https://prompt-hubs.com';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedBuild = /window\.__APP_BUILD__\s*=\s*['"]([^'"]+)['"]/.exec(
  readFileSync(join(root, 'index.html'), 'utf8')
)?.[1];
if (!expectedBuild) throw new Error('Unable to read the expected production build from index.html');
const packageDir = String(process.env.PLAYWRIGHT_PACKAGE_DIR || '').trim();
const playwright = await import(packageDir ? pathToFileURL(join(packageDir, 'index.js')).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  await page.route('**/*', route => (
    route.request().method() === 'GET' ? route.continue() : route.abort()
  ));
  page.on('requestfailed', request => failedRequests.push({
    method: request.method(),
    resourceType: request.resourceType(),
    url: request.url(),
    error: request.failure()?.errorText || ''
  }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${site}/generate/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => (
    document.getElementById('pageImageGen')?.classList.contains('active')
    && document.getElementById('imageGenModel')?.disabled === false
    && window.__IMAGE_GEN_CATALOG_READY__ === true
    && window.__IMAGE_GEN_CATALOG_SOURCE__ === 'api'
    && Array.isArray(window.__IMAGE_GEN_MODELS__)
    && window.__IMAGE_GEN_MODELS__.length >= 12
    && !window.__IMAGE_GEN_MODELS__.some(model => model?.id === 'image2-free')
  ), null, { timeout: 45_000 });

  const allModelIds = new Set();
  const familyTabs = page.locator('#imageGenModelFamilyTabs [data-family]');
  const familyCount = await familyTabs.count();
  for (let index = 0; index < familyCount; index += 1) {
    const tab = familyTabs.nth(index);
    await tab.click();
    await page.waitForFunction(family => (
      document.querySelector(`#imageGenModelFamilyTabs [data-family="${CSS.escape(family)}"]`)?.classList.contains('active')
      && document.querySelectorAll('#imageGenModel option').length > 0
    ), await tab.getAttribute('data-family'));
    for (const modelId of await page.locator('#imageGenModel option').evaluateAll(options => options.map(option => option.value))) {
      if (modelId) allModelIds.add(modelId);
    }
  }
  await familyTabs.first().click();

  const trigger = page.locator('#imageGenModelTrigger');
  await trigger.click();
  await page.locator('#imageGenModelMenu:not([hidden])').waitFor({ state: 'visible' });
  const screenshotPath = join(tmpdir(), 'prompt-hub-production-imagegen-readonly.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const state = await page.evaluate((catalogModelIds) => {
    const text = value => String(value || '').replace(/\s+/g, ' ').trim();
    const modelSelect = document.getElementById('imageGenModel');
    const quality = document.getElementById('imageGenQuality');
    const publicText = text(document.getElementById('pageImageGen')?.textContent);
    return {
      build: window.__APP_BUILD__ || '',
      lang: document.documentElement.lang,
      activePage: document.querySelector('.app-page.active')?.id || '',
      header: text(document.querySelector('#pageImageGen .imagegen-header-title')?.textContent),
      nav: [...document.querySelectorAll('.app-nav-label')].map(node => text(node.textContent)),
      familyCount: document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').length,
      catalogModelIds,
      totalModelCount: catalogModelIds.length,
      modelCount: modelSelect?.options.length || 0,
      customOptionCount: document.querySelectorAll('#imageGenModelMenu [data-model-id]').length,
      customExpanded: document.getElementById('imageGenModelTrigger')?.getAttribute('aria-expanded'),
      customMenuHidden: document.getElementById('imageGenModelMenu')?.hidden,
      nativeSelectClass: modelSelect?.className || '',
      qualities: [...(quality?.options || [])].map(option => option.value),
      privateTextPresent: /(?:upstream|provider|reseller|channel|route|apimart|grsai|thinkai|mooko|上游|渠道|线路|采购|成本)/i.test(publicText),
      englishShellPresent: /\b(?:Model Marketplace|Card Library|Image Generation|Settings|Recharge)\b/i.test(publicText)
    };
  }, [...allModelIds]);

  if (
    state.build !== expectedBuild
    || state.lang !== 'zh-CN'
    || state.activePage !== 'pageImageGen'
    || state.header !== '图片生成'
    || state.totalModelCount < 12
    || !['lingtu-fast', 'lingtu-lite', 'image2-economy', 'image2', 'image2-4k-fast', 'lingtu'].every(id => state.catalogModelIds.includes(id))
    || state.catalogModelIds.includes('image2-free')
    || state.modelCount < 1
    || state.customOptionCount !== state.modelCount
    || state.customExpanded !== 'true'
    || state.customMenuHidden !== false
    || !state.nativeSelectClass.includes('imagegen-model-native-select')
    || JSON.stringify(state.qualities) !== JSON.stringify(['low', 'medium', 'high'])
    || state.privateTextPresent
    || state.englishShellPresent
  ) {
    throw new Error(`Production image generation UI audit failed: ${JSON.stringify(state)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    ...state,
    screenshotPath,
    consoleErrors: errors.length,
    consoleErrorMessages: errors,
    failedRequests
  }));
  await context.close();
} finally {
  await browser.close();
}
