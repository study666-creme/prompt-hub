import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const playwrightDir = process.env.PLAYWRIGHT_PACKAGE_DIR;
if (!playwrightDir) throw new Error('PLAYWRIGHT_PACKAGE_DIR is required');
const playwright = await import(pathToFileURL(join(playwrightDir, 'index.js')).href);
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
});
const base = process.env.PH_BASE_URL || 'http://127.0.0.1:43219/';
const outputDir = process.env.PH_QA_OUTPUT || 'artifacts/ui-regression';
const models = [
  {
    id: 'image2-A',
    label: '全能模型2-A',
    uiFamily: 'gim2',
    sortOrder: 1,
    status: 'active',
    selectable: true,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    creditsByResolution: { '1k': 4, '2k': 5, '4k': 6 },
    creditsByResolutionQuality: {
      '1k': { low: 4, standard: 4, high: 6 },
      '2k': { low: 5, standard: 5, high: 7 },
      '4k': { low: 6, standard: 6, high: 8 }
    },
    parameters: [{ name: 'quality', options: ['low', 'standard', 'high'], default: 'standard' }]
  },
  { id: 'lingtu-fast', label: '香蕉 Fast', uiFamily: 'banana', sortOrder: 2, status: 'active', selectable: true, refundOnViolation: true, resolutions: ['1k'] },
  { id: 'mj-v7', label: 'MJ v7', uiFamily: 'midjourney', sortOrder: 3, status: 'active', selectable: true, refundOnViolation: true, resolutions: ['1k'] }
];

async function prepare(context) {
  await context.addInitScript(() => {
    localStorage.setItem('promptrepo_app_page', 'warehouse');
    localStorage.setItem('promptrepo_imagegen_models_cache_v4', JSON.stringify({
      ts: Date.now(),
      version: 11,
      models: [{ id: 'mj-v7', label: 'MJ v7', uiFamily: 'midjourney', status: 'active', selectable: true }]
    }));
  });
  await context.route('**/api/v1/generate/models', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { models, catalogVersion: 'qa-v1', globalDiscountPercent: 100 } })
  }));
  await context.route('**/api/v1/generate/cost?*', (route) => {
    const url = new URL(route.request().url());
    const resolution = String(url.searchParams.get('resolution') || '1k').toLowerCase();
    const quality = String(url.searchParams.get('quality') || 'standard').toLowerCase();
    const baseCredits = { '1k': 4, '2k': 5, '4k': 6 }[resolution] ?? 4;
    const final = quality === 'high' ? baseCredits + 2 : baseCredits;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { final, listPrice: final, appliedDiscount: 'fixed' } })
    });
  });
}

