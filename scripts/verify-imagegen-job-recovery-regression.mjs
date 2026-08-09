import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key))
  };
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  document: { getElementById: () => null }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of ['imagegen-job-state.js', 'imagegen-job-runner.js']) {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
}

const runner = sandbox.ImageGenJobRunner.init({
  getPendingJobs: () => [],
  setPendingJobs: () => {},
  getFailedJobs: () => [],
  setFailedJobs: () => {},
  normalizeImageGenModelId: (value) => String(value || '').trim().toLowerCase(),
  isGenerationJobDeleted: () => false
});

const now = Date.now();
const job = (id, status, ageMs, imageUrl = null) => ({
  id,
  status,
  prompt: '同一个回归提示词',
  model: 'image2-A',
  resolution: '4k',
  imageUrl,
  createdAt: new Date(now - ageMs).toISOString()
});
const processing = job('processing-old', 'processing', 20_000);
const completed = job('completed-real', 'completed', 5_000, 'https://example.test/result.png');

const recovered = runner.findBestApiJobForPrompt(
  [processing, completed],
  '同一个回归提示词',
  'IMAGE2-a',
  { minCreatedAt: now - 30_000, preferProcessing: true, resolution: '4k' }
);
if (recovered?.id !== completed.id) {
  throw new Error(`Completed recovery job lost to stale processing job: ${recovered?.id || 'none'}`);
}

const processingFallback = runner.findBestApiJobForPrompt(
  [processing, { ...completed, imageUrl: null }],
  '同一个回归提示词',
  'image2-A',
  { minCreatedAt: now - 30_000, preferProcessing: true, resolution: '4k' }
);
if (processingFallback?.id !== processing.id) {
  throw new Error(`Processing fallback regression: ${processingFallback?.id || 'none'}`);
}

const usedFallback = runner.findBestApiJobForPrompt(
  [processing, completed],
  '同一个回归提示词',
  'image2-A',
  { minCreatedAt: now - 30_000, preferProcessing: true, resolution: '4k', usedJobIds: new Set([completed.id]) }
);
if (usedFallback?.id !== processing.id) {
  throw new Error(`Used job exclusion regression: ${usedFallback?.id || 'none'}`);
}

console.log('imagegen-job-recovery-regression: passed');
