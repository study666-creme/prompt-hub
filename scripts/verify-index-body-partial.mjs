import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const partialDir = join(root, 'partials', 'index-body');
const partialFiles = readdirSync(partialDir)
  .filter((name) => /^part-\d+\.html$/.test(name))
  .sort();
const partial = partialFiles.map((name) => readFileSync(join(partialDir, name), 'utf8')).join('');

const requiredIndexTokens = [
  '__PROMPT_HUB_INDEX_BODY_PARTIAL__',
  'partials/index-body/part-01.html',
  '<script src="vendor/supabase.min.js'
];
const requiredPartialTokens = [
  'app-chrome',
  'ocrModal',
  'imageGenModel',
  'mobileBottomNav'
];

for (const token of requiredIndexTokens) {
  if (!index.includes(token)) {
    console.error(`verify-index-body-partial: index.html missing ${token}`);
    process.exit(1);
  }
}

for (const token of requiredPartialTokens) {
  if (!partial.includes(token)) {
    console.error(`verify-index-body-partial: partial missing ${token}`);
    process.exit(1);
  }
}

if (partial.includes('<script')) {
  console.error('verify-index-body-partial: partial fragments must not contain script tags');
  process.exit(1);
}

if (partialFiles.length < 2) {
  console.error('verify-index-body-partial: expected multiple body fragments');
  process.exit(1);
}

for (const name of partialFiles) {
  const rel = `partials/index-body/${name}`;
  if (!index.includes(rel)) {
    console.error(`verify-index-body-partial: index.html missing ${rel}`);
    process.exit(1);
  }
  const bytes = statSync(join(partialDir, name)).size;
  if (bytes > 50000) {
    console.error(`verify-index-body-partial: ${rel} is too large (${bytes} bytes)`);
    process.exit(1);
  }
}

if (index.includes('<nav class="mobile-bottom-nav')) {
  console.error('verify-index-body-partial: index.html still contains the expanded body fragment');
  process.exit(1);
}

const indexBytes = statSync(join(root, 'index.html')).size;
if (indexBytes > 40000) {
  console.error(`verify-index-body-partial: index.html is too large after split (${indexBytes} bytes)`);
  process.exit(1);
}

console.log(`verify-index-body-partial OK (${indexBytes} byte shell, ${partialFiles.length} fragments)`);
