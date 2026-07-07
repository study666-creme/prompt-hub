import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');

const files = [
  'script.js',
  'edit-panel-gallery.js',
  'features-draft.js',
  'image-gen-feed.js',
  'media-pipeline.js',
  'sync-orchestrator.js',
  'card-image-loader-queues.js',
  'card-image-loader.js',
  'feed-images.js',
  'feed-layout.js',
  'image-gen-feed-cards.js',
  'mobile.js',
  'features-assets.js',
  'community-public-feed.js',
  'imagegen-gen-errors.js',
  'imagegen-warehouse-repair.js',
  'imagegen-ref-compress.js',
  'imagegen-ref-ui.js',
  'imagegen-ref-resolve.js',
  'imagegen-warehouse-save.js',
  'imagegen-finish-run.js',
  'imagegen-poll-warehouse.js',
  'imagegen-job-state.js',
  'imagegen-job-runner.js',
  'imagegen-submit.js',
  'asset-studio.js',
  'supabase-sync.js',
  'api-client.js',
  'community-gacha.js',
  'admin.js',
  'imagegen-prompt-tools.js',
  'imagegen-prompt-kit.js',
  'points-system.js',
  'cloud-sync-safety.js',
  'app-toast.js',
  'app-viewer-core.js',
  'app-appreciate.js',
  'media-download.js',
  'app-lightbox.js'
];

const failed = [];

for (const rel of files) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  const result = spawnSync(process.execPath, ['--check', path], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  if (result.status !== 0) {
    failed.push(rel);
    console.error(`SYNTAX ERROR: ${rel}`);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failed.length) {
  console.error(`check-js-syntax: ${failed.length} file(s) failed`);
  process.exit(1);
}

console.log(`check-js-syntax: all ${files.length} files OK`);
