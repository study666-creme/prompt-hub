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

## 当前部署阶段（2026-05-30 · 构建 **20260621b**）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 资产创作 `asset-studio.html` |
| 构建号 | 主站 **20260619m** · 资产创作 **20260621b** |
| 已打通 | `/health`、社区、生图扣积分、资产创作对话 API（需 `CHAT_API_KEY`） |
| 资产创作 | 关联图顶栏、文档树内联命名、多对话线程、充值/明细、设置可关附带文档 |
| **浏览器插件** | `extension/` **v1.0.7** — 见 **`docs/BROWSER-EXTENSION.md`** |

### 本轮改动（20260621b）

- 修复 `renderEditor` 误命名；顶栏「关联图」、悬停放大、移除图无确认
- 文档树：单一 **+** 内联建文档；文件夹行 **+** 建子文档
- 对话：多线程保留历史；新对话无预设身份；复制不扣积分；设置可关发送附带文档
- 顶栏：去掉导入卡片库，积分旁 **充值** / **明细**

### 待用户执行

- 前端：`.\deploy-pages.ps1`；Worker：`server\.\deploy.ps1`；配置 `CHAT_API_KEY`（`server\secrets.ps1`）
- SQL 仍按 `20260530100000_user_data_service_role.sql` 等迁移顺序（见上文索引）

### 已知 / 下一步

- 部署后 **Ctrl+Shift+R** 强刷
- 对话需基础会员 + Worker 已部署 `CHAT_API_KEY`
- 新对话默认不注入系统人设，用户自行调教

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
