/**
 * 部署前：确认 pack 文件是 JS 而非 SPA 回退的 index.html。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packs = [
  'pack-prelude.js',
  'pack-foundation.js',
  'pack-core.js',
  'pack-viewer.js',
  'pack-appreciate.js',
  'pack-lightbox.js',
  'pack-feed.js',
  'pack-imagegen.js',
  'pack-account.js',
  'pack-extra.js',
  'pack-media-client.js'
];

for (const name of packs) {
  const path = join(root, name);
  let head;
  try {
    head = readFileSync(path, 'utf8').slice(0, 80);
  } catch {
    console.error(`verify-bundle-bytes: missing ${name}`);
    process.exit(1);
  }
  if (/^\s*</.test(head) || head.includes('<!DOCTYPE')) {
    console.error(`verify-bundle-bytes: ${name} looks like HTML, not JavaScript`);
    process.exit(1);
  }
  if (!/function|\(function|\(\(\)=>/.test(head)) {
    console.error(`verify-bundle-bytes: ${name} does not look like bundled JS`);
    process.exit(1);
  }
  const bytes = statSync(path).size;
  if (bytes < 2500) {
    console.error(`verify-bundle-bytes: ${name} too small (${bytes} bytes)`);
    process.exit(1);
  }
  console.log(`verify-bundle-bytes OK: ${name} (${bytes} bytes)`);
}
