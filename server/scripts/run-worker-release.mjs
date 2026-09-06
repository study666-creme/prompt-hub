import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '..');
const historicalRoot = resolve(repositoryRoot, '..', 'canvas', 'prompt-hub');
const dryRun = process.argv.slice(2).includes('--dry-run');

function git(...args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

if (!dryRun) {
  const freezeMarkers = [
    resolve(repositoryRoot, 'DO-NOT-DEPLOY.md'),
    resolve(historicalRoot, 'DO-NOT-DEPLOY.md')
  ].filter(existsSync);
  if (freezeMarkers.length) {
    throw new Error(`Worker release is frozen by: ${freezeMarkers.join(', ')}`);
  }
  if (git('status', '--porcelain')) {
    throw new Error('Worker release requires a clean, reviewed Git worktree');
  }
}

const buildSha = git('rev-parse', 'HEAD').toLowerCase();
if (!/^[0-9a-f]{40}$/.test(buildSha)) throw new Error('Unable to resolve the release Git SHA');

const wrangler = resolve(serverRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(wrangler)) throw new Error('Run npm ci before building the Worker release');

const args = [wrangler, 'deploy'];
if (dryRun) args.push('--dry-run');
args.push('--var', `BUILD_SHA:${buildSha}`);
console.log(`${dryRun ? 'Dry-running' : 'Deploying'} prompt-hub-api build ${buildSha}`);
const result = spawnSync(process.execPath, args, { cwd: serverRoot, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
