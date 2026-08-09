import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const port = Number(process.env.PORT || 5595);
const base = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '';
const evidenceFile = process.env.LAYOUT_EVIDENCE_FILE
  ? resolve(process.env.LAYOUT_EVIDENCE_FILE)
  : '';
const cardCounts = (process.env.LAYOUT_CARD_COUNTS || '192,816')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'desktop-1024x768', width: 1024, height: 768, mobile: false },
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true }
];

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
  const token = Buffer.from(`guest/generated/layout-fixture-${index}_grid.jpg`).toString('base64url');
  return [token, imageBodies[index]];
}));
function cdnUrl(index) {
  const token = Buffer.from(`guest/generated/layout-fixture-${index % images.length}_grid.jpg`).toString('base64url');
  return `${base}/api/v1/media/c/${token}`;
}
function missingUrl(index) {
  const token = Buffer.from(`guest/missing/layout-fixture-${index}_grid.jpg`).toString('base64url');
  return `${base}/api/v1/media/c/${token}`;
}
function slowUrl(index) {
  const token = Buffer.from(`guest/slow/layout-fixture-${index}_grid.jpg`).toString('base64url');
  return `${base}/api/v1/media/c/${token}`;
}
const slowBodies = new Map();

const groups = ['电影分镜', '角色设定', '产品视觉', '灵感收集', '场景氛围', '未分类'];
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

function slowBodyFor(index) {
  const token = Buffer.from(`guest/slow/layout-fixture-${index}_grid.jpg`).toString('base64url');
  if (!slowBodies.has(token)) {
    slowBodies.set(token, imageBodies[index % imageBodies.length]);
  }
  return token;
}

function buildCards(count) {
  return Array.from({ length: count }, (_, index) => {
    const kind = index % 7;
    const baseImage = cdnUrl(index);
    const missingImage = missingUrl(index);
    const slowImage = `${base}/api/v1/media/c/${slowBodyFor(index)}`;
    const image = kind === 0 ? ''
      : kind === 3 ? missingImage
      : kind === 6 ? slowImage
      : baseImage;
    const cardImages = kind === 0
      ? []
      : (kind === 2 ? [baseImage, cdnUrl(index + 7)] : [image]);
    return {
      id: `layout-fixture-${index}`,
      title: `布局测试卡 ${index + 1}`,
      prompt: image
        ? `Fixed geometry fixture ${index + 1}. A reusable visual brief with layered light, restrained palette and a deterministic caption used only for layout regression.`
        : `纯文字提示词 ${index + 1}：一段可复用的文案框架，用于验证文字卡片在网格中的行高稳定，不因图片存在与否发生重叠。`,
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
    if (url.pathname === '/__layout_seed.html') {
      const count = Math.max(1, Number(url.searchParams.get('count')) || 12);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(seedHtml(buildCards(count)));
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
      const slowBody = slowBodies.get(token);
      if (slowBody) {
        const delay = Number(url.searchParams.get('delay') || 900);
        setTimeout(() => {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
            'Content-Length': slowBody.length
          });
          res.end(slowBody);
        }, delay);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
      return;
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

async function openWarehouse(browser, viewport, count) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.goto(`${base}/__layout_seed.html?count=${count}`, { waitUntil: 'domcontentloaded' });
  const pageSize = viewport.mobile ? 12 : 24;
  await page.waitForFunction((size) => {
    if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return false;
    return document.querySelectorAll('#cardsContainer .card[data-id]').length >= size;
  }, pageSize, { timeout: 30000 });
  await page.waitForTimeout(900);
  return { context, page };
}

async function loadAllPages(page, viewport, count) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      if (window.innerWidth <= 900) {
        const main = document.querySelector('.app-main');
        if (main) main.scrollTop = main.scrollHeight;
      } else {
        const container = document.getElementById('cardsContainer');
        if (container) container.scrollTop = container.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 160));
    const loaded = await page.evaluate(() => (
      document.querySelectorAll('#cardsContainer .card[data-id]').length
    ));
    if (loaded >= count) break;
  }
  const finalCount = await page.evaluate(() => (
    document.querySelectorAll('#cardsContainer .card[data-id]').length
  ));
  if (finalCount < count) {
    throw new Error(`expected ${count} cards after pagination, got ${finalCount}`);
  }
  await page.evaluate(() => {
    if (window.innerWidth <= 900) {
      const main = document.querySelector('.app-main');
      if (main) main.scrollTop = 0;
    } else {
      const container = document.getElementById('cardsContainer');
      if (container) container.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')].slice(0, 24);
    return cards.every((card) => {
      const media = card.querySelector('.card-media');
      if (!media) return true;
      if (media.classList.contains('is-loading') || media.classList.contains('card-media--await')) return false;
      if (media.classList.contains('card-media--load-failed')) return true;
      const img = card.querySelector('.card-img');
      if (!img) return true;
      return img.complete;
    });
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('#cardsContainer .card-media')].every((el) => {
      const r = el.getBoundingClientRect();
      if (r.height >= 8 || getComputedStyle(el).display === 'none') return true;
      return el.classList.contains('is-loading') || el.classList.contains('card-media--await');
    });
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function inspectLayout(page, viewport) {
  return page.evaluate((isMobile) => {
    const container = document.getElementById('cardsContainer');
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')];
    const first = cards.slice(0, 20);
    const rects = first.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        id: card.dataset.id,
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        bottom: Math.round(rect.bottom * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100
      };
    });
    const pairs = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const area = x > 0 && y > 0 ? x * y : 0;
        if (area > 4) {
          pairs.push({ i, j, area: Math.round(area * 100) / 100, x, y });
        }
      }
    }
    const gridStyle = container ? getComputedStyle(container) : null;
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
    const absoluteCards = cards.filter((card) => getComputedStyle(card).position === 'absolute').length;
    const inlineAbs = cards.filter((card) => card.style.position === 'absolute').length;
    const firstRowTopSpread = rects.length >= 3
      ? Math.round(Math.max(...rects.slice(0, 3).map((r) => r.top))
        - Math.min(...rects.slice(0, 3).map((r) => r.top)))
      : 0;
    const media = [...document.querySelectorAll('#cardsContainer .card-media')];
    const zeroHeightMedia = media.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.height >= 8 || getComputedStyle(el).display === 'none') return false;
      if (el.classList.contains('is-loading') || el.classList.contains('card-media--await')) return false;
      if (el.classList.contains('card-media--load-failed')) return false;
      const img = el.querySelector('.card-img');
      if (img && !img.complete) return false;
      return true;
    }).length;
    const images = [...document.querySelectorAll('#cardsContainer .card-media img')];
    const brokenImages = images.filter((img) => img.complete && img.naturalWidth <= 1).length;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      mobile: isMobile,
      containerClass: container?.className || '',
      containerDisplay: gridStyle?.display || '',
      containerPosition: gridStyle?.position || '',
      gridColumns: String(gridStyle?.gridTemplateColumns || '').split(/\s+/).filter(Boolean).length,
      gridTemplateColumns: gridStyle?.gridTemplateColumns || '',
      gridOverflowY: gridStyle?.overflowY || '',
      cardCount: cards.length,
      textCards: document.querySelectorAll('#cardsContainer .card.card--text-only').length,
      visualCards: document.querySelectorAll('#cardsContainer .card.card--visual').length,
      mediaCount: media.length,
      loadedMediaCount: images.filter((img) => img.complete && img.naturalWidth > 8).length,
      brokenImageCount: brokenImages,
      galleryBadges: document.querySelectorAll('#cardsContainer .card-gallery-count').length,
      zeroHeightMedia,
      absoluteCards,
      inlineAbsCards: inlineAbs,
      firstRowTopSpread,
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      overflowNodes,
      rects,
      overlappingPairs: pairs
    };
  }, viewport.mobile);
}

