# 打包 Chrome/Edge 扩展 zip（不含开发说明）
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$extDir = Join-Path $root 'extension'
$manifestRaw = Get-Content (Join-Path $extDir 'manifest.json') -Raw -Encoding UTF8
if ($manifestRaw -match '"version"\s*:\s*"([^"]+)"') {
  $ver = $Matches[1]
} else {
  $ver = '0.0.0'
}
$outDir = Join-Path $root 'dist'
$zipPath = Join-Path $outDir "prompt-hub-extension-v$ver.zip"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$include = @(
  'manifest.json',
  'background.js',
  'config.js',
  'lib',
  'content',
  'popup',
  'icons',
  'PRIVACY.md'
)

$temp = Join-Path $env:TEMP "ph-ext-pack-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  foreach ($item in $include) {
    $src = Join-Path $extDir $item
    if (-not (Test-Path $src)) { throw "Missing: $item" }
    Copy-Item -Path $src -Destination (Join-Path $temp $item) -Recurse -Force
  }
  Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zipPath -Force
  $stableDir = Join-Path $root 'downloads'
  if (-not (Test-Path $stableDir)) { New-Item -ItemType Directory -Path $stableDir | Out-Null }
  $stableZip = Join-Path $stableDir 'prompt-hub-extension.zip'
  Copy-Item -Path $zipPath -Destination $stableZip -Force
  Write-Host "OK: $zipPath"
  Write-Host "OK: $stableZip (stable download link)"
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
