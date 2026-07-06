import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const partialPath = join(root, 'partials', 'index-body.html');
const partial = readFileSync(partialPath, 'utf8');

const requiredIndexTokens = [
  '__PROMPT_HUB_INDEX_BODY_PARTIAL__',
  'partials/index-body.html?v=',
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
  console.error('verify-index-body-partial: partial must not contain script tags');
  process.exit(1);
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

console.log(`verify-index-body-partial OK (${indexBytes} byte shell)`);
