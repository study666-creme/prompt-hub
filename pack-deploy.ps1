# Pack static site for Cloudflare Pages manual upload (not Git auto-deploy)
$root = $PSScriptRoot
$files = @(
  "index.html",
  "privacy.html",
  "terms.html",
  "styles.css",
  "styles-mobile.css",
  "styles-theme.css",
  "styles-settings.css",
  "styles-features.css",
  "theme.js",
  "script.js",
  "points-system.js",
  "features-draft.js",
  "membership.js",
  "subscription.js",
  "modal-hub.js",
  "trial-tasks.js",
  "mobile.js",
  "vendor\supabase.min.js",
  "api-domain.config.js",
  "api-config.js",
  "api-client.js",
  "cloud-sync-safety.js",
  "supabase-config.js",
  "supabase-sync.js",
  "sw.js",
  "manifest.webmanifest",
  "ripple-grid.js",
  "wrangler.toml",
  "vercel.json",
  "assets\logo.png"
)
$missing = @()
$paths = foreach ($f in $files) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { $missing += $f; continue }
  $p
}
if ($missing.Count) {
  Write-Warning "Missing (skipped): $($missing -join ', ')"
}
$dest = Join-Path $root "prompt-hub-deploy.zip"
if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path $paths -DestinationPath $dest -Force
Write-Host "OK: $dest"
Write-Host "Cloudflare: Workers and Pages -> your project -> Create deployment -> Upload assets -> pick ZIP -> Deploy"
Write-Host "Tip: use Connect to Git for auto deploy; manual ZIP is for upload-only projects."
