# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/AI-PITFALLS.md`**（防炸站）→ **`docs/CURRENT-ISSUES.md`（P0-带宽）** → **`docs/AI-HANDOFF.md`**。  
> 默认中文；**P0 拉满算力**见 `docs/AI-WORK-MODE.md`；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry、批量操作（含批量开/关社区公开） |
| **提示词社区** | 全站 Feed（`community_posts` + API）· 桌面 **Masonry** 瀑布流 |
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 **GrsAI**；含 **仓库/社区** Feed |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |
| **资产创作** | **前期制作**：设定库 + **分镜/视频脚本** + **图词绑定**（关联图）；非画布替代品，详见 **`docs/VIDEO-CANVAS-EXPORT.md`** |

部署：**主域名迁移中** `prompt-hubs.com` · 旧站 https://prompt-hub.cn · API Worker 名 `prompt-hub-api` · 路线见 **`docs/OVERSEAS-FIRST.md`**

**产品分工**：Prompt Hub = 前期（对表、找词、找图、脚本与参考图绑定）→ 画布平台（LibTV / TapNow / UpDream 等）= 正式制作（生视频）。Prompt Hub **不替代**画布，减轻进画布前的整理成本。

---

## 当前部署阶段（2026-06-10 · 社区孤儿误报 + 后台恢复/删除修复）

| 项 | 状态 |
|----|------|
| **主域名** | **https://prompt-hubs.com** · 旧 **https://prompt-hub.cn** · Pages `prompt-hub-hub` · build **`20260610e`** |
| Worker | `prompt-hub-api` · **https://api.prompt-hubs.com** |
| **数据库** | 境外 Supabase `yibawjvhmqcysdovscss`（Worker Secret）；`server/.dev.vars` 仍指向阿里云 RDS（仅本地） |
| **Git** | `main`：`15dd0bb` 手机 catalog 未就绪不闪价；`52527d3` 本地 429 豁免 |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、生图、Grs 2h / Apimart 7d 恢复、Feed full 预览 + PNG 下载
- ✅ 本地：`127.0.0.1:8787` + `5500` 双窗口；`ENVIRONMENT=development` 跳过限流
- ⚠️ 本地 `.dev.vars` 查不到生产用户；查账需 `scripts/admin.local.env` 或 Supabase SQL Editor
- ⚠️ `prompt-hub.cn` → `prompt-hubs.com` 重定向需在 CF 用 Dynamic concat，勿把表达式写进 URL 栏

### 已知问题

1. **b076702 勿合并**（第二张生图卡死）。
2. 管理后台用户详情无 `credit_ledger` 明细，只有最近兑换码。
3. 后台手动改「永久积分」**不会**写 ledger，对账以 SQL 为准。
4. **deploy 前勿删「桶内孤儿」**：旧版只认 `card.image` 字符串，会把好卡误报；新版已按 `source_card_id` + CDN 路径补全引用。
5. **管理后台恢复/删除**：`admin.js` 本地 API 指向已修（`api-config.js`）；R2 模式下删图不再因 Supabase Storage 失败而整请求挂掉。

### 下一步

1. `cd server; npx wrangler deploy` + `.\deploy-pages.ps1`（admin 构建号 `20260610a`）。
2. 后台社区操作失败见 `docs/LOCAL-DEV.md`「管理后台：恢复 / 删除」。
3. 查账：`node scripts/query-user-ledger.mjs <uid> --env scripts/admin.local.env`
4. cn 域名 301 到 com（排除 `api.prompt-hub.cn`）。

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
npx wrangler deploy
```

### 测试账号

- 邮箱 `2705367723@qq.com`
- `author_id`：`ab5c77dc-570e-4af7-ac38-2d311be96244`

---

## 新对话提示词（复制整段）

```text
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hub.cn，API https://api.prompt-hub.cn。

必读：docs/AI-PITFALLS.md、docs/CURRENT-ISSUES.md、docs/FEED-MODULES.md、docs/AI-HANDOFF.md。

Feed：feed-layout.js（排版）· feed-images.js（出图）· image-gen-feed.js（生图列表）· features-draft.js（业务+wireFeed*）。
MobileUI.isMobileViewport 唯一来源 mobile.js（须在 script.js 前）。

社区 Masonry + 我的主页 flex。侧栏打开须 immediate recalcCols 重排。
改 wireFeed* 后检查 IMG_LOADING_PLACEHOLDER、feedImgStorageAttr 已接线（曾致整站无图/社区空白）。

P0 带宽：生图仓库视口 cap 12、列表仅 grid。用户小白，简体中文分步。勿提交密钥。
```
