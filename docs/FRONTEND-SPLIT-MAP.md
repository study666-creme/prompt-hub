# Frontend Split Map

Updated: 2026-08-29

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

**Chunk prefetch contract.** Each loader still runs synchronously (downstream classic scripts depend on that ordering), but it no longer pays a serial blocking round trip per chunk. `index.html` fires one parallel `fetch()` per chunk during head parsing and stores the response text in `window.__PH_PART_STORE__.text`, keyed by the chunk's relative path **without** the `?v=` query. Every loader checks that map first and falls back to synchronous XHR only on a miss. Consequences:

- The loader template lives in `scripts/create-legacy-runtime-split.mjs`; editing a generated root loader by hand will be lost the next time the splitter runs.
- A new `legacy/.../part-*.js` chunk must also be added to the prefetch list in `index.html`, or it silently degrades to the old serial path.
- The map is keyed by path only, so a `?v=` mismatch never causes a wrong-file mixup — worst case is a redundant fetch.

## HTML And CSS Splits

- `index.html` keeps the head and script order, while the body DOM is loaded from `partials/index-body/part-*.html`. The boot loader detects a stale full-document response from an older local service worker, clears Prompt Hub caches once, and retries; `?clear-cache=1` forces the same local recovery path.
- **App-page container boundaries are structural, not cosmetic.** `#pageWarehouse` opens and closes entirely inside `partials/index-body/part-02.html`; every other app page (`#pageDevLab`, `#pageCanvas`, `#pageCommunity`, `#pageCreations`, `#pageImageGen`) is a sibling of `#pageWarehouse` under `.app-main`. `partials/index-body/part-04.html` closes `#pageImageGen` and `.app-main`, and `partials/index-body/part-05.html` closes `.app-chrome`. If an edit unbalances these divs, feature pages get nested inside `#pageWarehouse` and become invisible the moment the warehouse page is deactivated (`switchAppPage` hides `.app-page-warehouse` while a nested feature page still computes `display:flex` and readable `innerHTML` — probes must assert `getBoundingClientRect()` size, not `display`/`innerHTML`). Each partial must keep its `<div>`/`</div>` balance except the intentional handoffs documented here.
- `warehouse-composer.js` is a small root runtime entry loaded after `script.js`; it owns the prompt-first warehouse composer, delegates card persistence and image generation to the existing globals, and owns the optional Canvas iframe/standalone buttons.
- `styles.css` imports `styles/base/part-*.css`.
- `styles-features.css` imports `styles/features/part-*.css`.
- `styles-warehouse.css` is the `20260803a` standalone warehouse UI layer loaded after the shared CSS entries. It is not generated from a split CSS directory.
- `styles-landing.css` is the standalone landing-page layer. Its markup lives in `partials/index-body/part-06.html` (the whole `#pageLanding` block, split out of part-02 when the scrollable narrative sections pushed it over the 50 KB partial cap), and the pointer-parallax micro-interaction is an inline script in `index.html` (partials must not contain script tags). The hero uses only local `assets/studio-preset/` images and degrades cleanly with reduced motion, touch input, or light theme. The landing page scrolls as a full-page document: `.landing-shell` is the unified fixed scroller on desktop and mobile, while the landing-active `.app-chrome` is demoted to `display:contents` so its 90% ui-scale transform layer cannot cover the landing surface. Below the hero the page continues through workflow steps, feature pillars, a closing CTA, and a footer; `scripts/verify-landing-scroll-browser.mjs` is the focused desktop+mobile scroll regression check.

The source split loaders are synchronous in the repository so local development keeps the old classic-script order. They must not be shipped as the production request graph.

## Warehouse UI Ownership

The current candidate warehouse redesign keeps the warehouse surface isolated from generated bundles:

