import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const files = new Map([
  ['feed', read('image-gen-feed.js')],
  ['feed-cards', read('image-gen-feed-cards.js')],
  ['ref-ui', read('imagegen-ref-ui.js')],
  ['submit', read('imagegen-submit.js')],
  ['finish-run', read('imagegen-finish-run.js')],
  ['job-runner', read('imagegen-job-runner.js')],
  ['warehouse-save', read('imagegen-warehouse-save.js')],
  ['part-03', read('legacy/features-draft/part-03.js')],
  ['part-08', read('legacy/features-draft/part-08.js')],
  ['part-10', read('legacy/features-draft/part-10.js')],
  ['part-11', read('legacy/features-draft/part-11.js')],
  ['part-12', read('legacy/features-draft/part-12.js')],
  ['part-13', read('legacy/features-draft/part-13.js')]
]);

checkTokens('feed', [
  'const getFeedRefAssets = () => {',
  'referenceAssets: getFeedRefAssets()',
  "jobId: feedDragImg.getAttribute('data-job-id') || ''",
  'return feedCards.creationToFeedHtml(c);'
]);

checkTokens('feed-cards', [
  '存入库',
  '填入生图',
  '放大预览',
  '下载图片',
  '暂无提示词',
  'MJ·',
  '用户',
  '♥'
]);

checkTokens('ref-ui', [
  'let imageGenRefAssets = [];',
  'function normalizeRefAsset(ref, raw = {}, fallback = {})',
  'function rebuildImageGenRefAssets(refs, opts = {})',
  'function getImageGenReferenceAssets()',
  'imageGenRefAssets = rebuildImageGenRefAssets(imageGenRefImages, opts);',
  'getImageGenReferenceAssets,'
]);

checkTokens('submit', [
  'referenceAssets: d().getImageGenReferenceAssets?.() || []',
  'const submittedReferenceAssets = batchOpts.skipRefImages',
  ': normalizeReferenceAssets(',
  'referenceAssets: submittedReferenceAssets.length ? submittedReferenceAssets : null'
]);

checkTokens('finish-run', [
  'referenceAssets: submittedReferenceAssets',
  'referenceAssets: referenceAssets.length ? referenceAssets.map'
]);

checkTokens('job-runner', [
  'referenceAssets: Array.isArray(job.referenceAssets) ? job.referenceAssets.filter(Boolean) : null'
]);

checkTokens('warehouse-save', [
  'referenceAssets: Array.isArray(opts.referenceAssets) ? opts.referenceAssets.filter(Boolean) : null'
]);

checkTokens('part-03', [
  'referenceAssets: Array.isArray(c.referenceAssets) ? c.referenceAssets.filter(Boolean) : null'
]);

checkTokens('part-08', [
  'referenceAssets: opts.referenceAssets'
]);

checkTokens('part-10', [
  'setImageGenRefs(draft.refImages, { referenceAssets: draft.referenceAssets })',
  'setImageGenRefs([draft.refImage], { referenceAssets: draft.referenceAssets })'
]);

checkTokens('part-11', [
  'referenceAssets: getImageGenReferenceAssets()',
  'setImageGenRefs(refs.slice(0, max), { referenceAssets: assets.slice(0, max) })'
]);

checkTokens('part-12', [
  'fillFormFromData({ prompt, refImage, refImages, model, resolution, quality, size, sourceId, sourceType, refAssetId, referenceAssets })',
  'referenceAssets: item.referenceAssets'
]);

checkTokens('part-13', [
  'referenceAssets: data.referenceAssets',
  "function getImageGenReferenceAssets() { return ru('getImageGenReferenceAssets') || []; }",
  'getImageGenReferenceAssets,'
]);

const feedCreationDefs = countMatches(files.get('feed'), /function creationToFeedHtml\(c\)/g);
if (feedCreationDefs !== 1) {
  fail(`feed should expose exactly one creationToFeedHtml wrapper, found ${feedCreationDefs}`);
}

const cardCreationDefs = countMatches(files.get('feed-cards'), /function creationToFeedHtml\(c\)/g);
if (cardCreationDefs !== 1) {
  fail(`feed-cards should own exactly one creationToFeedHtml implementation, found ${cardCreationDefs}`);
}

const forbiddenFeedCards = [
  '瀛樺叆',
  '濉叆',
  '鏆傛棤',
  '鐢ㄦ埛',
  '涓嬭浇',
  '鏀惧ぇ',
  '鍒犻櫎',
  '脳'
];
const polluted = forbiddenFeedCards.filter((token) => files.get('feed-cards').includes(token));
if (polluted.length) {
  fail(`feed-cards contains mojibake tokens: ${polluted.join(', ')}`);
}

console.log('verify-reference-assets-regression OK');

function checkTokens(label, tokens) {
  const text = files.get(label);
  const missing = tokens.filter((token) => !text.includes(token));
  if (missing.length) {
    fail(`${label} missing tokens:\n${missing.map((token) => `  - ${token}`).join('\n')}`);
  }
}

function countMatches(text, re) {
  return [...text.matchAll(re)].length;
}

function fail(message) {
  console.error(`verify-reference-assets-regression: ${message}`);
  process.exit(1);
}
