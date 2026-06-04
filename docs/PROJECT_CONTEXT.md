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

## 当前部署阶段（2026-06-04）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建号 **`20260604l`**（以 `window.__APP_BUILD__` 为准） |
| **已修（社区 20260604j～k）** | flex 列稳定：append 不清空重分；图片/侧栏不触发全墙 layout；修复 `colsChanged` 重复声明致整站白屏 |
| **已修（媒体）** | `media/sign` 401 → 会话刷新 + 暂停签名风暴 + 提示重登；`posts/sync` 80 条分批 |
| **已修（体验）** | 社区首屏 ~5 页；批量模式不跳顶；日光模式可读性见 `docs/LIGHT-THEME-UX.md` |

### 已知问题（优先）

1. **P0 数据**：卡片库总数 ≠ 已勾选公开数 → `inspectCardLibraryPublishGap` / `markAllEligibleCardsPublished` + 分批 sync。
2. **日光可读性**：已 `--ui-scale:0.82` + 字色加深；待做「设置里界面大小」三档（见 `LIGHT-THEME-UX.md`）。
3. **网络**：媒体 `ERR_CONNECTION_RESET`；Supabase 配额紧张。

### 下一步

1. 强刷验构建号；社区点卡片侧栏：Feed 不应乱飞、不应白屏 SyntaxError。
2. 日光模式让用户试读侧栏/奖励说明/卡片标题。
3. tombstone 见 `scripts/audit-tombstone-storage.ps1`；**勿**自动幽灵 purge。

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
