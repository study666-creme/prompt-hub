# 卡片库 tombstone / Storage 恢复诊断（配合浏览器 Console）
# 用法：在项目根目录运行 .\scripts\audit-tombstone-storage.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "=== Prompt Hub 卡片恢复诊断 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "第 1 步  部署最新 Pages（若尚未部署）" -ForegroundColor Yellow
Write-Host "  cd $root"
Write-Host "  .\deploy-pages.ps1"
Write-Host ""
Write-Host "第 2 步  部署 Worker（生图历史 API /jobs/history 需要）" -ForegroundColor Yellow
Write-Host "  cd $root\server"
Write-Host "  npx wrangler deploy"
Write-Host ""
Write-Host "第 3 步  打开 https://prompt-hubs.com 登录后按 Ctrl+Shift+R 强刷" -ForegroundColor Yellow
Write-Host "  Console 确认: window.__APP_BUILD__  （应 >= 20260604q）"
Write-Host ""
Write-Host "第 4 步  在浏览器 Console 依次运行（只读扫描，不会删卡/不上传）" -ForegroundColor Green
Write-Host @"

// A. 总览
await inspectCardLibraryRecovery()

// B. tombstone 对应 Storage 是否还能救（默认扫 60 个，约 1～2 分钟）
const tombScan = await inspectTombstoneStorageRecovery({ max: 60, delayMs: 120 })
tombScan.summary

// C. Apimart / 生图任务恢复线索（需 Worker 已部署 history API）
const apPlan = await planApimartRecovery({ days: 90, limit: 200 })
apPlan

// D. 仅恢复「主图仍正常」的 tombstone 卡（不写 Storage、不 push 云端）
// await restoreFromTombstoneStorageScan(tombScan)

"@ -ForegroundColor White
Write-Host ""
Write-Host "说明：" -ForegroundColor Cyan
Write-Host "  - recoverablePrimary：Storage 主图正常，可安全重建卡片条目"
Write-Host "  - recoverableGridOnly：仅 grid 正常，列表可能能看，大图仍可能黑"
Write-Host "  - black：Storage 已被坏图覆盖，需 Apimart URL 或其它备份"
Write-Host "  - 恢复后若要上传云端：restoreFromTombstoneStorageScan(tombScan, { pushCloud: true })"
Write-Host ""

$indexPath = Join-Path $root "index.html"
if (Test-Path $indexPath) {
  $m = [regex]::Match((Get-Content $indexPath -Raw), "__APP_BUILD__\s*=\s*'([^']+)'")
  if ($m.Success) {
    Write-Host "本地构建号: $($m.Groups[1].Value)" -ForegroundColor DarkGray
  }
}
