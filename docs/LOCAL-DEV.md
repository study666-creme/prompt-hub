# 本地开发

## 前置条件

- Node.js 18+
- npm
- PowerShell 7（Windows 脚本）
- Python 3 可选；没有时静态服务器会退回 npx/PowerShell
- 已授权的 MemFire 和上游测试凭据

## 首次配置

```powershell
cd D:\prompt-hub
npm ci
cd server
npm ci
cd ..
.\scripts\setup-local-dev.ps1
```

脚本只在目标不存在时复制：

- `server/.dev.vars.example` -> `server/.dev.vars`
- `api-config.local.example.js` -> `api-config.local.js`
- `supabase-config.local.example.js` -> `supabase-config.local.js`

这些目标文件被 Git 忽略。编辑 `server/.dev.vars`，至少设置 MemFire `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`；测试生图时再配置对应 provider Key。

## 启动

推荐：

```powershell
.\start-dev.ps1
```

它启动 Worker `127.0.0.1:8787` 和静态站 `127.0.0.1:5500`。只运行 `serve-local.ps1` 只能预览静态 UI，登录、云同步和生图会失败。

也可以用两个终端：

```powershell
# 终端 1
cd D:\prompt-hub\server
npm run dev -- --ip 127.0.0.1 --port 8787

# 终端 2
cd D:\prompt-hub
.\serve-local.ps1
```

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

`supabase` 应为 `ok`。本地 R2 binding 通常为空，`server/.dev.vars` 可用 `LOCAL_MEDIA_UPSTREAM=https://api.prompt-hubs.com` 读取生产 CDN 预览，但写入/删除测试必须谨慎。

## 开发循环

- 改 `legacy/`、`styles/`、`partials/` 后刷新本地页面；loader 会读取片段。
- 改 pack 源模块后运行 `npm run build:all` 或重启 `serve-local.ps1`。
- 不直接修改 `pack-*.js`，它们会被构建覆盖。
- 不通过 `file://` 打开 `index.html`。

## 验证

```powershell
cd D:\prompt-hub
npm run check:predeploy

cd server
npm run typecheck
npm test
```

需要浏览器级验证时使用 `scripts/verify-*-browser.mjs`；需要生产移动首屏审计时运行 `scripts/audit-production-mobile-first-screen.mjs`。

## 数据安全

使用专门测试卡片，不删除已有卡片。`server/.dev.vars` 可能指向生产 MemFire；执行 purge、repair、restore、批量造码或 R2 写入前必须确认目标和 dry-run 输出。
