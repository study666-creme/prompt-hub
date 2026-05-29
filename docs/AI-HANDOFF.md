# AI 接手说明（省 Token）

> **目标**：用最少阅读量定位问题、做最小 diff。用户是纯小白，回复用简体中文 + 分步命令。

---

## 第 0 步：只读这 3 个文件（按顺序）

| 顺序 | 文件 | 用途 |
|------|------|------|
| 1 | **`docs/CURRENT-ISSUES.md`** | **当前 P0 故障**、已试方向、控制台验证命令 |
| 2 | **`docs/PROJECT_CONTEXT.md`** | 产品是什么、部署地址、构建号、约定 |
| 3 | **`docs/FILE-MAP.md`** | 按任务找函数，**禁止**无目的全仓 `grep` |

社区 Bug → 再读 **`docs/COMMUNITY-ARCHITECTURE.md`** 一节即可，不要通读。

云同步 / 登录 → 再读 **`docs/AUTH-AND-SYNC.md`** 相关小节。

---

## 第 1 步：用 Grep 定点，不要整文件读

| 要找什么 | 先搜（`features-draft.js` unless noted） |
|----------|---------------------------------------------|
| 社区列表从哪来 | `getCommunityFeedForDisplay`, `getAllCommunityPosts`, `publicFeedPosts` |
| **单卡发布开关 UI** | `setPublishCheckbox`, `readPublishCheckbox`, `cardPublishSessionOverride`, `syncCardPublishFromPrompt` |
| **publishedToCommunity 持久化** | `mergePublishFlag`, `mergeCardPair`（`cloud-sync-safety.js`）, `getDataPayload`（`script.js`） |
| 发布/下架 | `syncCardToCommunity`, `reconcileCommunityWithCards`, `ownPostAllowedInFeed` |
| **性能 / 慢加载** | `unpublishGhostCommunityPosts`（`community-feed.ts`）, `prefetchCommunityDisplayUrls`, `hydrateWarehouseImagesFast` |
| 社区通知 | `pushCommunityEvent`, `refreshRemoteNotifications`, `community-notify.ts` |
| 任务中心 | `membership-tasks.ts`, `trial-tasks.js` |
| 云上传超时 | `pushToCloud`, `scheduleCloudPush`（`script.js`） |
| 全站 API | `refreshPublicCommunityFeed`（前端）, `listPublicCommunityFeed`（`server/`） |

一次任务：**最多精读 2～4 个函数**，改前先读函数体 ±30 行上下文。

---

## 第 2 步：动手前在浏览器验证（让用户跑或自己 curl）

```javascript
// 登录后 F12 Console
window.__APP_BUILD__                                    // 应与左下角一致，当前 20260616f
await window.PromptHubApi.getCommunityFeed({ limit: 80 }) // posts.length、是否含他人 authorId
window.__promptHubCards.filter(c => c.publishedToCommunity) // 应与卡片库开关一致（用户反馈目前不一致）
console.time('feed'); await window.PromptHubApi.getCommunityFeed({ limit: 20 }); console.timeEnd('feed')
```

**用户 2026-05-29 实测**：他人配图偶现后刷新像没图 → **先量 Feed/sign 耗时、等 30s 不刷新**，再判过滤 Bug。

```text
https://api.prompt-hub.cn/health
https://api.prompt-hub.cn/api/v1/community/feed?limit=80
```

对比：**API 条数** vs **页面实际条数** → 区分后端问题还是 `features-draft.js` 展示/过滤问题。

---

## 测试账号（用户大号）

| 项 | 值 |
|----|-----|
| 邮箱 | `2705367723@qq.com` |
| `author_id` / `user_id` | `ab5c77dc-570e-4af7-ac38-2d311be96244` |

---

## 省 Token 的改代码原则

1. **最小 diff**：只改与 P0 相关的函数，不顺手重构。
2. **P0 顺序（2026-05-29）**：① 单卡 `publishedToCommunity` 与开关 UI / 云端 ② Feed 与图片签名性能。
3. **先证实根因再改**：20260615j～o 用户称多数未达预期；勿重复大块社区改动。
4. **不要**让用户只靠清 `localStorage` 当最终方案（云端 `user_data` 会拉回）。
4. **不要**未验证就叠新功能；**不要**通读 `script.js`（5000+ 行）。
5. 改静态资源：bump `index.html` 的 `__APP_BUILD__` + `sw.js` 的 `CACHE`。
6. 仅用户明确要求时 `git commit`；**勿提交** `.env`、密钥。

---

## 部署（给用户复制）

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

Worker 有改动时：

```powershell
cd d:\prompt-hub\server
npm run deploy
```

浏览器：Ctrl+Shift+R；仍异常 → F12 → Application → Service Workers → Unregister → 再强刷。

---

## 给下一位 AI 的复制提示词

见 **`docs/PROJECT_CONTEXT.md` 底部「新对话提示词」** 或直接把下面框内全文贴进新聊天。

---

*最后更新：2026-05-29*
