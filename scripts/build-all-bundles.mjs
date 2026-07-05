/**
 * 构建全部前端 esbuild 包（部署 / 本地预览前调用）。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

for (const name of [
  'build-prelude-pack.mjs',
  'build-core-bundle.mjs',
  'build-feed-bundle.mjs',
  'build-imagegen-bundle.mjs',
  'build-account-bundle.mjs',
  'build-app-extra-bundle.mjs',
  'build-foundation-bundle.mjs',
  'build-viewer-pack.mjs',
  'build-appreciate-pack.mjs',
  'build-lightbox-pack.mjs',
  'build-assets-bundle.mjs',
  'build-media-client-bundle.mjs'
]) {
  const path = join(scriptsDir, name);
  const r = spawnSync(process.execPath, [path], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('build-all-bundles OK');
