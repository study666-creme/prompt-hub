/**
 * feed-layout + feed-images + image-gen-feed 合并（加载顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'feed-layout.js',
  'feed-images.js',
  'image-gen-feed.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'dist', 'feed-modules.bundle.js'),
  metaFile: join(root, 'dist', 'feed-modules.bundle.meta.json'),
  label: 'build-feed-bundle'
});
