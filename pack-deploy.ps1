# Pack static site for Cloudflare Pages manual upload (when CLI times out)
param(
  [switch]$FromStaging
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dest = Join-Path $root "prompt-hub-deploy.zip"

if ($FromStaging) {
  $staging = Join-Path $root ".pages-deploy"
  if (-not (Test-Path $staging)) {
    & (Join-Path $root "scripts\stage-pages.ps1") | Out-Null
  }
  if (Test-Path $dest) { Remove-Item $dest -Force }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $dest -Force
  $count = (Get-ChildItem $staging -Recurse -File).Count
  Write-Host "OK: $dest ($count files from .pages-deploy)"
} else {
  $staging = & (Join-Path $root "scripts\stage-pages.ps1")
  if (Test-Path $dest) { Remove-Item $dest -Force }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $dest -Force
  $count = (Get-ChildItem $staging -Recurse -File).Count
  Write-Host "OK: $dest ($count files)"
}

Write-Host "Cloudflare: Workers and Pages -> prompt-hub-hub -> Create deployment -> Upload assets -> pick ZIP -> Deploy"
Write-Host "Tip: open VPN first if CLI deploy fails with ConnectTimeoutError."
