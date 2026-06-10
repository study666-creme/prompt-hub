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

## 当前部署阶段（2026-06-11 · 木瓜 Cron + 首屏不卡 + 社区保存逻辑）

| 项 | 状态 |
|----|------|
| **Pages** | `prompt-hub-hub` · 构建 **`20260611n`** · https://prompt-hubs.com |
| **Worker** | `prompt-hub-api` · **https://api.prompt-hubs.com** · 版本 `9b08b9a7` |
| **数据库** | 境外 Supabase `yibawjvhmqcysdovscss`（Worker Secret） |
| **Cron** | `*/2 * * * *` → **`drainMookoPendingSubmits`**（仅木瓜慢速线，见下） |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、Grs/Apimart 生图与 2h/7d 恢复
- ✅ **木瓜 gpt-image-2-pro**：Apifox 对齐（像素 size、jpeg、moderation: low）；Cron **await** 完整 POST；`settle=1` 轮询可同步提交
- ✅ **Apimart 特价** `apimart-gpt-image-2-official-budget`（4 档比例、无 1:1）
- ✅ 首屏本地 IndexedDB 先画 UI，云端拉取后台；社区「发布」未达标仍保存、不拦保存
- ⚠️ **Workers 免费日请求 10 万**：Cron+轮询易触顶，木瓜/Cron 会失败 → 建议 **Workers Paid $5/月**
- ⚠️ 木瓜慢速：单 POST 可达 **8 分钟**，勿在 HTTP `waitUntil` 里提交（仅 Cron + settle 深轮询）

### 木瓜 Cron 是干什么的？（≠ 其它模型自动恢复）

| | **Grs / Apimart / 即梦** | **木瓜 Cron** |
|--|--|--|
| 提交方式 | 生图 POST 后 **秒级** 返回 taskId，前台/轮询跟进度 | 同步 POST **阻塞 2～8 分钟** 才回图 |
| 「恢复」 | `resumePendingGenerationJobs`、2h/7d 补拉、repair 灰图 | **只服务木瓜**：排队 `queued` → Cron **await 提交**；`done` 无图 → 轮询 `/v1/tasks` 归档；死 `running` → 5min 退款释槽 |
| 触发 | 用户打开生图页、GET `/jobs/:id` 轮询 | **每 2 分钟** + 用户 **`settle=1`** 深轮询（同请求内跑完 POST） |

其它模型**不依赖**此 Cron；Cron **不是**全站生图自动恢复，只是木瓜专用「提交排水 + 拉图收尾」。

### 已知问题

1. **b076702 勿合并**（第二张生图卡死）。
2. 若 Cloudflare 日额度用尽，全站 API/Cron 失败直至 UTC 0 点重置。
3. 管理后台用户详情无 `credit_ledger` 明细。

### 下一步

1. Cloudflare 升级 **Workers Paid**（或等 UTC 0 点额度重置）后再测木瓜。
2. 强刷确认 `window.__APP_BUILD__ === '20260611n'`。
3. 木瓜测试：生图页留屏等 2～12 分钟，Network 看 `jobs/xxx?settle=1`。

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
木瓜：Cron */2 drainMookoPendingSubmits；勿 HTTP waitUntil 提交；settle 轮询可跑完整 POST。
```
