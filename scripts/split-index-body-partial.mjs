import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, 'index.html');
const partialPath = join(root, 'partials', 'index-body.html');

const html = readFileSync(indexPath, 'utf8');
const marker = '__PROMPT_HUB_INDEX_BODY_PARTIAL__';

if (html.includes(marker)) {
  const partial = readFileSync(partialPath, 'utf8');
  if (!partial.includes('mobileBottomNav')) {
    throw new Error('partials/index-body.html does not look like the index body fragment');
  }
  console.log('split-index-body-partial: index.html already uses partials/index-body.html');
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

const loader = `
  <script>
    window.__PROMPT_HUB_INDEX_BODY_PARTIAL__ = true;
    (function () {
      var path = 'partials/index-body.html?v=' + encodeURIComponent(window.__APP_BUILD__ || 'dev');
      var xhr = new XMLHttpRequest();
      xhr.open('GET', path, false);
      xhr.send(null);
      if (!((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText))) {
        throw new Error('Prompt Hub index body partial failed to load: ' + xhr.status);
      }
      var script = document.currentScript;
      if (script && script.parentNode) {
        script.insertAdjacentHTML('beforebegin', xhr.responseText);
        script.parentNode.removeChild(script);
      } else {
        document.body.insertAdjacentHTML('afterbegin', xhr.responseText);
      }
    })();
  </script>
`;

mkdirSync(dirname(partialPath), { recursive: true });
writeFileSync(partialPath, bodyFragment, 'utf8');
writeFileSync(indexPath, headAndBodyOpen + loader + tail, 'utf8');

console.log(`split-index-body-partial OK: ${partialPath.replace(/\\/g, '/')}`);
