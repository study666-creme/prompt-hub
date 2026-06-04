# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/AI-PITFALLS.md`**（防炸站）→ **`docs/CURRENT-ISSUES.md`（P0-带宽）** → **`docs/AI-HANDOFF.md`**。  
> 默认中文；**P0 拉满算力**见 `docs/AI-WORK-MODE.md`；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry、批量操作（含批量开/关社区公开） |
| **提示词社区** | 全站 Feed（`community_posts` + API）· 桌面 **flex 多列**瀑布流 |
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 **GrsAI**；含 **仓库/社区** Feed |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-05）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建号 **`20260604a`**（以 `window.__APP_BUILD__` 为准；`deploy-pages.ps1` 自动 bump） |
| **已修（20260604a）** | 我的主页 flex 多列（孤儿卡进列 + `repairCreationsFeedLayout`）；主页列数独立 `promptrepo_myhome_columns`；社区去掉图片加载全墙重平衡（防晃眼）；任务「累计 10 项 → 1 天专业版」 |
| **已修（20260605b）** | 生图滚动条统一；Tab「获取」；卡片库侧栏图随滚；基础/标准会员去边框 |
| **已修（社区）** | flex append 最短列；`fromImage` no-op；禁止 `forceReflow` 全墙重分 |
| **已修（媒体）** | `media/sign` 401 → 会话刷新 + 暂停签名风暴 |

### 已知问题（优先）

1. **P0 数据**：卡片库公开数与社区帖 gap → `inspectCardLibraryPublishGap` / 分批 sync。
2. **日光可读性**：待做「设置里界面大小」三档（`LIGHT-THEME-UX.md`）。
3. **网络**：媒体 `ERR_CONNECTION_RESET`；Supabase 配额紧张。

### 下一步

1. 强刷验 **`20260604a`**：我的主页应多列小卡，非整宽巨图；社区滚到底加载时不应整页乱跳。
2. 任务「累计 10 项」需 Worker 部署 `membership-tasks.ts` 后生效。
3. tombstone 见 `scripts/audit-tombstone-storage.ps1`；勿自动幽灵 purge。

### 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

### 测试账号

- 邮箱 `2705367723@qq.com`
- `author_id`：`ab5c77dc-570e-4af7-ac38-2d311be96244`

---

## 新对话提示词（复制整段）

```text
项目：Prompt Hub（d:\prompt-hub），Pages https://prompt-hub.cn，API https://api.prompt-hub.cn。

必读：docs/AI-PITFALLS.md、docs/CURRENT-ISSUES.md、docs/AI-HANDOFF.md、docs/COMMUNITY-ARCHITECTURE.md。

社区 Feed 为桌面 flex 多列：禁止 flatten 后全量重分、禁止 finishCardMediaShine 触发全墙 layout。
改 features-draft.js 后检查勿重复 const 声明（曾导致整站白屏）。

P0 带宽：生图仓库视口懒加载、列表仅 grid。修完 deploy-pages.ps1。用户小白，简体中文分步。勿提交密钥。
```
