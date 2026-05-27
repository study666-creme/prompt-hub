# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天开场白示例**  
> 请先阅读本文与 `docs/BACKEND.md`，再处理我的任务。默认中文回复；最小 diff；勿提交密钥。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA，管理提示词卡片（分组、标签、置顶、OCR、备份），并包含三块扩展能力：

| 模块 | 说明 |
|------|------|
| **卡片库** | 主仓库：Masonry 布局、侧栏详情、未登录最多 10 张，登录后迁移上云 |
| **社区** | 发布/浏览提示词 Feed，复制与互动需登录 |
| **我的创作** | 用户创作内容（草案功能） |
| **图片生成** | 扣积分生图（当前多为本地占位图；配置 API 后走服务端扣费） |

部署：静态资源（**Cloudflare Pages** `wrangler.toml` 或 **Vercel** `vercel.json`），无构建步骤，根目录即站点。  
**推荐（一劳永逸）**：① GitHub 已 SSH → `git push` 且 Pages 已 **Connect to Git** 则自动上线；② 或本机一次 `server` 里 `npm exec wrangler login` 后，根目录 `.\deploy-pages.ps1` 命令行部署。ZIP 上传仅作无法登录 Wrangler 时的备用。  
**移动端**（≤900px）：底部导航含「生图」；生图页「生成 / 作品」切换；`styles-mobile.css` + `mobile.js`。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vanilla JS + CSS，无框架；`theme.js` 主题与自动昼夜 |
| 认证 / 卡片云同步 | Supabase Auth + `user_data` 表（JSON） |
| 积分 / 会员 / 生图计费 | Cloudflare Workers API（`server/`，Hono + TS） |
| 数据库 | Supabase Postgres（见 migration） |

---

## 仓库结构（关键文件）

```
prompt-hub/
├── index.html              # 入口、脚本加载顺序
├── script.js               # 主逻辑：卡片库、Auth、云同步、两套设置、置顶
├── features-draft.js       # 社区 / 创作 / 生图 UI 与 Feed
├── points-system.js        # 积分 UI；兑换；里程碑（本地）；API 优先时 sync
├── membership.js           # 会员档位、生图折扣、置顶限额
├── subscription.js         # 订阅弹层 UI（演示价，支付未接）
├── theme.js                # 日光/夜间、自动昼夜 8:00/20:00
├── supabase-config.js      # SUPABASE_URL / ANON_KEY（可 local 覆盖）
├── supabase-sync.js        # 登录、pull/push user_data、图片 Storage
├── api-config.js           # API_BASE_URL（可 api-config.local.js 覆盖）
├── api-client.js           # PromptHubApi：syncMe / redeem / generate
├── styles*.css             # 主样式、功能、设置、主题、移动端
├── sw.js                   # Service Worker 缓存（改资源时 bump 版本号）
├── server/                 # Workers API（见 docs/BACKEND.md）
├── supabase/
│   ├── schema.sql          # 旧：user_data
│   ├── storage.sql
│   ├── migrations/20260526000000_backend_core.sql  # 新：profiles、积分、激活码
│   └── fix-policies.sql
└── docs/
    ├── PROJECT_CONTEXT.md  # 本文件
    ├── BACKEND.md          # API / 部署 / 安全
    └── SUPABASE-AUTH.md    # 手机/微信 OAuth 配置说明
```

**不要提交**：`.env*`、`supabase-config.local.js`、`api-config.local.js`、`SUPABASE_SERVICE_ROLE_KEY`。

---

## 数据如何拆分（重要）

| 数据 | 存储 | 写入口 |
|------|------|--------|
| 卡片、分组、字段、部分设置 | `user_data.data`（JSON） | 客户端 `SupabaseSync.pushCloudData` |
| 积分余额、会员到期 | `profiles` 表 | **仅 API** → RPC `apply_credit_delta` |
| 激活码 | `activation_codes` | **仅 API** `POST /api/v1/redeem` |
| 生图任务 | `generation_requests` | **仅 API** `POST /api/v1/generate` |
| 积分流水审计 | `credit_ledger` | 随 RPC 写入 |

