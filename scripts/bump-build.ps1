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

$files = @(
  (Join-Path $root "index.html"),
  (Join-Path $root "admin.html"),
  (Join-Path $root "sw.js")
)
foreach ($path in $files) {
  if (-not (Test-Path $path)) { continue }
  $t = Get-Content $path -Raw -Encoding UTF8
  $t = $t.Replace($old, $new)
  $t = [regex]::Replace($t, "const CACHE = 'prompt-hub-v[^']+';", "const CACHE = 'prompt-hub-v$new';")
  [System.IO.File]::WriteAllText($path, $t, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Build bumped: $old -> $new"
