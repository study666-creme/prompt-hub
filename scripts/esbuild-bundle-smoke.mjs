/**
 * Stage-3 前置：验证核心模块可被 esbuild 打包（不替换线上脚本，仅冒烟）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'media-pipeline.js',
  'sync-orchestrator.js',
  'feed-images.js',
  'feed-layout.js',
  'image-gen-feed.js',
  'card-image-loader.js',
  'imagegen-prompt-kit.js',
  'imagegen-prompt-tools.js',
  'points-system.js',
  'membership.js',
  'subscription.js',
  'trial-tasks.js',
  'community-gacha.js',
  'pwa-install.js',
  'cloud-sync-safety.js',
  'modal-hub.js',
  'mobile.js',
  'file-origin-guard.js',
  'image-trim.js',
  'theme.js',
  'app-toast.js',
  'app-viewer-core.js'
];

let failed = 0;
for (const rel of targets) {
  const path = join(root, rel);
  const code = readFileSync(path, 'utf8');
  try {
    buildSync({
      stdin: { contents: code, loader: 'js', sourcefile: rel },
      write: false,
      bundle: true,
      format: 'iife',
      globalName: 'PromptHubBundleSmoke'
    });
    console.log(`esbuild-smoke OK: ${rel}`);
  } catch (e) {
    failed += 1;
    console.error(`esbuild-smoke FAIL: ${rel}`);
    console.error(e?.message || e);
  }
}

if (failed) process.exit(1);
