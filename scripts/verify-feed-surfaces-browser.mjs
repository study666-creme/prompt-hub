import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 最近生成 + 社区首屏媒体：工作图必须解码渲染，缺图必须显示稳定占位，
// 任何情况下不得出现黑卡或纯文字退化（imagegen-feed-card--no-media）。
// 独立 fixture（data URL 图片，零网络），在 1440x900 / 1024x768 / 390x844
// 三个视口验证；不访问生产、不发送生成请求。

const playwrightPackageDir = process.env.PLAYWRIGHT_PACKAGE_DIR || '';
const playwrightImport = playwrightPackageDir
  ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
  : 'playwright';
const playwright = await import(playwrightImport);
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const root = join(import.meta.dirname, '..');
const okImage = await readFile(join(root, 'assets/studio-preset/scene.png'));
const okData = `data:image/png;base64,${okImage.toString('base64')}`;
const badData = 'data:image/png;base64,not-a-valid-image';

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1024x768', width: 1024, height: 768 },
  { name: 'mobile-390x844', width: 390, height: 844 }
];

function buildHtml() {
  const feedMedia = (src) => (
    `<div class="imagegen-feed-media is-loading"><img data-image-ref="${src}" src="${src}" alt="" decoding="async"></div>`
  );
  const communityMedia = (src) => (
    `<div class="card-media is-loading"><img class="card-img" data-image-ref="${src}" src="${src}" alt="" decoding="async"></div>`
  );
  const feedCards = [0, 1, 2].map((i) => (
    `<article class="imagegen-feed-card" data-feed-id="cr_surface-${i}">${feedMedia(okData)}<div class="imagegen-feed-body">最近生成 ${i}</div></article>`
  )).join('');
  const feedMissing = `<article class="imagegen-feed-card" data-feed-id="cr_surface-missing">${feedMedia(badData)}<div class="imagegen-feed-body">最近生成缺图</div></article>`;
  const communityCards = [0, 1, 2].map((i) => (
    `<article class="card community-post-card community-post-card--visual" data-post-id="surface-c-${i}">${communityMedia(okData)}<div class="card-body"><div class="card-title">社区卡 ${i}</div></div></article>`
  )).join('');
  const communityMissing = `<article class="card community-post-card community-post-card--visual" data-post-id="surface-c-missing">${communityMedia(badData)}<div class="card-body"><div class="card-title">社区卡缺图</div></div></article>`;
  return `<!doctype html><meta charset="utf-8"><style>
    .imagegen-feed-card, .community-post-card { margin: 8px; max-width: 320px; }
    .imagegen-feed-media, .card-media { aspect-ratio: 4/3; overflow: hidden; }
    img { width: 100%; height: 100%; object-fit: cover; }
  </style>
  <div id="imageGenFeed">${feedCards}${feedMissing}</div>
  <div id="communityGrid">${communityCards}${communityMissing}</div>`;
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.setContent(buildHtml());
    await page.addScriptTag({ path: join(root, 'feed-images.js') });
    await page.waitForTimeout(600);
    const result = await page.evaluate(() => {
      const read = (rootSel, mediaSel, missingRef) => {
        const rootEl = document.querySelector(rootSel);
        const cards = [...(rootEl?.querySelectorAll('.imagegen-feed-card, .community-post-card') || [])];
        return {
          cardCount: cards.length,
          decoded: [...(rootEl?.querySelectorAll('img') || [])]
            .filter((img) => img.complete && img.naturalWidth > 0).length,
          failed: [...(rootEl?.querySelectorAll('.card-media--load-failed') || [])].length,
          placeholders: [...(rootEl?.querySelectorAll('.card-media-placeholder') || [])].length,
          textOnly: cards.filter((card) => card.classList.contains('imagegen-feed-card--no-media')
            || (card.classList.contains('card--text-only') && card.querySelector('img'))).length,
          workingBroken: [...(rootEl?.querySelectorAll('img') || [])]
            .filter((img) => img.getAttribute('data-image-ref') !== missingRef
              && (img.classList.contains('img-load-failed')
                || (img.complete && img.naturalWidth === 0))).length
        };
      };
      const feedImages = window.FeedImages.init({ isDisplayableImage: () => true });
      document.querySelectorAll('#imageGenFeed img[data-image-ref$="not-a-valid-image"]')
        .forEach((img) => feedImages.finalizeFeedImageFailure(img));
      feedImages.stripFailedFeedMedia(document.getElementById('imageGenFeed'));
      document.querySelectorAll('#communityGrid img[data-image-ref$="not-a-valid-image"]')
        .forEach((img) => feedImages.finalizeFeedImageFailure(img));
      return {
        imageGenFeed: read('#imageGenFeed', '.imagegen-feed-media', 'data:image/png;base64,not-a-valid-image'),
        community: read('#communityGrid', '.card-media', 'data:image/png;base64,not-a-valid-image')
      };
    });
    const failures = [];
    for (const [surface, s] of Object.entries(result)) {
      if (s.cardCount < 4) failures.push(`${surface} too few cards (${s.cardCount})`);
      if (s.decoded < 2) failures.push(`${surface} working media not decoded (${s.decoded})`);
      if (s.failed < 1) failures.push(`${surface} missing-image card not failed`);
      if (s.placeholders !== s.failed) failures.push(`${surface} placeholders (${s.placeholders}) != failed (${s.failed})`);
      if (s.textOnly > 0) failures.push(`${surface} collapsed to text-only (${s.textOnly})`);
      if (s.workingBroken > 0) failures.push(`${surface} working media left broken/black (${s.workingBroken})`);
    }
    if (failures.length) {
      throw new Error(`feed surfaces contract ${vp.name}: ${failures.join('; ')}; ${JSON.stringify(result)}`);
    }
    console.log(`verify-feed-surfaces ${vp.name} OK`, JSON.stringify(result));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
}
