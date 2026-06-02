# Regenerate 10000-credit codes with 40-day basic membership bonus
$ErrorActionPreference = 'Stop'
$note = 'shop-cr10k-95'
$scriptDir = $PSScriptRoot
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

function New-RandomCode([string]$prefix) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $suffix = -join (1..12 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
  return ($prefix.ToUpper() + '-' + $suffix)
}

$sb = Read-DotEnv $serverEnv
$url = $sb.SUPABASE_URL.TrimEnd('/')
$key = $sb.SUPABASE_SERVICE_ROLE_KEY
$headers = @{
  apikey        = $key
  Authorization = "Bearer $key"
  'Content-Type' = 'application/json'
  Prefer        = 'return=representation'
}
if ($key -match '^sb_secret_') {
  $headers['User-Agent'] = 'PromptHub-RegenCR10K/1.0'
}

# Deactivate active CR10K without membership bonus
$q = "note=eq.$note&active=eq.true&membership_days=is.null"
$old = Invoke-RestMethod -Method Get -Uri ($url + "/rest/v1/activation_codes?select=code&$q") -Headers $headers
foreach ($r in @($old)) {
  Invoke-RestMethod -Method Patch -Uri ($url + "/rest/v1/activation_codes?code=eq.$($r.code)") -Headers $headers -Body '{"active":false}' | Out-Null
  Write-Host "Deactivated $($r.code)"
}

$rows = @()
$seen = @{}
$n = 0
while ($n -lt 2) {
  $code = New-RandomCode 'CR10K'
  if ($seen[$code]) { continue }
  $seen[$code] = $true
  $rows += @{
    code = $code
    credits = 10000
    membership_tier = 'basic'
    membership_days = 40
    offer_kind = $null
    max_uses = 1
    active = $true
    note = $note
  }
  $n++
}

$inserted = Invoke-RestMethod -Method Post -Uri ($url + '/rest/v1/activation_codes') -Headers $headers -Body ($rows | ConvertTo-Json -Depth 6)
Write-Host ''
Write-Host '10000 credits + 40d basic:' -ForegroundColor Yellow
$inserted | ForEach-Object { Write-Host "  $($_.code)" }
