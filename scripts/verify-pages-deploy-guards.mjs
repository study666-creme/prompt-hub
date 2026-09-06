import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const indexHtml = read('index.html');
const assetStudioHtml = read('asset-studio.html');
const bumpBuild = read('scripts/bump-build.ps1');
const deployPages = read('deploy-pages.ps1');
const predeploy = read('scripts/run-predeploy-smoke.mjs');
const stagePages = read('scripts/stage-pages.ps1');
const adminSource = [
  read('admin.html'),
  ...['part-01.js', 'part-02.js', 'part-03.js', 'part-04.js', 'part-05.js', 'part-06.js']
    .map((name) => read(`legacy/admin/${name}`))
].join('\n');

const buildId = indexHtml.match(/__APP_BUILD__\s*=\s*'([^']+)'/)?.[1];
assert(buildId, 'index.html is missing __APP_BUILD__');

const localAssetVersions = Array.from(
  assetStudioHtml.matchAll(/(?:src|href)=["']((?!https?:|\/\/)[^"']+\.(?:js|css))\?v=([^"']+)/gi),
  (match) => ({ path: match[1], version: match[2] })
);
assert(localAssetVersions.length >= 10, 'asset-studio.html local JS/CSS references were not detected');
for (const asset of localAssetVersions) {
  assert(
    asset.version === buildId,
    `asset-studio.html cache version for ${asset.path} is ${asset.version}, expected ${buildId}`
  );
}

requireTokens('scripts/bump-build.ps1', bumpBuild, [
  '(Join-Path $root "asset-studio.html")',
  "-eq 'asset-studio.html'",
  '(?:js|css)\\?v=',
  "'styles-warehouse.css'"
]);
requireTokens('deploy-pages.ps1', deployPages, [
  'scripts\\run-predeploy-smoke.mjs',
  'DO-NOT-DEPLOY.md',
  'status --porcelain',
  '$productionBranch = "main"',
  '--branch=$productionBranch',
  '--commit-dirty=false',
  '--commit-hash=$releaseSha'
]);
assert(
  !deployPages.includes('scripts\\run-predeploy-smoke.ps1'),
  'deploy-pages.ps1 still uses the stale PowerShell-only predeploy chain'
);
requireTokens('scripts/run-predeploy-smoke.mjs', predeploy, [
  "verify-imagegen-catalog-cache.mjs",
  "verify-pages-deploy-guards.mjs"
]);
requireTokens('scripts/stage-pages.ps1', stagePages, [
  '$internalRoutingPattern',
  'Select-String -Pattern @($privateIdentityPattern, $internalRoutingPattern)',
  "@('legacy', 'styles', 'partials')",
  'Pages warehouse first-screen assets verified.',
  'styles-warehouse.css',
  'assets\\studio-preset\\scene.png'
]);
assert(
  !stagePages.includes("$_.Name -notin @('admin.html', 'admin.js')"),
  'Pages confidentiality scan still excludes the admin bundle'
);
assert(
  !stagePages.includes("$_.FullName -notmatch '[\\\\/](vendor|functions)[\\\\/]'"),
  'Pages confidentiality scan still excludes deployed script directories'
);

const forbiddenAdminTokens = [
  'upstreamHost',
  'upstreamRoutes',
  'upstreamCostText',
  'upstreamPoints',
  'channelId',
  'channelName',
  'actualModel',
  'MODEL_PROVIDER_BADGE'
];
for (const token of forbiddenAdminTokens) {
  assert(!adminSource.includes(token), `public admin source contains internal routing field ${token}`);
}

console.log('verify-pages-deploy-guards OK');

function requireTokens(label, source, tokens) {
  const missing = tokens.filter((token) => !source.includes(token));
  assert(!missing.length, `${label} is missing required guards: ${missing.join(', ')}`);
}

function assert(condition, message) {
  if (condition) return;
  console.error(`verify-pages-deploy-guards: ${message}`);
  process.exit(1);
}
