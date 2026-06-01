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
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 APImart |
| **资产包** | 领取存入「拥有」、封面预览、一键导入建文件夹 |
| **资产创作** | `asset-studio.html` · 左图右文档悬浮详情 + 字段设置 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-01 · 构建 **20260601l**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn |
| 构建号 | **20260601k**（主站） |
| **社区** | 点卡片恢复右侧详情栏；快速预览不再抢点击 |
| **加载动效** | 夜间光带 3.2s 循环；白天生图占位用光球 |
| **卡片创作 / 社区** | 缩略图预取、批量签名等同前 |

### 已知问题 / 下一步

- 强刷确认 `window.__APP_BUILD__ === '20260601k'`
- 批量 5+ 张可能上游限流；失败项可「恢复丢失的生图」
- AI 改功能时勿动无关 UI（见 `.cursor/rules/prompt-hub-context.mdc`）

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
| **[CARD-LOADING.md](./CARD-LOADING.md)** | 卡片/社区图为何慢、已做优化 |
| **[PERFORMANCE-OPTIMIZATION.md](./PERFORMANCE-OPTIMIZATION.md)** | 性能与「流畅感」目标 |
| **[MEMBERSHIP-CREDITS.md](./MEMBERSHIP-CREDITS.md)** | 会员档位、激活码 |
| **[PROJECT-SNAPSHOT.md](./PROJECT-SNAPSHOT.md)** | 详细规划 + 现状 |
| [AI-HANDOFF.md](./AI-HANDOFF.md) | Grep 表、接手流程 |
