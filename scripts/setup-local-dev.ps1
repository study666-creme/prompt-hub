# One-time local dev setup (templates + npm install)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$server = Join-Path $root "server"

function Ensure-CopyExample([string]$example, [string]$target, [string]$label) {
  if (Test-Path $target) {
    Write-Host "[ok] $label" -ForegroundColor DarkGray
    return
  }
  if (-not (Test-Path $example)) {
    Write-Host "[skip] missing $example" -ForegroundColor Yellow
    return
  }
  Copy-Item $example $target
  Write-Host "[new] $label" -ForegroundColor Green
}

Ensure-CopyExample (Join-Path $root "supabase-config.local.example.js") (Join-Path $root "supabase-config.local.js") "supabase-config.local.js"
Ensure-CopyExample (Join-Path $root "api-config.local.example.js") (Join-Path $root "api-config.local.js") "api-config.local.js"
Ensure-CopyExample (Join-Path $server ".dev.vars.example") (Join-Path $server ".dev.vars") "server/.dev.vars"

if (-not (Test-Path (Join-Path $server "node_modules"))) {
  Write-Host "npm install in server/ ..." -ForegroundColor Cyan
  Push-Location $server
  npm install
  Pop-Location
}

$devVars = Join-Path $server ".dev.vars"
$dvText = Get-Content $devVars -Raw -ErrorAction SilentlyContinue
if ($dvText -match 'service_role') {
  Write-Host ""
  Write-Host "Edit server\.dev.vars: set SUPABASE_SERVICE_ROLE_KEY (Legacy service_role from Aliyun)" -ForegroundColor Yellow
  Write-Host "For image gen, also set IMAGE_API_KEY" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Run: .\start-dev.ps1" -ForegroundColor Cyan
Write-Host "Open: http://127.0.0.1:5500" -ForegroundColor Green
