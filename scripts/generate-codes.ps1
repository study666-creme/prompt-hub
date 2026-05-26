# Batch activation codes via POST /api/admin/codes
param(
  [int]$Count = 10,
  [int]$Credits = 1000,
  [int]$MaxUses = 1,
  [string]$Note = "taobao",
  [string]$Prefix = "PH",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $scriptDir "admin.local.env"

if (-not (Test-Path $envFile)) {
  Write-Host "Create scripts/admin.local.env from admin.local.env.example"
  Write-Host "Then: cd server; npx wrangler secret put ADMIN_API_SECRET"
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k, $v = $_ -split '=', 2
  Set-Item -Path "env:$($k.Trim())" -Value $v.Trim().Trim('"')
}

if (-not $env:API_BASE_URL -or -not $env:ADMIN_API_SECRET) {
  Write-Error "admin.local.env needs API_BASE_URL and ADMIN_API_SECRET"
}

$body = @{
  count   = $Count
  credits = $Credits
  maxUses = $MaxUses
  note    = $Note
  prefix  = $Prefix
} | ConvertTo-Json

$uri = ($env:API_BASE_URL.TrimEnd('/')) + "/api/admin/codes"
$headers = @{
  "Content-Type"   = "application/json"
  "X-Admin-Secret" = $env:ADMIN_API_SECRET
}

Write-Host "Generating $Count code(s), $Credits credits each ..."
$res = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body

$codes = @($res.data.codes)
Write-Host "Created $($codes.Count) code(s):" -ForegroundColor Green
$codes | ForEach-Object { Write-Host "  $_" }

$yuan = [math]::Round($Credits / 100, 2)
$sample = $codes[0]
Write-Host ""
Write-Host "--- Ship message (replace CODE) ---" -ForegroundColor Cyan
Write-Host @"
[Prompt Hub credits]
1. Open https://prompt-hub-hub.pages.dev
2. Register and sign in
3. Tab: Image gen -> redeem activation code
4. One-time use only

Code: $sample
Value: $Credits credits (~$yuan CNY)
"@

if ($OutFile) {
  $lines = foreach ($c in $codes) { "$c`t$Credits`t$Note" }
  $lines | Set-Content -Encoding utf8 $OutFile
  Write-Host "Saved: $OutFile"
}
