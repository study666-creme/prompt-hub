# Batch activation codes (API or Supabase direct)
param(
  [int]$Count = 10,
  [int]$Credits = 1000,
  [int]$MaxUses = 1,
  [string]$Note = "taobao",
  [string]$Prefix = "PH",
  [string]$OutFile = "",
  [ValidateSet("Auto", "Api", "Supabase")]
  [string]$Mode = "Auto"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$adminEnv = Join-Path $scriptDir "admin.local.env"
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

function Test-ApiReachable([string]$baseUrl) {
  if (-not $baseUrl) { return $false }
  try {
    $u = $baseUrl.TrimEnd('/') + '/health'
    $null = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 8
    return $true
  } catch {
    return $false
  }
}

function Invoke-ViaApi($admin, $Count, $Credits, $MaxUses, $Note, $Prefix) {
  $body = @{
    count   = $Count
    credits = $Credits
    maxUses = $MaxUses
    note    = $Note
    prefix  = $Prefix
  } | ConvertTo-Json
  $uri = $admin.API_BASE_URL.TrimEnd('/') + '/api/admin/codes'
  $headers = @{
    'Content-Type'   = 'application/json'
    'X-Admin-Secret' = $admin.ADMIN_API_SECRET
  }
  Write-Host "Via Workers API ..."
  $res = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec 30
  return @($res.data.codes)
}

function Invoke-ViaSupabase($sb, $Count, $Credits, $MaxUses, $Note, $Prefix) {
  $url = $sb.SUPABASE_URL.TrimEnd('/')
  $key = $sb.SUPABASE_SERVICE_ROLE_KEY
  if (-not $url -or -not $key) {
    throw "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server/.dev.vars (use sb_secret_ key)"
  }
  if ($key -match '^sb_publishable_') {
    throw "server/.dev.vars must use Secret key (sb_secret_), not Publishable key"
  }

  $rows = @()
  $seen = @{}
  while ($rows.Count -lt $Count) {
    $code = New-RandomCode $Prefix
    if ($seen.ContainsKey($code)) { continue }
    $seen[$code] = $true
    $rows += @{
      code      = $code
      credits   = $Credits
      max_uses  = $MaxUses
      active    = $true
      note      = $Note
    }
  }

  $headers = @{
    apikey        = $key
    Authorization = "Bearer $key"
    'Content-Type' = 'application/json'
    Prefer        = 'return=representation'
  }
  # sb_secret_ keys are blocked when User-Agent looks like a browser (PowerShell default)
  if ($key -match '^sb_secret_') {
    $headers['User-Agent'] = 'PromptHub-CodeGen/1.0 (server)'
  }
  Write-Host "Via Supabase (workers.dev unreachable) ..."
  try {
    $inserted = Invoke-RestMethod -Method Post -Uri ($url + '/rest/v1/activation_codes') -Headers $headers -Body ($rows | ConvertTo-Json -Depth 5) -TimeoutSec 60
    return @($inserted | ForEach-Object { $_.code })
  } catch {
    if ($_.Exception.Message -match '403|42501|permission denied') {
      Write-Host ""
      Write-Host "Fix: run scripts/apply-grants-once.sql in Supabase SQL Editor, then retry." -ForegroundColor Yellow
      Write-Host "Or: .\generate-codes-sql.ps1 -Count $Count -Credits $Credits" -ForegroundColor Yellow
    }
    throw
  }
}

function Show-ShipMessage($codes, $Credits) {
  $yuan = [math]::Round($Credits / 100, 2)
  $sample = $codes[0]
  Write-Host ""
  Write-Host "--- Ship message ---" -ForegroundColor Cyan
  Write-Host "[Prompt Hub] https://prompt-hubs.com"
  Write-Host "Register -> Image gen -> Redeem code (one-time)"
  Write-Host "Code: $sample"
  Write-Host "Credits: $Credits (~$yuan CNY)"
}

$admin = Read-DotEnv $adminEnv
$server = Read-DotEnv $serverEnv

$useApi = $Mode -eq 'Api'
if ($Mode -eq 'Auto') {
  $apiUrl = $admin.API_BASE_URL
  if (Test-ApiReachable $apiUrl) {
    $useApi = $true
  } else {
    Write-Host "Workers API unreachable, using Supabase direct insert." -ForegroundColor Yellow
    $useApi = $false
  }
}

Write-Host "Generating $Count code(s), $Credits credits each ..."

if ($useApi) {
  if (-not $admin.API_BASE_URL -or -not $admin.ADMIN_API_SECRET) {
    Write-Error "admin.local.env needs API_BASE_URL and ADMIN_API_SECRET"
  }
  $codes = Invoke-ViaApi $admin $Count $Credits $MaxUses $Note $Prefix
} else {
  $codes = Invoke-ViaSupabase $server $Count $Credits $MaxUses $Note $Prefix
}

Write-Host "Created $($codes.Count) code(s):" -ForegroundColor Green
$codes | ForEach-Object { Write-Host "  $_" }
Show-ShipMessage $codes $Credits

if ($OutFile) {
  $lines = foreach ($c in $codes) { "$c`t$Credits`t$Note" }
  $lines | Set-Content -Encoding utf8 $OutFile
  Write-Host "Saved: $OutFile"
}
