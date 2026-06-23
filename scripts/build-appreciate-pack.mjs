/**
 * app-appreciate 单文件包（须在 pack-viewer 之后、pack-lightbox 之前）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
concatMinifyBundle({
  root,
  sources: ['app-appreciate.js'],
  outFile: join(root, 'pack-appreciate.js'),
  metaFile: join(root, 'dist', 'pack-appreciate.meta.json'),
  label: 'build-appreciate-pack'
});
