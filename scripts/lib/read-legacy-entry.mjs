import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readLegacyEntry(root, entry, chunkDir) {
  const entryPath = join(root, entry);
  const entryText = readFileSync(entryPath, 'utf8');
  if (!entryText.includes('__PROMPT_HUB_LEGACY_SPLIT_LOADER__')) return entryText;
  const dir = join(root, chunkDir);
  const files = readdirSync(dir)
    .filter((name) => /^part-\d+\.js$/.test(name))
    .sort();
  if (!files.length) throw new Error(`No legacy chunks found for ${entry} in ${chunkDir}`);
  return files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
}
