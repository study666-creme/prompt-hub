# Frontend Split Map

Updated: 2026-08-11

This project still ships classic browser scripts from the site root, but several formerly large files are now thin runtime loaders. The real source is split into ordered chunks so classic script execution order and old global/IIFE behavior stay unchanged.

## Runtime Split Loaders

Root loader files:

- `features-draft.js` -> `legacy/features-draft/part-*.js`
- `script.js` -> `legacy/script/part-*.js`
- `supabase-sync.js` -> `legacy/supabase-sync/part-*.js`
- `admin.js` -> `legacy/admin/part-*.js`
- `asset-studio.js` -> `legacy/asset-studio/part-*.js`
- `features-assets.js` -> `legacy/features-assets/part-*.js`
- `imagegen-prompt-kit.js` -> `legacy/imagegen-prompt-kit/part-*.js`

Do not paste old monolithic code back into these root files. Edit the matching `legacy/.../part-*.js` chunk, then run the checks below.

## HTML And CSS Splits

- `index.html` keeps the head and script order, while the body DOM is loaded from `partials/index-body/part-*.html`.
- `styles.css` imports `styles/base/part-*.css`.
- `styles-features.css` imports `styles/features/part-*.css`.
- `styles-warehouse.css` is the `20260803a` standalone warehouse UI layer loaded after the shared CSS entries. It is not generated from a split CSS directory.

The source split loaders are synchronous in the repository so local development keeps the old classic-script order. They must not be shipped as the production request graph.

## Warehouse UI Ownership

The 2026-08-03 `20260803a` production release keeps the warehouse redesign isolated from generated bundles:

- `partials/index-body/part-02.html` owns the toolbar and compact warehouse summary markup.
- `legacy/script/part-04.js` owns summary count/scope synchronization.
- `legacy/script/part-09.js` owns card metadata and the actionable empty state.
- `styles-warehouse.css` owns warehouse-only layout, surface hierarchy, status accents, list/grid presentation, light theme, and mobile overrides.
- `styles-mobile.css` owns narrow-toolbar compaction, while `mobile.js` keeps the bottom navigation suppressed whenever the edit panel remains open.
- `scripts/verify-warehouse-ui-browser.mjs` seeds mixed cards and checks desktop, 320/360/390px mobile, empty, media, toolbar overflow, touch scrolling, and edit-control reachability without contacting production services.

Desktop `#cardsContainer` is now a stable CSS Grid owned by
`legacy/script/part-02.js`, `legacy/script/part-03.js`,
`legacy/script/part-10.js`, and `styles/base/part-09.css`. Image decode events
must not restore Masonry absolute positioning or full-list relayouts. The
warehouse browser check requires `display:grid`, zero absolute cards, aligned
column-start tops, and placeholder media slots. The desktop warehouse grid
is a compact waterfall: `part-03.js` distributes cards into
`.warehouse-desktop-col` flex columns (defined in `styles/base/part-09.css`) by
a greedy shortest-column pass and runs one debounced rebalance when image
heights settle; column gaps equal the grid gap so a short card is followed
immediately by the next card in its column. The outer grid uses
`grid-auto-rows: auto` only for the N column containers; do not reintroduce
row-aligned `grid-auto-rows: max-content` stretching (which erases the
waterfall and leaves hundreds of pixels of fillable vertical holes) and do not
make cards themselves grid items that participate in row height. The geometry
regression `scripts/verify-warehouse-card-layout-browser.mjs` covers 192/816
cards at 1440x900 / 1024x768 / 390x844 and asserts pairwise non-overlap,
in-column gaps ≈ the grid gap, bounded adjacent-column deltas, zero horizontal
overflow, plus grid/list and 1..5 column modes; width/sidebar changes wait for
the masonry to settle and images to decode before measuring.

Keep `styles-warehouse.css` as a standalone Pages asset. Staging and HTTP smoke checks must fail when the file, hero rules, or warehouse hero images are missing.

## Startup Routing

`app-router.js` treats the canonical URL as the only boot route and applies the
matching page before the larger classic-script loaders run. A refresh at
`/prompts/`, `/generate/`, `/community/`, `/profile/`, or `/dev/` remains on
that page; the root route always starts at the landing page. The
`promptrepo_app_page` value remains a compatibility record for existing UI
modules, but it must not override the URL during bootstrap.

