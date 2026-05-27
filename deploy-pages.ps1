# Deploy static site to Cloudflare Pages (CLI). One-time: npm exec wrangler login (in server/)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$server = Join-Path $root "server"
$project = "prompt-hub-hub"

if (Test-Path (Join-Path $root ".wrangler\cache\pages.json")) {
  try {
    $pj = Get-Content (Join-Path $root ".wrangler\cache\pages.json") -Raw | ConvertFrom-Json
    if ($pj.project_name) { $project = $pj.project_name }
  } catch {}
}

if (-not (Test-Path (Join-Path $server "node_modules\wrangler"))) {
  Write-Host "First run: npm install in server/ ..."
  Push-Location $server
  npm install
  Pop-Location
}

Write-Host "Pages project: $project"
Write-Host "Deploying from: $root"
Push-Location $server
npm exec wrangler pages deploy $root --project-name=$project
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
  Write-Host "Failed. If not logged in, run once:"
  Write-Host "  cd server"
  Write-Host "  npm exec wrangler login"
  exit $code
}
Write-Host "OK. Open your site and hard refresh (Ctrl+Shift+R)."
Write-Host "Check build: window.__APP_BUILD__ in browser console"
