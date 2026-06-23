# AI 踩坑清单（必读，避免重复炸站）

> **用途**：记录已踩过的致命/难查问题。改 `features-draft.js` / 社区 Feed / 媒体签名前**先扫本页**。  
> 最后更新：**2026-06-07** · Pages 构建号 **`20260623b`**

---

## 致命（一条就能整站白屏）

| 坑 | 现象 | 根因 | 禁止 |
|----|------|------|------|
| **重复 `const` 声明** | 社区/主页/生图全空，背景动效也停；Console：`Identifier 'colsChanged' has already been declared` | 同一函数内两次 `const colsChanged` → **整份 `features-draft.js` 解析失败**，后续脚本全不执行 | 改 `layoutCommunityMasonry` 等长函数时，合并变量名或改名（如 `measuredColsChanged` / `colsChanged`） |
| **bundle 放 `/dist/` 未 HTTP 验** | 卡片库只剩文字、全站无图；`MediaPipeline` 等为 false，Console 常无 SyntaxError | Cloudflare Pages SPA 把 `/dist/*.js` 回退成 `index.html`；VM 冒烟读本地文件发现不了 | bundle 输出到**根目录** `*.bundle.js`；部署后必须 `run-index-http-smoke.mjs` 验 Content-Type |
| **未部署就让用户测** | 用户仍见旧 bug | 只改本地未 `deploy-pages.ps1` | 改静态资源后必须 bump `__APP_BUILD__` + 部署，让用户 `Ctrl+Shift+R` 看 `window.__APP_BUILD__` |

---

## 社区 Feed 布局（flex 多列，桌面）

| 坑 | 现象 | 根因 | 正确做法 |
|----|------|------|----------|
| **每次 append 清空列** | 滚到底或点卡片后，白骨架卡插入、已加载图乱飞 | `distributeCommunityFeedColumns` 在 `newCards && orphanCards>0` 时**清空所有列再 round-robin** | 仅当 orphan 含「非本批新卡」时才全量重分；正常 append 只 `newCards → 最短列` |
| **`layoutCommunityMasonry` 先 flatten** | 持续晃动、停不下来 | 有 `.community-feed-col` 时仍 `flattenCommunityFeedColumns` 再分配 | `feedDistributed===1` 且无 `recalcCols/forceReflow/newCards` 时 **early return** |
| **`finishCommunityFeedLayoutAfterBatch` 全墙重排** | 分页/ hydrate 时整墙抖 | 每次都 `scheduleCommunityLayout({ force, immediate })` | 已 distributed 时只 `ensureFeedPageSentinel` + `reconnectFeedPageObserver` |
| **`hydrateFeedImages` 调 layout** | 后台补图时卡片跳 | `hydrateFeedImages` 末尾 `layoutCommunityMasonry` | 社区 Feed 的 hydrate **禁止**触发全墙 layout；用 `CardImageLoader.observeContainer` |
| **`finishCardMediaShine` 触发 Masonry** | 每张图加载完都晃 | `scheduleCommunityLayout({ fromImage:true })` on flex 列 | **flex 多列模式**下 `fromImage` 必须 **no-op**（`scheduleCommunityLayout` 内 return） |
| **`scheduleCommunityFeedHeightBalance`** | 新图加载后整页卡片乱跳 | onload / drain → `redistributeCommunityFeedByHeight` 清空列重分 | **禁止**（`20260604d` 已 no-op）；间距靠 CSS `aspect-ratio` |
| **`ensureCommunityFeedColumnLayout` 早退** | **我的主页**一张巨图占满宽 | 卡已在列内但 **Masonry 遗留 absolute/width** 叠成一张；或直层 orphan | 进列时 `clearCommunityFeedCardInline`；有 orphan 才 `distribute`；CSS 强制列内 `position:relative` |
| **我的主页列数跟社区 storage** | 社区设 1 列时主页也塌成单列 | `creationsGrid` 误用 `promptrepo_community_columns` | 主页用 **`promptrepo_myhome_columns`**（默认 3），`getCreationsFeedColumns()` 独立计算 |
| **首屏 `drainUntilDone`** | 卡顿、DOM 400+ | 首屏把 store 全部灌进 DOM | 首屏只 `drainCommunityFeedPages(5)`，其余靠哨兵滚动 |
| **侧栏打开 `recalcCols`** | 点卡片整墙重排 | 宽度变窄触发 `recalcCols:true` + flatten | 列数不变时只 `applyCommunityFeedColumnCss`，**不动卡片 DOM** |
| **点卡片 `scheduleCommunityLayout`** | 点击即乱 | `openPostSidePanel` 里 force layout | 开侧栏**只加 selected class**，保留 `scrollTop` |
| **`showCommunityFeedSkeleton` 盖掉已有 Feed** | 切回社区出现一排白卡 | `onAppChange` 不判断已有 `.community-post-card` | 已有真实卡时**不要** `innerHTML` 骨架 |