登录后：`handleCloudAfterLogin`（`script.js`）拉卡片云数据；若配置了 `API_BASE_URL`，会 `PromptHubApi.syncMe()` 同步积分/会员。

**渐进策略**：未配置 API 时，积分/会员仍可用本地 `localStorage` 演示逻辑；配置 API 后兑换与生图扣费以服务端为准。

---

## 核心业务规则（已实现）

### 认证与游客

- `window.AuthGate`：未登录限制（社区互动、兑换、生图点击「生成」等）。
- 游客卡片上限 **10**；`SIGNED_IN` 时可迁移本地卡片上云。

### 云同步体验

- `cloudHydratedUid`：同会话对同一用户**完整拉云一次**，避免每次回卡片库都 Toast + Masonry 重排。
- 切回仓库页：优先 `masonryInstance.layout()` 软布局。
- 手动「同步」按钮：**只 push**，不 force 全量 pull。

### 两套设置

- **侧栏「全局设置」**（`openAppSettings`）：外观 / 自动昼夜；**生图默认**（`defaultImageGenAutoPublish`：关闭后每次进入生图页「自动发布社区」默认关）。
- **卡片库「字段 & 设置」**（`openWarehouseSettings`）：OCR、新建卡片默认发社区、字段、帮助、备份（无外观）。

### 会员与积分

- **汇率**：1 元 = 100 积分；生图基准 **1K/2K/4K = 10/20/40 积分**。
- 档位：`basic` / `standard` / `pro`；生图折扣 **9/8/7 折**（**所有模型**含集梦及后续固定价模型，均在原价上乘折扣）。**全能模型2** 按分辨率 10/20/40；**集梦** 原价 40/张；**质量**仅影响出图，不额外加价。
- 首开：基础版连续包月 **¥1.9**（`first_sub_offer_used` / 侧栏「一折起」）；演示点击订阅不会消耗首开资格。
- 已上线库需执行 `supabase/migrations/20260526120000_points_scale_x10.sql`。
- 置顶：非会员 **2 张**，会员 **不限**（`PIN_LIMIT_FREE` / `PIN_LIMIT_MEMBER`）。
- 演示激活码：见 migration seed（如 `PROMPT-HUB-100`、`MEMBER-BASIC` 等）；生产需轮换。

### 订阅 UI

- `subscription.js` + `#subscribeOverlay`：三档包月/年；首开基础连续包月 ¥1.9（`promptrepo_first_sub_used`）。
- **支付 webhook 未接**，仅 UI + 本地/演示逻辑。

### 生图

- 未配置上游时 API 仍扣积分并记任务，可返回 `demo: true`；前端用占位图。
- 配置 `IMAGE_API_KEY` + `IMAGE_API_BASE_URL` 后代理上游（路径 `/generate`，可按供应商改）。

### 社区文案

- 无真实标题时不显示「未命名提示词」；`isGenericPostTitle` 过滤占位标题。

---

## 后端 API 速查

详见 **`docs/BACKEND.md`**。

- 本地：`cd server && npm run dev`（`.dev.vars` 含 Supabase 密钥）
- 前端：`api-config.local.js` → `window.API_BASE_URL = 'http://127.0.0.1:8787'`
- 生产：`wrangler secret put` + `npm run deploy`；CORS 需含静态站域名

主要路由：`GET /api/v1/me`、`POST /api/v1/redeem`、`POST /api/v1/generate`、`GET /api/v1/generate/cost`。

---

## Supabase 必做 SQL（新环境）

1. `supabase/schema.sql` + `storage.sql`（若尚未执行）
2. **`supabase/migrations/20260526000000_backend_core.sql`**（profiles、积分、激活码、RPC）

---

## 开发约定（请 AI 遵守）

1. **最小 diff**：不重构无关文件；匹配现有 IIFE / `window.Xxx` 风格。
2. **安全**：永不把 `service_role`、`.env` 写进前端或提交 Git。
3. **积分/会员写操作**：走 `server/` API，不要在客户端直接 `update profiles`。
4. **改静态资源**：记得提高 `sw.js` 里 `CACHE` 版本（如 `prompt-hub-v18`）。
5. **注释**：只写非显而易见的业务逻辑；用户未要求不写冗长 README。
6. **提交**：仅用户明确要求时再 `git commit`。
7. **回复语言**：简体中文。

