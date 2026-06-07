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
& (Join-Path $root "scripts\bump-build.ps1")
Write-Host "Deploying from: $root"
Push-Location $server
try {
  npm exec -- wrangler pages deploy $root --project-name=$project
  $code = $LASTEXITCODE
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
  Write-Host "部署失败（常见原因：Cloudflare 登录过期，错误码 10000）" -ForegroundColor Red
  Write-Host "请按下面步骤重新登录后再部署：" -ForegroundColor Yellow
  Write-Host "  第 1 步  cd server"
  Write-Host "  第 2 步  npm exec wrangler login"
  Write-Host "  第 3 步  浏览器完成授权后，回到项目根目录再运行 deploy-pages.ps1"
  Write-Host ""
  exit $code
}
Write-Host "OK. Open your site and hard refresh (Ctrl+Shift+R)."
Write-Host "Check build: window.__APP_BUILD__ in browser console"
