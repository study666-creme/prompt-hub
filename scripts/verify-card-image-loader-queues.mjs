import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'card-image-loader-queues.js'), 'utf8');
let now = 0;
let nextTimerId = 1;
const timers = new Map();

function setTimeoutFake(callback, delay) {
  const id = nextTimerId;
  nextTimerId += 1;
  timers.set(id, { at: now + Number(delay || 0), callback });
  return id;
}

function clearTimeoutFake(id) {
  timers.delete(id);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function advanceTo(target) {
  while (true) {
    const next = [...timers.entries()]
      .filter(([, timer]) => timer.at <= target)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next) break;
    const [id, timer] = next;
    timers.delete(id);
    now = timer.at;
    timer.callback();
    await flushMicrotasks();
  }
  now = target;
  await flushMicrotasks();
}

const context = {
  MobileUI: { getPerf: () => ({ maxDownload: 1 }) },
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'card-image-loader-queues.js' });

const queue = context.CardImageLoaderQueues.create();
let releaseFirst;
const firstUnderlying = new Promise((resolve) => { releaseFirst = resolve; });
let firstStarts = 0;
let secondStarts = 0;

const first = queue.enqueueDownload(() => {
  firstStarts += 1;
  return firstUnderlying;
});
const second = queue.enqueueDownload(async () => {
  secondStarts += 1;
  return 'second-result';
});

await flushMicrotasks();
assert.equal(firstStarts, 1, 'the first download should start immediately');
assert.equal(secondStarts, 0, 'the second download should wait for the only slot');

await advanceTo(29_999);
assert.equal(secondStarts, 0, 'the slot must remain occupied before 30 seconds');

await advanceTo(30_000);
assert.equal(await first, undefined, 'a timed-out queued caller should resolve safely');
assert.equal(secondStarts, 1, 'the next download should start when the slot times out');
assert.equal(await second, 'second-result');

let thirdStarts = 0;
const third = queue.enqueueDownload(async () => {
  thirdStarts += 1;
  return 'third-result';
});
await flushMicrotasks();
assert.equal(thirdStarts, 1, 'the completed second download should release its slot');
assert.equal(await third, 'third-result');

releaseFirst('late-first-result');
await flushMicrotasks();

let fourthStarts = 0;
const fourth = queue.enqueueDownload(async () => {
  fourthStarts += 1;
  return 'fourth-result';
});
await flushMicrotasks();
assert.equal(fourthStarts, 1, 'late completion must not decrement the active count twice');
assert.equal(await fourth, 'fourth-result');

console.log('card-image-loader-queues regression OK');
