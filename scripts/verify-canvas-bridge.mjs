import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app-router.js', import.meta.url), 'utf8');
const opened = [];
const storage = new Map();
const window = {
  PROMPT_CANVAS_URL: 'https://canvas.prompt-hubs.com/canvas?keep=1',
  location: { origin: 'https://prompt-hubs.com', pathname: '/' },
  history: { pushState() {}, replaceState() {}, state: null },
  open(url, target, features) {
    opened.push({ url, target, features });
    return { closed: false };
  },
  addEventListener() {}
};
const sessionStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

vm.runInNewContext(source, {
  window,
  sessionStorage,
  URL,
  Date,
  console
}, { filename: 'app-router.js' });

const base = new URL(window.PromptCanvasBridge.buildUrl());
assert.equal(base.pathname, '/canvas');
assert.equal(base.searchParams.get('keep'), '1');
assert.equal(base.searchParams.has('phCardId'), false);

window.openPromptCanvasCard('card_123');
assert.equal(opened.length, 1);
const handoff = new URL(opened[0].url);
assert.equal(handoff.origin, 'https://canvas.prompt-hubs.com');
assert.equal(handoff.pathname, '/canvas');
assert.equal(handoff.searchParams.get('keep'), '1');
assert.equal(handoff.searchParams.get('phSource'), 'prompt-hub');
assert.equal(handoff.searchParams.get('phVersion'), '1');
assert.equal(handoff.searchParams.get('phIntent'), 'insert-card');
assert.equal(handoff.searchParams.get('phCardId'), 'card_123');
assert.equal(opened[0].target, '_blank');
assert.equal(opened[0].features, 'noopener,noreferrer');
assert.equal(window.PromptCanvasBridge.consumeRefreshAfterCanvas(), true);
assert.equal(window.PromptCanvasBridge.consumeRefreshAfterCanvas(), false);

assert.equal(window.openPromptCanvasCard('bad\ncard'), null);
assert.equal(opened.length, 1);

window.PROMPT_CANVAS_URL = 'javascript:alert(1)';
assert.equal(new URL(window.PromptCanvasBridge.buildUrl()).origin, 'https://canvas.prompt-hubs.com');

console.log('verify-canvas-bridge OK');
