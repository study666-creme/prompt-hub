# Frontend Split Map

Updated: 2026-07-07

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

The split loaders are synchronous on purpose. They preserve the old blocking order before downstream classic scripts run.

## Generated Files

`pack-*.js` files are generated deployment bundles. Do not manually edit or split them as source files. Change the source chunks/modules and run:

```powershell
node scripts/build-all-bundles.mjs
```

Ignored local/generated outputs include `.pages-deploy/`, `dist/`, `*.bundle.js`, `.tmp-*.js`, and `prompt-hub-deploy.zip`.

## Required Checks

Before deploying:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-predeploy-smoke.ps1
node scripts/run-index-http-smoke.mjs
```

`run-predeploy-smoke.ps1` validates JS chunks, CSS chunks, index body fragments, bundle contracts, VM smoke tests, and key regressions. `deploy-pages.ps1` also runs production HTTP smoke after upload.
