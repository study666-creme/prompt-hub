# 只打包 Pages 需要的前端静态文件（排除 server/docs/backups 等）
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $root ".pages-deploy"

if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

$rootFilePattern = '\.(html|js|css|ico|webmanifest|txt|xml|json)$'
$rootExclude = @(
  'package.json', 'vercel.json', 'wrangler.toml',
  'prompt-hub-deploy.zip'
)

Get-ChildItem $root -File | Where-Object {
  $_.Name -match $rootFilePattern -and ($rootExclude -notcontains $_.Name)
} | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $staging $_.Name)
}

foreach ($dir in @('assets', 'vendor', 'functions', 'downloads', 'extension')) {
  $src = Join-Path $root $dir
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $staging $dir) -Recurse
  }
}

# 明确不部署：themes/（SillyTavern 本地资料）、server、docs、backups 等

if (Test-Path (Join-Path $root "_headers")) {
  Copy-Item (Join-Path $root "_headers") $staging
}

$count = (Get-ChildItem $staging -Recurse -File).Count
$sizeMb = [math]::Round(((Get-ChildItem $staging -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host "Pages staging: $staging ($count files, ${sizeMb} MB)"
Write-Host "Note: only frontend static assets are deployed (server/docs/backups excluded). Full repo has more files." -ForegroundColor DarkGray
return $staging
