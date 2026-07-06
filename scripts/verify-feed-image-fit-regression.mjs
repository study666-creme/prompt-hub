import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssEntry } from './lib/read-css-entry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readCssEntry(root, 'styles-features.css', 'styles/features');

const required = [
  '社区/我的主页/个人主页真实图片按原比例完整展示',
  '#communityGrid:not(.list-view) .community-post-card--visual .card-media .card-img',
  '#creationsGrid:not(.list-view) .community-post-card--visual .card-media .card-img',
  '#userProfileGrid:not(.list-view) .community-post-card--visual .card-media .card-img',
  '#communityGrid:not(.list-view) .community-post-card--visual,',
  '#communityGrid .community-feed-image-only .card-media .card-img',
  'object-fit: contain !important;'
];

const missing = required.filter((token) => !css.includes(token));
if (missing.length) {
  console.error('verify-feed-image-fit-regression: missing tokens:', missing.join(', '));
  process.exit(1);
}

const overrideStart = css.indexOf('社区/我的主页/个人主页真实图片按原比例完整展示');
const overrideCss = overrideStart >= 0 ? css.slice(overrideStart) : '';
if (/community-post-card--visual[\s\S]{0,1200}object-fit:\s*cover\s*!important/i.test(overrideCss)) {
  console.error('verify-feed-image-fit-regression: feed override reintroduces object-fit: cover');
  process.exit(1);
}

console.log('verify-feed-image-fit-regression OK');
