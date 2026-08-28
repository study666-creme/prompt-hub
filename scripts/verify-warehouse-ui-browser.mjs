import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = resolve(process.env.APP_ROOT || join(import.meta.dirname, '..'));
const port = Number(process.env.PORT || 5593);
const base = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '';

const now = Date.now();
const images = [
  '/assets/studio-preset/scene.png',
  '/assets/studio-preset/peishen.png',
  '/assets/studio-preset/linche.png',
  '/assets/studio-preset/shenmei.png'
];
const imageBodies = await Promise.all(images.map((pathname) => (
  readFile(join(root, pathname.replace(/^\/+/, '')))
)));
const foundationFiles = [
  'cloud-sync-safety.js',
  'modal-hub.js',
  'mobile.js',
  'app-toast.js'
];
const foundationSource = foundationFiles.every((pathname) => existsSync(join(root, pathname)))
  ? (await Promise.all(foundationFiles.map((pathname) => (
      readFile(join(root, pathname), 'utf8')
    )))).join('\n;\n')
  : await readFile(join(root, 'pack-foundation.js'), 'utf8');
const cdnAssets = new Map(images.map((_, index) => {
  const token = Buffer.from(`guest/generated/warehouse-ui-${index}_grid.jpg`).toString('base64url');
  return [token, imageBodies[index]];
}));
const imageCdnUrls = [...cdnAssets.keys()].map((token) => `${base}/api/v1/media/c/${token}`);
const groups = ['电影分镜', '角色设定', '产品视觉', '灵感收集'];
const cards = Array.from({ length: 12 }, (_, index) => {
  const image = index % 3 === 2 ? '' : imageCdnUrls[index % imageCdnUrls.length];
  return {
    id: `warehouse-ui-${index}`,
    title: [
      '雨夜列车的电影感镜头',
      '冷色调角色肖像研究',
      '品牌叙事的文案结构',
      '未来城市的空间氛围'
    ][index % 4],
    prompt: image
      ? `Cinematic visual study ${index + 1}, layered lighting, restrained palette, detailed composition.`
      : `A reusable prompt framework for building a clear visual narrative. Keep the hierarchy concise, describe the subject first, then light, lens, material and atmosphere. Variation ${index + 1}.`,
    group: groups[index % groups.length],
    tags: index % 2 ? ['构图', '光影'] : ['电影感', '收藏'],
    image,
    cardImages: image ? [image] : [],
    pinnedAt: index === 0 ? now : null,
    createdAt: now - index * 3_600_000,
    updatedAt: now - index * 1_800_000
  };
});

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

function seedHtml(empty) {
  const rows = empty ? [] : cards;
  return `<!doctype html><meta charset="utf-8"><script>
const cards = ${JSON.stringify(rows)};
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
(async () => {
  indexedDB.deleteDatabase('PromptRepoDB');
  await new Promise((resolve) => setTimeout(resolve, 80));
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
  location.href = '/prompts/';
})().catch((error) => { document.body.textContent = String(error?.stack || error); });
</script>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', base);
    if (url.pathname === '/__seed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(url.searchParams.get('empty') === '1'));
      return;
    }
    if (url.pathname.startsWith('/api/v1/media/c/')) {
      const token = url.pathname.split('/').pop() || '';
      const body = cdnAssets.get(token);
      if (body) {
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': body.length
        });
        res.end(body);
        return;
      }
    }
    if (url.pathname === '/pack-foundation.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(foundationSource);
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

function assertBetween(label, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${label} expected ${min}-${max}, got ${value}`);
  }
}