await mkdir(outputDir, { recursive: true });
const errors = [];
const desktopContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
await prepare(desktopContext);
const desktop = await desktopContext.newPage();
desktop.on('pageerror', (error) => errors.push(String(error)));
await desktop.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
await desktop.waitForFunction(
  () => typeof window.switchAppPage === 'function' && typeof window.relayoutMasonryGrid === 'function',
  null,
  { timeout: 30000 }
);
await desktop.evaluate(() => window.switchAppPage('warehouse'));
await desktop.waitForTimeout(1000);
await desktop.evaluate(() => {
  const container = document.getElementById('cardsContainer');
  document.documentElement.style.setProperty('--card-columns', '3');
  container.classList.remove('feed-grid-centered');
  container.innerHTML = Array.from({ length: 9 }, (_, index) => {
    const height = index === 0 ? 720 : 90 + (index % 3) * 28;
    return `<article class="card" data-id="qa-${index}"><div class="card-media" style="height:${height}px;background:rgb(${30 + index * 3},45,55)"></div><div class="card-body"><strong>QA card ${index}</strong><p>variable content ${'text '.repeat(index % 4 + 1)}</p></div></article>`;
  }).join('');
  window.relayoutMasonryGrid();
});
await desktop.waitForTimeout(250);
const desktopLayout = await desktop.evaluate(() => {
  const columns = [...document.querySelectorAll('#cardsContainer > .warehouse-desktop-col')];
  const cards = [...document.querySelectorAll('#cardsContainer > .warehouse-desktop-col > .card')];
  const rects = cards.map((card) => card.getBoundingClientRect());
  let overlaps = 0;
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      const a = rects[left];
      const b = rects[right];
      if (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      ) overlaps += 1;
    }
  }
  const grid = document.getElementById('cardsContainer');
  const columnGaps = columns.flatMap((column) => {
    const columnRects = [...column.querySelectorAll(':scope > .card')]
      .map((card) => card.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    return columnRects.slice(1).map((rect, index) => Math.round(rect.top - columnRects[index].bottom));
  });
  return {
    className: grid.className,
    display: getComputedStyle(grid).display,
    positionModes: [...new Set(cards.map((card) => getComputedStyle(card).position))],
    columns: columns.length,
    cards: cards.length,
    overlaps,
    columnGaps,
    widths: [...new Set(rects.map((rect) => Math.round(rect.width)))],
    scrollable: grid.scrollHeight > grid.clientHeight
  };
});
const desktopScrollStability = await desktop.evaluate(async () => {
  const grid = document.getElementById('cardsContainer');
  const card = grid.querySelector('.card[data-id="qa-0"]');
  const media = card?.querySelector('.card-media');
  const beforeColumns = Object.fromEntries(
    [...grid.querySelectorAll('.warehouse-desktop-col')].flatMap((column, columnIndex) =>
      [...column.querySelectorAll(':scope > .card[data-id]')].map((item) => [item.dataset.id, columnIndex])
    )
  );
  grid.scrollTop = Math.min(360, Math.max(0, grid.scrollHeight - grid.clientHeight));
  const beforeTop = grid.scrollTop;
  if (media) media.style.height = '940px';
  window.relayoutMasonryGrid();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const afterColumns = Object.fromEntries(
    [...grid.querySelectorAll('.warehouse-desktop-col')].flatMap((column, columnIndex) =>
      [...column.querySelectorAll(':scope > .card[data-id]')].map((item) => [item.dataset.id, columnIndex])
    )
  );
  return {
    beforeTop,
    afterTop: grid.scrollTop,
    sameColumns: JSON.stringify(beforeColumns) === JSON.stringify(afterColumns)
  };
});
await desktop.screenshot({ path: join(outputDir, 'desktop-warehouse.png'), fullPage: false });

