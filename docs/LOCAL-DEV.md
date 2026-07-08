# 本地开发与预览（MemFire / R2）

> 当前主站走 `prompt-hubs.com` + MemFire + R2。
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

- `SUPABASE_URL` = MemFire API URL（形如 `https://xxxx.baseaf.memfiredb.com`）
- `SUPABASE_SERVICE_ROLE_KEY` = MemFire **service_role**（不是 anon / publishable）
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

登录态验收前先打开 **http://127.0.0.1:8787/health**：必须看到 `"supabase":"ok"`。如果是 `misconfigured`，说明本地 `server\.dev.vars` 缺 `SUPABASE_URL` 或 `SUPABASE_SERVICE_ROLE_KEY`，前端会打开但登录/社区/卡片同步无法真实验证。

---

## 配置说明

| 文件 | 作用 |
|------|------|
| `supabase-config.js` | 生产用 `https://api.prompt-hubs.com/supabase`（com）或 cn 反代；**localhost 自动改** `http://127.0.0.1:8787/supabase` |
| `supabase-config.local.js` | 可选覆盖（勿提交、deploy 会自动排除） |
| `api-config.js` | localhost 自动指 `http://127.0.0.1:8787` |
| `server/.dev.vars` | Worker 本地密钥（勿提交） |
| `MEDIA_STORAGE_MODE=r2` | **与线上一致：只读写 R2**，不再回退 Supabase Storage（避免超额） |
| `LOCAL_MEDIA_UPSTREAM` | 本地看图走 `https://api.prompt-hubs.com` CDN（本地 R2 桶为空） |

**R2 桶**：Cloudflare 控制台建 `prompt-hub-card-images` 后 `cd server && npm run deploy`。

---

## 旧 Supabase 无图卡

～6/25 前，**拉不到图的 `storage://` 卡自动从列表隐藏**（不删库）。见 `docs/MEMFIRE-MIGRATION.md`。

---

## 不要用 file://

双击 `index.html` 会导致 API 失败。必须用 `serve-local.ps1` 或 `start-dev.ps1`。

---

## 管理后台：恢复 / 删除社区帖报「无法连接 API」

**现象**：`admin.html` 能列出帖子，但点 **恢复 / 下架 / 删除** 失败，底部红字提示无法连接 API。

**第 1 步 · 看 API 地址**  
登录后概览页副标题会显示 `API：https://…`。  
- 本地开发应是 **`http://127.0.0.1:8787`**（需 `start-dev.ps1` 或 `cd server; npx wrangler dev`）  
- 线上应是 **`https://api.prompt-hubs.com`**

**第 2 步 · 本地**  
```powershell
cd D:\prompt-hub
.\start-dev.ps1
```
浏览器打开 **http://127.0.0.1:5500/admin.html**（不要 file://）。`admin.html` 已加载 `api-config.js`，本地优先走 8787。

**第 3 步 · 线上**  
```powershell
cd D:\prompt-hub\server
npx wrangler deploy
cd D:\prompt-hub
.\deploy-pages.ps1
```
打开 https://prompt-hubs.com/admin.html ，**Ctrl+Shift+R** 强刷（构建号 `20260610a` 及以上）。

**第 4 步 · 自检**  
浏览器访问 https://api.prompt-hubs.com/health → 应含 `"supabase":"ok"`。

---

## 部署到线上（MemFire/备案就绪后）

```powershell
.\deploy-pages.ps1
```

**勿**把 `supabase-config.local.js` / `api-config.local.js` / `.dev.vars` 提交或 deploy。

---

## 验证

- http://127.0.0.1:8787/health → `"supabase":"ok"`
- 控制台：`window.API_BASE_URL` 应为 `http://127.0.0.1:8787`（**不是** `api.prompt-hubs.com`）
- 图片仍 401/CORS：确认 **Worker 窗口在跑** → **Ctrl+Shift+R 强刷**（会清 `ph_signed_urls_v1` 生产签名缓存）

---

## 常见问题：本地图片全黑 / 404（仓库、生图列表）

