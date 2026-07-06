import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readCssEntry(root, entry, chunkDir) {
  const entryPath = join(root, entry);
  const manifest = readFileSync(entryPath, 'utf8');
  if (!manifest.includes('__PROMPT_HUB_CSS_SPLIT_MANIFEST__')) return manifest;
  const dir = join(root, chunkDir);
  const files = readdirSync(dir)
    .filter((name) => /^part-\d+\.css$/.test(name))
    .sort();
  if (!files.length) throw new Error(`No CSS chunks found for ${entry} in ${chunkDir}`);
  return files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
}
