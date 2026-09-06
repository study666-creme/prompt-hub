param([switch]$Login)

# Deploy static site to Cloudflare Pages (CLI). One-time: .\deploy-pages.ps1 -Login
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$server = Join-Path $root "server"
$project = "prompt-hub-hub"
$productionBranch = "main"
$env:XDG_CONFIG_HOME = Join-Path $root ".wrangler"

$freezeMarkers = @(
  (Join-Path $root 'DO-NOT-DEPLOY.md'),
  'D:\canvas\prompt-hub\DO-NOT-DEPLOY.md'
)
foreach ($marker in $freezeMarkers) {
  if (Test-Path $marker -PathType Leaf) {
    throw "Pages deploy blocked by freeze marker: $marker"
  }
}

$releaseSha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $releaseSha) {
  throw "Pages deploy requires a committed Git SHA"
}
$dirty = @(& git -C $root status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
  throw "Pages deploy requires a clean worktree. Bump the build, verify, and commit before deploying."
}

if (Test-Path (Join-Path $root ".wrangler\cache\pages.json")) {
  try {
    $pj = Get-Content (Join-Path $root ".wrangler\cache\pages.json") -Raw | ConvertFrom-Json
    if ($pj.project_name) { $project = $pj.project_name }
  } catch {}
}

if (-not (Test-Path (Join-Path $server "node_modules\wrangler"))) {
  Write-Host "First run: npm install in server/ ..."
  Push-Location $server
  & npm.cmd install
  Pop-Location
}

$wrangler = Join-Path $server "node_modules\.bin\wrangler.cmd"
if (-not (Test-Path $wrangler)) {
  throw "Project Wrangler executable not found: $wrangler"
}
if ($Login) {
  & $wrangler login
  exit $LASTEXITCODE
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

Write-Host "Pages project: $project (production branch: $productionBranch)"
& node (Join-Path $root "scripts\run-predeploy-smoke.mjs")
if ($LASTEXITCODE -ne 0) { exit 1 }
$dirtyAfterChecks = @(& git -C $root status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirtyAfterChecks.Count -gt 0) {
  throw "Pages deploy checks changed tracked files. Review and commit the generated output first."
}

$staging = & (Join-Path $root "scripts\stage-pages.ps1")
Write-Host "Deploying staged assets from: $staging"

foreach ($bundle in @(
  'pack-prelude.js', 'pack-foundation.js', 'pack-core.js', 'pack-viewer.js', 'pack-appreciate.js', 'pack-lightbox.js', 'pack-feed.js', 'pack-imagegen.js',
  'pack-account.js', 'pack-extra.js', 'pack-media-client.js'
)) {
  $bp = Join-Path $staging $bundle
  if (-not (Test-Path $bp)) {
    Write-Host "Deploy blocked: staged bundle missing $bundle" -ForegroundColor Red
    exit 1
  }
  $head = (Get-Content $bp -First 1).TrimStart()
  if ($head.StartsWith('<')) {
    Write-Host "Deploy blocked: $bundle looks like HTML (SPA fallback would break site)" -ForegroundColor Red
    exit 1
  }
}
Write-Host "Staged bundle sanity OK" -ForegroundColor DarkGray

function Test-CloudflareReachable {
  Push-Location $server
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & $wrangler whoami 2>&1
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
      & $wrangler pages deploy $staging "--project-name=$project" "--branch=$productionBranch" "--commit-hash=$releaseSha" --commit-dirty=false --no-bundle
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

Write-Host "Post-deploy bundle smoke (production) ..." -ForegroundColor DarkGray
$previousSmokeBase = $env:SMOKE_BASE
$smokeCode = 1
try {
  $env:SMOKE_BASE = "https://prompt-hubs.com"
  $smokeWaits = @(0, 5, 15, 30, 45)
  foreach ($wait in $smokeWaits) {
    if ($wait -gt 0) {
      Write-Host "Waiting ${wait}s for the production alias to propagate ..." -ForegroundColor Yellow
      Start-Sleep -Seconds $wait
    }
    & node (Join-Path $root "scripts\run-index-http-smoke.mjs")
    $smokeCode = $LASTEXITCODE
    if ($smokeCode -eq 0) { break }
  }
} finally {
  if ($null -eq $previousSmokeBase) {
    Remove-Item Env:SMOKE_BASE -ErrorAction SilentlyContinue
  } else {
    $env:SMOKE_BASE = $previousSmokeBase
  }
}
if ($smokeCode -ne 0) {
  throw "Production bundle smoke failed after Pages alias propagation retries"
}
Write-Host "Production bundle smoke OK" -ForegroundColor Green

Write-Host "OK. Open your site and hard refresh (Ctrl+Shift+R)."
Write-Host "Check build: window.__APP_BUILD__ in browser console"
