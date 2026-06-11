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

## 当前部署阶段（2026-06-12 · 木瓜队列疏通 + 下载修复）

| 项 | 状态 |
|----|------|
| **Pages** | `prompt-hub-hub` · **待部署**（`script.js` / `supabase-sync.js` 下载修复）· https://prompt-hubs.com |
| **Worker** | `prompt-hub-api` · **https://api.prompt-hubs.com** · 版本 **`54ecc2e2`** |
| **数据库** | 境外 Supabase `yibawjvhmqcysdovscss`（Worker Secret） |
| **Cron** | `* * * * *` → **`drainMookoPendingSubmits`**（仅 Cron await POST，勿 HTTP waitUntil） |
| **健康检查** | `GET /health` 含 `mooko: configured|missing` |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、Grs/Apimart 生图与 2h/7d 恢复
- ✅ **Apimart 特价** `gpt-image-2-official`（1K 约 $0.0093；后台默认定价 3 积分/张，可按成本调高）
- ✅ **木瓜**：大图 base64 分块归档；僵尸 `running` 释槽/回队列；图生图 `images[].image_url` 格式
- ✅ 生图下载：按任务真实 `resolution` 拉原图，1K 不再误报「2K 原图」、不再慢速重拉
- ⚠️ **Workers 日请求额度**：Cron+轮询易触顶 → 建议 **Workers Paid $5/月**
- ⚠️ 旧木瓜/假 `running` 任务占槽 → 用户需 **× 取消** 后重试；`$0.0093` 是 Apimart 特价非木瓜

### 木瓜 Cron 是干什么的？（≠ 其它模型自动恢复）

| | **Grs / Apimart / 即梦** | **木瓜 Cron** |
|--|--|--|
| 提交方式 | 生图 POST 后 **秒级** 返回 taskId，前台/轮询跟进度 | 同步 POST **阻塞 2～8 分钟** 才回图 |
| 「恢复」 | `resumePendingGenerationJobs`、2h/7d 补拉、repair 灰图 | **只服务木瓜**：`queued` → Cron await POST；R2 补 completed；假 `running` 6min 回队列 |
| 触发 | 用户打开生图页、GET `/jobs/:id` 轮询 | **每分钟 Cron**；`settle=1` 仅 R2 恢复，**不在 HTTP 里 POST 木瓜** |

其它模型**不依赖**此 Cron；Cron **不是**全站生图自动恢复，只是木瓜专用「提交排水 + 拉图收尾」。

### 已知问题

1. **ThinkAI 经济线** `ithink-gpt-image-2-slow`：上游 401/无效令牌 → 前台「生图接口密钥异常」；Worker 曾误建错误名 Secret，需 `wrangler secret delete` 后重设 `ITHINK_API_KEY`。
2. **Apimart Gemini 高频**：`gemini-2.5-flash-lite` 用于社区配图审核/反推/裂变（非生图）；批量 `posts/sync` 每张新帖审一次；同步失败会重复审图。
3. **Apimart 任务详情**：`gpt-image-2-official` 控制台详情常只显示成图，无 size/quality；参数见本站 `generation_requests.meta` 或 API `GET /v1/tasks/{id}`。
4. **b076702 勿合并**（第二张生图卡死）。
5. 管理后台用户详情无 `credit_ledger` 明细。

### 下一步

1. `.\deploy-pages.ps1` 部署前端下载修复 → Ctrl+F5。
2. 取消卡住的木瓜任务 → 只测 1 张 2K 纯文字（无参考图）→ 看木瓜控制台是否有新记录。
3. 特价 1K 若亏本：管理后台把 `apimart-gpt-image-2-official-budget` 1K 调到 ≥7 积分。

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
