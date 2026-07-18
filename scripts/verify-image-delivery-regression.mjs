import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const apiClient = read('api-client.js');
const loader = read('card-image-loader.js');
const imageFeed = read('image-gen-feed.js');
const jobRunner = read('imagegen-job-runner.js');
const jobState = read('imagegen-job-state.js');
const imageSubmit = read('imagegen-submit.js');
const featureBoot = read('legacy/features-draft/part-01.js');
const featureSubmit = read('legacy/features-draft/part-08.js');
const featureModelUi = read('legacy/features-draft/part-11.js');
const imageGenMarkup = read('partials/index-body/part-03.html');
const imageGenCss = read('styles/features/part-11.css');
const imageGenMotionCss = read('styles/features/part-10.css');
const baseCss = read('styles/base/part-04.css');
const mobileCss = read('styles-mobile.css');

checkTokens('generation image API', apiClient, [
  'async function getGenerationImageUrl(jobId, opts = {})',
  "const variant = opts.variant === 'grid' ? 'grid' : 'full';",
  '/url?variant=${variant}'
]);

checkTokens('generation direct-submit API', apiClient, [
  'if (!opts?.directFirst)',
  'directFirst: true'
]);

checkTokens('generation submit feedback', imageSubmit, [
  'function waitForSubmitPaint()',
  "btn.classList.add('is-submitting');",
  "btn.textContent = '已开始生成';",
  'isImageGenMobileFormActive'
]);

checkTokens('pending reference compaction', jobState, [
  'function compactPendingJobsForStorage(list)',
  '/^(?:data:|blob:)/i.test(value)',
  'pending: compactPendingJobsForStorage(pendingList())'
]);

checkTokens('generation submit motion', imageGenMotionCss, [
  '#imageGenSubmit.is-submitting::before',
  '#imageGenSubmit.is-submitted::before',
  '@keyframes imageGenSubmitConfirm'
]);

checkTokens('desktop generation feed grid', imageGenMotionCss, [
  'display: grid !important;',
  'grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)) !important;',
  'grid-auto-rows: max-content !important;',
  'min-width: 0 !important;'
]);

checkTokens('recent image loader', loader, [
  "variant: wantFull ? 'full' : 'grid'",
  'if (jobUrl && isReadySrc(jobUrl, img)) return jobUrl;',
  'if (jobId && recoverWarehouseListGeneratedImg(img, feedMediaFromImg(img))) return;'
]);

checkTokens('recent feed warmup', imageFeed, [
  "getGenerationImageUrl(jobId, { variant: 'grid' })"
]);

checkTokens('broken image concealment', baseCss, [
  '.card-media.card-media--load-failed .card-img',
  'visibility: hidden !important;',
  'opacity: 0 !important;'
]);

checkTokens('mobile edit panel motion', mobileCss, [
  '.edit-panel.hidden {',
  'display: flex !important;',
  'transform: translate3d(100%, 0, 0);',
  'visibility 0s linear 280ms;'
]);

checkTokens('idle generation polling', jobRunner, [
  'if (shouldRunGenJobsBackgroundSync()) scheduleGenJobsSync(300);',
  'if (shouldRunGenJobsBackgroundSync()) scheduleGenJobsSync(200);'
]);

checkTokens('simplified generation form', imageGenMarkup, [
  'id="imageGenAdvancedFold"',
  '<span>输出与入库</span>',
  'data-param="quality"',
  'id="imageGenPromptBlock"',
  'class="imagegen-ref-block"'
]);

checkTokens('generation form hierarchy', imageGenCss, [
  '#pageImageGen .imagegen-advanced-fold',
  'grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)) !important;',
  '#imageGenFeed .card-media--load-failed img'
]);

checkTokens('quality parameter visibility', featureModelUi, [
  'const qParam = qEl?.closest(\'.imagegen-param[data-param="quality"]\');',
  'if (qParam) qParam.hidden = hideQuality;'
]);

const modelIndex = imageGenMarkup.indexOf('id="imageGenModel"');
const advancedIndex = imageGenMarkup.indexOf('id="imageGenAdvancedFold"');
const promptIndex = imageGenMarkup.indexOf('id="imageGenPromptBlock"');
const referenceIndex = imageGenMarkup.indexOf('class="imagegen-ref-block"');
if (!(modelIndex < advancedIndex && advancedIndex < promptIndex && promptIndex < referenceIndex)) {
  fail('generation form order must remain model, optional settings, prompt, reference');
}

if (/scheduleGenJobsSync\(delay\);\s*if \(pending \|\| opts\.forceJobs\)/.test(featureBoot)) {
  fail('image generation boot must not poll jobs when no task is active');
}

if (/fetchMediaAsBlobUrl\(jobUrl\)/.test(loader)) {
  fail('recent signed CDN images must not be downloaded again as Blob URLs');
}

if (/MobileUI\?\.setImageGenView/.test(imageSubmit) || /setImageGenView\('feed'/.test(featureSubmit)) {
  fail('generation submit must not force mobile users from the form to the feed');
}

if ((apiClient.match(/directFirst:\s*true/g) || []).length < 3) {
  fail('image, MJ action and MJ blend requests must all skip the successful-path health preflight');
}

const desktopGridBlock = cssRuleBlock(
  imageGenMotionCss,
  '#imageGenFeed.imagegen-feed.imagegen-feed--desktop-grid'
);
if (!desktopGridBlock || /display:\s*flex\s*!important/.test(desktopGridBlock)) {
  fail('desktop generation feed must remain CSS Grid, not a flex container with auto-width cards');
}

for (const name of ['card-beam-loading', 'card-beam-trbl']) {
  const block = keyframesBlock(baseCss, name);
  if (!block) fail(`missing @keyframes ${name}`);
  if (/\b(?:top|left|filter)\s*:/.test(block)) {
    fail(`${name} must animate only compositor-safe properties`);
  }
}

console.log('verify-image-delivery-regression OK');

function keyframesBlock(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

function cssRuleBlock(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open + 1);
  return open >= 0 && close >= 0 ? css.slice(open + 1, close) : '';
}

function checkTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${label} missing token: ${token}`);
  }
}

function fail(message) {
  console.error(`verify-image-delivery-regression: ${message}`);
  process.exit(1);
}
