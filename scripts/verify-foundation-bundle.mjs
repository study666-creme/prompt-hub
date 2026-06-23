/**
 * 部署前：foundation.bundle 含云同步安全 / 弹层 / 手机 UI 全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'pack-foundation.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-foundation-bundle: missing pack-foundation.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.CloudSyncSafety',
  'window.AppModalHub',
  'window.MobileUI',
  'mergeCardsList',
  'isMobileViewport',
  'unlockPageInteraction',
  'window.showToast'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-foundation-bundle: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 8000 || bytes > 600000) {
  console.error(`verify-foundation-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-foundation-bundle OK (${bytes} bytes, ${required.length} checks)`);
