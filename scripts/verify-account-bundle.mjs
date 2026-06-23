/**
 * 部署前：account-modules.bundle 含会员/订阅/任务全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'account-modules.bundle.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-account-bundle: missing account-modules.bundle.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.Membership',
  'window.SubscriptionUI',
  'window.TrialTasksUI',
  'openSubscribePanel',
  'openTrialTasksPanel'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-account-bundle: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 8000 || bytes > 800000) {
  console.error(`verify-account-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-account-bundle OK (${bytes} bytes, ${required.length} checks)`);
