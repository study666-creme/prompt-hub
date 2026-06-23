/**
 * cloud-sync-safety + modal-hub + mobile 合并（须在 supabase-sync / script.js 之前）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
const sources = [
  'cloud-sync-safety.js',
  'modal-hub.js',
  'mobile.js',
  'app-toast.js'
];

concatMinifyBundle({
  root,
  sources,
  outFile: join(root, 'pack-foundation.js'),
  metaFile: join(root, 'dist', 'pack-foundation.meta.json'),
  label: 'build-foundation-bundle'
});
