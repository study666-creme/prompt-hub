# Prompt Hub - local static preview (do not open index.html via file://)
$ErrorActionPreference = 'Stop'
$Port = 5500
$Root = $PSScriptRoot
Set-Location $Root

function Test-PythonServer {
  try {
    $v = & python -c "import sys; print(sys.version_info[0])" 2>$null
    return ($v -eq '3')
  } catch {
    return $false
  }
}

function Start-PythonServer([int]$p) {
  Write-Host "Using Python http.server on port $p ..." -ForegroundColor DarkGray
  & python -m http.server $p --bind 127.0.0.1
}

function Start-NpxServer([int]$p) {
  Write-Host "Using npx http-server on port $p ..." -ForegroundColor DarkGray
  Push-Location $Root
  try {
    npx --yes http-server . -p $p -a 127.0.0.1 -c-1
  } finally {
    Pop-Location
  }
}

function Start-PowerShellServer([int]$p) {
  Write-Host "Using built-in PowerShell static server on port $p ..." -ForegroundColor DarkGray
  $listener = [System.Net.HttpListener]::new()
  $prefix = "http://127.0.0.1:$p/"
  $listener.Prefixes.Add($prefix)
  $listener.Start()
  Write-Host "Serving: $prefix" -ForegroundColor Green
  try {
    while ($listener.IsListening) {
      $ctx = $listener.GetContext()
      $req = $ctx.Request
      $res = $ctx.Response
      $rel = [Uri]::UnescapeDataString($req.Url.LocalPath).TrimStart('/')
      if (-not $rel) { $rel = 'index.html' }
      $file = Join-Path $Root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
      if (-not (Test-Path $file -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()
        continue
      }
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      $mime = switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.webp' { 'image/webp' }
        '.svg' { 'image/svg+xml' }
        '.webmanifest' { 'application/manifest+json' }
        default { 'application/octet-stream' }
      }
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentType = $mime
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
    }
  } finally {
    $listener.Stop()
    $listener.Close()
  }
}

Write-Host ''
Write-Host '=== Prompt Hub local server ===' -ForegroundColor Cyan
if (Test-Path (Join-Path $Root "scripts\build-core-bundle.mjs")) {
  if (-not (Test-Path (Join-Path $Root "node_modules\esbuild"))) {
    Write-Host 'Installing esbuild for core bundle ...' -ForegroundColor DarkGray
    Push-Location $Root
    npm install --no-audit --no-fund 2>$null
    Pop-Location
  }
  Write-Host 'Building dist/*.bundle.js ...' -ForegroundColor DarkGray
  & node (Join-Path $Root "scripts\build-all-bundles.mjs")
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'bundle build failed — fix before local preview' -ForegroundColor Red
    exit 1
  }
}
Write-Host "Open in browser: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host 'Do NOT open index.html via file:// (API will be blocked).' -ForegroundColor Yellow
Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

if (Test-PythonServer) {
  Start-PythonServer -p $Port
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
  Start-NpxServer -p $Port
} else {
  Write-Host 'Python/npx unavailable; using PowerShell built-in server.' -ForegroundColor Yellow
  Start-PowerShellServer -p $Port
}
