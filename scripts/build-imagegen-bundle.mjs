/**
 * points-system + imagegen-prompt-kit + imagegen-prompt-tools 合并（加载顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'points-system.js',
  'imagegen-prompt-kit.js',
  'imagegen-prompt-tools.js',
  'imagegen-gen-errors.js',
  'imagegen-warehouse-repair.js',
  'imagegen-ref-compress.js',
  'imagegen-ref-resolve.js',
  'imagegen-warehouse-save.js',
  'imagegen-finish-run.js',
  'imagegen-poll-warehouse.js',
  'imagegen-job-runner.js',
  'imagegen-submit.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'pack-imagegen.js'),
  metaFile: join(root, 'dist', 'pack-imagegen.meta.json'),
  label: 'build-imagegen-bundle'
});
