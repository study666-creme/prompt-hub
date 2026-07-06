import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'card-gallery.js'), 'utf8');

const calls = [];
const context = {
  console,
  SupabaseSync: {
    isInvalidMediaUrl: () => false,
    isEphemeralUpstreamImageUrl: (url) => /^https?:\/\/upstream\.example\//i.test(String(url || '')),
    isStorageRef: (url) => String(url || '').startsWith('storage://'),
    storagePathFromRef: (url) => String(url || '').replace(/^storage:\/\//, ''),
    isPathKnownMissing: () => false,
    cardImageStillResolvable: () => true,
    isDataUrl: (url) => /^data:image\//i.test(String(url || '')),
    isGridDisplayUrl: () => false,
    resolveDisplayUrl: async (_ref, opts) => {
      calls.push(['display', opts]);
      return opts.jobId ? `display:${opts.jobId}` : '';
    }
  },
  MediaPipeline: {
    resolveListUrl: async (_ref, opts) => {
      calls.push(['list', opts]);
      return opts.jobId ? `list:${opts.jobId}` : '';
    },
    resolvePreviewUrl: async (_ref, opts) => {
      calls.push(['preview', opts]);
      return opts.jobId ? `preview:${opts.jobId}` : '';
    }
  },
  WarehouseThumb: {
    resolveForCard: async (_ref, opts) => {
      calls.push(['warehouse', opts]);
      return opts.jobId ? `warehouse:${opts.jobId}` : '';
    }
  }
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(code, context, { filename: 'card-gallery.js' });

const api = context.PromptHubCardGallery;
assert(api, 'PromptHubCardGallery export is missing');

const mjCard = {
  id: 'card-1',
  isMidjourney: true,
  genJobId: 'job-1',
  mjCompositeUrl: 'storage://grid',
  mjGridUrls: ['storage://tile-1', 'storage://tile-2', 'storage://tile-3', 'storage://tile-4'],
  image: 'storage://tile-1'
};

const gallery = api.normalizeCardGallery(mjCard);
assertEqual(gallery[0], 'storage://grid', 'MJ composite should stay at gallery index 0');
assertEqual(gallery.length, 5, 'MJ gallery should include composite plus four tiles');

const cover = api.pickWarehouseListThumb(mjCard);
assertEqual(cover.ref, 'storage://grid', 'feed/list cover should use gallery first image');
assertEqual(cover.galleryIndex, 0, 'feed/list cover should keep index 0');
assertEqual(cover.slotJobId, 'job-1', 'cover slot should use base job id');

const legacyMjCard = {
  id: 'legacy-card',
  genJobId: 'legacy-job',
  mjCompositeUrl: 'storage://legacy-grid',
  mjGridUrls: ['storage://legacy-tile-1', 'storage://legacy-tile-2'],
  cardImages: ['storage://legacy-tile-1', 'storage://legacy-tile-2'],
  image: 'storage://legacy-tile-1'
};

const legacyGallery = api.normalizeCardGallery(legacyMjCard);
assertEqual(legacyGallery[0], 'storage://legacy-grid', 'legacy MJ card with composite should put grid at index 0');
assertEqual(api.pickWarehouseListThumb(legacyMjCard).ref, 'storage://legacy-grid', 'legacy MJ cover should use composite first image');

assertEqual(api.gallerySlotJobId('job-1', 0), 'job-1', 'gallery slot 0 should use base job id');
assertEqual(api.gallerySlotJobId('job-1', 1), 'job-1#2', 'gallery slot 1 should use #2 job id');

calls.length = 0;
const noJobResult = await api.resolveMediaUrl('storage://tile-2', {
  cardId: 'card-1',
  galleryIndex: 1,
  preferFull: true
});
assertEqual(noJobResult, '', 'gallery slot without a real job id should not resolve via card id');
assert(calls.every(([, opts]) => !opts.jobId), 'card id must not be passed as job id');

calls.length = 0;
const slotResult = await api.resolveMediaUrl('storage://tile-2', {
  cardId: 'card-1',
  jobId: 'job-1',
  galleryIndex: 1,
  preferFull: true
});
assertEqual(slotResult, 'preview:job-1#2', 'gallery slot should resolve with tile-specific job id');
assert(calls.some(([, opts]) => opts.jobId === 'job-1#2'), 'tile-specific job id was not used');

console.log('verify-card-gallery-regression OK');

function assert(condition, message) {
  if (!condition) {
    console.error(`verify-card-gallery-regression: ${message}`);
    process.exit(1);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`verify-card-gallery-regression: ${message}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    process.exit(1);
  }
}
