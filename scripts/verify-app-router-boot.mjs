import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const routerSource = readFileSync(join(root, 'app-router.js'), 'utf8');
const bodySource = readdirSync(join(root, 'partials', 'index-body'))
  .filter((name) => /^part-\d+\.html$/.test(name))
  .sort()
  .map((name) => readFileSync(join(root, 'partials', 'index-body', name), 'utf8'))
  .join('\n');

function resolveBootApp(pathname, savedPage = 'community') {
  const window = {
    location: {
      pathname,
      search: '',
      hash: '',
      origin: 'https://prompt-hubs.test'
    },
    history: {
      state: null,
      pushState() {},
      replaceState() {}
    },
    addEventListener() {}
  };
  const localStorage = {
    getItem(key) {
      return key === 'promptrepo_app_page' ? savedPage : null;
    }
  };

  vm.runInNewContext(routerSource, { URL, console, localStorage, window }, { filename: 'app-router.js' });
  return window.AppRouter.resolveBootApp();
}

assert.equal(resolveBootApp('/'), 'landing', 'root must ignore a stale saved community page');
assert.equal(resolveBootApp('/prompts/'), 'warehouse');
assert.equal(resolveBootApp('/generate/'), 'imagegen');
assert.equal(resolveBootApp('/community/'), 'community');
assert.equal(resolveBootApp('/profile/'), 'creations');
assert.equal(resolveBootApp('/dev/'), 'devlab');

const activePages = [...bodySource.matchAll(/<div class="([^"]*\bapp-page\b[^"]*\bactive\b[^"]*)" id="([^"]+)"/g)]
  .map((match) => match[2]);
assert.deepEqual(activePages, ['pageLanding'], 'static body must expose only the landing page before scripts boot');

console.log(`verify-app-router-boot OK: ${activePages[0]} is the only static active page`);