function assertStableLayout(label, state, allowBrokenImages) {
  const problems = [];
  if (state.overlappingPairs.length) {
    problems.push(`card pairs overlap: ${JSON.stringify(state.overlappingPairs)}`);
  }
  if (state.absoluteCards > 0) {
    problems.push(`absolute positioned cards: ${state.absoluteCards}`);
  }
  if (state.zeroHeightMedia > 0) {
    problems.push(`media boxes with zero height: ${state.zeroHeightMedia}`);
  }
  if (state.pageOverflow > 1 || state.overflowNodes.length) {
    problems.push(`horizontal overflow: ${JSON.stringify(state.overflowNodes)}`);
  }
  if (state.containerDisplay !== 'grid') {
    problems.push(`container display=${state.containerDisplay}`);
  }
  if (!allowBrokenImages && state.brokenImageCount > 0) {
    problems.push(`broken images: ${state.brokenImageCount}`);
  }
  if (state.firstRowTopSpread > 1 && state.mobile === false) {
    problems.push(`desktop first-row top spread ${state.firstRowTopSpread}px`);
  }
  if (problems.length) {
    throw new Error(`${label} layout unstable: ${problems.join('; ')}`);
  }
}

async function checkControlsReachable(page, mobile) {
  return page.evaluate((isMobile) => {
    const viewport = { width: innerWidth, height: innerHeight };
    const probe = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return { present: false };
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        present: true,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1,
        rect: rect.width > 0 ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } : null
      };
    };
    const controls = isMobile
      ? { newCard: probe('#mobileNewCardBtn'), search: probe('#mobileSearchBtn'), filter: probe('#filterBtn'), groups: probe('#mobileGroupsBtn'), nav: probe('#mobileNavBtn') }
      : { newCard: probe('#desktopNewCardBtn'), columnUp: probe('.column-toggle .icon-btn:first-child'), gridView: probe('#viewToggle button[data-view="grid"]'), search: probe('#searchInput') };
    const insideViewport = (rect) => !!rect
      && rect.left >= -1 && rect.right <= viewport.width + 1
      && rect.top >= -1 && rect.bottom <= viewport.height + 1;
    const hidden = Object.entries(controls).filter(([, v]) => v.present && !v.visible).map(([k]) => k);
    const offscreen = Object.entries(controls)
      .filter(([, v]) => v.present && v.visible && !insideViewport(v.rect))
      .map(([k]) => k);
    const nav = document.getElementById('mobileBottomNav');
    return {
      viewport,
      controls,
      hidden,
      offscreen,
      bottomNavDisplay: nav ? getComputedStyle(nav).display : 'missing'
    };
  }, mobile);
}

