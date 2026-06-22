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

$localDeployExclude = @(
  @{ Path = Join-Path $root "api-config.local.js"; Label = "api-config.local.js" },
  @{ Path = Join-Path $root "supabase-config.local.js"; Label = "supabase-config.local.js" }
)
$localDeployBak = @()
foreach ($item in $localDeployExclude) {
  if (-not (Test-Path $item.Path)) { continue }
  $bak = Join-Path $env:TEMP ("ph-local-" + $item.Label + "-" + [guid]::NewGuid().ToString("n") + ".js")
  Write-Host "Temporarily excluding $($item.Label) from deploy (local dev only)." -ForegroundColor Yellow
  Move-Item -LiteralPath $item.Path -Destination $bak
  $localDeployBak += @{ Path = $item.Path; Bak = $bak }
}

Write-Host "Pages project: $project"
& (Join-Path $root "scripts\check-js-syntax.ps1")
$esbuildSmoke = Join-Path $root "scripts\esbuild-bundle-smoke.mjs"
if ((Test-Path $esbuildSmoke) -and (Test-Path (Join-Path $root "node_modules\esbuild"))) {
  Write-Host "esbuild-bundle-smoke ..."
  & node $esbuildSmoke
  if ($LASTEXITCODE -ne 0) { exit 1 }
} elseif (Test-Path $esbuildSmoke) {
  Write-Host "Skip esbuild-smoke (run: npm install in repo root)" -ForegroundColor Yellow
}
& (Join-Path $root "scripts\bump-build.ps1")

$staging = & (Join-Path $root "scripts\stage-pages.ps1")
Write-Host "Deploying staged assets from: $staging"

function Test-CloudflareReachable {
  Push-Location $server
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & npm exec -- wrangler whoami 2>&1
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($exit -eq 0) { return $true }
    $text = ($out | Out-String)
    if ($text -match 'fetch failed|ConnectTimeout|UND_ERR_CONNECT') {
      Write-Host "Cannot reach Cloudflare API (VPN/proxy may be required)." -ForegroundColor Red
      Write-Host $text
      return $false
    }
    Write-Host $text
    return $false
  } finally {
    Pop-Location
  }
}

$code = 1
Push-Location $server
try {
  if (-not (Test-CloudflareReachable)) {
    $code = 2
  } else {
    $retryWaits = @(0, 8, 20, 45)
    foreach ($i in 0..($retryWaits.Length - 1)) {
      if ($retryWaits[$i] -gt 0) {
        Write-Host "Retry $($i + 1)/$($retryWaits.Length) after $($retryWaits[$i])s ..." -ForegroundColor Yellow
        Start-Sleep -Seconds $retryWaits[$i]
      }
      Write-Host "wrangler pages deploy (attempt $($i + 1)) ..."
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & npm exec -- wrangler pages deploy $staging "--project-name=$project" --commit-dirty=true --no-bundle
      $code = $LASTEXITCODE
      $ErrorActionPreference = $prevEap
      if ($code -eq 0) { break }
    }
  }
} finally {
  Pop-Location
  foreach ($item in $localDeployBak) {
    if ($item.Bak -and (Test-Path $item.Bak)) {
      Move-Item -LiteralPath $item.Bak -Destination $item.Path
    }
  }
}

if ($code -ne 0) {
  Write-Host ""
  Write-Host "CLI deploy failed; packing ZIP for manual upload ..." -ForegroundColor Yellow
  & (Join-Path $root "pack-deploy.ps1") -FromStaging
  Write-Host ""
  Write-Host "Deploy failed (common fixes):" -ForegroundColor Red
  Write-Host "  1. ConnectTimeoutError: enable VPN, rerun .\deploy-pages.ps1" -ForegroundColor Yellow
  Write-Host "  2. Login expired: cd server; npm exec wrangler login" -ForegroundColor Yellow
  Write-Host "  3. Manual upload (no CLI):" -ForegroundColor Yellow
  Write-Host "     Cloudflare Dashboard -> Workers & Pages -> prompt-hub-hub -> Create deployment -> Upload assets" -ForegroundColor Yellow
  Write-Host "     ZIP file: $root\prompt-hub-deploy.zip" -ForegroundColor Cyan
  Write-Host ""
  exit $code
}

Write-Host "OK. Open your site and hard refresh (Ctrl+Shift+R)."
Write-Host "Check build: window.__APP_BUILD__ in browser console"
