/**
 * 按顺序合并多个 IIFE 源文件并 esbuild 压缩。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { execSync } from 'node:child_process';
import { readLegacyEntry } from './read-legacy-entry.mjs';

export function concatMinifyBundle({ root, sources, outFile, metaFile, label }) {
  const outDir = dirname(outFile);
  mkdirSync(outDir, { recursive: true });

  const combined = sources.map((rel) => {
    return `/* === ${rel} === */\n${readLegacyEntry(root, rel)}`;
  }).join('\n;\n');

  buildSync({
    stdin: { contents: combined, loader: 'js', sourcefile: label || 'bundle.js' },
    outfile: outFile,
    bundle: false,
    minify: true,
    legalComments: 'none',
    target: 'es2018'
  });

  execSync(`node --check "${outFile}"`, { stdio: 'inherit' });

  const stat = readFileSync(outFile, 'utf8');
  if (metaFile) {
    writeFileSync(metaFile, JSON.stringify({
      builtAt: new Date().toISOString(),
      sources,
      bytes: Buffer.byteLength(stat, 'utf8')
    }, null, 2));
  }

  const bytes = Buffer.byteLength(stat, 'utf8');
  console.log(`${label || 'bundle'} OK: ${outFile.replace(/\\/g, '/')} (${bytes} bytes)`);
  return bytes;
}

export function bundleRootFromMeta(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), '..');
}
