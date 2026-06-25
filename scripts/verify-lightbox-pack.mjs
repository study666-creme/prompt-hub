/**
 * 部署前：pack-lightbox 含灯箱业务全局出口。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'pack-lightbox.js');

let code;
try {
  code = readFileSync(bundlePath, 'utf8');
} catch {
  console.error('verify-lightbox-pack: missing pack-lightbox.js');
  process.exit(1);
}

execSync(`node --check "${bundlePath}"`, { stdio: 'inherit' });

const required = [
  'window.MediaDownload',
  'window.promptHubSaveImage',
  'window.AppLightbox',
  'window.openLightbox',
  'window.setLightboxSrc',
  'window.closeLightbox',
  'window.syncLightboxActions',
  'window.downloadLightboxImage'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-lightbox-pack: missing tokens:', missing.join(', '));
  process.exit(1);
}

const bytes = statSync(bundlePath).size;
if (bytes < 4000 || bytes > 250000) {
  console.error(`verify-lightbox-pack: suspicious size ${bytes} bytes`);
  process.exit(1);
}

console.log(`verify-lightbox-pack OK (${bytes} bytes, ${required.length} checks)`);
