/**
 * membership + subscription + trial-tasks 合并（须在 script.js 之前，顺序不变）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'membership.js',
  'subscription.js',
  'trial-tasks.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'account-modules.bundle.js'),
  metaFile: join(root, 'dist', 'account-modules.bundle.meta.json'),
  label: 'build-account-bundle'
});
