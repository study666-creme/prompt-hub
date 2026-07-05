/**
 * Phase 2/3：packages/shared + media-client/cache → pack-media-client.js
 */
import { buildSync } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'bridge', 'media-client-entry.js');
const outfile = join(root, 'pack-media-client.js');

buildSync({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  outfile,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  allowOverwrite: true
});

const size = statSync(outfile).size;
console.log(`build-media-client-bundle OK: ${outfile} (${size} bytes)`);
