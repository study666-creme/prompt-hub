/**
 * 部署前：index 与 pack 文件契约（防 Cloudflare .bundle.js / ?v= 复发）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'index.html');
const index = readFileSync(indexPath, 'utf8');

const requiredPacks = [
  'pack-prelude.js',
  'pack-foundation.js',
  'pack-core.js',
  'pack-viewer.js',
  'pack-appreciate.js',
  'pack-lightbox.js',
  'pack-feed.js',
  'pack-imagegen.js',
  'pack-account.js',
  'pack-extra.js'
];

const forbidden = [
  { re: /\.bundle\.js/i, msg: '禁止引用 *.bundle.js（Pages script 请求会 SPA 回退 HTML）' },
  { re: /pack-[a-z]+\.js\?v=/i, msg: 'pack-*.js 禁止 ?v= 查询串' }
];

let failed = 0;
for (const { re, msg } of forbidden) {
  if (re.test(index)) {
    console.error(`verify-pack-contract: ${msg}`);
    failed++;
  }
}

const scriptSrcRe = /src="([^"]+\.js[^"]*)"/g;
let sm;
while ((sm = scriptSrcRe.exec(index)) !== null) {
  const src = sm[1];
  if (src.includes('/dist/') || src.startsWith('dist/')) {
    console.error(`verify-pack-contract: script src 禁止 /dist/ 路径: ${src}`);
    failed++;
  }
}

for (const pack of requiredPacks) {
  if (!index.includes(`src="${pack}"`)) {
    console.error(`verify-pack-contract: index.html missing <script src="${pack}">`);
    failed++;
  }
  const path = join(root, pack);
  if (!existsSync(path)) {
    console.error(`verify-pack-contract: missing file ${pack} — run build-all-bundles`);
    failed++;
  } else {
    const head = readFileSync(path, 'utf8').slice(0, 60);
    if (/^\s*</.test(head)) {
      console.error(`verify-pack-contract: ${pack} looks like HTML`);
      failed++;
    }
  }
}

if (failed) process.exit(1);
console.log(`verify-pack-contract OK (${requiredPacks.length} packs, index clean)`);
