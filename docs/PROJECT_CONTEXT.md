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

## 当前部署阶段（2026-05-30 · 构建 **20260622d**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 资产创作 `asset-studio.html` |
| 构建号 | 主站 **20260622d** · SW **prompt-hub-v278** |
| 已打通 | `/health`、社区、生图、兑换、资产创作对话（限免+积分） |
| 任务中心 | 新增插件保存/资产创作对话/关联卡片任务；资产创作限免 |
| **浏览器插件** | `extension/` **v1.0.7** — 见 **`docs/BROWSER-EXTENSION.md`** |

### 本轮改动（20260622d）

- 任务：插件保存卡片 +3 天、资产创作 AI 对话 +1 天、关联图拖卡片 +2 天基础会员
- 资产创作解除会员门槛，侧栏标「限免」；对话 API 仅需登录+积分
- 修正「卡片库快速预览」任务判定：须点击「去生图」（不再误用收藏 flag）

### 待用户执行

- 部署后 **Ctrl+Shift+R** 强刷；Worker 需同步部署（新任务 flag 在 API）

### 已知 / 下一步

- 资产包/粉丝数为演示数据；404 图片需 Storage 修复

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

*最后更新：2026-05-30 — 构建 20260616p；扩展公开到社区 + 采集说明*
