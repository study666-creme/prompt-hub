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
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate` |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-05-31 · 构建 **20260602e**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260602e**（已部署 Pages） |
| `/health`、兑换、生图 | 已打通 |
| 资产包 | 选卡发布 / 层叠封面 / 开包导入 / 下架；需 Supabase 迁移 |
| 生图仓库详情 | 右侧预览栏收窄，竖图两侧留白优化 |

### 已知问题 / 下一步

- 强刷确认 `window.__APP_BUILD__ === '20260602e'`
- 资产包迁移：`20260530120000` + `20260530130000`（若未跑）
- 加入社群 +100 积分：入群后人工引导领取

### 测试账号

- 邮箱 `2705367723@qq.com`

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
npm exec wrangler deploy
```
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
| **[PROJECT-SNAPSHOT.md](./PROJECT-SNAPSHOT.md)** | **详细** 规划 + 现状 |
| [AI-HANDOFF.md](./AI-HANDOFF.md) | Grep 表、接手流程 |
