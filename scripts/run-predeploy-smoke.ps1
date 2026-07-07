# 部署前完整冒烟：语法 → esbuild 单文件 → 打包 → bundle 校验
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

& (Join-Path $root "scripts\check-js-syntax.ps1")

if (Test-Path (Join-Path $root "legacy")) {
  Write-Host "verify-legacy-runtime-chunks ..."
  & node (Join-Path $root "scripts\verify-legacy-runtime-chunks.mjs")
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

if (Test-Path (Join-Path $root "styles")) {
  Write-Host "verify-css-runtime-splits ..."
  & node (Join-Path $root "scripts\verify-css-runtime-splits.mjs")
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

if (Test-Path (Join-Path $root "partials\index-body")) {
  Write-Host "verify-index-body-partial ..."
  & node (Join-Path $root "scripts\verify-index-body-partial.mjs")
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host "audit-features-draft-exports ..."
& node (Join-Path $root "scripts\audit-features-draft-exports.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "audit-features-draft-wire ..."
& node (Join-Path $root "scripts\audit-features-draft-wire.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-card-gallery-regression ..."
& node (Join-Path $root "scripts\verify-card-gallery-regression.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-edit-panel-gallery-regression ..."
& node (Join-Path $root "scripts\verify-edit-panel-gallery-regression.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-feed-image-fit-regression ..."
& node (Join-Path $root "scripts\verify-feed-image-fit-regression.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

$esbuildSmoke = Join-Path $root "scripts\esbuild-bundle-smoke.mjs"
if (-not (Test-Path (Join-Path $root "node_modules\esbuild"))) {
  Write-Host "Installing root npm deps (esbuild) ..." -ForegroundColor Yellow
  Push-Location $root
  npm install --no-audit --no-fund
  Pop-Location
}

Write-Host "esbuild-bundle-smoke ..."
& node $esbuildSmoke
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "build-all-bundles ..."
& node (Join-Path $root "scripts\build-all-bundles.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-bundle-bytes ..."
& node (Join-Path $root "scripts\verify-bundle-bytes.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-core-bundle ..."
& node (Join-Path $root "scripts\verify-core-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-feed-bundle ..."
& node (Join-Path $root "scripts\verify-feed-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "feed-bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-feed-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-imagegen-bundle ..."
& node (Join-Path $root "scripts\verify-imagegen-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "imagegen-bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-imagegen-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-app-extra-bundle ..."
& node (Join-Path $root "scripts\verify-app-extra-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "app-extra-bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-app-extra-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-account-bundle ..."
& node (Join-Path $root "scripts\verify-account-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "account-bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-account-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-foundation-bundle ..."
& node (Join-Path $root "scripts\verify-foundation-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "foundation-bundle-vm-smoke ..."
& node (Join-Path $root "scripts\run-foundation-bundle-vm-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-viewer-pack ..."
& node (Join-Path $root "scripts\verify-viewer-pack.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-appreciate-pack ..."
& node (Join-Path $root "scripts\verify-appreciate-pack.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-lightbox-pack ..."
& node (Join-Path $root "scripts\verify-lightbox-pack.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "verify-pack-contract ..."
& node (Join-Path $root "scripts\verify-pack-contract.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "predeploy-smoke: all checks passed" -ForegroundColor Green
