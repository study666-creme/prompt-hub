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
| **资产包** | 领取存入「拥有」、封面预览、一键导入建文件夹 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-05-30 · 构建 **20260602w** · 已部署）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260602w** · SW `prompt-hub-v314` |
| `/health`、兑换、生图 | 已打通 |
| 资产包 | 领取后存入「拥有」；封面点击预览；一键导入自动建文件夹 |
| 随心一抽 | 每日 10 次 · `GET/POST /api/v1/community/gacha/*` + `/me` 同步 |
| 手机社区 | Grid 两列（20260602u 修空白叠卡） |
| 资产创作详情 | 左悬浮图 · 中链接 · 右悬浮文档 + 字段设置入口 |

### 已知问题 / 下一步

- 强刷或注销 SW 后确认 `window.__APP_BUILD__ === '20260602w'`
- 资产包分批选择性导入（当前：浏览全部 + 一键全量导入）
- 大体积图包「浏览包内图片」加载速度待优化

### 测试账号

- 邮箱 `2705367723@qq.com`

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
npx wrangler deploy
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
