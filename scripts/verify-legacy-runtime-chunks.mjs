import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readLegacyPartList } from './lib/read-legacy-entry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  { entry: 'features-draft.js', dir: 'legacy/features-draft' },
  { entry: 'script.js', dir: 'legacy/script' },
  { entry: 'supabase-sync.js', dir: 'legacy/supabase-sync' },
  { entry: 'imagegen-prompt-kit.js', dir: 'legacy/imagegen-prompt-kit' },
  { entry: 'features-assets.js', dir: 'legacy/features-assets' },
  { entry: 'asset-studio.js', dir: 'legacy/asset-studio' },
  { entry: 'admin.js', dir: 'legacy/admin' }
];

let checked = 0;
for (const item of entries) {
  const dir = join(root, item.dir);
  if (!existsSync(dir)) continue;
  const entryText = await readFile(join(root, item.entry), 'utf8');
  if (!entryText.includes('__PROMPT_HUB_LEGACY_SPLIT_LOADER__')) {
    throw new Error(`${item.entry} has chunks but is not a split loader`);
  }
  const declaredParts = readLegacyPartList(entryText);
  const files = (await readdir(dir))
    .filter((name) => /^part-\d+\.js$/.test(name))
    .sort();
  if (!files.length) throw new Error(`${item.dir} has no part-*.js chunks`);
  for (const name of files) {
    const rel = `${item.dir}/${name}`;
    if (!entryText.includes(rel)) throw new Error(`${item.entry} loader does not reference ${rel}`);
  }
  if (declaredParts.length !== files.length) {
    throw new Error(`${item.entry} loader declares ${declaredParts.length} chunks but ${item.dir} has ${files.length}`);
  }
  const combined = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('\n');
  try {
    // Parse only. Do not execute the legacy IIFE in Node.
    new Function(combined);
  } catch (err) {
    err.message = `${item.entry} combined chunks parse failed: ${err.message}`;
    throw err;
  }
  checked += 1;
  console.log(`verify-legacy-runtime-chunks OK: ${item.entry} (${files.length} chunks)`);
}

if (!checked) {
  throw new Error('verify-legacy-runtime-chunks found no split legacy entries');
}
