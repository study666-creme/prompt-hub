/**
 * imagegen-prompt-kit + imagegen-prompt-tools 合并（加载顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'imagegen-prompt-kit.js',
  'imagegen-prompt-tools.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'imagegen-tools.bundle.js'),
  metaFile: join(root, 'dist', 'imagegen-tools.bundle.meta.json'),
  label: 'build-imagegen-bundle'
});
