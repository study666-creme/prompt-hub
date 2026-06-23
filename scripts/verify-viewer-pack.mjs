/**
 * 部署前：pack-viewer 含灯箱/欣赏器全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'pack-viewer.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-viewer-pack: missing pack-viewer.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.setViewerNav',
  'window.getViewerNav',
  'window.attachImageZoom',
  'window.resetImageZoom',
  'window.getLightboxFrame',
  'viewerWheelBound'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-viewer-pack: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 2000 || bytes > 200000) {
  console.error(`verify-viewer-pack: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-viewer-pack OK (${bytes} bytes, ${required.length} checks)`);
