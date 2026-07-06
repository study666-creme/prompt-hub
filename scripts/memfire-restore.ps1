# Restore a Prompt Hub dump into MemFire Postgres (app dev direct connect).
# Usage:
#   .\scripts\memfire-restore.ps1 -DbHost "xxx.baseapi.memfiredb.com" -Port 10000 -User memfire -Password "..." -Yes
param(
  [string] $DumpFile,
  [Alias('HostName')]
  [string] $DbHost,
  [string] $Port = '',
  [string] $User,
  [string] $Database = 'postgres',
  [string] $Password,
  [switch] $CleanTarget,
  [switch] $Yes
)

$ErrorActionPreference = 'Stop'

function Resolve-PgTool {
  param([string] $Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "C:\Program Files\PostgreSQL\17\bin\$Name.exe",
    "C:\Program Files\PostgreSQL\16\bin\$Name.exe",
    "C:\Program Files\PostgreSQL\15\bin\$Name.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  throw "Missing $Name. Install PostgreSQL client first."
}

function Load-DotEnv {
  param([string] $Path)
  $out = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $out }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $out[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
  }
  return $out
}

function Invoke-PgCommand {
  param(
    [string] $Exe,
    [string[]] $ArgumentList
  )
  & $Exe @ArgumentList
  if ($LASTEXITCODE -ne 0) { throw "$Exe failed exit=$LASTEXITCODE" }
}

$pgRestore = Resolve-PgTool 'pg_restore'
$pgPsql = Resolve-PgTool 'psql'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Load-DotEnv (Join-Path $PSScriptRoot 'memfire.local.env')

if (-not $DumpFile) {
  $latest = Get-ChildItem -LiteralPath (Join-Path $root 'backups') -Filter 'prompt-hub-final-*.dump' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) { $DumpFile = $latest.FullName }
}

if (-not $DumpFile -or -not (Test-Path -LiteralPath $DumpFile -PathType Leaf)) {
  throw 'Dump file not found. Pass -DumpFile backups\prompt-hub-final-YYYYMMDD-HHmm.dump'
}

if (-not $DbHost) { $DbHost = $envFile['MEMFIRE_DB_HOST'] }
if (-not $Port) { $Port = $envFile['MEMFIRE_DB_PORT'] }
if (-not $User) { $User = $envFile['MEMFIRE_DB_USER'] }
if (-not $Password) { $Password = $envFile['MEMFIRE_DB_PASSWORD'] }
if (-not $Port) { $Port = '10000' }
if (-not $User) { $User = 'memfire' }

Write-Host '=== Prompt Hub MemFire restore ===' -ForegroundColor Cyan
Write-Host "Dump: $DumpFile"
Write-Host ''
Write-Host 'MemFire app dev defaults: port 10000, user memfire.'
Write-Host 'Use -DbHost (not -HostName; PowerShell reserves $HostName).'
Write-Host ''

if (-not $Yes) {
  $confirm = Read-Host 'Type MEMFIRE to continue'
  if ($confirm -ne 'MEMFIRE') { throw 'Restore cancelled' }
}

if (-not $DbHost) {
  $DbHost = (Read-Host 'MemFire DB host (e.g. xxx.baseapi.memfiredb.com)').Trim()
}
if (-not $DbHost) { throw 'DbHost is required.' }

Write-Host "Target: $DbHost`:$Port user=$User db=$Database" -ForegroundColor Cyan

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $portInput = Read-Host "Port (default $Port)"
  if ($portInput) { $Port = $portInput }
}

if (-not $PSBoundParameters.ContainsKey('User')) {
  $userInput = Read-Host "User (default $User)"
  if ($userInput) { $User = $userInput }
}

if (-not $PSBoundParameters.ContainsKey('Database')) {
  $dbInput = Read-Host "Database (default $Database)"
  if ($dbInput) { $Database = $dbInput }
}

if (-not $Password) {
  Write-Host 'Password = MemFire Settings -> Database -> Reset database password' -ForegroundColor Yellow
  $Password = (Read-Host 'Password').Trim()
}

$env:PGPASSWORD = $Password
# MemFire app dev direct connect (port 10000) often does not use SSL.
$env:PGSSLMODE = 'prefer'
$env:PGCONNECT_TIMEOUT = '30'

try {
  Write-Host ''
  Write-Host 'Testing connection...' -ForegroundColor Cyan
  Invoke-PgCommand -Exe $pgPsql -ArgumentList @(
    '-h', $DbHost,
    '-p', $Port,
    '-U', $User,
    '-d', $Database,
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'select 1 as ok;'
  )
  Write-Host 'Connection OK. Restoring (may take 1-3 minutes)...' -ForegroundColor Green

  $restoreArgs = @(
    '-h', $DbHost,
    '-p', $Port,
    '-U', $User,
    '-d', $Database,
    '--no-owner',
    '--no-acl',
    '-v'
  )
  if ($CleanTarget) {
    $restoreArgs += @('--clean', '--if-exists')
  }
  $restoreArgs += $DumpFile

  Invoke-PgCommand -Exe $pgRestore -ArgumentList $restoreArgs

  Write-Host ''
  Write-Host 'Checking auth.users (may need supplemental import if 0)...' -ForegroundColor Cyan
  $authCount = & $pgPsql -h $DbHost -p $Port -U $User -d $Database -t -A -c 'select count(*) from auth.users;'
  if ([int]$authCount -eq 0) {
    Write-Host 'auth.users is empty. Run scripts/memfire-import-auth.ps1 after main restore.' -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host 'Restore OK. Row counts:' -ForegroundColor Green
  $sql = @"
select 'auth.users' as table_name, count(*)::text as n from auth.users
union all select 'public.user_data', count(*)::text from public.user_data
union all select 'public.community_posts', count(*)::text from public.community_posts
union all select 'storage.objects/card-images', count(*)::text from storage.objects where bucket_id = 'card-images';
"@
  Invoke-PgCommand -Exe $pgPsql -ArgumentList @(
    '-h', $DbHost,
    '-p', $Port,
    '-U', $User,
    '-d', $Database,
    '-v', 'ON_ERROR_STOP=1',
    '-c', $sql
  )
} catch {
  Write-Host ''
  Write-Host 'Restore failed.' -ForegroundColor Red
  if ($_.Exception.Message -match 'timeout') {
    Write-Host 'Likely cause: MemFire database whitelist blocked your IP.' -ForegroundColor Yellow
  }
  throw
} finally {
  Remove-Item Env:PGPASSWORD,Env:PGSSLMODE,Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
}
