/**
 * 将 media-pipeline + sync-orchestrator + card-image-loader 合并为单文件（加载顺序不变）。
 * 输出到站点根目录，避免 Cloudflare Pages SPA 把 /dist/*.js 回退成 index.html。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'warehouse-thumb.js',
  'media-pipeline.js',
  'sync-orchestrator.js',
  'card-image-loader-queues.js',
  'card-image-loader.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'pack-core.js'),
  metaFile: join(root, 'dist', 'pack-core.meta.json'),
  label: 'build-core-bundle'
});
