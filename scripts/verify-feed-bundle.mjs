/**
 * 部署前：确认 feed bundle 含三个全局出口且体积合理。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'dist', 'feed-modules.bundle.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-feed-bundle: missing dist/feed-modules.bundle.js — run npm run build:feed');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'FeedLayout',
  'FeedImages',
  'ImageGenFeed',
  'FEED_LAYOUT_MODE',
  'resolveImageDisplayUrl',
  'renderImageGenFeed'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-feed-bundle: bundle missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 8000 || bytes > 900000) {
  console.error(`verify-feed-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-feed-bundle OK (${bytes} bytes, ${required.length} checks)`);
