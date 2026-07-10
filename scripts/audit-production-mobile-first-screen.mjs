import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const email = process.env.PH_TEST_EMAIL || '';
const password = process.env.PH_TEST_PASSWORD || '';
const base = String(process.env.PH_BASE_URL || 'https://prompt-hubs.com').replace(/\/$/, '');
if (!email || !password) {
  throw new Error('Set PH_TEST_EMAIL and PH_TEST_PASSWORD before running this audit');
}

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

let activePhase = '';
const phases = new Map();
const requests = new Map();

function phaseMetrics(name) {
  if (!phases.has(name)) {
    phases.set(name, { requests: [], bytes: 0, bytesByType: {}, countByType: {} });
  }
  return phases.get(name);
}

function classifyUrl(url) {
  if (/\/media\/sign-batch(?:\?|$)/.test(url)) return 'signBatch';
  if (/\/media\/sign(?:\?|$)/.test(url)) return 'signOne';
  if (/\/rest\/v1\/user_data(?:\?|$)/.test(url)) return 'userData';
  if (/\/legacy\/(?:script|features-draft|supabase-sync)\/part-\d+\.js/.test(url)) return 'runtimePart';
  if (/\/styles\/(?:base|features)\/part-\d+\.css/.test(url)) return 'runtimePart';
  if (/\/partials\/index-body\/part-\d+\.html/.test(url)) return 'runtimePart';
  return '';
}

function summarize(name) {
  const metric = phaseMetrics(name);
  const urlClasses = {};
  for (const request of metric.requests) {
    const key = classifyUrl(request.url);
    if (key) urlClasses[key] = (urlClasses[key] || 0) + 1;
  }
  return {
    requestCount: metric.requests.length,
    encodedBytes: Math.round(metric.bytes),
    encodedMiB: Number((metric.bytes / 1024 / 1024).toFixed(2)),
    countByType: metric.countByType,
    bytesByType: Object.fromEntries(
      Object.entries(metric.bytesByType).map(([key, value]) => [key, Math.round(value)])
    ),
    urlClasses
  };
}

async function pageSnapshot(page, gridSelector) {
  return page.evaluate((selector) => {
    const grid = document.querySelector(selector);
    const cards = [...(grid?.querySelectorAll('.card[data-id], .card[data-post-id]') || [])];
    const images = [...(grid?.querySelectorAll('img') || [])];
    const loadedImages = images.filter((img) => img.complete && img.naturalWidth > 8);
    const splitRuntimeResources = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => (
        /\/legacy\/(?:script|features-draft|supabase-sync)\/part-\d+\.js/i.test(name)
        || /\/styles\/(?:base|features)\/part-\d+\.css/i.test(name)
        || /\/partials\/index-body\/part-\d+\.html/i.test(name)
      ));
    return {
      href: location.href,
      build: window.__APP_BUILD__ || '',
      activePage: document.querySelector('.app-page.active')?.id || '',
      cards: cards.length,
      images: images.length,
      loadedImages: loadedImages.length,
      resourceEntries: performance.getEntriesByType('resource').length,
      splitRuntimeRequests: splitRuntimeResources.length
    };
  }, gridSelector);
}