- `partials/index-body/part-02.html` owns the legacy toolbar shell (hidden on the prompt-first home), prompt-first composer, application-drawn model/ratio/resolution picker shells, and compact warehouse summary markup. The warehouse page's visible content tabs are named `卡片库`, `社区`, and `生成记录`; the old `发现` label is retired.
- `partials/index-body/part-03.html` owns the dedicated `pageCanvas` route shell. The homepage no longer embeds Canvas; the Canvas route contains the iframe and a standalone-open action.
- `warehouse-composer.js` owns composer mode state, bounded reference-image intake (drag/drop, file picker, paste), direct card-save handoff, image-generation form bridging, inline library/community/creation views, and warehouse content-focus behavior. It mounts the existing file-group switcher, multi-select tag filter, search field, and custom sort menu into one persistent library toolbar. Its model menu reads the complete public catalog, keeps `generic` models in an “其他模型” group, and derives the supported aspect-ratio and resolution options per model; the application-drawn pickers support keyboard navigation and block unavailable entries. The first deliberate downward wheel gesture collapses the surrounding chrome, while an upward gesture at the content top restores the same composer. It must not duplicate paid-generation requests. Focus state changes are idempotent per view, and `window.WarehouseComposer.exitFocus()` is the single full-exit hook the router must call when leaving the warehouse: it reparents `#cardsContainer` and toolbar nodes back, unmounts borrowed community/creations shells, and clears every `warehouse-content-focus*` / inline-active body class before another page becomes active. The expand/collapse control is an icon button mounted in `.app-nav-head` (`#warehouseFocusToggleBtn`) and hidden on non-warehouse pages.
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
first-row tops, and collapsed failed media slots.

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
- `legacy/script/part-02.js` owns generated-card persistence. Signed-in `copyStorage` saves must finish through `archiveGeneratedCardImage` and produce a verified `storage://` primary reference; failed archival removes the new card instead of persisting a temporary upstream URL. Completed generations are now auto-saved into the warehouse (default group 「图片生成」) by `imagegen-finish-run.js` via `addCardFromGenerated({ guestQuiet: true, copyStorage: true })`; the manual「存入库」button and the 7-day retention wording are only kept as fallbacks for creations whose auto-save failed (e.g. guest quota reached).
- `feed-layout.js` (pack-feed) owns community/creations feed layout. Community masonry relayouts triggered by image loads are deferred while the user is actively scrolling (`feedUserScrollingActive`) so browsing no longer flickers, and `styles/features/part-01.css` keeps `#communityGrid` in a CSS grid fallback while `.masonry-ready` is pending so the first paint never flashes one full-width image.

`card-image-loader.js` treats a URL as loaded only after the browser has decoded pixels (or while that exact request is still pending). A completed broken signed URL invalidates its cached path/reference and performs one fresh-sign resolution with the existing bounded fallback and authoritative-missing cleanup rules. Failed `cr_`/`wh_` feed media is collapsed to a text card while recovery continues, so a failed image never leaves a black media slot. Run `scripts/verify-card-image-loader-retry-browser.mjs`, `scripts/verify-imagegen-failed-media-collapse-browser.mjs`, and `scripts/verify-imagegen-finish-immediate-browser.mjs` for the focused regressions.

- `imagegen-select-ui.js` is a standalone root script appended after `pack-extra.js` in the deferred queue (`__PH_DEFERRED_PACKS__` in `index.html`); it is not part of any `pack-*.js`. It converts every visible native `<select>` inside `#pageImageGen` (MJ 速度/附加开关/画质/风格、分辨率/比例/质量/入库文件夹、数量、优化场景、裂变/风格转换/灵感抽卡、仓库筛选分组/标签) into application-drawn triggers + menus (`.ph-cselect*` in `styles/features/part-11.css`). The native selects stay in the DOM as hidden value carriers: options are re-read on open, labels re-sync on `change` and `childList` mutations, and option clicks set `.value` and dispatch a bubbling `change`, so the existing imagegen listeners and cost hints are untouched. `#imageGenModel` keeps its dedicated model picker.
- `theme.js` is bundled into `pack-prelude.js` by `scripts/build-prelude-pack.mjs` (with `file-origin-guard.js`, `image-trim.js`). Day/night toggle buttons live outside the settings panel: `#themeToggleBtn` in the sidebar footer (`partials/index-body/part-02.html`) and `#themeToggleBtnMobile` in the mobile bottom nav (`partials/index-body/part-04.html`); both bind `toggleTheme` and swap sun/moon icons via `styles-theme.css`. Auto day/night is ON by default (`autoDayNight !== false` in `theme.js`, `legacy/script/part-01.js`, `legacy/script/part-05.js`, `legacy/script/part-13.js`) and can be switched off in Settings → 外观.

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

静态资源缓存契约（2026-09-01 起）：版本化静态资源（`pack-*.js` 带 `?v=` 由 `functions/_middleware.js` 下发，其余清单文件由 `_headers` 覆盖）一律 `Cache-Control: public, max-age=31536000, immutable`；入口 HTML（`index.html`、admin、asset-studio）与 `sw.js` 保持 `no-cache, no-store`。失效完全依赖 `?v=` 随发版变化，所以**改任何静态资源后必须先跑 `scripts/bump-build.ps1` 再部署**。`scripts/verify-versioned-cache.mjs`（挂在 predeploy smoke 末尾）会拦截两类事故：引用版本与 `__APP_BUILD__` 不一致、以及内容相对上次通过基线变化而版本未变（本地基线 `scripts/.versioned-cache-baseline.json`，gitignore）。不带 `?v=` 的直接 pack 请求仍走 `no-store` 兜底。

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