The static body has exactly one initial active page: `#pageLanding`. This keeps
the first screen visible while the classic scripts load and prevents a later
community node from covering it. Run `node scripts/verify-app-router-boot.mjs`
for the focused route regression check.

## Canvas Bridge Ownership

The frozen working tree contains an unreleased Prompt Hub -> Canvas handoff. Its source ownership is split as follows:

- `app-router.js` is the canonical root module for validating the Canvas URL and card ID, adding the four `ph*` deep-link parameters, opening the isolated window, and managing the one-shot return marker. It is not generated from a `legacy/` chunk.
- `legacy/script/part-04.js` owns the warehouse-facing open helpers. `legacy/script/part-09.js` owns card action markup, the context-menu entry, and the forced cloud pull when the tab becomes visible after a handoff. `legacy/script/part-10.js` owns delegated clicks for `data-card-canvas`.
- `styles/base/part-04.css`, `styles/base/part-09.css`, `styles-mobile.css`, and `styles-theme.css` own the desktop icon and the two-row mobile action layout.

Keep the URL payload limited to `phSource`, `phVersion`, `phIntent`, and `phCardId`; card content and credentials are fetched through the authenticated Worker endpoint. The matching VM and Chromium checks are `scripts/verify-canvas-bridge.mjs` and `scripts/verify-canvas-card-handoff-browser.mjs`.

This bridge has not been deployed. Canvas still has to consume the versioned deep link and call the result handback endpoint before the cross-repository flow is complete.

## Pages Runtime Consolidation

`scripts/stage-pages.ps1` runs `scripts/build-pages-runtime.mjs` after copying tracked assets into `.pages-deploy/`. The staging-only build:

- concatenates `supabase-sync.js`, `script.js`, and `features-draft.js` from their ordered source chunks;
- concatenates `styles.css` and `styles-features.css` from their ordered CSS chunks;
- inlines the four `partials/index-body/part-*.html` fragments into the staged `index.html`.
- fails if the inlined warehouse hero, `styles-warehouse.css`, or any of its three first-screen images is missing.

The split source files remain canonical and editable. Production must contain the `__PROMPT_HUB_DEPLOY_BUNDLE__` marker in the five consolidated JS/CSS entries and must make zero requests to the main runtime `part-*` files.

The browser routes use canonical trailing-slash paths (`/prompts/`, `/generate/`, `/community/`, `/profile/`, `/dev/`). Keep `<base href="/">` in `index.html`; without it, a cold refresh would resolve root assets under the route directory. `_redirects` converts old non-trailing-slash links to the canonical paths.

## Generated Files

`pack-*.js` files are generated deployment bundles. Do not manually edit or split them as source files. Change the source chunks/modules and run:

```powershell
node scripts/build-all-bundles.mjs
```

## Bundle Source Modules

The generated packs are assembled from real source modules in a fixed order:

- `pack-core.js`: `media-pipeline.js`, `sync-orchestrator.js`, `card-image-loader-queues.js`, `card-image-loader.js`
- `pack-feed.js`: `feed-images.js`, `feed-layout.js`, `image-gen-feed-cards.js`, `image-gen-feed.js`
- `pack-imagegen.js`: image generation modules, including `imagegen-job-state.js`, `imagegen-job-runner.js`, `imagegen-finish-run.js`, `imagegen-ref-ui.js`, `imagegen-submit.js`

When continuing the split work, edit these source modules first, then rebuild the packs. Current extracted boundaries:

- `imagegen-job-state.js` owns pending/failed/session generation job persistence used by `imagegen-job-runner.js`.
- `image-gen-feed-cards.js` owns image generation feed card HTML, ref dataset extraction helpers, and card display strings used by `image-gen-feed.js`.
- `card-image-loader-queues.js` owns image loader concurrency caps and queue helpers used by `card-image-loader.js`.
- `card-gallery.js` decides whether a warehouse card has a real media reference; generation job IDs and tags alone must remain text cards.
- `community-public-feed.js` owns the shared public-feed refresh promise, partial-cache hydration, bounded head request, and retry cooldown used by both community surfaces.
- `legacy/script/part-02.js` owns generated-card persistence. Signed-in `copyStorage` saves must finish through `archiveGeneratedCardImage` and produce a verified `storage://` primary reference; failed archival removes the new card instead of persisting a temporary upstream URL.

