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
  'pack-media-client.js',
  'pack-extra.js'
];

const forbidden = [
  { re: /\.bundle\.js/i, msg: '禁止引用 *.bundle.js（Pages script 请求会 SPA 回退 HTML）' }
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

// 部分 pack 改为首帧后延迟注入（见 index.html 的 __PH_DEFERRED_PACKS_ 标记），
// 因此不再有 <script src="pack.js"> 标签。这里两种形式都接受，但必须至少命中一种，
// 避免某个 pack 被悄悄从 index.html 里摘掉却没人发现。
const deferredBlock = (index.match(/\/\* __PH_DEFERRED_PACKS_START__ \*\/([\s\S]*?)\/\* __PH_DEFERRED_PACKS_END__ \*\//) || [])[1] || '';
const isDeferred = (pack) => deferredBlock.includes(`'${pack}'`);

for (const pack of requiredPacks) {
  const packSrcRe = new RegExp(`src="${pack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[^"]+)?"`);
  if (!packSrcRe.test(index) && !isDeferred(pack)) {
    console.error(
      `verify-pack-contract: index.html 既没有 <script src="${pack}?v=...">，也不在延迟加载队列里`
    );
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