async function openWarehouse(browser, viewport, empty = false) {
  const mobile = viewport.width <= 480;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.goto(`${base}/__seed.html${empty ? '?empty=1' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expectEmpty) => {
    if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return false;
    return expectEmpty
      ? !!document.querySelector('.warehouse-grid-empty')
      : document.querySelectorAll('#cardsContainer .card[data-id]').length >= 12;
  }, empty, { timeout: 20000 });
  await page.waitForTimeout(900);
  if (!empty) {
    await page.waitForFunction(() => (
      document.querySelectorAll('#cardsContainer .card-media img').length === 8
    ), null, { timeout: 5000 });
  }
  return { context, page };
}

async function inspectWarehouse(page, mobile) {
  return page.evaluate((isMobile) => {
    const composer = document.getElementById('warehouseComposer');
    const libraryToolbar = document.getElementById('warehouseLibraryToolbar');
    const grid = document.getElementById('cardsContainer');
    const metaRows = [...document.querySelectorAll('#cardsContainer .card-meta-row')];
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')];
    const cardRects = cards.map((card) => card.getBoundingClientRect());
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const viewportWidth = document.documentElement.clientWidth;
    const overflowNodes = [...document.querySelectorAll('.app-page-warehouse.active *')].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return style.position !== 'fixed'
        && rect.left < viewportWidth - 1
        && rect.right > viewportWidth + 1
        && rect.width > 1;
    }).slice(0, 8).map((node) => ({
      tag: node.tagName,
      id: node.id,
      className: String(node.className || '').slice(0, 120),
      right: Math.round(node.getBoundingClientRect().right)
    }));
    return {
      composerHeight: Math.round(composer?.getBoundingClientRect().height || 0),
      toolbarHeight: Math.round(libraryToolbar?.getBoundingClientRect().height || 0),
      groupLabel: document.getElementById('warehouseLibraryGroupTrigger')?.getAttribute('aria-label') || '',
      tagLabel: document.getElementById('filterBtn')?.getAttribute('aria-label') || '',
      searchPlaceholder: document.getElementById('searchInput')?.getAttribute('placeholder') || '',
      sortLabel: document.getElementById('sortMenuLabel')?.textContent?.trim() || '',
      visibleNativeSelects: [...document.querySelectorAll('select')].filter((select) => {
        const rect = select.getBoundingClientRect();
        const style = getComputedStyle(select);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
      }).map((select) => select.id),
      cardCount: cards.length,
      metaCount: metaRows.length,
      textKinds: document.querySelectorAll('.card-kind.is-text').length,
      visualKinds: document.querySelectorAll('.card-kind.is-visual').length,
      mediaCount: document.querySelectorAll('#cardsContainer .card-media img').length,
      loadedMediaCount: [...document.querySelectorAll('#cardsContainer .card-media img')]
        .filter((img) => img.complete && img.naturalWidth > 8).length,
      warehouseStylesheet: [...document.styleSheets].some((sheet) => /styles-warehouse\.css/.test(sheet.href || '')),
      gridWidth: Math.round(grid?.getBoundingClientRect().width || 0),
      gridDisplay: gridStyle?.display || '',
      gridColumnCount: String(gridStyle?.gridTemplateColumns || '').split(/\s+/).filter(Boolean).length,
      absoluteCards: cards.filter((card) => getComputedStyle(card).position === 'absolute').length,
      firstRowTopSpread: cardRects.length >= 3
        ? Math.round(Math.max(...cardRects.slice(0, 3).map((rect) => rect.top))
          - Math.min(...cardRects.slice(0, 3).map((rect) => rect.top)))
        : 0,
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      draggableCards: grid?.querySelectorAll('.card[draggable="true"]').length || 0,
      overflowNodes,
      mobileActions: document.querySelectorAll('.card-mobile-actions').length,
      cardData: (window.__promptHubCards || []).slice(0, 3).map((card) => ({
        id: card.id,
        image: String(card.image || '').slice(0, 80),
        cardImages: (card.cardImages || []).map((value) => String(value).slice(0, 80)),
        hasThumb: window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, { skipEnsure: true })?.hasImage === true
      })),
      isMobile
    };
  }, mobile);
}

async function inspectMobileToolbar(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const controls = [
      ['file-groups', '#warehouseLibraryGroupTrigger'],
      ['tag-groups', '#filterBtn'],
      ['search', '#warehouseLibrarySearchSlot .warehouse-search'],
      ['sort', '#sortMenuBtn']
    ].map(([name, selector]) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      const style = node ? getComputedStyle(node) : null;
      return {
        name,
        present: !!node,
        visible: !!node && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1,
        left: rect?.left || 0,
        right: rect?.right || 0,
        top: rect?.top || 0,
        bottom: rect?.bottom || 0,
        width: rect?.width || 0,
        height: rect?.height || 0
      };
    });
    const visible = controls.filter((control) => control.visible);
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
        const left = visible[leftIndex];
        const right = visible[rightIndex];
        if (left.left < right.right - 0.5 && left.right > right.left + 0.5
          && left.top < right.bottom - 0.5 && left.bottom > right.top + 0.5) {
          overlaps.push(`${left.name}:${right.name}`);
        }
      }
    }
    const outside = visible
      .filter((control) => control.left < -0.5 || control.right > viewportWidth + 0.5)
      .map((control) => control.name);
    const toolbar = document.getElementById('warehouseLibraryToolbar');
    const filter = document.getElementById('filterBtn');
    return {
      viewportWidth,
      controls,
      overlaps,
      outside,
      toolbarOverflow: (toolbar?.scrollWidth || 0) - (toolbar?.clientWidth || 0),
      filterAriaLabel: filter?.getAttribute('aria-label') || '',
      filterTitle: filter?.getAttribute('title') || '',
      searchPlaceholder: document.getElementById('searchInput')?.getAttribute('placeholder') || '',
      sortLabel: document.getElementById('sortMenuLabel')?.textContent?.trim() || ''
    };
  });
}

function assertMobileToolbar(label, state) {
  if (state.controls.some((control) => !control.present || !control.visible)) {
    throw new Error(`${label} mobile toolbar control missing: ${JSON.stringify(state)}`);
  }
  if (state.overlaps.length || state.outside.length || state.toolbarOverflow > 1) {
    throw new Error(`${label} mobile toolbar overlap/overflow: ${JSON.stringify(state)}`);
  }
  if (state.filterAriaLabel !== '标签分类' || state.filterTitle !== '标签分类'
    || state.searchPlaceholder !== '搜索卡片' || !state.sortLabel) {
    throw new Error(`${label} library toolbar semantics mismatch: ${JSON.stringify(state)}`);
  }
}

async function inspectPromptFirstInteractions(page) {
  await page.locator('#warehouseLibraryGroupTrigger').click();
  const fileGroups = await page.locator('#warehouseLibraryGroupMenu [data-picker-value]').allTextContents();
  await page.keyboard.press('Escape');
  await page.locator('#filterBtn').click();
  const tagMenu = await page.locator('#filterDropdown').innerText();
  await page.keyboard.press('Escape');

  const main = page.locator('#mainContentArea');
  await main.evaluate((element) => { element.scrollTop = 0; });
  await main.hover();
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(520);
  const focused = await page.evaluate(() => ({
    active: document.body.classList.contains('warehouse-content-focus'),
    composerHeight: Math.round(document.getElementById('warehouseComposer')?.getBoundingClientRect().height || 0)
  }));
  await page.waitForTimeout(800);
  await main.hover();
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(520);
  const restored = await page.evaluate(() => ({
    active: document.body.classList.contains('warehouse-content-focus'),
    composerHeight: Math.round(document.getElementById('warehouseComposer')?.getBoundingClientRect().height || 0)
  }));
  return { fileGroups, tagMenu, focused, restored };
}

async function inspectMobileEditPanelAfterTouch(page) {
  await page.locator('#cardsContainer [data-mobile-edit]').first().click();
  await page.waitForFunction(() => (
    !document.getElementById('editPanel')?.classList.contains('hidden')
    && document.body.classList.contains('panel-open')
  ), null, { timeout: 10000 });

  const panelBody = await page.locator('#panelBody').boundingBox();
  if (!panelBody) throw new Error('mobile edit panel body has no layout box');
  const x = Math.round(panelBody.x + panelBody.width / 2);
  const fromY = Math.round(Math.min(panelBody.y + panelBody.height - 24, 700));
  const toY = Math.round(Math.max(panelBody.y + 24, fromY - 220));
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y: fromY, id: 1 }]
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: toY, id: 1 }]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
  await page.waitForTimeout(150);

  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      const box = node?.getBoundingClientRect();
      return box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null;
    };
    const nav = document.getElementById('mobileBottomNav');
    return {
      panelOpen: document.body.classList.contains('panel-open'),
      panelVisible: !document.getElementById('editPanel')?.classList.contains('hidden'),
      navDisplay: nav ? getComputedStyle(nav).display : 'missing',
      footer: rect('#editPanel .panel-footer'),
      save: rect('#editPanel .btn-footer-save'),
      close: rect('#editPanel .panel-close-mobile'),
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

function assertMobileEditPanel(state) {
  const insideViewport = (box) => !!box
    && box.left >= -1
    && box.right <= state.viewport.width + 1
    && box.top >= -1
    && box.bottom <= state.viewport.height + 1;
  if (!state.panelOpen || !state.panelVisible || state.navDisplay !== 'none') {
    throw new Error(`mobile edit panel lost blocking state after touch: ${JSON.stringify(state)}`);
  }
  if (!insideViewport(state.footer) || !insideViewport(state.save) || !insideViewport(state.close)) {
    throw new Error(`mobile edit panel footer controls are not reachable: ${JSON.stringify(state)}`);
  }
}

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

if (process.env.PREVIEW_ONLY === '1') {
  console.log(`Warehouse preview: ${base}/__seed.html`);
  console.log(`Warehouse empty state: ${base}/__seed.html?empty=1`);
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise(() => {});
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  const desktop = await openWarehouse(browser, { width: 1440, height: 900 });
  const desktopState = await inspectWarehouse(desktop.page, false);
  assertBetween('desktop composer height', desktopState.composerHeight, 320, 410);
  assertBetween('desktop library toolbar height', desktopState.toolbarHeight, 50, 80);
  if (desktopState.groupLabel !== '文件分类' || desktopState.tagLabel !== '标签分类'
    || desktopState.searchPlaceholder !== '搜索卡片' || !desktopState.sortLabel
    || desktopState.visibleNativeSelects.length) {
    throw new Error(`desktop prompt-first controls incomplete: ${JSON.stringify(desktopState)}`);
  }
  if (desktopState.cardCount !== 12 || desktopState.metaCount !== 12) {
    throw new Error(`desktop cards/meta mismatch: ${JSON.stringify(desktopState)}`);
  }
  if (!desktopState.textKinds || !desktopState.visualKinds) {
    throw new Error(`desktop card type hierarchy missing: ${JSON.stringify(desktopState)}`);
  }
  if (desktopState.mediaCount !== 8 || desktopState.loadedMediaCount !== 8) {
    throw new Error(`desktop card media incomplete: ${JSON.stringify(desktopState)}`);
  }
  if (!desktopState.warehouseStylesheet) {
    throw new Error(`warehouse visual assets did not load: ${JSON.stringify(desktopState)}`);
  }
  if (desktopState.pageOverflow > 1 || desktopState.overflowNodes.length) {
    throw new Error(`desktop horizontal overflow: ${JSON.stringify(desktopState.overflowNodes)}`);
  }
  if (desktopState.gridDisplay !== 'grid' || desktopState.gridColumnCount !== 3
    || desktopState.absoluteCards !== 0 || desktopState.firstRowTopSpread > 1) {
    throw new Error(`desktop warehouse grid is unstable: ${JSON.stringify(desktopState)}`);
  }
  if (screenshotDir) {
    await desktop.page.screenshot({ path: join(screenshotDir, 'warehouse-desktop.png'), fullPage: false });
  }
  const promptFirstInteractions = await inspectPromptFirstInteractions(desktop.page);
  if (!promptFirstInteractions.fileGroups.some((label) => label.includes('全部卡片'))
    || !promptFirstInteractions.fileGroups.some((label) => label.includes('电影分镜'))
    || !promptFirstInteractions.tagMenu.includes('筛选（可多选）')
    || !promptFirstInteractions.tagMenu.includes('电影感')) {
    throw new Error(`library classification controls lost data: ${JSON.stringify(promptFirstInteractions)}`);
  }
  if (!promptFirstInteractions.focused.active || promptFirstInteractions.focused.composerHeight !== 0
    || promptFirstInteractions.restored.active || promptFirstInteractions.restored.composerHeight < 300) {
    throw new Error(`wheel focus transition failed: ${JSON.stringify(promptFirstInteractions)}`);
  }
  const failedMediaState = await desktop.page.evaluate(() => {
    const media = document.querySelector('#cardsContainer .card.card--visual .card-media');
    const card = media?.closest('.card');
    media?.classList.add('card-media--load-failed');
    return {
      mediaDisplay: media ? getComputedStyle(media).display : '',
      cardText: card?.textContent?.trim() || '',
      cardHeight: Math.round(card?.getBoundingClientRect().height || 0)
    };
  });
  if (failedMediaState.mediaDisplay !== 'none' || !failedMediaState.cardText || failedMediaState.cardHeight < 80) {
    throw new Error(`failed warehouse media left a black or broken slot: ${JSON.stringify(failedMediaState)}`);
  }
  await desktop.context.close();

  const mobile = await openWarehouse(browser, { width: 390, height: 844 });
  const mobileState = await inspectWarehouse(mobile.page, true);
  assertBetween('mobile composer height', mobileState.composerHeight, 400, 470);
  assertBetween('mobile library toolbar height', mobileState.toolbarHeight, 90, 140);
  if (mobileState.groupLabel !== '文件分类' || mobileState.tagLabel !== '标签分类'
    || mobileState.searchPlaceholder !== '搜索卡片' || !mobileState.sortLabel
    || mobileState.visibleNativeSelects.length) {
    throw new Error(`mobile prompt-first controls incomplete: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.cardCount !== 12 || mobileState.metaCount !== 12 || mobileState.mobileActions !== 12) {
    throw new Error(`mobile cards/meta/actions mismatch: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.mediaCount !== 8 || mobileState.loadedMediaCount < 6) {
    throw new Error(`mobile card media incomplete: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.draggableCards !== 0) {
    throw new Error(`mobile cards expose native drag: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.pageOverflow > 1 || mobileState.overflowNodes.length) {
    throw new Error(`mobile horizontal overflow: ${JSON.stringify(mobileState.overflowNodes)}`);
  }
  if (screenshotDir) {
    await mobile.page.screenshot({ path: join(screenshotDir, 'warehouse-mobile.png'), fullPage: false });
  }
  const mobileEditPanelState = await inspectMobileEditPanelAfterTouch(mobile.page);
  assertMobileEditPanel(mobileEditPanelState);
  await mobile.context.close();

  const narrowToolbarStates = {};
  for (const width of [320, 360]) {
    const narrow = await openWarehouse(browser, { width, height: 844 });
    const toolbarState = await inspectMobileToolbar(narrow.page);
    assertMobileToolbar(`${width}px`, toolbarState);
    narrowToolbarStates[width] = toolbarState;
    await narrow.context.close();
  }

  const empty = await openWarehouse(browser, { width: 1440, height: 900 }, true);
  const emptyState = await empty.page.evaluate(() => {
    const grid = document.getElementById('cardsContainer');
    const emptyBox = document.querySelector('.warehouse-grid-empty');
    const gridRect = grid?.getBoundingClientRect();
    const emptyRect = emptyBox?.getBoundingClientRect();
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const padding = (property) => parseFloat(gridStyle?.[property] || '0') || 0;
    const scaleX = gridRect && grid?.offsetWidth ? gridRect.width / grid.offsetWidth : 1;
    const scaleY = gridRect && grid?.offsetHeight ? gridRect.height / grid.offsetHeight : 1;
    const contentLeft = (gridRect?.left || 0)
      + ((grid?.clientLeft || 0) + padding('paddingLeft')) * scaleX;
    const contentRight = (gridRect?.left || 0)
      + ((grid?.clientLeft || 0) + (grid?.clientWidth || 0) - padding('paddingRight')) * scaleX;
    const contentTop = (gridRect?.top || 0)
      + ((grid?.clientTop || 0) + padding('paddingTop')) * scaleY;
    const contentBottom = (gridRect?.top || 0)
      + ((grid?.clientTop || 0) + (grid?.clientHeight || 0) - padding('paddingBottom')) * scaleY;
    return {
      heading: document.querySelector('.warehouse-grid-empty h4')?.textContent?.trim() || '',
      actions: document.querySelectorAll('.warehouse-empty-actions button').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      gridCenter: gridRect ? (gridRect.left + gridRect.right) / 2 : 0,
      emptyCenter: emptyRect ? (emptyRect.left + emptyRect.right) / 2 : 0,
      gridContentCenter: (contentLeft + contentRight) / 2,
      gridVerticalCenter: gridRect ? (gridRect.top + gridRect.bottom) / 2 : 0,
      emptyVerticalCenter: emptyRect ? (emptyRect.top + emptyRect.bottom) / 2 : 0,
      gridContentVerticalCenter: (contentTop + contentBottom) / 2
    };
  });
  if (!emptyState.heading || emptyState.actions !== 2 || emptyState.overflow > 1) {
    throw new Error(`warehouse empty state incomplete: ${JSON.stringify(emptyState)}`);
  }
  if (Math.abs(emptyState.emptyCenter - emptyState.gridContentCenter) > 2
    || Math.abs(emptyState.emptyVerticalCenter - emptyState.gridContentVerticalCenter) > 2) {
    throw new Error(`warehouse empty state is not centered: ${JSON.stringify(emptyState)}`);
  }
  if (screenshotDir) {
    await empty.page.screenshot({ path: join(screenshotDir, 'warehouse-empty.png'), fullPage: false });
  }
  await empty.context.close();

  const emptyMobile = await openWarehouse(browser, { width: 390, height: 844 }, true);
  const emptyMobileState = await emptyMobile.page.evaluate(() => {
    const gridNode = document.getElementById('cardsContainer');
    const grid = gridNode?.getBoundingClientRect();
    const emptyBox = document.querySelector('.warehouse-grid-empty')?.getBoundingClientRect();
    const gridStyle = gridNode ? getComputedStyle(gridNode) : null;
    const padding = (property) => parseFloat(gridStyle?.[property] || '0') || 0;
    const scaleX = grid && gridNode?.offsetWidth ? grid.width / gridNode.offsetWidth : 1;
    const scaleY = grid && gridNode?.offsetHeight ? grid.height / gridNode.offsetHeight : 1;
    const contentLeft = (grid?.left || 0)
      + ((gridNode?.clientLeft || 0) + padding('paddingLeft')) * scaleX;
    const contentRight = (grid?.left || 0)
      + ((gridNode?.clientLeft || 0) + (gridNode?.clientWidth || 0) - padding('paddingRight')) * scaleX;
    const contentTop = (grid?.top || 0)
      + ((gridNode?.clientTop || 0) + padding('paddingTop')) * scaleY;
    const contentBottom = (grid?.top || 0)
      + ((gridNode?.clientTop || 0) + (gridNode?.clientHeight || 0) - padding('paddingBottom')) * scaleY;
    return {
      gridCenter: grid ? (grid.left + grid.right) / 2 : 0,
      emptyCenter: emptyBox ? (emptyBox.left + emptyBox.right) / 2 : 0,
      gridContentCenter: (contentLeft + contentRight) / 2,
      gridVerticalCenter: grid ? (grid.top + grid.bottom) / 2 : 0,
      emptyVerticalCenter: emptyBox ? (emptyBox.top + emptyBox.bottom) / 2 : 0,
      gridContentVerticalCenter: (contentTop + contentBottom) / 2
    };
  });
  if (Math.abs(emptyMobileState.emptyCenter - emptyMobileState.gridContentCenter) > 3
    || Math.abs(emptyMobileState.emptyVerticalCenter - emptyMobileState.gridContentVerticalCenter) > 40) {
    throw new Error(`mobile warehouse empty state is not centered: ${JSON.stringify(emptyMobileState)}`);
  }
  await emptyMobile.context.close();

  console.log('verify-warehouse-ui-browser OK', JSON.stringify({
    desktopState,
    promptFirstInteractions,
    mobileState,
    mobileEditPanelState,
    narrowToolbarStates,
    emptyState,
    emptyMobileState
  }));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
