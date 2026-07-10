import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const loader = read('card-image-loader.js');
const layout = read('feed-layout.js');
const imageFeed = read('image-gen-feed.js');
const mobileCss = read('styles-mobile.css');
const scriptPart01 = read('legacy/script/part-01.js');
const scriptPart09 = read('legacy/script/part-09.js');
const syncPart03 = read('legacy/supabase-sync/part-03.js');

const requiredLoaderTokens = [
  'ownWarehouseMobile',
  'window.MobileUI?.isUserInteracting?.()',
  'isImgNearViewport(img, 900, whRoot)',
  'window.finalizeWarehouseCardMediaFailure?.(feedMediaFromImg(img), img)',
  'window.FeatureDraft?.removeBrokenCommunityFeedCard?.(media)',
  'queueGridBackfillForImg(img)',
  'scheduleImageGenWarehouseRepair()',
  'tryAlternateFeedCover(img)',
  "signedRoot?.id === 'cardsContainer'",
  'const containerSignReady = new Map();',
  'function enqueueDownload(fn) { return queues.enqueueDownload(fn); }',
  'function enqueueResolve(fn) { return queues.enqueueResolve(fn); }',
  'function enqueueFeedResolve(fn) { return queues.enqueueFeedResolve(fn); }'
];

const requiredLayoutTokens = [
  'function isCreationsStale(container)',
  'flattenColumns(container)',
  "container.classList.add('community-feed-grid', 'community-feed-columns')",
  "container.classList.remove('community-mobile-feed', 'masonry-ready', 'cards-grid-priming')",
  'container.style.overflow = \'visible\''
];

const requiredImageFeedTokens = [
  "wrap.classList.add('imagegen-feed--tiles', 'mobile-feed-grid')",
  "wrap.querySelectorAll('.grid-sizer').forEach((el) => el.remove())",
  "wrap.querySelectorAll('.imagegen-feed-card').forEach((el) => el.removeAttribute('style'))"
];

const requiredCssTokens = [
  '#communityGrid.community-feed-columns:not(.list-view)',
  '#creationsGrid.community-feed-columns:not(.list-view)',
  '#pageCommunity .feature-shell,',
  'overflow-x: clip;',
  'display: contents;',
  'flex: 0 0 calc((100% - 12px) / 2) !important;',
  '#cardsContainer.cards-container .card .card-media:not(.is-loading):not(.card-media--await) .card-img',
  'object-fit: contain;',
  '#imageGenFeed.mobile-feed-grid',
  '.imagegen-feed.imagegen-feed--tiles',
  'gap: 12px !important;',
  'row-gap: 12px !important;',
  'column-gap: 12px !important;'
];

checkTokens('loader', loader, requiredLoaderTokens);
checkTokens('layout', layout, requiredLayoutTokens);
checkTokens('image-feed', imageFeed, requiredImageFeedTokens);
checkTokens('mobile-css', mobileCss, requiredCssTokens);
checkTokens('warehouse-page-size', scriptPart01, ['const MOBILE_PER_PAGE = 12;']);
checkTokens('community-strict-lazy', loader, [
  '|| isCommunityContainer(container);',
  "window.MobileUI?.isMobileViewport?.() ? '160px 0px' : '280px 0px'",
  'const nearPx = window.MobileUI?.isMobileViewport?.() ? 180 : 360;'
]);
checkTokens('warehouse-full-fallback', scriptPart09, [
  "const allowFullFallback = viewMode !== 'list' && showImage;",
  'data-allow-full-fallback="1"'
]);
checkTokens('sync-full-fallback', syncPart03, ['function allowWarehouseFullFallback(img)']);

const forbiddenLoader = [
  /\bdownloadActive\b/,
  /\bdownloadQueue\b/,
  /\bresolveActive\b/,
  /\bresolveQueue\b/,
  /\bfeedResolveActive\b/,
  /\bfeedResolveQueue\b/,
  /function\s+pumpDownloadQueue\s*\(/,
  /function\s+runResolveQueue\s*\(/,
  /function\s+runFeedResolveQueue\s*\(/
];

for (const re of forbiddenLoader) {
  if (re.test(loader)) {
    console.error(`verify-mobile-feed-regression: forbidden loader queue residue matched: ${re}`);
    process.exit(1);
  }
}

if (/function allowWarehouseFullFallback\(img\)[\s\S]{0,180}isMobileViewport/.test(loader)) {
  console.error('verify-mobile-feed-regression: warehouse full fallback was restricted to mobile');
  process.exit(1);
}

if (/function allowWarehouseFullFallback\(img\)[\s\S]{0,180}isMobileViewport/.test(syncPart03)) {
  console.error('verify-mobile-feed-regression: sync warehouse full fallback was restricted to mobile');
  process.exit(1);
}

const forbiddenCss = [
  /#cardsContainer[\s\S]{0,650}\.card-img[\s\S]{0,180}object-fit:\s*cover/i,
  /#imageGenFeed[\s\S]{0,700}gap:\s*(2[4-9]|[3-9]\d)px\s*!important/i,
  /#communityGrid\.community-feed-columns[\s\S]{0,700}gap:\s*(2[4-9]|[3-9]\d)px\s*!important/i,
  /#pageCommunity\s+\.feature-shell[\s\S]{0,180}overflow-y:\s*auto/i,
  /body\.efficiency-mode\s+#(?:creationsGrid|communityGrid)\.cards-container[\s\S]{0,500}overflow-y:\s*auto/i
];

for (const re of forbiddenCss) {
  if (re.test(mobileCss)) {
    console.error(`verify-mobile-feed-regression: forbidden mobile CSS pattern matched: ${re}`);
    process.exit(1);
  }
}

console.log('verify-mobile-feed-regression OK');

function checkTokens(label, text, tokens) {
  const missing = tokens.filter((token) => !text.includes(token));
  if (missing.length) {
    console.error(`verify-mobile-feed-regression: ${label} missing tokens:`);
    for (const token of missing) console.error(`  - ${token}`);
    process.exit(1);
  }
}
