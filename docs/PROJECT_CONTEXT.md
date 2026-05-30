# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/CURRENT-ISSUES.md`**，再读 **`docs/AI-HANDOFF.md`**。  
> 默认中文；最小 diff；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry；登录后同步 `user_data` |
| **提示词社区** | 全站 Feed（`community_posts` + API） |
| **我发布的** | 卡片库勾选「发布到社区」的作品 |
| **图片生成** | 扣积分；`POST /api/v1/generate` |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-05-29 · 构建 **20260616n**）

| 项 | 状态 |
|----|------|
| 构建号 | **`20260616n`** / SW **`prompt-hub-v252`** |
| 已打通 | `/health`、兑换、生图、社区 Feed、社区点赞 API、收藏独立副本 |
| **本轮** | 社区点赞全站计数；会员 lite 档 + 新价；激活码兑换前自选每日/一次性（同码通用）；轻量会员紧凑面板 |

### 待用户执行（SQL）

按顺序执行：

1. `20260529140000_community_post_likes.sql`
2. `20260529150000_membership_lite_tier.sql`
3. `20260529160000_new_membership_codes_daily.sql`

（若更早未跑：`20260529120000_community_notifications.sql`、`20260529130000_profiles_display_name.sql`）

### 已知 / 待验收

- 浏览器插件：见 **`docs/BROWSER-EXTENSION.md`**（规划，未开发）
- 单卡「发布到社区」开关 UI 与 `publishedToCommunity` 仍可能不同步
- Worker + SQL 都部署后点赞才全站持久

### 测试账号

- 邮箱 `2705367723@qq.com`

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
.\deploy.ps1
```

---

## 文档索引

| 文档 | 何时读 |
|------|--------|
| **[CURRENT-ISSUES.md](./CURRENT-ISSUES.md)** | **必读** — P0、实测 |
| **[MEMBERSHIP-CREDITS.md](./MEMBERSHIP-CREDITS.md)** | 会员档位、激活码、领取方式 |
| **[BROWSER-EXTENSION.md](./BROWSER-EXTENSION.md)** | 插件可行性 / 合规 |
| [AI-HANDOFF.md](./AI-HANDOFF.md) | Grep 表、接手流程 |

---

## 开发约定

1. 最小 diff；改静态资源 bump `__APP_BUILD__` + `sw.js`
2. 会员卡密**不按**领取方式分批发码；兑换时传 `creditGrantMode`
3. 轻量会员 `lite` 仅 `daily` 积分

---

*最后更新：2026-05-29 — 构建 20260616n；点赞/会员/插件文档*
