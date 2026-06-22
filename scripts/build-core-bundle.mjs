/**
 * 将 media-pipeline + sync-orchestrator + card-image-loader 合并为单文件（加载顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'media-pipeline.js',
  'sync-orchestrator.js',
  'card-image-loader.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'dist', 'core-pipeline.bundle.js'),
  metaFile: join(root, 'dist', 'core-pipeline.bundle.meta.json'),
  label: 'build-core-bundle'
});
