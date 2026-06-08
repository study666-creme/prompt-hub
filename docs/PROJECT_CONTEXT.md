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

## 当前部署阶段（2026-06-08 · 原图 + 524 + 木瓜慢速线）

| 项 | 状态 |
|----|------|
| **主域名** | **https://prompt-hubs.com** · Pages `prompt-hub-hub` · build **`20260608l`** |
| Worker | `prompt-hub-api` · **https://api.prompt-hubs.com** · Cron `* * * * *`（含 `mooko-drain`） |
| **卡片上传** | Worker + 前端单张上限 **50MB**（与 `card-images` 桶一致）；8MB 旧限制已移除 |
| **原图下载** | 多路径取**最大体积**；优先 `generated/{jobId}`；保存卡片时**不删**生图归档；4K 偏小自动 re-archive |
| **生图提交** | GrsAI/Apimart **后台提交**（防 CF **524**）；木瓜排队后 **POST 即触发 drain** + 轮询补提交 |
| **生图商品** | 入库原字节；列表仅 grid 缩略；`settle=1` 深查上游 |

### 已打通 / 未打通

- ✅ `/health`、登录、兑换、生图扣费、R2 `r2-first` 读图
- ✅ 4K 原图上传（≤50MB）、下载走 blob 不落 JSON 404 页
- ⚠️ 木瓜慢速线 2–12 分钟；勿用后台「测试勿用」备用模型做日常出图
- ⚠️ 编辑保存卡片时勿重复上传原图（会写入 `card_xxx` 副本）

### 已知问题

1. **Apimart**：多为内容审核，改提示词；积分已退。
2. **旧图偏小**：上游链过期则 repair 无效，需重新生成。
3. **524**：前台应转「后台等待」；强刷 build `20260608l` 后重试。

### 下一步

1. 日常生图用 **GPT Image 2 VIP**（GrsAI），2K/4K 验收下载体积 ≥10MB。
2. 木瓜线路仅慢速省钱场景；监控 `mooko-drain` 日志与木瓜控制台消费记录。
3. 后台「测试勿用」模型改 `maintenance` 或下架，避免用户误选。

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
