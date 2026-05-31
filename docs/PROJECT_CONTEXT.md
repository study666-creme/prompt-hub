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

## 当前部署阶段（2026-05-30 · 构建 **20260603f** · 已部署 Pages）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260603f** · SW `prompt-hub-v323` |
| `/health`、兑换、生图 | 已打通 |
| 生图页 | 双模式 Tab；优化按钮在复制左侧；灵感词条含「精品」；画风含「超写实」 |
| 生图仓库 | 修复生成中卡片短暂消失（pending 删除时机 + feed 不再闪隐） |
| 抽卡配额 | 普通 10 次/天 · 轻量 30 次/天 · 基础+无限 |

### 已知问题 / 下一步

- 强刷或注销 SW 后确认 `window.__APP_BUILD__ === '20260603f'`
- 部署 Pages 后验证：优化按钮位置、精品词条抽卡、生图过程中卡片是否仍稳定可见
- 资产包 UI 仍待用户验收
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
