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

## 当前部署阶段（2026-05-30 · 构建 **20260618c**）

| 项 | 状态 |
|----|------|
| 构建号 | **`20260618c`** / SW **`prompt-hub-v264`** |
| 已打通 | 社区点赞 API、会员 lite 档、扩展 quick-card + tags + **公开到社区** |
| **浏览器插件** | `extension/` **v1.0.7** — 见 **`docs/BROWSER-EXTENSION.md`** |
| **主站** | 卡片资产草案 · **资产创作独立工作台**（侧栏直达 `asset-studio.html`）· 多卡片库占位 |

### 资产创作工作台（20260618c）

- 独立页 `asset-studio.html`：拖入首字段 → 悬浮卡；**双击** → 左卡片库样式 + 右完整设定/关联文档
- 侧栏「资产创作」自动导出卡片库并跳转；设定可编辑、本地自动保存

### 插件 v1.0.7 要点

- **× 退出存卡模式**（全局关闭，换页不再出现）；**−** 仅收起
- 设置里 **「提示词与图片都填入后自动保存」**（默认开）；关则需手动保存
- 面板内拖/贴图片**仅预览**，满足条件才自动保存
- **标签选择**（`GET /extension/tags`）

### 待用户执行（SQL）

按顺序执行：

1. `20260529140000_community_post_likes.sql`
2. `20260529150000_membership_lite_tier.sql`
3. `20260529160000_new_membership_codes_daily.sql`
4. **`20260530100000_user_data_service_role.sql`**（扩展保存必需）

（若更早未跑：`20260529120000_community_notifications.sql`、`20260529130000_profiles_display_name.sql`）

### 已知 / 待验收

- 扩展改代码后：Chrome 扩展页 → **重新加载** + `server` 部署 API + 主站 **Ctrl+Shift+R**
- **20260618c**：资产创作独立工作台 · 卡片详情面板 · 侧栏直达
- **20260618a**：卡片资产市场（3 个示例 SKU）· 多卡片库（标准 1 / 专业 2）
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

*最后更新：2026-05-30 — 构建 20260616p；扩展公开到社区 + 采集说明*
