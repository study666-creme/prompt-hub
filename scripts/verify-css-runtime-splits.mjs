import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  { entry: 'styles.css', dir: 'styles/base' },
  { entry: 'styles-features.css', dir: 'styles/features' }
];

let checked = 0;
for (const item of entries) {
  const dir = join(root, item.dir);
  if (!existsSync(dir)) continue;
  const manifest = await readFile(join(root, item.entry), 'utf8');
  if (!manifest.includes('__PROMPT_HUB_CSS_SPLIT_MANIFEST__')) {
    throw new Error(`${item.entry} has CSS chunks but is not a split manifest`);
  }
  const files = (await readdir(dir)).filter((name) => /^part-\d+\.css$/.test(name)).sort();
  if (!files.length) throw new Error(`${item.dir} has no part-*.css chunks`);
  for (const file of files) {
    const rel = `${item.dir}/${file}`;
    if (!manifest.includes(rel)) throw new Error(`${item.entry} manifest does not reference ${rel}`);
    const css = await readFile(join(dir, file), 'utf8');
    if (!css.trim()) throw new Error(`${rel} is empty`);
  }
  checked += 1;
  console.log(`verify-css-runtime-splits OK: ${item.entry} (${files.length} chunks)`);
}

if (!checked) throw new Error('verify-css-runtime-splits found no split CSS entries');
