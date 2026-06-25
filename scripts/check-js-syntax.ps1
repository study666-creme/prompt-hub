# Fail deploy if any shipped frontend JS has syntax errors.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$files = @(
  'script.js', 'features-draft.js', 'image-gen-feed.js', 'media-pipeline.js',
  'sync-orchestrator.js', 'card-image-loader.js', 'feed-images.js', 'feed-layout.js',
  'mobile.js', 'features-assets.js', 'community-public-feed.js', 'imagegen-gen-errors.js', 'imagegen-warehouse-repair.js', 'imagegen-ref-compress.js', 'imagegen-ref-resolve.js', 'imagegen-warehouse-save.js', 'imagegen-finish-run.js', 'imagegen-poll-warehouse.js', 'imagegen-job-runner.js', 'imagegen-submit.js', 'asset-studio.js', 'supabase-sync.js',
  'api-client.js', 'community-gacha.js', 'admin.js', 'imagegen-prompt-tools.js',
  'imagegen-prompt-kit.js', 'points-system.js', 'cloud-sync-safety.js', 'app-toast.js', 'app-viewer-core.js', 'app-appreciate.js', 'media-download.js', 'app-lightbox.js'
)

$failed = @()
foreach ($rel in $files) {
  $path = Join-Path $root $rel
  if (-not (Test-Path $path)) { continue }
  $out = & node --check $path 2>&1
  if ($LASTEXITCODE -ne 0) {
    $failed += $rel
    Write-Host "SYNTAX ERROR: $rel" -ForegroundColor Red
    Write-Host $out
  }
}

if ($failed.Count) {
  Write-Host "check-js-syntax: $($failed.Count) file(s) failed" -ForegroundColor Red
  exit 1
}

Write-Host "check-js-syntax: all $($files.Count) files OK" -ForegroundColor Green