async function checkViewModes(page) {
  const modeStates = [];
  const measure = async (mode) => {
    await page.waitForTimeout(600);
    return page.evaluate((label) => {
      const container = document.getElementById('cardsContainer');
      const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')].slice(0, 12);
      const rects = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      const pairs = [];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]; const b = rects[j];
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 0 && y > 0 && x * y > 4) pairs.push({ i, j });
        }
      }
      const cs = container ? getComputedStyle(container) : null;
      const activeView = document.querySelector('#viewToggle .active')?.dataset.view || '';
      return {
        mode: label,
        activeView,
        containerClass: container?.className || '',
        gridCols: String(cs?.gridTemplateColumns || '').split(/\s+/).filter(Boolean).length,
        cardCount: cards.length,
        overlappingPairs: pairs,
        columns: Number(document.documentElement.style.getPropertyValue('--card-columns')) || 0
      };
    }, mode);
  };
  const setColumns = (cols) => page.evaluate((c) => {
    if (typeof window.setCardColumns !== 'function') throw new Error('setCardColumns unavailable');
    window.setCardColumns(c);
  }, cols);
  await setColumns(4);
  modeStates.push(await measure('columns=4'));
  await setColumns(2);
  modeStates.push(await measure('columns=2'));
  await setColumns(3);
  modeStates.push(await measure('columns=3'));
  await page.evaluate(() => {
    const btn = document.querySelector('#viewToggle button[data-view="list"]');
    if (btn) btn.click();
  });
  modeStates.push(await measure('list-view'));
  await page.evaluate(() => {
    const btn = document.querySelector('#viewToggle button[data-view="grid"]');
    if (btn) btn.click();
  });
  modeStates.push(await measure('grid-view-restored'));
  for (const state of modeStates) {
    if (state.overlappingPairs.length) {
      throw new Error(`mode ${state.mode} cards overlap: ${JSON.stringify(state.overlappingPairs)}`);
    }
    if (state.mode === 'list-view') {
      if (state.activeView !== 'list' || state.cardCount < 12) {
        throw new Error(`list-view did not activate: ${JSON.stringify(state)}`);
      }
    }
  }
  return modeStates;
}

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
if (evidenceFile) await mkdir(resolve(evidenceFile, '..'), { recursive: true });

const evidence = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });

  for (const count of cardCounts) {
    for (const viewport of viewports) {
      const { context, page } = await openWarehouse(browser, viewport, count);
      await loadAllPages(page, viewport, count);
      const state = await inspectLayout(page, viewport);
      const controls = await checkControlsReachable(page, viewport.mobile);
      const label = `${viewport.name} cards=${count}`;
      const record = { label, count, viewport: viewport.name, state, controls };
      evidence.push(record);
      if (evidenceFile) {
        await writeFile(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8');
      }
      const allowBrokenImages = process.env.ALLOW_BROKEN_IMAGES === '1';
      assertStableLayout(label, state, allowBrokenImages);
      if (controls.hidden.length || controls.offscreen.length) {
        throw new Error(`${label} controls unreachable: ${JSON.stringify(controls)}`);
      }
      if (viewport.name === 'desktop-1440x900') {
        const modes = await checkViewModes(page);
        record.modes = modes;
      }
      if (screenshotDir) {
        await page.screenshot({
          path: join(screenshotDir, `warehouse-layout-${viewport.name}-${count}.png`),
          fullPage: false
        });
      }
      console.log(`${label} OK`, JSON.stringify({
        grid: `${state.containerDisplay} ${state.gridColumns}col`,
        cardCount: state.cardCount,
        overlaps: state.overlappingPairs.length,
        overflow: state.pageOverflow,
        controls: { hidden: controls.hidden, offscreen: controls.offscreen }
      }));
      await context.close();
    }
  }
  if (evidenceFile) {
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8');
  }
  console.log('verify-warehouse-card-layout-browser OK', JSON.stringify({
    cardCounts,
    viewports: viewports.map((v) => v.name),
    evidenceFile: evidenceFile || null
  }));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
