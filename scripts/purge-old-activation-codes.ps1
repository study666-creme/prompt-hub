# Keep only the latest activation-code batch; deactivate/delete all older codes.
param(
  [string]$KeepSince = '2026-05-30T16:19:00+00:00'
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEnv = Join-Path $scriptDir '..\server\.dev.vars'

function Read-DotEnv($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_ -split '=', 2
    $map[$k.Trim()] = $v.Trim().Trim('"')
  }
  return $map
}

$sb = Read-DotEnv $serverEnv
$url = $sb.SUPABASE_URL.TrimEnd('/')
$key = $sb.SUPABASE_SERVICE_ROLE_KEY
if (-not $url -or -not $key) { throw 'Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.dev.vars' }

$headers = @{
  apikey         = $key
  Authorization  = "Bearer $key"
  'Content-Type' = 'application/json'
  Prefer         = 'return=representation'
}
if ($key -match '^sb_secret_') {
  $headers['User-Agent'] = 'PromptHub-PurgeCodes/1.0'
}

$encSince = [uri]::EscapeDataString("gte.$KeepSince")
$all = Invoke-RestMethod -Method Get -Uri "$url/rest/v1/activation_codes?select=code,created_at,used_count,active,note&order=created_at.asc" -Headers $headers
$keep = @($all | Where-Object { $_.created_at -ge $KeepSince })
$purge = @($all | Where-Object { $_.created_at -lt $KeepSince })

Write-Host "Total codes: $($all.Count)" -ForegroundColor Cyan
Write-Host "Keep (since $KeepSince): $($keep.Count)" -ForegroundColor Green
Write-Host "Purge: $($purge.Count)" -ForegroundColor Yellow

if (-not $purge.Count) {
  Write-Host 'Nothing to purge.'
  exit 0
}

$deleted = 0
$deactivated = 0
$failed = 0

foreach ($row in $purge) {
  $code = $row.code
  $encCode = [uri]::EscapeDataString($code)
  if ([int]$row.used_count -eq 0) {
    try {
      Invoke-RestMethod -Method Delete -Uri "$url/rest/v1/activation_codes?code=eq.$encCode" -Headers $headers | Out-Null
      $deleted++
      Write-Host "  DEL $code ($($row.note))" -ForegroundColor DarkGray
    } catch {
      try {
        $body = '{"active":false,"note":"purged-' + (Get-Date -Format 'yyyyMMdd') + '"}'
        Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/activation_codes?code=eq.$encCode" -Headers $headers -Body $body | Out-Null
        $deactivated++
        Write-Host "  OFF $code (delete blocked, deactivated)" -ForegroundColor Yellow
      } catch {
        $failed++
        Write-Host "  FAIL $code $($_.Exception.Message)" -ForegroundColor Red
      }
    }
  } else {
    try {
      $body = '{"active":false,"note":"purged-redeemed-' + (Get-Date -Format 'yyyyMMdd') + '"}'
      Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/activation_codes?code=eq.$encCode" -Headers $headers -Body $body | Out-Null
      $deactivated++
      Write-Host "  OFF $code (used=$($row.used_count))" -ForegroundColor Yellow
    } catch {
      $failed++
      Write-Host "  FAIL $code $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}

Write-Host ""
Write-Host "Done. Deleted=$deleted Deactivated=$deactivated Failed=$failed" -ForegroundColor Cyan
Write-Host "Remaining active codes:" -ForegroundColor Green
$left = Invoke-RestMethod -Method Get -Uri "$url/rest/v1/activation_codes?select=code,note,active,used_count,created_at&active=eq.true&order=created_at.desc" -Headers $headers
$left | ForEach-Object { Write-Host "  $($_.code)  $($_.note)  used=$($_.used_count)" }
