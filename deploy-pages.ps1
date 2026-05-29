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

$localApiCfg = Join-Path $root "api-config.local.js"
$localApiBak = $null
if (Test-Path $localApiCfg) {
  $localApiBak = Join-Path $env:TEMP ("ph-api-config-local-" + [guid]::NewGuid().ToString("n") + ".js")
  Write-Host "Temporarily excluding api-config.local.js from deploy (local dev only)." -ForegroundColor Yellow
  Move-Item -LiteralPath $localApiCfg -Destination $localApiBak
}

Write-Host "Pages project: $project"
Write-Host "Deploying from: $root"
Push-Location $server
try {
  npm exec -- wrangler pages deploy $root --project-name=$project
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  if ($localApiBak -and (Test-Path $localApiBak)) {
    Move-Item -LiteralPath $localApiBak -Destination $localApiCfg
  }
}
if ($code -ne 0) {
  Write-Host "Failed. If not logged in, run once:"
  Write-Host "  cd server"
  Write-Host "  npm exec wrangler login"
  exit $code
}
Write-Host "OK. Open your site and hard refresh (Ctrl+Shift+R)."
Write-Host "Check build: window.__APP_BUILD__ in browser console"
