# AI 接手说明（省 Token）

> **目标**：用最少阅读量定位问题、做最小 diff。用户是纯小白，回复用简体中文 + 分步命令。

---

## 第 0 步：只读这 5 个文件（按顺序）

| 顺序 | 文件 | 用途 |
|------|------|------|
| 0 | **`docs/AI-PITFALLS.md`** + **`docs/ERROR-LOG.md`** | **防炸站** + 历史高频坑 |
| 1 | **`docs/CURRENT-ISSUES.md`** | P0-带宽（**部分改善**）、数据 gap |
| 2 | **`docs/FEED-MODULES.md`** + **`docs/FEED-LAYOUT.md`** | Feed 四模块 + 排版调试 |
| 3 | **`docs/PROJECT_CONTEXT.md`** | 产品、部署、构建号 |
| 4 | **`docs/FILE-MAP.md`** | 按任务找函数 |

社区 Bug → **`docs/COMMUNITY-ARCHITECTURE.md`** + **`docs/AI-PITFALLS.md`** 社区章节。  
日光可读性 → **`docs/LIGHT-THEME-UX.md`**。

云同步 / 登录 → 再读 **`docs/AUTH-AND-SYNC.md`** 相关小节。

---

## 第 1 步：用 Grep 定点，不要整文件读

| 要找什么 | 先搜（`features-draft.js` unless noted） |
|----------|---------------------------------------------|
| 社区列表从哪来 | `getCommunityFeedForDisplay`, `getAllCommunityPosts`, `publicFeedPosts` |
| **单卡发布开关 UI** | `setPublishCheckbox`, `readPublishCheckbox`, `cardPublishSessionOverride`, `syncCardPublishFromPrompt` |
| **publishedToCommunity 持久化** | `mergePublishFlag`, `mergeCardPair`（`cloud-sync-safety.js`）, `getDataPayload`（`script.js`） |
| 发布/下架 | `syncCardToCommunity`, `reconcileCommunityWithCards`, `ownPostAllowedInFeed` |
| **社区侧栏空白** | `renderCommunitySidePanel`, `communitySideBody`, `openPostSidePanel` |
| **社区 Masonry（桌面）/ 我的主页 flex** | `feed-layout.js`, `FeedLayout.*`, `wireFeedLayout` | `docs/FEED-LAYOUT.md` |
| **Feed 出图 / 生图列表** | `feed-images.js`, `image-gen-feed.js`, `wireFeedImages`, `wireImageGenFeed` | `docs/FEED-MODULES.md` |
| **侧栏打开重排** | `relayoutFeedGridAfterSidePanel`, `scheduleImageGenFeedLayout({ immediate })` |
| **Mobile 断点** | `mobile.js` → `MobileUI.isMobileViewport`（须在 `script.js` 前） |
| **我的主页巨图** | `repairCreationsFeedLayout`, `getCreationsFeedColumns`, `promptrepo_myhome_columns` — 见 **`docs/ERROR-LOG.md`** |
| **社区 Masonry（手机）** | `enforceMobileCommunityFeedGrid`, `useCssGridForCommunityFeed` |
| **卡片库首屏顺序** | `renderCards`, `card-image-loader.js`, `prefetchWarehousePage`, `observeContainer` |
| **性能 / 慢加载** | `prefetchCommunityDisplayUrls`, `hydrateWarehouseImagesFast` |
| **生图仓库带宽 P0** | `hydrateFeedImages`, `applyFeedImageSrc`, `#imageGenFeed`, `warehouseBoost`（`supabase-sync.js`） |
| 社区通知 | `pushCommunityEvent`, `refreshRemoteNotifications`, `community-notify.ts` |
| 任务中心 | `membership-tasks.ts`, `trial-tasks.js` |
| 云上传超时 | `pushToCloud`, `scheduleCloudPush`（`script.js`） |
| **生图预览滚轮** | `attachImageZoom`, `bindImageGenPreviewWheelScroll`, `loadLightboxImage` |
| 全站 API | `refreshPublicCommunityFeed`（前端）, `listPublicCommunityFeed`（`server/`） |

一次任务：**最多精读 2～4 个函数**，改前先读函数体 ±30 行上下文。

---

## 第 2 步：动手前在浏览器验证（让用户跑或自己 curl）

```javascript
// 登录后 F12 Console
window.__APP_BUILD__                                    // 应与左下角一致，当前 20260605l
document.querySelectorAll('#imageGenFeed img[data-image-ref]').length
performance.getEntriesByType('resource').filter(e => e.transferSize > 500000).length  // 期望 0
!!window.FeatureDraft?.hydrateFeedImages
!!window.FeedImages?.feedImgStorageAttr
window.MobileUI?.isMobileViewport?.()
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
2. **P0 顺序（2026-06-06 更新）**：
   - ① **生图页「仓库」带宽**：视口懒加载 + 列表仅 grid，禁止首屏批量 full（见 `CURRENT-ISSUES.md` P0-带宽）
   - ② 404 / `card-images` 500 重试风暴
   - ③ 社区侧栏 / Masonry（历史项，部分已修）
   - ④ 卡片库首屏顺序（`20260603q` 已部分改 grid，需与生图 Feed 统一）
   - 详见 **`docs/CURRENT-ISSUES.md`**。
3. **先证实根因再改**：20260601l～q 布局/CSS 多轮用户仍称未解决；下次须 DevTools 断点后再最小 diff。
4. **不要**让用户只靠清 `localStorage` 当最终方案（云端 `user_data` 会拉回）。
4. **不要**未验证就叠新功能；**不要**通读 `script.js`（5000+ 行）。
5. 改静态资源：bump `index.html` 的 `__APP_BUILD__` + `sw.js` 的 `CACHE`。
6. 仅用户明确要求时 `git commit`；**勿提交** `.env`、密钥。
7. 改 `layoutCommunityMasonry` / `distributeCommunityFeedColumns` 前读 **`docs/AI-PITFALLS.md`**，改完搜 `const colsChanged` 是否重复。

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

*最后更新：2026-06-06 · 用户要求只更新文档；下条聊天修 P0-带宽*
