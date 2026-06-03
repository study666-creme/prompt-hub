# 下架社区无效帖：Storage 无图、无效作者、重复 source_card_id
param(
  [string]$ApiBase = '',
  [string]$AdminSecret = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$localEnv = Join-Path $scriptDir 'admin.local.env'

function Read-DotEnv($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_ -split '=', 2
    $map[$k.Trim()] = $v.Trim().Trim('"')
  }
  return $map
}

if (-not $ApiBase -or -not $AdminSecret) {
  $envMap = Read-DotEnv $localEnv
  if (-not $ApiBase) { $ApiBase = $envMap['API_BASE_URL'] }
  if (-not $AdminSecret) { $AdminSecret = $envMap['ADMIN_API_SECRET'] }
}

if (-not $ApiBase) { $ApiBase = 'https://api.prompt-hub.cn' }
$ApiBase = $ApiBase.TrimEnd('/')
if ($ApiBase -match 'workers\.dev$') {
  Write-Host "admin.local.env 指向 workers.dev，改用 api.prompt-hub.cn" -ForegroundColor Yellow
  $ApiBase = 'https://api.prompt-hub.cn'
}

if (-not $AdminSecret) {
  throw '缺少 ADMIN_API_SECRET：请复制 scripts/admin.local.env.example 为 admin.local.env 并填入 Worker 的 ADMIN_API_SECRET'
}

$secretBytes = [Text.Encoding]::UTF8.GetBytes($AdminSecret)
$b64 = [Convert]::ToBase64String($secretBytes)
$headers = @{
  'Content-Type'   = 'application/json'
  'X-Admin-Secret' = "b64:$b64"
}

Write-Host "请求 $ApiBase/api/admin/community/purge-ghosts …" -ForegroundColor Cyan
Write-Host "（帖多时约 1～2 分钟，请耐心等待）"

$res = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/admin/community/purge-ghosts" -Headers $headers -TimeoutSec 180
if (-not $res.ok) {
  throw ($res.error.message | Out-String)
}

$d = $res.data
Write-Host ""
Write-Host "清理完成：" -ForegroundColor Green
Write-Host "  下架无图/无效作者: $($d.unpublishedMissing)"
Write-Host "  下架重复卡片:     $($d.unpublishedDuplicates)"
Write-Host "  修正作者归属:     $($d.repairedAuthors)"
Write-Host "  仍在线社区帖:     $($d.publishedRemaining)"
Write-Host ""
Write-Host "请强刷 prompt-hub.cn 社区页验证。" -ForegroundColor Yellow
