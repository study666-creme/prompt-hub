# Prompt Hub — 项目上下文（给 AI / 新对话用）

> **新聊天**：先读 **`docs/AI-PITFALLS.md`**（防炸站）→ **`docs/CURRENT-ISSUES.md`（P0-带宽）** → **`docs/AI-HANDOFF.md`**。  
> 默认中文；**P0 拉满算力**见 `docs/AI-WORK-MODE.md`；勿提交密钥。用户是纯小白 → 分步 + 可复制命令。

---

## 产品是什么

**提示词仓库（Prompt Hub）**：纯前端 SPA + Cloudflare Workers API + Supabase。

| 模块 | 说明 |
|------|------|
| **卡片库** | 提示词卡片、分组、Masonry、批量操作（含批量开/关社区公开） |
| **提示词社区** | 全站 Feed（`community_posts` + API）· 桌面 **Masonry** 瀑布流 |
| **我的主页** | 发布作品、关注/粉丝、拥有的/发布的资产包 |
| **图片生成** | 扣积分；`POST /api/v1/generate`；上游 **GrsAI**；含 **仓库/社区** Feed |
| **资产包** | 领取存入「拥有」、封面预览、选择性导入、大图下载 |

部署：**Pages** https://prompt-hub.cn · **API** https://api.prompt-hub.cn · Worker 名 `prompt-hub-api`

---

## 当前部署阶段（2026-06-05）

| 项 | 状态 |
|----|------|
| Worker | `prompt-hub-api` · API https://api.prompt-hub.cn |
| Pages | https://prompt-hub.cn · 构建号 `window.__APP_BUILD__` |
| **已修** | 我的主页 `#creationsGrid` flex 多列 + 整页滚动（非条缝内滚） |
| **架构** | Feed 排版在 `feed-layout.js`；`wireFeedLayout()` 于脚本解析时初始化；`forceRefreshAllImages` 已并入 `features-draft.js` |
| **部分改善** | 社区 Masonry 同列间距大体稳定；加载阶段偶发不齐，等图或点卡开侧栏多能恢复（§2.6，暂不改） |
| **已打通** | `/health`、兑换、生图、社区 Feed、我的主页侧栏 |

### 已知问题（优先）

1. **社区 Masonry 间距**：加载阶段偶发，可等待或点卡触发重排；架构层暂不再改（§2.6）。
2. **P0 数据**：卡片库公开数与社区帖 gap。
3. **日光可读性**：界面大小三档（`LIGHT-THEME-UX.md`）。

### 下一步

1. 强刷后验收：`FeedLayout.diagnose('creationsGrid')`（flex）与社区 Masonry 视觉。
2. Worker：`membership-tasks.ts`（累计 10 项任务）。
3. tombstone：`scripts/audit-tombstone-storage.ps1`。

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

社区 Feed 桌面为 **Masonry**（`#communityGrid`）；我的主页为 **flex 多列**（`#creationsGrid`）。禁止 finishCardMediaShine 触发全墙 flex 重分。
改 features-draft.js 后检查勿重复 const 声明（曾导致整站白屏）。

P0 带宽：生图仓库视口懒加载、列表仅 grid。修完 deploy-pages.ps1。用户小白，简体中文分步。勿提交密钥。
```
