# Restore a Prompt Hub dump into a MemFire/Postgres database.
# Run this only against the new MemFire target project.
param(
  [string] $DumpFile,
  [switch] $CleanTarget
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

if (-not $DumpFile) {
  $latest = Get-ChildItem -LiteralPath (Join-Path $root "backups") -Filter "prompt-hub-final-*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) { $DumpFile = $latest.FullName }
}

if (-not $DumpFile -or -not (Test-Path -LiteralPath $DumpFile -PathType Leaf)) {
  throw "Dump file not found. Pass -DumpFile backups\prompt-hub-final-YYYYMMDD-HHmm.dump"
}

Write-Host "=== Prompt Hub MemFire restore ===" -ForegroundColor Cyan
Write-Host "Dump: $DumpFile"
Write-Host ""
Write-Host "Use a fresh/new MemFire project database. Do not point this at the old Supabase database."
if ($CleanTarget) {
  Write-Host "CleanTarget enabled: pg_restore will use --clean --if-exists." -ForegroundColor Yellow
}
Write-Host ""

$confirm = Read-Host "Type MEMFIRE to continue"
if ($confirm -ne "MEMFIRE") {
  throw "Restore cancelled"
}

$hostName = Read-Host "MemFire DB host"
$port = Read-Host "Port (default 5432)"
if (-not $port) { $port = "5432" }
$user = Read-Host "User (default postgres)"
if (-not $user) { $user = "postgres" }
$db = Read-Host "Database (default postgres)"
if (-not $db) { $db = "postgres" }
$plainPwd = Read-Host "Password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($plainPwd)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

try {
  $restoreArgs = @(
    "-h", $hostName,
    "-p", $port,
    "-U", $user,
    "-d", $db,
    "--no-owner",
    "--no-acl",
    "--single-transaction",
    "--exit-on-error",
    "-v"
  )
  if ($CleanTarget) {
    $restoreArgs += @("--clean", "--if-exists")
  }
  $restoreArgs += $DumpFile

  & pg_restore @restoreArgs
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed exit=$LASTEXITCODE" }

  Write-Host ""
  Write-Host "Restore OK. Running quick counts if psql is available..." -ForegroundColor Green

  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if ($psql) {
    $sql = @"
select 'auth.users' as table_name, count(*) from auth.users
union all select 'public.user_data', count(*) from public.user_data
union all select 'public.community_posts', count(*) from public.community_posts
union all select 'storage.objects/card-images', count(*) from storage.objects where bucket_id = 'card-images';
"@
    & psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c $sql
  } else {
    Write-Host "psql not found; use the MemFire SQL editor for row-count checks." -ForegroundColor Yellow
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($bstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
