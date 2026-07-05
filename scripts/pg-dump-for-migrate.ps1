# Export the current Supabase database before cutting over to MemFire.
# The dump is custom-format so it can be restored with pg_restore.
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "backups"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$outFile = Join-Path $outDir "prompt-hub-final-$stamp.dump"

Write-Host "=== Prompt Hub final Supabase dump ===" -ForegroundColor Cyan
Write-Host "Output: $outFile"
Write-Host ""
Write-Host "Use the Supabase database connection info. Session pooler is usually more reliable than direct DB host."
Write-Host "Nothing typed here is written to git."
Write-Host ""

$hostName = Read-Host "Supabase DB host"
$port = Read-Host "Port (default 5432)"
if (-not $port) { $port = "5432" }
$user = Read-Host "User (for example postgres.xxxxx)"
$db = Read-Host "Database (default postgres)"
if (-not $db) { $db = "postgres" }
$plainPwd = Read-Host "Password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($plainPwd)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

try {
  & pg_dump `
    -h $hostName `
    -p $port `
    -U $user `
    -d $db `
    -Fc `
    --no-owner `
    --no-acl `
    -f $outFile

  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed exit=$LASTEXITCODE" }

  $sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
  Write-Host ""
  Write-Host "OK: $outFile ($sizeMb MB)" -ForegroundColor Green
  Write-Host "Restore tomorrow with:"
  Write-Host "  .\scripts\memfire-restore.ps1 -DumpFile `"$outFile`"" -ForegroundColor Yellow
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($bstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
