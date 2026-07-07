import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, 'index.html');
const partialPath = join(root, 'partials', 'index-body.html');
const partialDir = join(root, 'partials', 'index-body');
const fragmentLines = 420;

const html = readFileSync(indexPath, 'utf8');
const marker = '__PROMPT_HUB_INDEX_BODY_PARTIAL__';

function buildFragmentParts(source) {
  const lines = source.replace(/\s+$/, '\n').split(/\r?\n/);
  const chunks = [];
  for (let i = 0; i < lines.length; i += fragmentLines) {
    chunks.push(lines.slice(i, i + fragmentLines).join('\n'));
  }
  mkdirSync(partialDir, { recursive: true });
  const width = String(chunks.length).length < 2 ? 2 : String(chunks.length).length;
  const parts = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const name = `part-${String(i + 1).padStart(width, '0')}.html`;
    const rel = `partials/index-body/${name}`;
    parts.push(rel);
    writeFileSync(join(partialDir, name), chunks[i] + (chunks[i].endsWith('\n') ? '' : '\n'), 'utf8');
  }
  return parts;
}

function readExistingBodyFragment() {
  if (existsSync(partialPath)) return readFileSync(partialPath, 'utf8');
  if (existsSync(partialDir)) {
    const files = readdirSync(partialDir)
      .filter((name) => /^part-\d+\.html$/.test(name))
      .sort();
    if (files.length) return files.map((name) => readFileSync(join(partialDir, name), 'utf8')).join('');
  }
  return '';
}

function loaderFor(parts) {
  return `
  <script>
    window.__PROMPT_HUB_INDEX_BODY_PARTIAL__ = true;
    (function () {
      var parts = ${JSON.stringify(parts, null, 2).replace(/\n/g, '\n      ')};
      var version = encodeURIComponent(window.__APP_BUILD__ || 'dev');
      var html = '';
      for (var i = 0; i < parts.length; i += 1) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', parts[i] + '?v=' + version, false);
        xhr.send(null);
        if (!((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText))) {
          throw new Error('Prompt Hub index body partial failed to load: ' + parts[i] + ' (' + xhr.status + ')');
        }
        html += xhr.responseText;
      }
      var script = document.currentScript;
      if (script && script.parentNode) {
        script.insertAdjacentHTML('beforebegin', html);
        script.parentNode.removeChild(script);
      } else {
        document.body.insertAdjacentHTML('afterbegin', html);
      }
    })();
  </script>
`;
}

if (html.includes(marker)) {
  const partial = readExistingBodyFragment();
  if (!partial.includes('mobileBottomNav')) {
    throw new Error('partials/index-body does not look like the index body fragment');
  }
  const parts = buildFragmentParts(partial);
  if (!html.includes('partials/index-body/part-01.html')) {
    const replaced = html.replace(/  <script>\s*window\.__PROMPT_HUB_INDEX_BODY_PARTIAL__[\s\S]*?<\/script>\r?\n/, loaderFor(parts));
    if (replaced === html) throw new Error('Cannot replace existing index body partial loader');
    writeFileSync(indexPath, replaced, 'utf8');
  }
  console.log(`split-index-body-partial: index.html uses ${parts.length} body fragments`);
  process.exit(0);
}

const bodyOpen = html.match(/<body[^>]*>/i);
if (!bodyOpen || bodyOpen.index === undefined) {
  throw new Error('Cannot find <body> in index.html');
}

const bodyContentStart = bodyOpen.index + bodyOpen[0].length;
const firstRuntimeScript = html.indexOf('  <script src="vendor/supabase.min.js', bodyContentStart);
if (firstRuntimeScript === -1) {
  throw new Error('Cannot find the first runtime script boundary in index.html');
}

const headAndBodyOpen = html.slice(0, bodyContentStart);
const bodyFragment = html.slice(bodyContentStart, firstRuntimeScript).replace(/^\r?\n/, '').replace(/\s+$/, '\n');
const tail = html.slice(firstRuntimeScript);

if (!bodyFragment.includes('mobileBottomNav') || bodyFragment.includes('<script')) {
  throw new Error('Body fragment boundary looks unsafe');
}

const parts = buildFragmentParts(bodyFragment);

writeFileSync(indexPath, headAndBodyOpen + loaderFor(parts) + tail, 'utf8');

console.log(`split-index-body-partial OK: ${parts.length} body fragments`);
