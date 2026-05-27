param(
  [string]$ApiHost = "api.prompt-hub.cn",
  [string]$ZoneName = "prompt-hub.cn"
)

$ErrorActionPreference = "Stop"
$cfgPath = Join-Path $env:APPDATA "xdg.config\.wrangler\config\default.toml"
if (-not (Test-Path $cfgPath)) {
  Write-Error "wrangler not logged in. Run: cd server; npx wrangler login"
}

$cfg = Get-Content $cfgPath -Raw
if ($cfg -notmatch 'oauth_token\s*=\s*"([^"]+)"') {
  Write-Error "oauth_token missing"
}
$token = $Matches[1]
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

Write-Host "Zone lookup: $ZoneName"
$zones = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$ZoneName" -Headers $headers
if (-not $zones.result -or $zones.result.Count -eq 0) {
  Write-Error "Zone not found: $ZoneName"
}
$zoneId = $zones.result[0].id
Write-Host "Zone ID: $zoneId"

$apiLabel = ($ApiHost -split "\.")[0]
$dns = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?per_page=100" -Headers $headers
$targets = @($dns.result | Where-Object {
  $_.name -eq $ApiHost -or $_.name -eq "$apiLabel.$ZoneName" -or $_.name -eq $apiLabel
})

if ($targets.Count -eq 0) {
  Write-Host "No conflicting api DNS records found."
} else {
  foreach ($rec in $targets) {
    Write-Host "Delete $($rec.type) $($rec.name) -> $($rec.content)"
    Invoke-RestMethod -Method Delete -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$($rec.id)" -Headers $headers | Out-Null
  }
}

Write-Host "Redeploy worker..."
Push-Location $PSScriptRoot
try {
  npm run deploy
} finally {
  Pop-Location
}

Write-Host "Test: https://$ApiHost/health"
