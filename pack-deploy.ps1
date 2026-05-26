# 打包静态站文件，用于 Cloudflare「上传项目」部署（非 Git 自动部署）
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
  "mobile.js",
  "api-config.js",
  "api-client.js",
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
  Write-Warning "以下文件不存在，已跳过: $($missing -join ', ')"
}
$dest = Join-Path $root "prompt-hub-deploy.zip"
if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path $paths -DestinationPath $dest -Force
Write-Host "已生成: $dest"
Write-Host "Cloudflare: prompt-hub-web -> Create deployment -> 上传此 ZIP -> Save and deploy"
Write-Host "提示: 若要用 GitHub 自动部署，不要走上传页，应选 Connect to Git。"
