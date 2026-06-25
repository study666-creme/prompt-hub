/**
 * features-assets 合并（须在 features-draft.js 之后，顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'features-assets.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'pack-assets.js'),
  metaFile: join(root, 'dist', 'pack-assets.meta.json'),
  label: 'build-assets-bundle'
});