async function auditPage(page, name, path, activePageId, gridSelector, minCards) {
  activePhase = name;
  phaseMetrics(name);
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForFunction(({ pageId, selector, minimum }) => {
      return document.getElementById(pageId)?.classList.contains('active')
        && document.querySelectorAll(`${selector} .card[data-id], ${selector} .card[data-post-id]`).length >= minimum;
    }, { pageId: activePageId, selector: gridSelector, minimum: minCards }, { timeout: 45000 });
  } catch (error) {
    const diagnostics = await page.evaluate(({ pageId, selector }) => ({
      href: location.href,
      build: window.__APP_BUILD__ || '',
      activePage: document.querySelector('.app-page.active')?.id || '',
      expectedPageActive: document.getElementById(pageId)?.classList.contains('active') || false,
      domCards: document.querySelectorAll(`${selector} .card[data-id], ${selector} .card[data-post-id]`).length,
      memoryCards: (window.__promptHubCards || []).length,
      loggedIn: window.SupabaseSync?.isLoggedIn?.() === true,
      cloudPhase: document.body?.dataset?.cloudSyncPhase || '',
      gridHtml: document.querySelector(selector)?.innerHTML?.slice(0, 1000) || ''
    }), { pageId: activePageId, selector: gridSelector });
    throw new Error(`${name} first-screen timeout: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  await page.waitForTimeout(8000);
  const snapshot = await pageSnapshot(page, gridSelector);
  activePhase = '';
  return { ...snapshot, network: summarize(name) };
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  cdp.on('Network.requestWillBeSent', (event) => {
    if (!activePhase) return;
    const type = event.type || 'Other';
    const metric = phaseMetrics(activePhase);
    metric.requests.push({ url: event.request.url, type });
    metric.countByType[type] = (metric.countByType[type] || 0) + 1;
    requests.set(event.requestId, { phase: activePhase, type });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    requests.delete(event.requestId);
    const metric = phaseMetrics(request.phase);
    const bytes = Number(event.encodedDataLength) || 0;
    metric.bytes += bytes;
    metric.bytesByType[request.type] = (metric.bytesByType[request.type] || 0) + bytes;
  });
  cdp.on('Network.loadingFailed', (event) => requests.delete(event.requestId));

  await page.goto(`${base}/prompts/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.openAuthModal === 'function', null, { timeout: 30000 });
  const loggedIn = await page.evaluate(() => window.SupabaseSync?.isLoggedIn?.() === true);
  if (!loggedIn) {
    await page.evaluate(async ({ loginEmail, loginPassword }) => {
      window.openAuthModal('login');
      document.getElementById('authEmail').value = loginEmail;
      document.getElementById('authPassword').value = loginPassword;
      await window.authSubmit();
    }, { loginEmail: email, loginPassword: password });
    await page.waitForFunction(() => window.SupabaseSync?.isLoggedIn?.() === true, null, { timeout: 45000 });
  }
  await page.waitForFunction(() => (window.__promptHubCards || []).length > 0, null, { timeout: 60000 });

  const warehouse = await auditPage(page, 'warehouse', '/prompts/', 'pageWarehouse', '#cardsContainer', 1);

  await page.evaluate(() => localStorage.setItem('promptrepo_app_page', 'warehouse'));
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => location.pathname === '/prompts/', null, { timeout: 30000 });
  const rootRestoredToWarehouse = await page.evaluate(() => (
    location.pathname === '/prompts/'
    && document.getElementById('pageWarehouse')?.classList.contains('active')
  ));

  const community = await auditPage(page, 'community', '/community/', 'pageCommunity', '#communityGrid', 1);
  await page.waitForTimeout(2000);
  const communityIdleCards = await page.locator('#communityGrid .card[data-post-id]').count();

  activePhase = 'communityScroll';
  phaseMetrics('communityScroll');
  await page.evaluate(() => {
    window.__auditFeedAnimations = [];
    const grid = document.getElementById('communityGrid');
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const cards = node.matches?.('.card[data-post-id]')
            ? [node]
            : [...node.querySelectorAll?.('.card[data-post-id]') || []];
          cards.forEach((card) => {
            if (card.classList.contains('feed-card-enter')) {
              window.__auditFeedAnimations.push(getComputedStyle(card).animationName);
            }
          });
        }
      }
    });
    observer.observe(grid, { childList: true, subtree: true });
    const main = document.querySelector('.app-main');
    main.scrollTop = main.scrollHeight;
    main.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction((before) => {
    return document.querySelectorAll('#communityGrid .card[data-post-id]').length > before;
  }, communityIdleCards, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const communityAfterScroll = await pageSnapshot(page, '#communityGrid');
  const animationNames = await page.evaluate(() => window.__auditFeedAnimations || []);
  activePhase = '';

  const result = {
    rootRestoredToWarehouse,
    warehouse,
    community: {
      ...community,
      idleCardsAfterTwoSeconds: communityIdleCards,
      afterOneScroll: communityAfterScroll,
      appendAnimations: animationNames,
      scrollNetwork: summarize('communityScroll')
    }
  };

  console.log(JSON.stringify(result, null, 2));

  if (!rootRestoredToWarehouse) throw new Error('Root refresh did not restore the warehouse route');
  if (warehouse.cards > 12) throw new Error(`Mobile warehouse rendered too many cards: ${warehouse.cards}`);
  if (community.cards > 12 || communityIdleCards > 12) {
    throw new Error(`Mobile community rendered too many idle cards: ${community.cards}/${communityIdleCards}`);
  }
  if (communityAfterScroll.cards > 24) {
    throw new Error(`One community scroll appended too many cards: ${communityAfterScroll.cards}`);
  }
  if (warehouse.splitRuntimeRequests || community.splitRuntimeRequests) {
    throw new Error('Production requested split runtime assets');
  }
  if (!animationNames.includes('communityFeedCardIn')) {
    throw new Error(`Community append animation was not observed: ${JSON.stringify(animationNames)}`);
  }

  await context.close();
} finally {
  if (browser) await browser.close();
}
