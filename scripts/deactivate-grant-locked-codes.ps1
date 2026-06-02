# Deactivate membership codes with grant-daily / grant-bundle in note
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
if (-not $url -or -not $key) { throw "Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" }

$headers = @{
  apikey        = $key
  Authorization = "Bearer $key"
  'Content-Type' = 'application/json'
  Prefer        = 'return=representation'
}
if ($key -match '^sb_secret_') {
  $headers['User-Agent'] = 'PromptHub-Deactivate/1.0'
}

$body = '{"active":false}'
$total = 0
foreach ($pat in @('grant-daily', 'grant-bundle')) {
  $enc = [uri]::EscapeDataString("%$pat%")
  $uri = "$url/rest/v1/activation_codes?note=like.$enc&active=eq.true"
  $rows = Invoke-RestMethod -Method PATCH -Uri $uri -Headers $headers -Body $body
  $n = @($rows).Count
  $total += $n
  Write-Host "Deactivated $n codes (note like %$pat%)"
}
Write-Host "Total: $total"
