/**
 * 部署前：确认 core bundle 含三个全局出口且体积合理。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'pack-core.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-core-bundle: missing pack-core.js — run npm run build:all');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.MediaPipeline',
  'window.SyncOrchestrator',
  'window.CardImageLoader',
  'resolveFeedUrl',
  'schedulePush',
  'schedulePull',
  'requestFeedRefresh',
  'notifyCardsChanged'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-core-bundle: bundle missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 5000 || bytes > 500000) {
  console.error(`verify-core-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-core-bundle OK (${bytes} bytes, ${required.length} checks)`);
