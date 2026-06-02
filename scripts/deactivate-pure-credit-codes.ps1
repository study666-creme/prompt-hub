# Deactivate old pure-credit shop codes (no membership bonus)
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEnv = Join-Path $scriptDir "..\server\.dev.vars"

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
if (-not $url -or -not $key) { throw "Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.dev.vars" }

$headers = @{
  apikey        = $key
  Authorization = "Bearer $key"
  'Content-Type' = 'application/json'
  Prefer        = 'return=representation'
}
if ($key -match '^sb_secret_') {
  $headers['User-Agent'] = 'PromptHub-DeactivateCodes/1.0'
}

$notes = @(
  'shop-cr100-0.99', 'shop-cr500-4.9', 'shop-cr1k-9.8',
  'shop-cr3k-29.5', 'shop-cr5k-48', 'shop-cr10k-95'
)

foreach ($note in $notes) {
  $q = "note=eq.$note&active=eq.true&membership_days=is.null"
  $rows = Invoke-RestMethod -Method Get -Uri ($url + "/rest/v1/activation_codes?select=code,note&$q") -Headers $headers
  if (-not $rows -or $rows.Count -eq 0) {
    Write-Host "No active pure-credit codes for $note" -ForegroundColor DarkGray
    continue
  }
  $codes = @($rows | ForEach-Object { $_.code })
  Write-Host "Deactivating $($codes.Count) codes for $note ..." -ForegroundColor Yellow
  foreach ($code in $codes) {
    $patch = @{ active = $false } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri ($url + "/rest/v1/activation_codes?code=eq.$code") -Headers $headers -Body $patch | Out-Null
    Write-Host "  $code"
  }
}

Write-Host "Done." -ForegroundColor Green