`card-image-loader.js` treats a URL as loaded only after the browser has decoded pixels (or while that exact request is still pending). A completed broken signed URL invalidates its cached path/reference and performs one fresh-sign resolution with the existing bounded fallback and authoritative-missing cleanup rules. Failed media keeps a stable placeholder slot with a retry button (`.card-media--load-failed > .card-media-placeholder`) instead of collapsing to a text card or leaving a black slot; transient failures do not write the 24h missing mark. `feed-images.js`'s `finalizeFeedImageFailure` / `collapseWarehouseFeedCardNoThumb` follow the same placeholder contract for recent/community feed media. Loader requests/dedup/failure counters are exposed on `window.__PH_IMAGE_STATS__`. Run `scripts/verify-card-image-loader-retry-browser.mjs`, `scripts/verify-card-image-loader-dedupe-browser.mjs`, `scripts/verify-imagegen-failed-media-collapse-browser.mjs`, `scripts/verify-imagegen-finish-immediate-browser.mjs`, and `scripts/verify-media-ux-browser.mjs` for the focused regressions.

Ignored local/generated outputs include `.pages-deploy/`, `dist/`, `*.bundle.js`, `.tmp-*.js`, and `prompt-hub-deploy.zip`. Removed one-off cleanup artifacts from this split pass: `.tmp-fd-head.js`, `.tmp-recover-chunks.js`, `prompt-hub-deploy.zip`, and `scripts/新建 文本文档.txt`.

## Required Checks

Before deploying:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-predeploy-smoke.ps1
node scripts/run-index-local-http-smoke.mjs
```

`run-predeploy-smoke.ps1` validates JS chunks, CSS chunks, index body fragments, bundle contracts, VM smoke tests, and key regressions. `run-index-local-http-smoke.mjs` starts a temporary static server and then runs `run-index-http-smoke.mjs`. `deploy-pages.ps1` also runs production HTTP smoke after upload.

For the first-screen paging and request-budget browser checks:

```powershell
$env:PLAYWRIGHT_PACKAGE_DIR = '<playwright package directory>'
$env:BROWSER_EXECUTABLE_PATH = '<Chrome or Edge executable>'
node scripts/verify-mobile-first-screen-browser.mjs

$env:APP_ROOT = 'D:\prompt-hub\.pages-deploy'
node scripts/verify-mobile-first-screen-browser.mjs

node scripts/verify-imagegen-feed-retention-browser.mjs
```

The production audit is `scripts/audit-production-mobile-first-screen.mjs`; pass credentials through `PH_TEST_EMAIL` and `PH_TEST_PASSWORD`, never in source.

`deploy-pages.ps1` does not bump the build automatically. Run `scripts/bump-build.ps1`, validate and commit its output, then deploy from that clean SHA. The deploy script refuses either freeze marker or any dirty tracked/untracked state, targets the `main` production branch explicitly, records the release SHA, and retries the custom-domain smoke while the production alias propagates.

On Windows, npm 8 can fail lifecycle scripts whose names contain `:` because it creates temporary `.cmd` files from the script name. Prefer the colon-free aliases:

```powershell
npm run build-all
npm run check-esbuild
npm run check-predeploy
```

## Image Generation Feed Delivery (2026-08-03)

`image-gen-feed.js` now delegates recent-card loading to `CardImageLoader` and
waits on its promise with a bounded worker pool. Recent and warehouse list
views request `_grid` variants only; full-resolution media remains an explicit
detail action. Rebuild `pack-feed.js` with `node scripts/build-feed-bundle.mjs`
after changing the feed sources.

The first six recent thumbnails are eager (the first four high priority), and
paginated cards are inserted before the recent-feed footer so that the footer
cannot split the image grid. The Grid guard observes direct child insertion
only; image attribute changes must not rescan every feed card.
