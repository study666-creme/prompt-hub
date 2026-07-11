# Shop activation codes: 1 CNY = 100 credits, without recharge bonuses
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

# Credit products use the same fixed exchange rate shown in the app.
$creditProducts = @(
  @{ label = '100 credits / CNY 1'; credits = 100; prefix = 'CR100'; note = 'shop-cr100-1' },
  @{ label = '500 credits / CNY 5'; credits = 500; prefix = 'CR500'; note = 'shop-cr500-5' },
  @{ label = '1000 credits / CNY 10'; credits = 1000; prefix = 'CR1K'; note = 'shop-cr1k-10' },
  @{ label = '3000 credits / CNY 30'; credits = 3000; prefix = 'CR3K'; note = 'shop-cr3k-30' },
  @{ label = '5000 credits / CNY 50'; credits = 5000; prefix = 'CR5K'; note = 'shop-cr5k-50' },
  @{ label = '10000 credits / CNY 100'; credits = 10000; prefix = 'CR10K'; note = 'shop-cr10k-100' }
)

$memberProducts = @(
  @{ label = 'trial'; tier = 'basic'; days = 3; offer = 'mini_3d'; prefix = 'MBTR'; note = 'shop-trial-0.99' },
  @{ label = 'basic-30d'; tier = 'basic'; days = 30; offer = $null; prefix = 'MBB30'; note = 'shop-basic30-9.99' },
  @{ label = 'standard-30d'; tier = 'standard'; days = 30; offer = $null; prefix = 'MBS30'; note = 'shop-std30-29.9' },
  @{ label = 'pro-30d'; tier = 'pro'; days = 30; offer = $null; prefix = 'MBP30'; note = 'shop-pro30-69.9' }
)

$allRows = @()
$seen = @{}

foreach ($p in $creditProducts) {
  $n = 0
  while ($n -lt $PerProduct) {
    $code = New-RandomCode $p.prefix
    if ($seen.ContainsKey($code)) { continue }
    $seen[$code] = $true
    $row = @{
      code = $code
      credits = $p.credits
      membership_tier = $null
      membership_days = $null
      offer_kind = $null
      max_uses = 1
      active = $true
      note = $p.note
    }
    $allRows += $row
    $n++
  }
}

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
      membership_days = $p.days
      offer_kind = $p.offer
      max_uses = 1
      active = $true
      note = $p.note
    }
    $n++
  }
}

Write-Host "Inserting $($allRows.Count) codes into Supabase ..."
$inserted = Invoke-RestMethod -Method Post -Uri ($url + '/rest/v1/activation_codes') -Headers $headers -Body ($allRows | ConvertTo-Json -Depth 6) -TimeoutSec 90

Write-Host ""
Write-Host "=== Codes ($PerProduct each) ===" -ForegroundColor Cyan

foreach ($p in $creditProducts) {
  Write-Host ""
  Write-Host "$($p.label) [$($p.note)]:" -ForegroundColor Yellow
  $inserted | Where-Object { $_.note -eq $p.note } | ForEach-Object { Write-Host "  $($_.code)" }
}

foreach ($p in $memberProducts) {
  Write-Host ""
  Write-Host "$($p.label) [$($p.note)]:" -ForegroundColor Yellow
  $inserted | Where-Object { $_.note -eq $p.note } | ForEach-Object { Write-Host "  $($_.code)" }
}
