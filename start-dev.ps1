# Local dev: Worker API + static site (two windows)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

& (Join-Path $root "scripts\setup-local-dev.ps1")

$server = Join-Path $root "server"
$devVars = Join-Path $server ".dev.vars"
if (-not (Test-Path $devVars)) {
  Write-Host "Missing server\.dev.vars - run scripts\setup-local-dev.ps1 first" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Starting Worker in new window (http://127.0.0.1:8787) ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$server'; Write-Host '=== Prompt Hub Worker ===' -ForegroundColor Cyan; npm run dev -- --ip 127.0.0.1 --port 8787"
)

Start-Sleep -Seconds 2

Write-Host "Starting static site in this window (http://127.0.0.1:5500) ..." -ForegroundColor Cyan
Write-Host "Keep BOTH windows open. If images fail: Ctrl+Shift+R on 5500 (clears prod sign cache)." -ForegroundColor DarkGray
Write-Host "JSON backup: Settings -> Data -> Export backup" -ForegroundColor DarkGray
& (Join-Path $root "serve-local.ps1")
