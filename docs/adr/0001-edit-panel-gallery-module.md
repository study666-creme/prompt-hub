# ADR-0001: Extract Edit Panel Gallery Helpers

Date: 2026-07-07

## Status

Accepted

## Context

`script.js` still owns the card warehouse editor, but the edit side panel gallery path has become a separate concern:

- It normalizes card galleries, including MJ composite images.
- It maps the active gallery slot to the correct job id.
- It resolves the preview image for the current slot without falling back to the card list thumbnail.
- It is covered by browser regression tests after the side panel paging bug.

Keeping this logic inline made future fixes harder because the surrounding file also contains auth, warehouse rendering, sync, import/export, and batch actions.

## Decision

Add `edit-panel-gallery.js` as a small global module loaded after `card-gallery.js` and before `script.js`.

`script.js` keeps the old local function names as thin compatibility wrappers:

- `getEditPanelCardGallery`
- `getEditPanelCardJobId`
- `getEditPanelSlotJobId`
- `isPanelDisplayableImageUrl`
- `resolveEditPanelGalleryPreview`

This is a strangler-style extraction: callers do not change, behavior stays the same, and future panel gallery fixes can land in the smaller module.

## Invariants

- Do not change the saved card schema.
- Do not remove `genJobId`, `cardImages`, `mjCompositeUrl`, or `mjGridUrls`.
- Do not use warehouse list thumbnails as the current side panel slot preview.
- Keep `edit-panel-gallery.js` loaded before `script.js`.
- Any deployment smoke must verify the standalone script is served as JavaScript, not HTML.

## Verification

- `node --check edit-panel-gallery.js`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-js-syntax.ps1`
- `node scripts/verify-edit-panel-gallery-regression.mjs`
- `node scripts/verify-edit-panel-gallery-browser.mjs`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-predeploy-smoke.ps1`
