# Export a PostgreSQL-compatible database before cutover or for backup.
# Usage: .\scripts\pg-dump-for-migrate.ps1
#        .\scripts\pg-dump-for-migrate.ps1 -Mode direct
param(
  [ValidateSet('direct', 'pooler', 'uri')]
  [string] $Mode = '',
  [string] $ProjectRef = ''
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
  throw "Missing $Name. Install PostgreSQL client or add its bin folder to PATH."
}

function Read-PlainPassword {
  Write-Host 'Password = Database -> Settings -> Reset database password' -ForegroundColor Yellow
  Write-Host 'Do NOT use anon / service_role API keys from Settings -> API.' -ForegroundColor Yellow
  return (Read-Host 'Password').Trim()
}

function Encode-PgUriPassword {
  param([string] $Password)
  return [uri]::EscapeDataString($Password)
}

$pgDump = Resolve-PgTool 'pg_dump'
$pgPsql = Resolve-PgTool 'psql'

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$outFile = Join-Path $outDir "prompt-hub-final-$stamp.dump"

Write-Host '=== Prompt Hub PostgreSQL dump ===' -ForegroundColor Cyan
Write-Host "Output: $outFile"
Write-Host ''
Write-Host 'For MemFire backups choose URI and paste the database connection URI.'
Write-Host ''

if (-not $Mode) {
  Write-Host 'Choose connection mode:'
  Write-Host '  1 = Session pooler (recommended on IPv4 / China networks)'
  Write-Host '  2 = Direct (needs IPv6 or IPv4 add-on)'
  Write-Host '  3 = Paste full URI from Connect dialog'
  $pick = (Read-Host 'Enter 1 / 2 / 3 (default 1)').Trim()
  switch ($pick) {
    '2' { $Mode = 'direct' }
    '3' { $Mode = 'uri' }
    default { $Mode = 'pooler' }
  }
}

$hostName = $null
$port = '5432'
$user = $null
$db = 'postgres'
$password = $null
$connectionUri = $null

if ($Mode -eq 'uri') {
  Write-Host ''
  Write-Host 'Copy URI from Connect dialog. Replace [YOUR-PASSWORD] or leave it for prompt below.'
  $connectionUri = (Read-Host 'Connection URI').Trim()
  if ($connectionUri -match '\[YOUR-PASSWORD\]' -or $connectionUri -notmatch '://[^:]+:[^@]+@') {
    $password = Read-PlainPassword
    $connectionUri = $connectionUri -replace '\[YOUR-PASSWORD\]', (Encode-PgUriPassword $password)
  }
  if ($connectionUri -notmatch '\?') {
    $connectionUri += '?sslmode=require'
  } elseif ($connectionUri -notmatch 'sslmode=') {
    $connectionUri += '&sslmode=require'
  }
} else {
  if (-not $ProjectRef) {
    $ProjectRef = (Read-Host 'Supabase project ref (required for direct/pooler mode)').Trim()
    if (-not $ProjectRef) { throw 'ProjectRef is required for direct/pooler mode. Use -Mode uri for MemFire.' }
  }
  if ($Mode -eq 'direct') {
    $hostName = "db.$ProjectRef.supabase.co"
    $user = 'postgres'
    Write-Host ''
    Write-Host 'Direct mode' -ForegroundColor Green
    Write-Host "  Host: $hostName"
    Write-Host "  User: $user"
    Write-Host "  Port: $port"
    Write-Host '  (Do NOT type pooler host here. Press Enter only if asked.)' -ForegroundColor Yellow
  } else {
    Write-Host ''
    Write-Host 'Session pooler mode' -ForegroundColor Yellow
    $defaultPoolerHost = 'aws-1-ap-southeast-1.pooler.supabase.com'
    Write-Host "  Default host: $defaultPoolerHost"
    $hostName = (Read-Host "Pooler host (Enter for default)").Trim()
    if (-not $hostName) { $hostName = $defaultPoolerHost }
    if (-not $hostName) { throw 'Pooler host is required.' }
    $defaultUser = "postgres.$ProjectRef"
    Write-Host "  Default user: $defaultUser"
    $user = (Read-Host "User (Enter for default)").Trim()
    if (-not $user) { $user = $defaultUser }
    if ($hostName -match 'pooler\.supabase\.com' -and $user -eq 'postgres') {
      throw "Pooler host requires user postgres.$ProjectRef (not plain postgres)."
    }
  }
  $password = Read-PlainPassword
}

$env:PGSSLMODE = 'require'

function Invoke-PgCommand {
  param(
    [string] $Exe,
    [string[]] $Args
  )
  & $Exe @Args
  if ($LASTEXITCODE -ne 0) {
    throw "$Exe failed exit=$LASTEXITCODE"
  }
}

function Test-DbConnection {
  if ($connectionUri) {
    Invoke-PgCommand -Exe $pgPsql -Args @($connectionUri, '-v', 'ON_ERROR_STOP=1', '-c', 'select 1 as ok;')
    return
  }
  $env:PGPASSWORD = $password
  try {
    Invoke-PgCommand -Exe $pgPsql -Args @(
      '-h', $hostName,
      '-p', $port,
      '-U', $user,
      '-d', $db,
      '-v', 'ON_ERROR_STOP=1',
      '-c', 'select 1 as ok;'
    )
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host 'Testing connection...' -ForegroundColor Cyan
try {
  Test-DbConnection
  Write-Host 'Connection OK. Starting dump...' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host 'Connection failed. Check:' -ForegroundColor Red
  if ($Mode -eq 'direct') {
    Write-Host '  - Direct needs IPv6 or IPv4 add-on. If timeout, rerun and choose 2 (pooler).'
  } else {
    Write-Host '  - Use Database password from Database -> Settings (not API keys).'
    Write-Host '  - User must match Connect dialog exactly.'
  }
  throw
}

try {
  if ($connectionUri) {
    Invoke-PgCommand -Exe $pgDump -Args @($connectionUri, '-Fc', '--no-owner', '--no-acl', '-f', $outFile)
  } else {
    $env:PGPASSWORD = $password
    Invoke-PgCommand -Exe $pgDump -Args @(
      '-h', $hostName,
      '-p', $port,
      '-U', $user,
      '-d', $db,
      '-Fc',
      '--no-owner',
      '--no-acl',
      '-f', $outFile
    )
  }

  $sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
  Write-Host ''
  Write-Host "OK: $outFile - $sizeMb MB" -ForegroundColor Green
  if ($sizeMb -lt 5) {
    Write-Host 'Warning: dump looks small. Verify you exported the right database.' -ForegroundColor Yellow
  }
  Write-Host 'Restore with:'
  Write-Host "  .\scripts\memfire-restore.ps1 -DumpFile `"$outFile`"" -ForegroundColor Yellow
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
