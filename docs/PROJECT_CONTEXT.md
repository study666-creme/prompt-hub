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

## 当前部署阶段（2026-05-29 · 构建 **20260616f**）

| 项 | 状态 |
|----|------|
| 构建号 | **`20260616f`** / SW **`prompt-hub-v244`** |
| 已打通 | `/health`、兑换、生图、社区 Feed、收藏独立副本、社区 Masonry 瀑布流 |
| **本轮** | 社区/我发布恢复瀑布流（≤3 列 horizontalOrder）；欣赏模式退出修复；移除「同步卡片库」UI；手机隐藏欣赏按钮；社区通知 API（点赞/收藏推作者）；任务中心每日 5 积分保留、仅邀请要绑手机 |

### 待用户执行（SQL）

- Supabase SQL Editor 运行：`supabase/migrations/20260529120000_community_notifications.sql`（社区消息收件箱）

### 已知 / 待验收

- 单卡「发布到社区」开关 UI 与 `publishedToCommunity` 仍可能不同步（见 CURRENT-ISSUES P0）
- 社区他人配图加载仍可能偏慢（签名/预取）
- Worker 未部署时任务中心仍会要求绑手机（旧 API）

### 测试账号

- 邮箱 `2705367723@qq.com`
- UUID `ab5c77dc-570e-4af7-ac38-2d311be96244`

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
| **[CURRENT-ISSUES.md](./CURRENT-ISSUES.md)** | **必读** — P0、实测、验证命令 |
| **[AI-HANDOFF.md](./AI-HANDOFF.md)** | Grep 表、接手流程 |
| [FILE-MAP.md](./FILE-MAP.md) | 按任务找文件 |
| [COMMUNITY-ARCHITECTURE.md](./COMMUNITY-ARCHITECTURE.md) | 社区数据流 |
| [AUTH-AND-SYNC.md](./AUTH-AND-SYNC.md) | 登录、云合并、超时 |

---

## 仓库关键路径

```
index.html          # __APP_BUILD__
script.js           # 卡片库、pushToCloud、欣赏模式
features-draft.js   # 社区 Feed、Masonry、通知、欣赏模式
supabase-sync.js    # 图片签名、缺 token 校验
server/src/lib/community-notify.ts  # 点赞/收藏通知收件箱
server/src/lib/membership-tasks.ts  # 任务中心规则
trial-tasks.js      # 任务中心 UI
```

---

## 开发约定

1. 最小 diff；先浏览器/API 验证再改
2. 改静态资源：bump `__APP_BUILD__` + `sw.js` CACHE
3. 仅用户要求时 `git commit`
4. **`publishedToCommunity` 是单卡字段**，开关不是全局状态

---

*最后更新：2026-05-29 — 构建 20260616f；社区瀑布流/通知/任务中心；用户自行跑 SQL*
