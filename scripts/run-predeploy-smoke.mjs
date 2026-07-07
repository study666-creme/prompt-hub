import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args) {
  if (label) console.log(`${label} ...`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function runNode(label, rel) {
  run(label, process.execPath, [join(scriptsDir, rel)]);
}

runNode('', 'check-js-syntax.mjs');

if (existsSync(join(root, 'legacy'))) {
  runNode('verify-legacy-runtime-chunks', 'verify-legacy-runtime-chunks.mjs');
}

if (existsSync(join(root, 'styles'))) {
  runNode('verify-css-runtime-splits', 'verify-css-runtime-splits.mjs');
}

if (existsSync(join(root, 'partials', 'index-body'))) {
  runNode('verify-index-body-partial', 'verify-index-body-partial.mjs');
}

runNode('audit-features-draft-exports', 'audit-features-draft-exports.mjs');
runNode('audit-features-draft-wire', 'audit-features-draft-wire.mjs');
runNode('verify-card-gallery-regression', 'verify-card-gallery-regression.mjs');
runNode('verify-edit-panel-gallery-regression', 'verify-edit-panel-gallery-regression.mjs');
runNode('verify-feed-image-fit-regression', 'verify-feed-image-fit-regression.mjs');
runNode('verify-mobile-feed-regression', 'verify-mobile-feed-regression.mjs');
runNode('verify-reference-assets-regression', 'verify-reference-assets-regression.mjs');
runNode('verify-admin-split-regression', 'verify-admin-split-regression.mjs');

if (!existsSync(join(root, 'node_modules', 'esbuild'))) {
  console.log('Installing root npm deps (esbuild) ...');
  run('', npmBin, ['install', '--no-audit', '--no-fund']);
}

runNode('esbuild-bundle-smoke', 'esbuild-bundle-smoke.mjs');
runNode('build-all-bundles', 'build-all-bundles.mjs');
runNode('verify-bundle-bytes', 'verify-bundle-bytes.mjs');
runNode('verify-core-bundle', 'verify-core-bundle.mjs');
runNode('verify-feed-bundle', 'verify-feed-bundle.mjs');
runNode('bundle-vm-smoke', 'run-bundle-vm-smoke.mjs');
runNode('feed-bundle-vm-smoke', 'run-feed-bundle-vm-smoke.mjs');
runNode('verify-imagegen-bundle', 'verify-imagegen-bundle.mjs');
runNode('imagegen-bundle-vm-smoke', 'run-imagegen-bundle-vm-smoke.mjs');
runNode('verify-app-extra-bundle', 'verify-app-extra-bundle.mjs');
runNode('app-extra-bundle-vm-smoke', 'run-app-extra-bundle-vm-smoke.mjs');
runNode('verify-account-bundle', 'verify-account-bundle.mjs');
runNode('account-bundle-vm-smoke', 'run-account-bundle-vm-smoke.mjs');
runNode('verify-foundation-bundle', 'verify-foundation-bundle.mjs');
runNode('foundation-bundle-vm-smoke', 'run-foundation-bundle-vm-smoke.mjs');
runNode('verify-viewer-pack', 'verify-viewer-pack.mjs');
runNode('verify-appreciate-pack', 'verify-appreciate-pack.mjs');
runNode('verify-lightbox-pack', 'verify-lightbox-pack.mjs');
runNode('verify-pack-contract', 'verify-pack-contract.mjs');

console.log('predeploy-smoke: all checks passed');
