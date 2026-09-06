$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $root ".pages-deploy"

if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

$rootFilePattern = '\.(html|js|css|ico|webmanifest|txt|xml|json)$'
$allowedDirs = @(
  'assets/',
  'vendor/',
  'functions/',
  'extension/',
  'legacy/',
  'partials/',
  'styles/'
)
$entryRootFiles = @(
  'index.html',
  'admin.html',
  'admin-login.html',
  'asset-studio.html',
  'privacy.html',
  'terms.html',
  'baidu_verify_codeva-ppEB3Ror5E.html'
)
$alwaysRootFiles = @(
  '_headers',
  '_redirects',
  'favicon.ico',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  'features-assets.js',
  'ripple-grid.js'
)
$alwaysStaticDirs = @(
  'partials/index-body/'
)

function Copy-StaticFile {
  param([string] $RelativePath)

  $src = Join-Path $root $RelativePath
  if (-not (Test-Path $src -PathType Leaf)) { return }

  $dest = Join-Path $staging $RelativePath
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }
  Copy-Item $src $dest
}

$tracked = & git -C $root ls-files
if ($LASTEXITCODE -ne 0 -or -not $tracked) {
  throw "Unable to enumerate tracked files for Pages staging"
}

$allowedRoot = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
function Add-RootFile {
  param([string] $Path)
  if (-not $Path) { return }
  $clean = ($Path -replace '\\', '/').TrimStart('./')
  if ($clean -match '/') { return }
  if ($clean -notmatch $rootFilePattern -and ($alwaysRootFiles -notcontains $clean)) { return }
  if (Test-Path (Join-Path $root $clean) -PathType Leaf) {
    [void] $allowedRoot.Add($clean)
  }
}

foreach ($file in $entryRootFiles + $alwaysRootFiles) {
  Add-RootFile $file
}

foreach ($file in $entryRootFiles) {
  $htmlPath = Join-Path $root $file
  if (-not (Test-Path $htmlPath -PathType Leaf)) { continue }
  $html = Get-Content $htmlPath -Raw
  foreach ($m in [regex]::Matches($html, '(?:src|href)=["'']([^"'']+)["'']')) {
    $ref = $m.Groups[1].Value
    if (-not $ref -or $ref -match '^(https?:|data:|#)') { continue }
    $ref = ($ref -split '[?#]')[0]
    Add-RootFile $ref
  }
}

foreach ($rootFile in $allowedRoot) {
  $rel = $rootFile -replace '/', [IO.Path]::DirectorySeparatorChar
  Copy-StaticFile $rel
}

foreach ($dir in $alwaysStaticDirs) {
  $dirPath = Join-Path $root ($dir -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $dirPath -PathType Container)) { continue }
  foreach ($file in Get-ChildItem $dirPath -File) {
    $relPath = $file.FullName.Substring($root.Length).TrimStart('\', '/')
    Copy-StaticFile $relPath
  }
}

foreach ($path in $tracked) {
  $rel = $path -replace '/', [IO.Path]::DirectorySeparatorChar
  $isAllowedDir = $false
  foreach ($dir in $allowedDirs) {
    if ($path.StartsWith($dir)) {
      $isAllowedDir = $true
      break
    }
  }

  if ($isAllowedDir) {
    Copy-StaticFile $rel
  }
}

$runtimeBuildOutput = & node (Join-Path $root "scripts\build-pages-runtime.mjs") $staging
if ($LASTEXITCODE -ne 0) {
  throw "Unable to build consolidated Pages runtime assets"
}
foreach ($line in $runtimeBuildOutput) {
  Write-Host $line -ForegroundColor DarkGray
}

$files = Get-ChildItem $staging -Recurse -File
$count = $files.Count
$sizeMb = [math]::Round((($files | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host "Pages staging: $staging ($count files, ${sizeMb} MB)"
Write-Host "Note: staging copies only allowlisted root entries and tracked asset directories." -ForegroundColor DarkGray
return $staging
