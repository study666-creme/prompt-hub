/**
 * file-origin-guard + image-trim（须在 theme.js 之前）。
 */
import { join } from 'node:path';
import { concatMinifyBundle, bundleRootFromMeta } from './lib/concat-minify-bundle.mjs';

const root = bundleRootFromMeta(import.meta.url);
concatMinifyBundle({
  root,
  sources: ['file-origin-guard.js', 'image-trim.js'],
  outFile: join(root, 'pack-prelude.js'),
  metaFile: join(root, 'dist', 'pack-prelude.meta.json'),
  label: 'build-prelude-pack'
});
