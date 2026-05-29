# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天开场白示例**  
> 请先读 **`docs/CURRENT-ISSUES.md`**（当前故障与进度），再按需打开下方索引文档。默认中文回复；最小 diff；勿提交密钥。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry、OCR、备份；登录后同步 `user_data` |
| **提示词社区** | 全站 Feed（`community_posts` 表）+ 本地副本；互动需登录 |
| **我发布的** | 卡片库发布到社区的作品（按 `sourceCardId`） |
| **图片生成** | 扣积分；`POST /api/v1/generate` |

部署：**Cloudflare Pages**（静态）+ **Worker** `api.prompt-hub.cn` + **Supabase**。

---

## 文档索引（按任务阅读）

| 文档 | 何时读 |
|------|--------|
| **[CURRENT-ISSUES.md](./CURRENT-ISSUES.md)** | **必读**：未解决问题、根因分析、调试建议 |
| [FILE-MAP.md](./FILE-MAP.md) | 按任务找文件/函数，避免全仓遍历 |
| [DATA-MODEL.md](./DATA-MODEL.md) | DB / JSON / Storage / 本地缓存分层 |
| [COMMUNITY-ARCHITECTURE.md](./COMMUNITY-ARCHITECTURE.md) | 社区读写的数据流与踩坑函数 |
| [AUTH-AND-SYNC.md](./AUTH-AND-SYNC.md) | 登录、换号、云合并、墓碑 |
| [DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md) | Pages/Worker 部署与验证 |
| [BACKEND.md](./BACKEND.md) | API 路由、积分、生图、webhook |
| [LOCAL-DEV.md](./LOCAL-DEV.md) | 本地 `serve-local.ps1`，勿 `file://` |
| [FIX-API-522-BEGINNER.md](./FIX-API-522-BEGINNER.md) | API 522 / 连不上 |
| [CUSTOM-DOMAIN.md](./CUSTOM-DOMAIN.md) | 域名与 Cloudflare |
| [SUPABASE-AUTH.md](./SUPABASE-AUTH.md) | 手机/微信 OAuth |
| [CARD-LOADING.md](./CARD-LOADING.md) | 卡片图加载 |
| [DATA-SAFETY.md](./DATA-SAFETY.md) | 合并防覆盖 |

运维 SQL：`scripts/purge-community-ghost-888.sql`（清理历史 888 等脏帖）

---

## 技术栈（简表）

| 层 | 技术 |
|----|------|
| 前端 | Vanilla JS + CSS；`script.js` + `features-draft.js` |
| 认证 / 卡片 JSON | Supabase Auth + `user_data` |
| 全站社区 | Postgres `community_posts` + Worker |
| 图片 | Storage `card-images` + 签名 API |
| 积分/会员/生图 | Worker `server/`（Hono + TS） |

---

## 仓库关键路径

```
prompt-hub/
├── index.html              # __APP_BUILD__、脚本顺序
├── script.js               # 卡片库、Auth、云同步
├── features-draft.js       # 社区、生图、publicFeedPosts
├── supabase-sync.js        # Auth、Storage 签名
├── cloud-sync-safety.js    # 云合并
├── api-client.js           # PromptHubApi
├── sw.js                   # Service Worker CACHE
├── server/                 # Workers API
├── supabase/migrations/    # SQL
└── docs/                   # 本文及次级文档
```

**勿提交**：`.env*`、`*-config.local.js`、`SUPABASE_SERVICE_ROLE_KEY`。

---

## 当前部署阶段（2026-05-29）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` → **https://api.prompt-hub.cn** |
| Pages | **https://prompt-hub.cn** |
| 仓库构建号 | **`20260614b`** / SW **`prompt-hub-v208`** |
| DB 社区帖 | 用户大号约 **15 条** `published=true`（SQL 已核实） |
| 已打通 | `/health`、兑换、生图、社区 Feed API、社区图签名 |

### 仍未解决（用户实测，2026-05-29）

详见 **[CURRENT-ISSUES.md](./CURRENT-ISSUES.md)** 全文。

1. **游客**进社区长期「正在加载」，列表不出。  
2. **登录大号**社区只见 2～3 条，与 DB 15 条不符；「同步/对齐」无效。  
3. **卡片库**与 `community_posts` 脱节；缺的十几张未通过 UI 恢复。  
4. 社区 Masonry **间歇变大变小**（未确认是否已部署 `20260614b`）。  
5. 部分图片 **404**（Storage 无文件）。

**接手者优先**：验证 `GET /api/v1/community/feed` 与前端 `publicFeedPosts` 是否一致，再查 `reconcileCommunityWithCards` / `mergeCommunityPostsList`。

---

## 开发约定

1. **最小 diff**；IIFE + `window.Xxx` 风格。  
2. 积分/会员写操作仅经 Worker + service_role。  
3. 改静态资源：bump `__APP_BUILD__` + `sw.js` CACHE。  
4. 用户为小白：分步说明 + 可复制命令；Cloudflare 写菜单路径。  
5. 仅用户要求时 `git commit`；回复简体中文。

---

## 常见改动 → 文件

| 任务 | 文件 |
|------|------|
| 卡片库 / 登录 | `script.js`, `supabase-sync.js`, `cloud-sync-safety.js` |
| 社区 Feed | `features-draft.js`, `server/src/lib/community-feed.ts` |
| API 客户端 | `api-client.js` |
| 部署 | `deploy-pages.ps1`, `server` → `npm run deploy` |

---

*最后更新：2026-05-29 — 暂停改代码；补充次级文档与真实故障状态*
