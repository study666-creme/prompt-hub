# 境外 Supabase Worker 密钥（prompt-hubs.com 上线必做）
# 现象：登录 403、社区空白、管理后台 INTERNAL_ERROR
# 原因：Worker SUPABASE_URL 仍指向阿里云 RDS -> Cloudflare 出站被备案页拦截

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Join-Path (Join-Path $PSScriptRoot "..") "" | Resolve-Path
$server = Join-Path $root "server" | Resolve-Path
$wrangler = Join-Path $server "node_modules\.bin\wrangler.cmd"
$config = Join-Path $server "wrangler.toml"
$adminEnv = Join-Path $PSScriptRoot "admin.local.env"

function Read-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content -LiteralPath $path -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_ -split '=', 2
    $map[$k.Trim()] = $v.Trim().Trim('"')
  }
  return $map
}

function Invoke-WranglerSecret([string]$name, [string]$value) {
  if (-not $value) {
    Write-Host ""
    Write-Host "请在下方粘贴 $name 的值，然后按 Enter：" -ForegroundColor Yellow
    & $wrangler secret put $name --config $config
  } else {
    Write-Host "  从 admin.local.env 写入 $name ..." -ForegroundColor DarkGray
    $value | & $wrangler secret put $name --config $config
  }
  if ($LASTEXITCODE -ne 0) {
    throw "wrangler secret put $name 失败（退出码 $LASTEXITCODE）。请确认在 server 目录使用本地 wrangler，勿用全局 wrangler 4。"
  }
}

Write-Host ""
Write-Host "=== Prompt Hub：切换 Worker 到境外 Supabase ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $wrangler)) {
  Write-Host "首次运行：在 server/ 安装依赖 ..." -ForegroundColor Yellow
  Push-Location $server
  npm install
  Pop-Location
  if (-not (Test-Path $wrangler)) { throw "未找到 $wrangler，请先在 server 目录执行 npm install" }
}

Write-Host "健康检查（修改前）：" -ForegroundColor DarkGray
curl.exe -sS "https://api.prompt-hubs.com/health"
Write-Host ""
Write-Host ""

$envMap = Read-DotEnv $adminEnv
$supabaseUrl = $envMap['SUPABASE_URL']
$serviceRole = $envMap['SUPABASE_SERVICE_ROLE_KEY']

if ($supabaseUrl -and $serviceRole) {
  Write-Host "检测到 scripts/admin.local.env，将自动写入 Worker Secret。" -ForegroundColor Green
} else {
  Write-Host "未找到 admin.local.env 或其中缺少密钥，将逐项手动粘贴。" -ForegroundColor Yellow
  Write-Host "Supabase Dashboard -> Settings -> API：" -ForegroundColor Yellow
  Write-Host "  Project URL  例：https://yibawjvhmqcysdovscss.supabase.co"
  Write-Host "  service_role Secret（勿用 anon/publishable）"
  Write-Host ""
}

Push-Location $server
try {
  Write-Host "第 1 步：SUPABASE_URL" -ForegroundColor Green
  if (-not $supabaseUrl) {
    Write-Host "  粘贴 Project URL（境外 .supabase.co），回车确认" -ForegroundColor DarkGray
  }
  Invoke-WranglerSecret "SUPABASE_URL" $supabaseUrl

  Write-Host ""
  Write-Host "第 2 步：SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Green
  if (-not $serviceRole) {
    Write-Host "  粘贴 service_role，回车确认" -ForegroundColor DarkGray
  }
  Invoke-WranglerSecret "SUPABASE_SERVICE_ROLE_KEY" $serviceRole

  Write-Host ""
  Write-Host "第 3 步：部署 Worker（prompt-hub-api）" -ForegroundColor Green
  & $wrangler deploy --config $config
  if ($LASTEXITCODE -ne 0) { throw "wrangler deploy 失败" }

  Write-Host ""
  Write-Host "第 4 步：验证（应 supabase:ok，不再是阿里云备案页）" -ForegroundColor Green
  Start-Sleep -Seconds 3
  $health = curl.exe -sS "https://api.prompt-hubs.com/health"
  Write-Host $health
  Write-Host ""
  if ($health -match 'aliyun_icp_block|"supabase":"error"') {
    Write-Host ""
    Write-Host "仍连阿里云/Supabase 不可用。请检查 SUPABASE_URL 是否为 https://xxxxx.supabase.co" -ForegroundColor Red
    Write-Host "手动重试（在 server 目录）：" -ForegroundColor Yellow
    Write-Host "  cd d:\prompt-hub\server"
    Write-Host "  .\node_modules\.bin\wrangler.cmd secret put SUPABASE_URL --config wrangler.toml"
    Write-Host "  .\node_modules\.bin\wrangler.cmd secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.toml"
    Write-Host "  npm run deploy"
    exit 1
  }

  Write-Host ""
  Write-Host "第 5 步：部署 Pages（项目根目录）" -ForegroundColor Green
  Write-Host "  cd d:\prompt-hub"
  Write-Host "  .\deploy-pages.ps1"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Worker 已切换。请 deploy Pages 后浏览器 Ctrl+Shift+R 强刷登录。" -ForegroundColor Cyan
