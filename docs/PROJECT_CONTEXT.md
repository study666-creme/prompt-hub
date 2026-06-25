# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/AI-PITFALLS.md`**（防炸站）→ **`docs/CURRENT-ISSUES.md`** → **`docs/AI-HANDOFF.md`**。  
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

## 当前部署阶段（2026-06-07 · Feed 滚动 + 生图 Tab）

| 项 | 状态 |
|----|------|
| **Pages** | build `20260625p` · https://prompt-hubs.com |
| **Worker** | `prompt-hub-api` · https://api.prompt-hubs.com |
| **Supabase 账期** | Pro 约至 **2026-07-07**；到期前迁 MemFire + R2 |

### 已打通

- ✅ **首屏带宽**：卡片库 ~889 kB、社区 ~865 kB（2026-06 用户 Network 验收）
- ✅ **P0 全站图片/Feed**：模块化 ReferenceError 热修
- ✅ **生图仓库 / Feed**：grid-only + sign-batch；Tab 切换强制重绘
- ✅ **MediaPipeline + SyncOrchestrator**（pull/Feed 刷新已收编至编排器）
- ✅ 新图走 **R2**（`MEDIA_STORAGE_MODE=r2`）
- ✅ **社区分页 / 生图 Tab 错乱 / 侧栏点图后滚动对抗**（`20260625p`）

### 架构优化进度

| 阶段 | 内容 | 进度 |
|------|------|------|
| 1 图片管线 | MediaPipeline 全站 Feed/卡片库/生图/资产 | 完成 |
| 2 云同步解耦 | SyncOrchestrator + skipImageUpload | 完成 |
| 3 模块化 | 12 个 imagegen 子模块 + features-draft ~9.3k 行 | 完成 |

### 已知问题 / 下一步

1. MemFire 迁移（7 月初 final dump）
2. 部分旧第三方外链 404、偶发 502
3. 运营后台 UI 持续优化（侧栏导航、概览统计色条、刷新按钮）
4. R2 历史图本机 `backups/card-images` → 同步脚本

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
