/**
 * app-viewer-core 单文件包（须在 script.js 之前）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
concatMinifyBundle({
  root,
  sources: ['app-viewer-core.js'],
  outFile: join(root, 'pack-viewer.js'),
  metaFile: join(root, 'dist', 'pack-viewer.meta.json'),
  label: 'build-viewer-pack'
});
