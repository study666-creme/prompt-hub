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

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-05）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建号 **`20260605l`**（`window.__APP_BUILD__`） |
| **架构** | Feed 四模块：`feed-layout.js` · `feed-images.js` · `image-gen-feed.js` + `features-draft.js`（`wireFeed*`）；见 **`docs/FEED-MODULES.md`** |
| **MobileUI** | 手机断点 900px 唯一来源 `mobile.js`（须在 `script.js` 前加载） |
| **已修** | 侧栏打开即时重排（社区 Masonry / 生图预览）；拆分后 `feedImgStorageAttr` / `IMG_LOADING_PLACEHOLDER` 接线 |
| **部分改善** | 社区 Masonry 加载阶段偶发间距不齐；P0 生图仓库带宽（首屏 ~5MB、`big:0` 已验收） |
| **已打通** | `/health`、兑换、生图、社区 Feed、我的主页侧栏 |

### 已知问题（优先）

1. **社区 Masonry 间距**：加载阶段偶发，可等待或点卡触发重排；架构层暂不再 deep 改（§2.6）。
2. **P0 数据**：卡片库公开数与社区帖 gap。
3. **日光可读性**：界面大小三档（`LIGHT-THEME-UX.md`）。

### 下一步

1. 继续瘦身 `features-draft.js`（社区 render / 生图轮询）。
2. Worker：`membership-tasks.ts`（累计 10 项任务）。
3. tombstone：`scripts/audit-tombstone-storage.ps1`。

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
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
