/**
 * 部署前：buildFeatureDraftExports 的 shorthand 导出必须已有 function/let/const 声明。
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLegacyEntry } from './lib/read-legacy-entry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readLegacyEntry(root, 'features-draft.js', 'legacy/features-draft');

const start = code.indexOf('function buildFeatureDraftExports()');
if (start < 0) {
  console.error('audit-features-draft-exports FAIL: buildFeatureDraftExports not found');
  process.exit(1);
}
const ret = code.indexOf('return {', start);
let depth = 0;
let i = code.indexOf('{', ret);
const begin = i;
for (; i < code.length; i++) {
  if (code[i] === '{') depth++;
  else if (code[i] === '}') {
    depth--;
    if (depth === 0) {
      i++;
      break;
    }
  }
}
const block = code.slice(begin + 1, i - 1);
const names = new Set();
for (const line of block.split('\n')) {
  const m = line.match(/^\s{4}([a-zA-Z_$][\w$]*)\s*(?:,|$)/);
  if (m) names.add(m[1]);
}

const fnDef = new Set(
  [...code.matchAll(/(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1])
);
const bound = new Set(
  [...code.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\b/g)].map((m) => m[1])
);

const missing = [...names].filter((n) => !fnDef.has(n) && !bound.has(n)).sort();
if (missing.length) {
  console.error('audit-features-draft-exports FAIL:', missing.join(', '));
  process.exit(1);
}

console.log('audit-features-draft-exports OK:', names.size, 'exports');
