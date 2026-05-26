# 打包网站文件，用于 Cloudflare 网页上传
$files = @(
  "index.html",
  "privacy.html",
  "styles.css",
  "styles-mobile.css",
  "styles-theme.css",
  "styles-settings.css",
  "styles-features.css",
  "theme.js",
  "script.js",
  "points-system.js",
  "features-draft.js",
  "mobile.js",
  "sw.js",
  "manifest.webmanifest",
  "ripple-grid.js",
  "supabase-config.js",
  "supabase-sync.js",
  "package.json",
  "assets\logo.png"
)
$dest = Join-Path $PSScriptRoot "prompt-hub-deploy.zip"
if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path ($files | ForEach-Object { Join-Path $PSScriptRoot $_ }) -DestinationPath $dest -Force
Write-Host "已生成: $dest"
Write-Host "请到 Cloudflare -> Workers 和 Pages -> prompt-hub-web -> 创建部署 -> 上传 ZIP"
