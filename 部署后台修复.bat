@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   部署后台修复
echo   （画布模型白屏 / 生图任务分组 / 左侧导航分组）
echo ==========================================================
echo.
echo 将要执行：
echo   1) git push origin main      （部署脚本要求本地与远端一致）
echo   2) deploy-pages.ps1          （语法检查 -^> 打包 -^> 发布到 Cloudflare Pages）
echo.
echo 影响范围：会把当前已提交的内容发布到 https://prompt-hubs.com
echo 耗时：通常 1-3 分钟（取决于网络）
echo.
echo 若第 1 步失败，多半是网络/代理问题，可重试或先手动处理 git 状态。
echo.
pause

echo.
echo [1/2] 推送到 GitHub ...
git push origin main
if errorlevel 1 (
  echo.
  echo 推送失败，已中止。请检查网络或代理后重试。
  pause
  exit /b 1
)

echo.
echo [2/2] 部署到 Cloudflare Pages ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-pages.ps1"
if errorlevel 1 (
  echo.
  echo 部署未成功。常见原因：
  echo   - 需要开启 VPN / 代理才能连上 Cloudflare（脚本会提示 ConnectTimeout）
  echo   - Cloudflare 登录过期：在 server 目录执行 npm exec wrangler login
  echo   - 也可以按上方提示用生成的 ZIP 在 Cloudflare 后台手动上传
  pause
  exit /b 1
)

echo.
echo 部署完成。
echo 打开 https://prompt-hubs.com/admin.html 后按 Ctrl+Shift+R 强制刷新查看。
echo.
pause