---

## 当前部署阶段（自动维护，2026-05-27）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api`（账号 `2705367723`）已部署 |
| **API 自定义域名** | **`https://api.prompt-hub.cn/health` ✅ 已通**（`ok:true`, `supabase:ok`） |
| workers.dev | 国内常超时，生产走 `api.prompt-hub.cn` |
| 自有域名 | `prompt-hub.cn` / Pages：`prompt-hub.cn`、`www.prompt-hub.cn` |
| 前端 API | `api-domain.config.js` → `api.prompt-hub.cn`；CORS 含 `prompt-hub.cn` / `www` |
| 构建号 | **`20260531b`**（待部署）；SW `prompt-hub-v78` |
| 会员任务 | 侧栏任务中心；API `/api/v1/membership/tasks`（需迁移 `20260528120000_membership_tasks.sql`） |
| 试用码 | `MINI-99-3D`（¥0.99/3 天） |

**已知问题 / 下一步**

- 部署 `20260531b`：修侧栏底部裁切、编辑区图片铺满、生图记录去重、图片优先 Supabase 签名（避免 API CORS 拖慢）。
- 部署后 **Ctrl+F5**；控制台 `window.__APP_BUILD__` 应为 `20260531b`。
- Edge「跟踪防护」若拦 Supabase，改用本地 `vendor/supabase.min.js`（已内置）。
- 会员任务迁移 + Worker 重部署后，登录用户可在任务中心领取奖励。

文档每 **8 条用户消息** 由 `.cursor/hooks` + 规则 `.cursor/rules/doc-auto-sync.mdc` 提醒 AI 更新本节（计数见 `.cursor/doc-sync-state.json`）。

---

## 当前未完成 / 路线图

- [x] 支付 webhook 骨架（HMAC + 幂等 + 充值/会员）
- [x] APIMart 生图对接（全能模型2 + 集梦 Seedream）
- [x] 生图 UI：模型名无后缀、积分在生成按钮、质量命名、自动发布社区（全局默认）
- [x] 简易速率限制（兑换/生图，生产建议 CF Rate Limiting）
- [x] 点赞里程碑奖励迁到服务端（`POST /api/v1/community/like-milestone`；未配置 API 时仍走本地）
- [ ] 微信 OAuth 完整链路（见 `docs/SUPABASE-AUTH.md`）

---

## 本地快速启动

```bash
# 静态站（任选）
npx serve . 
# 或 Live Server / Cloudflare Pages 预览

# API（另开终端）
cd server
cp .dev.vars.example .dev.vars   # 填入 Supabase
npm install
npm run dev
```

根目录创建 **`api-config.local.js`**（已 gitignore）：

```javascript
window.API_BASE_URL = 'http://127.0.0.1:8787';
```

Supabase 密钥在 **`supabase-config.js`** 或 **`supabase-config.local.js`**。

---

## 常见改动应改哪些文件

| 任务 | 文件 |
|------|------|
| 卡片库 / 登录 / 云同步 | `script.js`, `supabase-sync.js` |
| 社区 / 生图 / Feed | `features-draft.js`, `styles-features.css` |
| 积分 / 兑换 | `points-system.js`, `api-client.js`, `server/src/routes/v1/redeem.ts` |
| 会员 / 置顶 | `membership.js`, `subscription.js` |
| 主题 / 自动昼夜 | `theme.js`, `script.js`（`openAppSettings`） |
| 后端路由 / 扣费 | `server/src/**`, migration SQL |
| 部署 API | `server/wrangler.toml`, secrets |

---

## 版本与缓存

- Service Worker：`sw.js` → `CACHE = 'prompt-hub-v…'`
- 脚本加载顺序见 `index.html` 底部：`theme` → `supabase` → `api-config` → `api-client` → `sync` → `membership` → `subscription` → `script` → `points` → `features-draft`

---

*最后更新：2026-05（含 Workers API、profiles 迁移、前端 API 客户端对接）*
