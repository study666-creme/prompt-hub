# 部署前完整冒烟：语法 → esbuild 单文件 → 打包 → bundle 校验
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

& (Join-Path $root "scripts\check-js-syntax.ps1")

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

Write-Host "predeploy-smoke: all checks passed" -ForegroundColor Green