**原因**：`server/.dev.vars` 里 `MEDIA_STORAGE_MODE=r2` 时，本地 Miniflare **R2 桶是空的**；真实图片在 **线上 Cloudflare R2**。本地 Worker 签出来的 URL 指向 `127.0.0.1:8787`，读不到文件就全黑。

**处理（按顺序）**：

1. **重启 Worker**（改代码或 `.dev.vars` 后必须重启）：Worker 窗口 `Ctrl+C` → `cd server` → `npm run dev -- --ip 127.0.0.1 --port 8787`
2. 编辑 `server\.dev.vars`（建议与 `.dev.vars.example` 对齐）：
   - `MEDIA_STORAGE_MODE=r2`（**不要** `r2-first`，否则会继续读 Supabase Storage）
   - `ENVIRONMENT=development`
   - `LOCAL_MEDIA_UPSTREAM=https://api.prompt-hubs.com`
3. 强刷 `http://127.0.0.1:5500`（Ctrl+Shift+R），清 Session **`ph_signed_urls_v1`**
4. F12 → Network：图片 URL 应为 **`https://api.prompt-hubs.com/api/v1/media/c/...`**（本地开发正常情况）
5. 强刷后若仍只有**部分**图：多为线上 R2 **没有对应 grid/原图**（卡片元数据在库、文件已删或未迁移），属正常；F12 里 404 的 `/media/c/` 即此类

**sign-batch 一直「挂起」**：先重启 Worker；强刷并清 `ph_signed_urls_v1`。若 `supabase-sync.js` 已更新，线上 CDN 签名 URL 会被正确缓存（不再被 `mediaUrlMatchesCurrentApi` 误拒）。

---

## 常见问题：本地图片全挂 / CORS 报 api.prompt-hubs.com

**原因**：同一浏览器先开过 **prompt-hubs.com**，Session 里缓存了生产签名 URL；本地 `127.0.0.1:5500` 去拉会被 CORS 拦。

**处理**：

1. 必须 **两个窗口都开着**（`start-dev.ps1` 会开 Worker + 静态站）
2. 强刷 `http://127.0.0.1:5500`（Ctrl+Shift+R）
3. 仍不行：F12 → Application → Session Storage → 删 **`ph_signed_urls_v1`**（第 5 步，很重要）
4. 控制台若大量 **429** 在 `/media/sign`：重启 Worker 窗口（`Ctrl+C` 后重新 `npm run dev`），再强刷
5. 控制台确认：`window.API_BASE_URL === 'http://127.0.0.1:8787'`

**不是**连 `.cn` 网站——本地 API 固定本机 Worker；只是签名缓存可能来自 `.com` 生产。

---

## prompt-hub.cn 与 prompt-hubs.com

| 域名 | 建议 |
|------|------|
| **prompt-hubs.com** | 主站（当前主力） |
| **prompt-hub.cn** | 可保留 DNS，在 Cloudflare **Rules → Redirect Rules** 做 301 到 `.com`（见 `docs/OVERSEAS-FIRST.md`） |
| **api.prompt-hub.cn** | 旧 API；新功能以 **api.prompt-hubs.com** 为准，暂勿关直到老用户迁移完 |

**Cloudflare 跳转（cn → com）**：Dashboard → 选 `prompt-hub.cn` → **Rules** → **Redirect Rules** → Create rule → When hostname equals `prompt-hub.cn` or `www.prompt-hub.cn` → Redirect to `https://prompt-hubs.com` 301。

控制台：`window.__APP_BUILD__`  
健康检查（本机 Worker）：http://127.0.0.1:8787/health → `"supabase":"ok"`

---

## Windows npm check aliases

On Windows with npm 8, scripts with `:` in the name can fail before Node starts because npm creates a temporary `.cmd` file using the lifecycle name. Use the colon-free aliases:

```powershell
npm run build-all
npm run check-esbuild
npm run check-predeploy
```

The colon scripts stay in `package.json` for compatibility, but local predeploy verification should use `npm run check-predeploy`.
