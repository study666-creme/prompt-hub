# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/CURRENT-ISSUES.md`（P0-带宽）**，再读 **`docs/AI-HANDOFF.md`**。  
> 默认中文；**P0 拉满算力**见 `docs/AI-WORK-MODE.md`；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry、批量操作（含批量开/关社区公开） |
| **提示词社区** | 全站 Feed（`community_posts` + API） |
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 **GrsAI**；含 **仓库/社区** Feed（`#imageGenFeed`） |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-04）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建号 **`20260604t`**（以 `window.__APP_BUILD__` 为准） |
| **已打通** | 社区 / 兑换 / 资产包 / GrsAI 生图 / 云端同步 / 管理后台 / `/health` |
| **未打通 / 体验 P0** | 社区/主页列表 sign 200 但 img 未请求 CDN（缓存键不匹配）— **`20260604t` 已修** |

### 已知问题（优先）

1. **已修（20260604t）**：batch 签名 URL 只缓存在 grid key，lookup 用 primary ref → 无图且无 jpeg 请求；`loadImg` 被 stale missing 缓存拦截。
2. **P0 带宽**：列表仅签/载 `_grid`；目标首屏 **<10MB**、单张 40–150KB。
3. **验收**：强刷后 Network 应有 `/api/v1/media/c/` 的 jpeg 200。

### 下一步（给下一条 AI）

1. 用户强刷验 `window.__APP_BUILD__ === '20260604t'`；Console：`document.querySelector('#communityGrid img.card-img')?.src` 应以 `https://api.prompt-hub.cn/api/v1/media/c/` 开头。
2. 若仍无图：查 sign-batch 响应与 CDN `/c/` 是否 200。
3. 部署：`deploy-pages.ps1` + `server` 下 `npx wrangler deploy`。

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

Worker 有改动时：

```powershell
cd d:\prompt-hub\server
npx wrangler deploy
```

### 测试账号

- 邮箱 `2705367723@qq.com`
- `author_id`：`ab5c77dc-570e-4af7-ac38-2d311be96244`

---

## 新对话提示词（复制整段）

```text
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hub.cn，API https://api.prompt-hub.cn。

请先读：docs/CURRENT-ISSUES.md（P0-带宽）、docs/AI-HANDOFF.md、docs/CARD-LOADING.md。

P0：用户在「图片生成 → 仓库」首屏流量仍高；大量 generated/ 无 grid。生图 Feed 每页 24 卡 DOM，但图片 eager 仅 6 张。

关键：features-draft.js IMAGEGEN_FEED_*；supabase-sync.js getListDisplayImageSrc / consumeImageGenFeedFullSlot；card-image-loader.js。

修完默认 deploy-pages.ps1。用户是小白，繁体中文分步说明。不要提交密钥。
```
