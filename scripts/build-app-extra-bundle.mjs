/**
 * community-gacha + pwa-install 合并（须在 features-draft.js 之后，顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'community-gacha.js',
  'pwa-install.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'pack-extra.js'),
  metaFile: join(root, 'dist', 'pack-extra.meta.json'),
  label: 'build-app-extra-bundle'
});
