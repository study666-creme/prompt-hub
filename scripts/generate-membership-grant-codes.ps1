# Membership 30d codes — one code per tier; user picks daily/bundle at redeem time (lite = daily only)
param(
  [int]$PerProduct = 2
)

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

function New-RandomCode([string]$prefix) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $suffix = -join (1..12 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
  return ($prefix.ToUpper() + '-' + $suffix)
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
  $headers['User-Agent'] = 'PromptHub-ShopCodeGen/1.0'
}

$memberProducts = @(
  @{ label = 'lite-30d'; tier = 'lite'; days = 30; prefix = 'MBLT'; note = 'shop-lite30-6 batch' },
  @{ label = 'basic-30d'; tier = 'basic'; days = 30; prefix = 'MBBD'; note = 'shop-basic30-12.9 batch' },
  @{ label = 'standard-30d'; tier = 'standard'; days = 30; prefix = 'MBSD'; note = 'shop-std30-31.9 batch' },
  @{ label = 'pro-30d'; tier = 'pro'; days = 30; prefix = 'MBPD'; note = 'shop-pro30-63.9 batch' }
)

$allRows = @()
$seen = @{}

foreach ($p in $memberProducts) {
  $n = 0
  while ($n -lt $PerProduct) {
    $code = New-RandomCode $p.prefix
    if ($seen.ContainsKey($code)) { continue }
    $seen[$code] = $true
    $allRows += @{
      code = $code
      credits = 0
      membership_tier = $p.tier
      membership_days = 30
      offer_kind = $null
      max_uses = 1
      active = $true
      note = $p.note
    }
    $n++
  }
}

Write-Host "Inserting $($allRows.Count) membership codes ($PerProduct per tier) ..."
$inserted = Invoke-RestMethod -Method Post -Uri ($url + '/rest/v1/activation_codes') -Headers $headers -Body ($allRows | ConvertTo-Json -Depth 6) -TimeoutSec 90

Write-Host ""
Write-Host "=== membership codes ($PerProduct each; redeem with daily OR bundle picker) ===" -ForegroundColor Cyan
foreach ($p in $memberProducts) {
  Write-Host ""
  Write-Host "$($p.label) [$($p.note)]:" -ForegroundColor Yellow
  $inserted | Where-Object { $_.note -eq $p.note } | ForEach-Object { Write-Host "  $($_.code)" }
}
