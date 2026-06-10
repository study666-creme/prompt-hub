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

## 当前部署阶段（2026-06-10 · 稳定基线 b51e129 + 恢复/预览修复）

| 项 | 状态 |
|----|------|
| **主域名** | **https://prompt-hubs.com** / **https://prompt-hub.cn** · Pages `prompt-hub-hub` · build **`20260610b`** |
| Worker | `prompt-hub-api` · **https://api.prompt-hubs.com** |
| **Git 基线** | `b51e129`（生图连点可用）；已撤销远端 `b076702`/`a5dffff`（第二张卡死回归） |
| **恢复窗口** | GrsAI 等默认 **2 小时**（`providerScope: grs`）；Apimart **7 天**（`providerScope: apimart`） |
| **侧栏预览** | 卡藏卡片优先 **full 原图**；`rec_` 新恢复卡 id；Feed `wh_` 前缀不再二次剥离 |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、生图扣费、生图连点提交（`b51e129` 基线）
- ✅ 服务端恢复入库、侧栏点卡藏卡片、大图预览走原图
- ⚠️ GrsAI 上游图 **2h 后销毁**，勿用 7 天窗口扫 Grs 任务
- ⚠️ Apimart 链接可保留约 7 天，需单独 `providerScope: apimart`

### 已知问题

1. **b076702 逻辑勿合并**：全量 `renderImageGenFeed` 会导致第二张提交卡死。
2. **Apimart**：多为内容审核；超 7 天上游链过期则 repair 无效。
3. 强刷后验收：`window.__APP_BUILD__` 应为 `20260610b`。

### 下一步

1. 部署 Pages + Worker（`20260610b`）。
2. Grs 恢复：`runServerApimartImport({ mode:'import', max:80, hours:2, providerScope:'grs' })`。
3. Apimart 恢复：`runServerApimartImport({ mode:'import', max:80, days:7, providerScope:'apimart' })`。

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
