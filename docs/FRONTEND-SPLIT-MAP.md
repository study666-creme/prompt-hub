# Frontend Split Map

Updated: 2026-07-11

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

The source split loaders are synchronous in the repository so local development keeps the old classic-script order. They must not be shipped as the production request graph.

## Pages Runtime Consolidation

`scripts/stage-pages.ps1` runs `scripts/build-pages-runtime.mjs` after copying tracked assets into `.pages-deploy/`. The staging-only build:

- concatenates `supabase-sync.js`, `script.js`, and `features-draft.js` from their ordered source chunks;
- concatenates `styles.css` and `styles-features.css` from their ordered CSS chunks;
- inlines the four `partials/index-body/part-*.html` fragments into the staged `index.html`.

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
- `pack-imagegen.js`: image generation modules, including `imagegen-job-state.js`, `imagegen-job-runner.js`, `imagegen-ref-ui.js`, `imagegen-submit.js`

When continuing the split work, edit these source modules first, then rebuild the packs. Current extracted boundaries:

- `imagegen-job-state.js` owns pending/failed/session generation job persistence used by `imagegen-job-runner.js`.
- `image-gen-feed-cards.js` owns image generation feed card HTML, ref dataset extraction helpers, and card display strings used by `image-gen-feed.js`.
- `card-image-loader-queues.js` owns image loader concurrency caps and queue helpers used by `card-image-loader.js`.

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

On Windows, npm 8 can fail lifecycle scripts whose names contain `:` because it creates temporary `.cmd` files from the script name. Prefer the colon-free aliases:

```powershell
npm run build-all
npm run check-esbuild
npm run check-predeploy
```
