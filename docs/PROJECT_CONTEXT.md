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

## 当前部署阶段（2026-06-07 · esbuild 八 pack）

| 项 | 状态 |
|----|------|
| **Pages** | build `20260623j` · https://prompt-hubs.com |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |

### 已打通

- ✅ **八 pack**（`pack-prelude` … `pack-viewer` … `pack-extra`）+ 部署前 `verify-pack-contract` + HTTP 冒烟（含 `Sec-Fetch-Dest: script`）
- ✅ **灯箱/欣赏器核心** 已拆至 `app-viewer-core.js` → `pack-viewer.js`（在 `script.js` 之前加载）
- ✅ **禁止** `*.bundle.js` / `pack-*.js?v=`（Cloudflare Pages script 请求会 SPA 回退 HTML）
- ✅ 手机切后台生图恢复 · 失败标红 · Feed 首开 hydrate

### 已知问题（已修）

- ~~`/dist/*.js` SPA 回退~~（`20260622p`）
- ~~`*.bundle.js` 文件名 script 加载得 HTML~~（`20260623f` → 改名为 `pack-*.js`）

### 下一步

1. 强刷确认 `window.__APP_BUILD__ === '20260623j'` 与 8 个 pack 无 Console MIME 报错
2. 继续从 `script.js` 拆 lightbox 业务层（`openLightbox` / `loadLightboxImage` 等）

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
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hubs.com，API https://api.prompt-hubs.com。

必读：docs/AI-PITFALLS.md、docs/CURRENT-ISSUES.md、docs/FEED-MODULES.md、docs/AI-HANDOFF.md。

协作：简体中文；用户是小白；分步说明；Cloudflare 写清菜单路径；勿提交密钥。
```
