# Use project-local Wrangler 3 (Node 18+). Do not use bare "npx wrangler" (may pull v4).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules\wrangler")) {
  Write-Host "npm install ..."
  npm install
}
Write-Host "Deploying with wrangler 3.x ..."
npm exec wrangler deploy
