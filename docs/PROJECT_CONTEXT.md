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

## 当前部署阶段（2026-05-30 · 构建 **20260530c**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 资产创作 `asset-studio.html` |
| 构建号 | 主站 **20260530c** · SW **prompt-hub-v282** |
| 卡片库 | 批量签名 32 张/并发 8；首屏 patch 缓存 |
| 资产创作 | 导入 UI 两张独立封面卡；IndexedDB 读主站 |
| 详细规划 | **[PROJECT-SNAPSHOT.md](./PROJECT-SNAPSHOT.md)** |

### 本轮改动（20260530c）

- 修复社区 `renderPosts` 初始化顺序错误（只显示一张的根因）
- 社区图片预取时间加长、签图并发提高

### 上轮（20260530b）

- 导入弹窗：两张独立卡片，库内图作背景、库名作封面字
- 卡片图：预取 12s、warm 12s、签并发 8
- ogl 背景改 esm.sh

### 待用户执行

- **Ctrl+Shift+R** 强刷主站 + 资产创作页

### 已知问题

- 部分历史卡片 Storage 404（已删文件）

### 下一步

- 验收首屏图片是否在数秒内批量出现

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
| **[PROJECT-SNAPSHOT.md](./PROJECT-SNAPSHOT.md)** | **详细** 规划 + 现状 |
| [AI-HANDOFF.md](./AI-HANDOFF.md) | Grep 表、接手流程 |

---

## 开发约定

1. 最小 diff；改静态资源 bump `__APP_BUILD__` + `sw.js`
2. 会员卡密**不按**领取方式分批发码；兑换时传 `creditGrantMode`
3. 轻量会员 `lite` 仅 `daily` 积分

---

*最后更新：2026-05-30 — 构建 20260530b*
