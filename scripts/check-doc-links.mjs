import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const roots = ['README.md', 'CHANGELOG.md', 'docs', 'extension'];
const files = [];

function collect(path) {
  const full = join(root, path);
  if (!existsSync(full)) return;
  const stat = statSync(full);
  if (stat.isDirectory()) {
    for (const name of readdirSync(full)) collect(join(path, name));
    return;
  }
  if (extname(full).toLowerCase() === '.md') files.push(full);
}

for (const path of roots) collect(path);

const failures = [];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      failures.push(`${file.slice(root.length + 1)}:${line} -> ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error('Broken local documentation links:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`check-doc-links: ${files.length} Markdown files OK`);
