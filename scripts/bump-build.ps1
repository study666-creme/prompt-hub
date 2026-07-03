# Bump build id before Pages deploy (index.html, admin.html, sw.js)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$today = Get-Date -Format "yyyyMMdd"

$indexPath = Join-Path $root "index.html"
$text = Get-Content $indexPath -Raw -Encoding UTF8
$m = [regex]::Match($text, "__APP_BUILD__\s*=\s*'(\d{8})([a-z])'")
if (-not $m.Success) { throw "Cannot find __APP_BUILD__ in index.html" }

$old = $m.Groups[1].Value + $m.Groups[2].Value
$d = $m.Groups[1].Value
$c = [int][char]$m.Groups[2].Value
if ($d -eq $today) {
  $c++
} else {
  $d = $today
  $c = [int][char]'a'
}
if ($c -gt [int][char]'z') {
  $dt = [DateTime]::ParseExact($d, 'yyyyMMdd', $null).AddDays(1)
  $d = $dt.ToString('yyyyMMdd')
  $c = [int][char]'a'
  Write-Host "Build letter rolled to next day: $d$([char]$c)" -ForegroundColor Yellow
}
$new = $d + [char]$c
$oldEsc = [regex]::Escape($old)

$files = @(
  (Join-Path $root "index.html"),
  (Join-Path $root "admin.html"),
  (Join-Path $root "sw.js")
)
$syncCacheAssets = @(
  'styles.css', 'styles-theme.css', 'styles-mobile.css', 'styles-features.css', 'styles-premium.css',
  'theme.js', 'api-client.js', 'supabase-sync.js', 'script.js',
  'features-draft.js', 'features-assets.js', 'community-public-feed.js', 'card-gallery.js'
)

foreach ($path in $files) {
  if (-not (Test-Path $path)) { continue }
  $t = Get-Content $path -Raw -Encoding UTF8
  if ($path -eq $indexPath) {
    $t = [regex]::Replace($t, "__APP_BUILD__\s*=\s*'$oldEsc'", "__APP_BUILD__ = '$new'")
    $t = [regex]::Replace($t, "版本 $oldEsc", "版本 $new")
    foreach ($asset in $syncCacheAssets) {
      $esc = [regex]::Escape($asset)
      $t = [regex]::Replace($t, "($esc\?v=)$oldEsc", "`${1}$new")
      $t = [regex]::Replace($t, "($esc\?v=)\d{8}[a-z]", "`${1}$new")
    }
    # pack-*.js 不带 ?v=（verify-pack-contract）；缓存靠 __APP_BUILD__ + sw.js
  } elseif ($path -like '*admin.html') {
    $t = [regex]::Replace($t, "__ADMIN_BUILD__\s*=\s*'[^']+'", "__ADMIN_BUILD__ = '$new'")
    $t = [regex]::Replace($t, 'admin\.js\?v=[^"\s>]+', "admin.js?v=$new")
  } elseif ($path -like '*sw.js') {
    $t = [regex]::Replace($t, "const CACHE = 'prompt-hub-v[^']+';", "const CACHE = 'prompt-hub-v$new';")
  } else {
    $t = $t.Replace($old, $new)
  }
  [System.IO.File]::WriteAllText($path, $t, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Build bumped: $old -> $new"
