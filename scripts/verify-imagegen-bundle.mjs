/**
 * 部署前：确认 imagegen tools bundle 含两个全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'imagegen-tools.bundle.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-imagegen-bundle: missing imagegen-tools.bundle.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'ImageGenPromptKit',
  'ImageGenPromptTools',
  'generateInspirationPrompts',
  'updateRefToolState',
  'listContentTypes',
  'CONTENT_TEMPLATES'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-imagegen-bundle: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 10000 || bytes > 1200000) {
  console.error(`verify-imagegen-bundle: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-imagegen-bundle OK (${bytes} bytes, ${required.length} checks)`);
