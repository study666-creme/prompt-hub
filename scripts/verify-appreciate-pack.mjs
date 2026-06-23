/**
 * 部署前：pack-appreciate 含欣赏器/全局欣赏全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'pack-appreciate.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-appreciate-pack: missing pack-appreciate.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.AppAppreciate',
  'window.openAppreciateViewer',
  'window.closeAppreciateViewer',
  'window.syncAppreciateViewerActions',
  'window.toggleGlobalView',
  'window.exitGlobalView',
  'window.forceExitGlobalView'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-appreciate-pack: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 4000 || bytes > 200000) {
  console.error(`verify-appreciate-pack: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-appreciate-pack OK (${bytes} bytes, ${required.length} checks)`);
