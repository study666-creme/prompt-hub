/**
 * 部署前：app-extra.bundle 含社区抽卡 / PWA 全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'app-extra.bundle.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-app-extra-bundle: missing app-extra.bundle.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.CommunityGacha',
  'beforeinstallprompt',
  'pwaInstallBanner'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-app-extra-bundle: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 3000 || bytes > 400000) {
  console.error(`verify-app-extra-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-app-extra-bundle OK (${bytes} bytes, ${required.length} checks)`);
