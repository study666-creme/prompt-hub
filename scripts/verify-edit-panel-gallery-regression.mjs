import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLegacyEntry } from './lib/read-legacy-entry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readLegacyEntry(root, 'script.js', 'legacy/script');

const required = [
  'function getEditPanelCardJobId(card)',
  'function getEditPanelSlotJobId(card, galleryIndex)',
  'async function resolveEditPanelGalleryPreview(ref, card, galleryIndex)',
  'resolveEditPanelGalleryPreview(imageAtStart, cardAtStart, galleryIndexAtStart)',
  'useJobImageApi: false',
  'allowGridFallback: false',
  "src = window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(imageData) ? '' : imageData;",
  'cardJobId: lightboxJobId || undefined',
  'mjJobId: lightboxJobId || undefined'
];

const forbidden = [
  'resolveCardListThumb(cardModel)',
  'resolveCardListThumb(cardAtStart)',
  'galleryIndexAtStart <= 0 && cardAtStart && window.MediaPipeline?.resolveCardListThumb',
  'const resolved = await window.PromptHubCardGallery?.resolveMediaUrl?.(ref, resolveOpts);',
  'getListCached?.(imageAtStart, cardIdAtStart',
  'getListDisplayImageSrc?.(imageAtStart, cardIdAtStart',
  'isGridDisplayUrl?.(imageData) ? imageData :',
  'src || domGrid || (refIsEphemeral ? \'\' : ref)',
  'cardJobId: full.genJobId ? String(full.genJobId).replace(/#\\d+$/, \'\') : full.id',
  'jobId: full.genJobId || null',
  'card?.genJobId,\n        panelGalleryIndex'
];

const missing = required.filter((token) => !code.includes(token));
if (missing.length) {
  console.error('verify-edit-panel-gallery-regression: missing tokens:', missing.join(', '));
  process.exit(1);
}

const present = forbidden.filter((token) => code.includes(token));
if (present.length) {
  console.error('verify-edit-panel-gallery-regression: forbidden tokens:', present.join(', '));
  process.exit(1);
}

console.log('verify-edit-panel-gallery-regression OK');
