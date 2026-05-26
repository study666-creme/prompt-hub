# Count user prompts; every 8th creates PENDING_DOC_UPDATE for the agent.
$ErrorActionPreference = 'Stop'
$root = if ($env:CURSOR_PROJECT_DIR) { $env:CURSOR_PROJECT_DIR } else { (Get-Location).Path }
$stateDir = Join-Path $root '.cursor'
$statePath = Join-Path $stateDir 'doc-sync-state.json'
$pendingPath = Join-Path $stateDir 'PENDING_DOC_UPDATE'

if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$interval = 8
$count = 0
if (Test-Path $statePath) {
  try {
    $raw = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $count = [int]$raw.userTurnCount
    if ($raw.interval) { $interval = [int]$raw.interval }
  } catch {
    $count = 0
  }
}

$count += 1
$now = (Get-Date).ToString('o')

if ($count % $interval -eq 0) {
  Set-Content -Path $pendingPath -Value $now -Encoding UTF8 -NoNewline
}

@{
  userTurnCount = $count
  interval      = $interval
  lastDocUpdate = $now
} | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

exit 0
