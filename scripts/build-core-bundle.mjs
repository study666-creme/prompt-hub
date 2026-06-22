/**
 * 将 media-pipeline + sync-orchestrator + card-image-loader 合并为单文件（加载顺序不变）。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const outFile = join(outDir, 'core-pipeline.bundle.js');
const sources = [
  'media-pipeline.js',
  'sync-orchestrator.js',
  'card-image-loader.js'
];

const combined = sources.map((rel) => {
  const path = join(root, rel);
  return `/* === ${rel} === */\n${readFileSync(path, 'utf8')}`;
}).join('\n;\n');

mkdirSync(outDir, { recursive: true });

buildSync({
  stdin: { contents: combined, loader: 'js', sourcefile: 'core-pipeline.bundle.js' },
  outfile: outFile,
  bundle: false,
  minify: true,
  legalComments: 'none',
  target: 'es2018'
});

execSync(`node --check "${outFile}"`, { stdio: 'inherit' });

const stat = readFileSync(outFile, 'utf8');
writeFileSync(join(outDir, 'core-pipeline.bundle.meta.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  sources,
  bytes: Buffer.byteLength(stat, 'utf8')
}, null, 2));

console.log(`build-core-bundle OK: dist/core-pipeline.bundle.js (${Buffer.byteLength(stat, 'utf8')} bytes)`);
