/**
 * app-lightbox 单文件包（须在 pack-viewer 之后、script.js 之前）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
concatMinifyBundle({
  root,
  sources: ['app-lightbox.js'],
  outFile: join(root, 'pack-lightbox.js'),
  metaFile: join(root, 'dist', 'pack-lightbox.meta.json'),
  label: 'build-lightbox-pack'
});