---

## 生图任务 / 生图 Feed

| 坑 | 现象 | 根因 | 正确做法 |
|----|------|------|----------|
| **仅 sessionStorage 存 pending** | 手机切后台/重载后丢图 | iOS 等会清 session；回前台只在生图页才 resume | `localStorage` 备份 + `pagehide` 持久化；`visibilitychange` 任意页 `resumePendingGenerationJobs({ force:true })` |
| **failed 空错误当可恢复** | 一直「恢复中」不标失败 | `isLikelyRecoverableGenFailure('')` 曾为 true | API 已 `failed` 且非明确可恢复 → **12 分钟内** `failPendingJob` |
| **生图 Feed 跳过整页刷新** | 成功仍显示「生成中」 | `warehouseCardsListUnchanged` 只 patch pending | 完成/失败/进生图页用 `renderImageGenFeed({ force:true })` |
| **等 prefetch 再 hydrate** | 生图页首开全黑卡、比社区慢 | `await prefetchList` 挡住 `observeContainer` | `innerHTML` 后立刻 `patchContainerFromCache` + `boostImageGenWarehouseImages` |

---

## 媒体签名 / 卡片库黑图

| 坑 | 现象 | 根因 | 正确做法 |
|----|------|------|----------|
| **`media/sign` 401** | 卡片库全黑、Console 一片 401 | JWT 过期仍疯狂请求 sign | `api-client` 401 → `ensureApiAuthFresh` + 暂停签名 + `ph-api-unauthorized` 提示**重新登录** |
| **`posts/sync` 一次 80+ 条** | 400 / 超时 | 服务端 `max(80)` | `COMMUNITY_SYNC_BATCH_MAX = 80` 分批 |
| **签名预算过小** | 部分图永不加载 | `SIGN_BUDGET_MAX=64` + 212 张卡 | 已提到 120；勿在循环里每张单独 sign，优先 `sign-batch` |
| **`community/sign-batch` 429/503** | 社区白卡、Network 上千条红 | 滚动/append/`observeContainer` 并发 batch；Worker 曾 **120/min**；429 还重试 4 次 | `runCommunitySignBatchQueued` 串行+700ms；429/503 冷却；prefetch debounce；Worker **300/min** |

---

## 数据 / 同步（勿再犯）

| 坑 | 说明 |
|----|------|
| **侧栏「全部」≠ 公开数** | 212 总卡 vs 140 `publishedToCommunity`；需 `inspectCardLibraryPublishGap` / `markAllEligibleCardsPublished` |
| **自动幽灵 purge / 盲目云端对齐** | 用户曾大量丢卡；**禁止**未经确认的全量删除或「与云端对齐」补传 |
| **`pruneEmptyCommunityFeedCards` 过早** | 图仍 loading 时删卡 → domUnique 从 410 掉到 ~200 |

---

## 改代码自检（30 秒）

1. 保存后本地搜：`const colsChanged` 是否在同一函数出现两次。  
2. 社区改动：搜 `flattenCommunityFeedColumns`、`finishCommunityFeedLayoutAfterBatch`、`fromImage`。  
3. 部署后：`window.__APP_BUILD__` 与 `index.html` 一致；`run-index-http-smoke.mjs` 三个 bundle 须为 JS。  
4. 生图改动：手机提交 → 切后台 → 回来占位应自动变图或标失败。  
5. Console 无红色 SyntaxError 再让用户验收。

---

## 相关文档

- **`docs/ERROR-LOG.md`** — 历史事故与高频坑（含 SEO「仅 Edge 能搜到」）  
- `docs/SEO-SEARCH-ENGINES.md` — 收录、站标、Google/百度分工  
- `docs/COMMUNITY-ARCHITECTURE.md` — Feed 数据流与分页  
- `docs/CARD-LOADING.md` — 列表 grid / 签名管线  
- `docs/LIGHT-THEME-UX.md` — 日光模式可读性优化方向  
- `docs/PROJECT_CONTEXT.md` — 部署阶段与构建号  
