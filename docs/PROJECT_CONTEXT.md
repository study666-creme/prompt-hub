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
| **我的主页** | 发布作品（按**首次发布时间**倒序）、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；含 **仓库/社区** Feed（仓库仅生图卡片） |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |
| **资产创作** | **前期制作**：设定库 + **分镜/视频脚本** + **图词绑定**（关联图）；非画布替代品，详见 **`docs/VIDEO-CANVAS-EXPORT.md`** |

部署：**主域名** https://prompt-hubs.com · 旧站 https://prompt-hub.cn · API Worker 名 `prompt-hub-api` · 路线见 **`docs/OVERSEAS-FIRST.md`**

**产品分工**：Prompt Hub = 前期（对表、找词、找图、脚本与参考图绑定）→ 画布平台（LibTV / TapNow / UpDream 等）= 正式制作（生视频）。Prompt Hub **不替代**画布，减轻进画布前的整理成本。

---

## 当前部署阶段（2026-06-07 · 图片管线 + Apimart MJ）

| 项 | 状态 |
|----|------|
| **Pages** | **待部署** `20260621m` · https://prompt-hubs.com |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |
| **数据库** | 境外 Supabase `yibawjvhmqcysdovscss`（Worker Secret） |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、GrsAI/Apimart GPT 生图与恢复
- ✅ **Apimart MJ**：生图/混图 Tab、中文参数、胶片条预览、四张分别入库
- ✅ `media-pipeline.js`：列表 grid / 预览·灯箱 full 统一出口；full 404 时 grid 回退
- ✅ 静默云同步默认 `skipImageUpload`，登录后不再被大批量图片上传卡住
- ⚠️ 需部署后强刷确认 `window.__APP_BUILD__ === '20260621m'`

### 下一步

1. `.\deploy-pages.ps1` → `cd server; npx wrangler deploy` → Ctrl+F5
2. 卡片库点大图：Network 非 404，或 toast「原图暂不可用，已显示预览图」
3. 强刷后试 MJ「生图」与「混图」

### 已知问题

1. MJ 默认站内积分 5 分/次，可在管理后台按模型单独调价
2. 局部重绘（inpaint）需遮罩，当前仅支持上游按钮触发，未做画布遮罩 UI

### 下一步

1. 强刷后试 MJ「生图」与「混图」（参考图框 2～5 张）
2. 勾选「四张分别存入仓库」验证仓库出现 4 张卡
3. 预览胶片条切换 + 放大/变体

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
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hubs.com，API https://api.prompt-hubs.com。

必读：docs/AI-PITFALLS.md、docs/CURRENT-ISSUES.md、docs/FEED-MODULES.md、docs/AI-HANDOFF.md。

Feed：feed-layout.js（排版）· feed-images.js（出图）· image-gen-feed.js（生图列表）· features-draft.js（业务+wireFeed*）。
MobileUI.isMobileViewport 唯一来源 mobile.js（须在 script.js 前）。

社区 Masonry + 我的主页 flex。侧栏打开须 immediate recalcCols 重排。
改 wireFeed* 后检查 IMG_LOADING_PLACEHOLDER、feedImgStorageAttr 已接线（曾致整站无图/社区空白）。

P0 带宽：生图仓库视口 cap 12、列表仅 grid。用户小白，简体中文分步。勿提交密钥。
木瓜：Cron * * * * * drainMookoPendingSubmits；仅 Cron await POST；/health 看 mooko:configured。
```
