import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readLegacyEntry(root, entry, chunkDir) {
  const entryPath = join(root, entry);
  const entryText = readFileSync(entryPath, 'utf8');
  if (!entryText.includes('__PROMPT_HUB_LEGACY_SPLIT_LOADER__')) return entryText;

  const parts = readLegacyPartList(entryText);
  if (parts.length) {
    return parts.map((rel) => readFileSync(join(root, rel), 'utf8')).join('\n');
  }

  if (!chunkDir) throw new Error(`No legacy chunk list found for ${entry}`);
  const dir = join(root, chunkDir);
  const files = readdirSync(dir)
    .filter((name) => /^part-\d+\.js$/.test(name))
    .sort();
  if (!files.length) throw new Error(`No legacy chunks found for ${entry} in ${chunkDir}`);
  return files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
}

export function readLegacyPartList(entryText) {
  const match = entryText.match(/var\s+parts\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];
  const parts = JSON.parse(match[1]);
  if (!Array.isArray(parts) || parts.some((part) => typeof part !== 'string' || !/^legacy\/.+\/part-\d+\.js$/.test(part))) {
    throw new Error('Invalid legacy split part list');
  }
  return parts;
}
