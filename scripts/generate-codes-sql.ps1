param(
  [int]$Count = 5,
  [int]$Credits = 1000,
  [int]$MaxUses = 1,
  [string]$Note = "taobao",
  [string]$Prefix = "PH",
  [string]$OutFile = "activation-codes-insert.sql"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([IO.Path]::IsPathRooted($OutFile)) {
  $outPath = $OutFile
} else {
  $outPath = Join-Path $scriptDir $OutFile
}

function New-RandomCode([string]$prefix) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $suffix = -join (1..12 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
  return ($prefix.ToUpper() + '-' + $suffix)
}

$values = New-Object System.Collections.Generic.List[string]
$seen = @{}
while ($values.Count -lt $Count) {
  $code = New-RandomCode $Prefix
  if ($seen.ContainsKey($code)) { continue }
  $seen[$code] = $true
  $safeNote = $Note.Replace("'", "''")
  [void]$values.Add("  ('$code', $Credits, $MaxUses, true, '$safeNote')")
}

$body = $values -join ",`r`n"
$sql = "-- Run in Supabase SQL Editor`r`n"
$sql += "insert into public.activation_codes (code, credits, max_uses, active, note)`r`n"
$sql += "values`r`n"
$sql += $body + "`r`n"
$sql += "returning code, credits, max_uses, note;`r`n"

[System.IO.File]::WriteAllText($outPath, $sql, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote: $outPath"
Write-Host "Open Supabase SQL Editor, paste file contents, Run"
