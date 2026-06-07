# 本地开发与预览（过渡期 · 阿里云 / MemFire 前）

> **线上 prompt-hub.cn** 在 ICP/MemFire 就绪前可能无法登录；**请用本机调试**。  
> **卡片主备份**：设置 → 数据管理 → **备份导出 JSON**（强刷/换机可 **备份导入**）。

---

## JSON 备份（推荐习惯）

| 操作 | 路径 |
|------|------|
| **导出** | 设置 → 数据管理 → **备份导出** → 下载 `prompt-hub-backup_YYYYMMDD.json` |
| **导入** | 设置 → 数据管理 → **备份导入** → 选 JSON 文件 |

JSON 内含：`cards`、`customGroups`、`globalFields`、`settings`（不含 Storage 里的大图文件；图仍走 `storage://` 或本机新上传）。

**建议**：每次大批量改卡或调试结束前 **导出一份** 到 `D:\prompt-hub\backups\` 文件夹。

---

## 一键启动（推荐）

**第 1 步** 编辑 `server\.dev.vars`（首次运行 `setup-local-dev.ps1` 会生成）：

- `SUPABASE_SERVICE_ROLE_KEY` = 阿里云 **Legacy service_role**（不是 anon）
- `IMAGE_API_KEY` = 生图 Key（要测生图时必填）

**第 2 步** 项目根目录：

```powershell
cd D:\prompt-hub
.\start-dev.ps1
```

会打开两个窗口：

- Worker API → http://127.0.0.1:8787  
- 静态站 → http://127.0.0.1:5500  

**第 3 步** 浏览器打开 **http://127.0.0.1:5500** → 登录 `2705367723@qq.com`

---

## 配置说明

| 文件 | 作用 |
|------|------|
| `supabase-config.js` | 生产用 `https://api.prompt-hub.cn/supabase`；**localhost 自动改** `http://8.148.193.247:80` |
| `supabase-config.local.js` | 可选覆盖（勿提交、deploy 会自动排除） |
| `api-config.js` | localhost 自动指 `http://127.0.0.1:8787` |
| `server/.dev.vars` | Worker 本地密钥（勿提交） |
| `MEDIA_STORAGE_MODE=r2` | **新图只写 Cloudflare R2**，浏览器上传走 `/api/v1/media/upload`，不烧阿里云流量 |

**R2 桶**：Cloudflare 控制台建 `prompt-hub-card-images` 后 `cd server && npm run deploy`。

---

## 旧 Supabase 无图卡

～6/25 前，**拉不到图的 `storage://` 卡自动从列表隐藏**（不删库）。见 `docs/MEMFIRE-MIGRATION.md`。

---

## 不要用 file://

双击 `index.html` 会导致 API 失败。必须用 `serve-local.ps1` 或 `start-dev.ps1`。

---

## 部署到线上（MemFire/备案就绪后）

```powershell
.\deploy-pages.ps1
```

**勿**把 `supabase-config.local.js` / `api-config.local.js` / `.dev.vars` 提交或 deploy。

---

## 验证

控制台：`window.__APP_BUILD__`  
健康检查（本机 Worker）：http://127.0.0.1:8787/health → `"supabase":"ok"`