await desktop.evaluate(() => {
  window.importPromptHubCards([
    {
      id: 'qa-text',
      title: '纯文字筛选回归',
      prompt: '只有文字，没有任何媒体',
      group: '未分组',
      tags: ['回归'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      image: null
    },
    {
      id: 'qa-image',
      title: '图片筛选回归',
      prompt: '带图片的卡片',
      group: '未分组',
      tags: ['回归'],
      createdAt: Date.now() - 1,
      updatedAt: Date.now() - 1,
      image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    }
  ]);
  document.getElementById('searchInput').value = '';
  document.getElementById('searchInputMobile').value = '这个隐藏搜索值不应影响桌面筛选';
  window.clearWarehouseFilters({ force: true, toast: false });
  window.toggleFilterMenu();
});
await desktop.locator('#filterDropdown .filter-option', { hasText: '纯文字' }).click();
await desktop.waitForSelector('#cardsContainer .card[data-id="qa-text"]');
const textFilter = await desktop.evaluate(() => ({
  ids: [...document.querySelectorAll('#cardsContainer .card[data-id]')].map((card) => card.dataset.id),
  empty: !!document.querySelector('#cardsContainer .warehouse-grid-empty')
}));

await desktop.evaluate(() => window.switchAppPage('imagegen'));
await desktop.waitForFunction(
  () => Array.isArray(window.__IMAGE_GEN_MODELS__)
    && window.__IMAGE_GEN_MODELS__.some((model) => model.id === 'image2-A')
    && document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').length >= 3,
  null,
  { timeout: 20000 }
);
const catalog = await desktop.evaluate(() => ({
  ids: window.__IMAGE_GEN_MODELS__.map((model) => model.id),
  families: [...document.querySelectorAll('#imageGenModelFamilyTabs [data-family]')].map((button) => button.dataset.family),
  active: document.querySelector('#imageGenModelFamilyTabs .active')?.dataset.family || '',
  options: [...document.querySelectorAll('#imageGenModel option')].map((option) => option.value)
}));
await desktop.locator('#imageGenModelFamilyTabs [data-family="gim2"]').click();
await desktop.waitForFunction(() => !!document.querySelector('#imageGenModel option[value="image2-A"]'));
await desktop.selectOption('#imageGenModel', 'image2-A');
await desktop.waitForFunction(
  () => [...document.querySelectorAll('#imageGenQuality option')].map((option) => option.textContent?.trim()).join(',') === '低,中,高'
);
await desktop.evaluate(() => window.FeatureDraft.refreshImageGenModelCatalog({ force: true }));
await desktop.waitForFunction(
  () => document.getElementById('imageGenModel')?.value === 'image2-A'
    && !!document.querySelector('#imageGenModel option[value="image2-A"]')
);
const resolutionModelStability = [];
for (const resolution of ['1k', '2k', '4k', '1k']) {
  await desktop.evaluate((nextResolution) => {
    const select = document.getElementById('imageGenResolution');
    select.value = nextResolution;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, resolution);
  await desktop.waitForFunction(
    (expectedResolution) => document.getElementById('imageGenResolution')?.value === expectedResolution
      && document.getElementById('imageGenModel')?.value === 'image2-A',
    resolution
  );
  resolutionModelStability.push(await desktop.evaluate(() => ({
    resolution: document.getElementById('imageGenResolution')?.value || '',
    model: document.getElementById('imageGenModel')?.value || '',
    optionExists: !!document.querySelector('#imageGenModel option[value="image2-A"]'),
    optionCount: document.querySelectorAll('#imageGenModel option').length
  })));
}
await desktop.evaluate(() => {
  for (const [id, value] of [['imageGenResolution', '4k'], ['imageGenQuality', 'high']]) {
    const select = document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await desktop.waitForFunction(() => document.getElementById('imageGenSubmit')?.textContent?.includes('8 积分'));
const qualityPricing = await desktop.evaluate(() => ({
  labels: [...document.querySelectorAll('#imageGenQuality option')].map((option) => option.textContent?.trim()),
  values: [...document.querySelectorAll('#imageGenQuality option')].map((option) => option.value),
  selectedResolution: document.getElementById('imageGenResolution')?.value,
  selectedQuality: document.getElementById('imageGenQuality')?.value,
  hint: document.getElementById('imageGenCostHint')?.textContent?.trim() || '',
  submit: document.getElementById('imageGenSubmit')?.textContent?.trim() || ''
}));

const feedColumnStability = [];
for (const [pageName, containerId] of [['community', 'communityGrid'], ['creations', 'creationsGrid']]) {
  await desktop.evaluate((nextPage) => window.switchAppPage(nextPage), pageName);
  await desktop.waitForTimeout(120);
  const initial = await desktop.evaluate((id) => {
    const grid = document.getElementById(id);
    window.FeedLayout?.destroyLayout?.(id);
    window.FeedLayout?.resetGridClasses?.(grid);
    grid.innerHTML = Array.from({ length: 36 }, (_, index) => `
      <article class="card community-post-card community-post-card--visual" data-post-id="${id}-${index}" data-feed-order="${index}">
        <div class="card-media"><img class="card-img" alt="" style="height:${180 + (index % 4) * 42}px"></div>
        <div class="card-body" style="min-height:${90 + (index % 3) * 30}px">Feed card ${index}</div>
      </article>`).join('');
    window.FeedLayout?.layout?.(id, { force: true, forceReflow: true, recalcCols: true });
    return window.FeedLayout?.diagnose?.(id) || {};
  }, containerId);
  await desktop.waitForTimeout(160);
  const stable = await desktop.evaluate(async (id) => {
    const grid = document.getElementById(id);
    const columns = [...grid.querySelectorAll(':scope > .community-feed-col')];
    const assignments = () => Object.fromEntries(columns.flatMap((column, columnIndex) =>
      [...column.querySelectorAll(':scope > .card[data-post-id]')]
        .map((card) => [card.dataset.postId, columnIndex])
    ));
    const findScrollRoot = () => {
      let node = grid;
      while (node) {
        const style = getComputedStyle(node);
        if (/auto|scroll|overlay/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 8) return node;
        node = node.parentElement;
      }
      return grid;
    };
    const beforeColumns = assignments();
    const scrollRoot = findScrollRoot();
    scrollRoot.scrollTop = Math.min(320, Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight));
    const beforeTop = scrollRoot.scrollTop;
    const firstMedia = columns[0]?.querySelector('.card-media');
    const firstImage = firstMedia?.querySelector('.card-img');
    if (firstMedia) firstMedia.style.height = '760px';
    firstImage?.dispatchEvent(new Event('load'));
    window.FeedLayout?.schedule?.(id, { fromImage: true, immediate: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    return {
      mode: window.FeedLayout?.getMode?.(id),
      columns: columns.length,
      sameColumns: JSON.stringify(beforeColumns) === JSON.stringify(assignments()),
      beforeTop,
      afterTop: scrollRoot.scrollTop
    };
  }, containerId);
  feedColumnStability.push({ pageName, containerId, initial, stable });
}

const mobileResults = [];
for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await prepare(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${viewport.width}:${error}`));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(
    () => typeof window.switchAppPage === 'function' && window.MobileUI?.setImageGenView,
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => window.switchAppPage('imagegen'));
  try {
    await page.waitForFunction(
      () => Array.isArray(window.__IMAGE_GEN_MODELS__)
        && window.__IMAGE_GEN_MODELS__.some((model) => model.id === 'image2-A')
        && !document.getElementById('imageGenModel')?.disabled
        && document.querySelectorAll('#imageGenModel option').length > 1
        && document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').length >= 3,
      null,
      { timeout: 30000 }
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      build: window.__APP_BUILD__,
      models: window.__IMAGE_GEN_MODELS__?.map((model) => model.id) || [],
      disabled: document.getElementById('imageGenModel')?.disabled,
      options: document.querySelectorAll('#imageGenModel option').length,
      families: document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').length,
      body: document.body.className
    }));
    throw new Error(`Mobile catalog timeout ${viewport.width}: ${JSON.stringify(state)}; pageErrors=${errors.join(' | ')}; ${error}`);
  }
  const selectState = await page.evaluate(() => {
    const select = document.getElementById('imageGenModel');
    const trigger = select?.nextElementSibling;
    const relevant = [...document.querySelectorAll('select:not(.desktop-only):not([multiple])')];
    return {
      nativeDisplay: getComputedStyle(select).display,
      trigger: !!trigger?.classList.contains('mobile-custom-select-trigger'),
      triggerText: trigger?.textContent?.trim() || '',
      enhanced: relevant.length,
      missingTriggers: relevant
        .filter((item) => !item.nextElementSibling?.classList.contains('mobile-custom-select-trigger'))
        .map((item) => item.id)
    };
  });
  await page.locator('#imageGenModel + .mobile-custom-select-trigger').click();
  await page.waitForSelector('.mobile-select-overlay.open', { state: 'visible' });
  const picker = await page.evaluate(() => ({
    visible: !!document.querySelector('.mobile-select-overlay.open'),
    options: document.querySelectorAll('.mobile-select-option').length,
    title: document.querySelector('.mobile-select-title')?.textContent || ''
  }));
  await page.screenshot({ path: join(outputDir, `mobile-${viewport.width}-picker.png`), fullPage: false });
  await page.locator('.mobile-select-close').click();

  await page.evaluate(() => {
    window.switchAppPage('warehouse');
    const container = document.getElementById('cardsContainer');
    container.className = 'cards-container mobile-grid warehouse-mobile-columns';
    container.innerHTML = '<div class="warehouse-mobile-col"></div><div class="warehouse-mobile-col"></div>';
    const columns = container.querySelectorAll('.warehouse-mobile-col');
    for (let index = 0; index < 24; index += 1) {
      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.id = `m-${index}`;
      card.innerHTML = `<div style="height:${150 + (index % 4) * 35}px"></div><div class="card-body">Card ${index}</div>`;
      columns[index % 2].appendChild(card);
    }
  });
  await page.waitForTimeout(100);
  const warehouseScroll = await page.evaluate(() => {
    const main = document.querySelector('.app-main');
    const before = main.scrollTop;
    main.scrollTop = Math.min(500, main.scrollHeight);
    main.dispatchEvent(new Event('scroll'));
    return {
      clientHeight: main.clientHeight,
      scrollHeight: main.scrollHeight,
      before,
      after: main.scrollTop,
      touchAction: getComputedStyle(main).touchAction
    };
  });

  await page.evaluate(() => {
    window.switchAppPage('imagegen');
    window.MobileUI.setImageGenView('form');
    const scroll = document.querySelector('.imagegen-form-scroll');
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:1400px;min-height:1400px;flex:0 0 1400px';
    spacer.dataset.qaSpacer = '1';
    scroll.appendChild(spacer);
  });
  await page.waitForTimeout(100);
  const formScroll = await page.evaluate(() => {
    const scroll = document.querySelector('.imagegen-form-scroll');
    scroll.scrollTop = Math.min(420, scroll.scrollHeight);
    return {
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      after: scroll.scrollTop,
      touchAction: getComputedStyle(scroll).touchAction
    };
  });
  await page.evaluate(() => window.MobileUI.setImageGenView('feed'));
  await page.waitForTimeout(600);
  const imageFeedGrid = await page.evaluate(async () => {
    const feed = document.getElementById('imageGenFeed');
    feed.className = 'imagegen-feed imagegen-feed--tiles mobile-feed-grid';
    feed.innerHTML = `
      <article class="imagegen-feed-card imagegen-feed-card-tile"><div class="imagegen-feed-media imagegen-gen-pending"></div><div class="imagegen-feed-content">A</div></article>
      <article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--failed"><div class="imagegen-feed-media imagegen-gen-failed"></div><div class="imagegen-feed-content"><p>失败内容</p><div class="imagegen-feed-foot imagegen-feed-foot--failed"><button class="btn">重试</button><button class="btn">复制</button><button class="btn" data-failed-dismiss>×</button></div></div></article>
      <div class="imagegen-feed-library-cta">最近生成说明</div>`;
    window.FeatureDraft?.enforceMobileImageGenFeed?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cards = [...feed.querySelectorAll(':scope > .imagegen-feed-card')];
    const rects = cards.map((card) => card.getBoundingClientRect());
    const cta = feed.querySelector(':scope > .imagegen-feed-library-cta')?.getBoundingClientRect();
    const pendingStyle = getComputedStyle(cards[0].querySelector('.imagegen-gen-pending'), '::after');
    return {
      display: getComputedStyle(feed).display,
      columns: getComputedStyle(feed).gridTemplateColumns,
      widths: rects.map((rect) => Math.round(rect.width)),
      sameRow: Math.abs(rects[0].top - rects[1].top) < 2,
      ctaAfterCards: !!cta && cta.top >= Math.min(rects[0].bottom, rects[1].bottom),
      horizontalOverflow: feed.scrollWidth > feed.clientWidth + 1,
      pendingAnimation: pendingStyle.animationName
    };
  });
  await page.screenshot({ path: join(outputDir, `mobile-${viewport.width}-image-feed.png`), fullPage: false });
  mobileResults.push({ viewport, selectState, picker, warehouseScroll, formScroll, imageFeedGrid });
  await context.close();
}

const result = { desktopLayout, desktopScrollStability, textFilter, catalog, resolutionModelStability, qualityPricing, feedColumnStability, mobileResults, errors };
console.log(JSON.stringify(result, null, 2));
if (
  desktopLayout.overlaps !== 0
  || desktopLayout.display !== 'grid'
  || desktopLayout.columns !== 3
  || desktopLayout.cards !== 9
  || desktopLayout.columnGaps.some((gap) => gap < 0 || gap > 24)
) {
  throw new Error('Desktop warehouse layout regression');
}
if (!desktopScrollStability.sameColumns || Math.abs(desktopScrollStability.afterTop - desktopScrollStability.beforeTop) > 2) {
  throw new Error(`Desktop warehouse scroll regression: ${JSON.stringify(desktopScrollStability)}`);
}
if (textFilter.empty || textFilter.ids.join(',') !== 'qa-text') {
  throw new Error(`Desktop text filter regression: ${JSON.stringify(textFilter)}`);
}
if (!catalog.ids.includes('image2-A') || !['gim2', 'banana', 'midjourney'].every((family) => catalog.families.includes(family))) {
  throw new Error('Image catalog family regression');
}
if (
  resolutionModelStability.length !== 4
  || resolutionModelStability.some((step) => step.model !== 'image2-A' || !step.optionExists || step.optionCount < 1)
) {
  throw new Error(`Image resolution model regression: ${JSON.stringify(resolutionModelStability)}`);
}
if (
  qualityPricing.labels.join(',') !== '低,中,高'
  || qualityPricing.values.join(',') !== 'low,standard,high'
  || qualityPricing.selectedResolution !== '4k'
  || qualityPricing.selectedQuality !== 'high'
  || !qualityPricing.submit.includes('8 积分')
) {
  throw new Error(`Image quality pricing regression: ${JSON.stringify(qualityPricing)}`);
}
for (const feed of feedColumnStability) {
  if (
    feed.stable.mode !== 'flex-columns'
    || feed.stable.columns < 2
    || !feed.stable.sameColumns
    || feed.stable.afterTop < feed.stable.beforeTop - 2
  ) throw new Error(`Desktop feed stability regression: ${JSON.stringify(feed)}`);
}
for (const mobile of mobileResults) {
  if (
    mobile.selectState.nativeDisplay !== 'none'
    || !mobile.selectState.trigger
    || mobile.selectState.missingTriggers.length
    || !mobile.picker.visible
    || mobile.picker.options < 1
  ) throw new Error(`Mobile select regression: ${JSON.stringify(mobile)}`);
  if (mobile.warehouseScroll.after <= 0 || mobile.formScroll.after <= 0) {
    throw new Error(`Mobile scroll regression: ${JSON.stringify(mobile)}`);
  }
  if (
    mobile.imageFeedGrid.display !== 'grid'
    || !mobile.imageFeedGrid.sameRow
    || mobile.imageFeedGrid.ctaAfterCards !== true
    || mobile.imageFeedGrid.horizontalOverflow
    || mobile.imageFeedGrid.widths.some((width) => width < 120)
    || mobile.imageFeedGrid.pendingAnimation === 'none'
  ) throw new Error(`Mobile image feed regression: ${JSON.stringify(mobile.imageFeedGrid)}`);
}
if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);

await desktopContext.close();
await browser.close();
