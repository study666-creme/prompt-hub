# 错误日志（防重复踩坑）

> 与 **`docs/AI-PITFALLS.md`** 互补：PITFALLS = 改代码前禁止项；本页 = **已发生过**的事故（含绕了很久的、高频复发的）。  
> 新事故：先记本页一条，再把可复用规则补进 PITFALLS。

**图例**：🔴 致命/整站 · 🟠 高频 · 🟡 难查/绕很久 · 🔵 运维/SEO/误解

---

## 索引（按频率/危害）

| 标签 | 主题 | 跳转到 |
|------|------|--------|
| 🔴 | 整站白屏 `features-draft.js` 语法 | [§1](#1-整站白屏重复-const-声明) |
| 🟠 | 社区 flex 布局晃、乱飞、巨图 | [§2](#2-社区--我的主页-feed-布局高频) |
| 🟠 | 我的主页侧栏空白 | [§2.7](#27-我的主页侧栏空白桌面端) |
| 🟠 | 卡片库/社区黑图、401、429 签名风暴 | [§3](#3-媒体签名与黑图高频) |
| 🟠 | 生图仓库一进页几十～上百 MB | [§4](#4-生图仓库带宽-p0-未完全解决) |
| 🟡 | API 522、域名 DNS 冲突 | [§5](#5-api-522--自定义域名) |
| 🟡 | 批量删除遮罩不消失、旧图残留 | [§6](#6-前端交互与状态) |
| 🟡 | 换号串号、公开数≠社区帖、误删卡 | [§7](#7-数据同步与账号) |
| 🔵 | 未部署就测、构建号/SW 缓存 | [§8](#8-部署与缓存) |
| 🔵 | 搜索只有 Edge 能搜到、无站标 | [§9](#9-seo--搜索引擎误解) |
| 🔵 | Google 搜「提示词仓库」没有本站 | [§9](#93-google-泛词无排名--正常) · **`docs/GOOGLE-SEARCH-CONSOLE-BEGINNER.md`** |

---

## 1. 整站白屏（重复 const 声明）

| 项 | 内容 |
|----|------|
| **标签** | 🔴 致命 |
| **现象** | 社区/主页/生图全空，背景动效也停；Console：`Identifier 'colsChanged' has already been declared` |
| **根因** | 同一函数内两次 `const colsChanged` → **整份 `features-draft.js` 解析失败**，后面 `script.js` 等照常加载但 FeatureDraft 不存在 |
| **修复** | 合并为 `measuredColsChanged` / `colsChanged` 等不同名 |
| **勿再犯** | 改 `layoutCommunityMasonry` 等长函数后，保存即搜 `const colsChanged` 出现次数；本地打开站点看 Console **无 SyntaxError** 再部署 |

---

## 2. 社区 / 我的主页 Feed 布局（高频）

### 2.1 每次 append 清空所有列再重分

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 |
| **现象** | 滚到底加载、点卡片后白骨架插入、已看图乱飞 |
| **根因** | `distributeCommunityFeedColumns` 在 `newCards && orphanCards>0` 时误把「本批新卡」当 broken，**清空所有列** round-robin |
| **修复** | 仅当 orphan 含「非本批新卡」才全量重分；正常 append 只 `newCards → 最短列` |

### 2.2 有列仍 flatten / finishBatch 全墙重排

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 |
| **现象** | 分页、hydrate、点侧栏时整墙抖 |
| **根因** | `feedDistributed===1` 仍 `flatten`；`finishCommunityFeedLayoutAfterBatch` 总是 `force layout` |
| **修复** | 已 distributed 时 early return，只维护哨兵；开侧栏**不** `scheduleCommunityLayout` |

### 2.3 图片 onload / drain 触发全墙 DOM 重分（社区晃眼）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 社区 Feed 图片「疯狂乱跳」；每张图加载或分页 drain 后整墙重排 |
| **根因** | `finishCardMediaShine` → `scheduleCommunityFeedHeightBalance` → `redistributeCommunityFeedByHeight`；`drainCommunityFeedPages` 结束调 `repairCommunityFeedLayout`（列高差 >240px 即全墙清空重分） |
| **修复** | 禁用 `scheduleCommunityFeedHeightBalance`（no-op）；`finishCommunityFeedLayoutAfterBatch` 不再调度；drain 结束只 `ensureCommunityFeedColumnLayout`（仅孤儿进列）；间距靠 CSS `aspect-ratio` + `media-revealed` 收拢 |
| **构建** | `20260604d` |
| **验收（控制台）** | 滚社区并等图加载，运行 `window.__PH_FEED_BULK_DRAIN__` 应为 `undefined`；观察卡片 `dataset.postId` 不应批量变化：`[...document.querySelectorAll('#communityGrid .community-feed-col .card')].slice(0,5).map(c=>c.dataset.postId)` 前后对比 |

### 2.4 我的主页一张巨图（列在但 Masonry 叠卡）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 控制台 3 列、orphan=0，但 UI 仍像一张铺满整行的模糊大图 |
| **根因** | 卡已在 `.community-feed-col` 内，但 **Masonry 遗留** `position:absolute` + `left/top/width` 未清，多卡叠在同一坐标；非「孤儿直层」为主因 |
| **修复** | `clearCommunityFeedCardInline` 进列/重分时清除 inline；`repairCommunityFeedLayout` 仅处理孤儿+清列内 inline，**不再**按列高全墙重分；`#pageCreations` / flex 列 CSS 强制 `position:relative` |
| **构建** | `20260604d`（仍可能复现 → 见 **2.6 待验收**） |
| **验收（控制台）** | `document.querySelectorAll('#creationsGrid > .card').length` → **0**；`[...document.querySelectorAll('#creationsGrid .community-feed-col')].map(c=>({n:c.children.length, cards:[...c.querySelectorAll('.card')].slice(0,2).map(x=>getComputedStyle(x).position)}))` → 每列 `position` 应为 `relative` |

### 2.6 社区同列上下间距不齐（架构差异 · 未解决 · 暂停改动）

| 项 | 内容 |
|----|------|
| **状态** | ⏳ **未解决**；2026-06-05 起**暂停继续改间距**（一有缝就容易出现同列松紧不一，怀疑底层架构问题） |
| **现象** | 社区 Feed 同列有的贴死、有的空一大块；卡片库从未出现；多轮 Masonry / flex / gutter / margin 仍难与卡片库一致 |
| **架构差异（卡片库 vs 社区）** | **卡片库**：`#cardsContainer` + Masonry；`gutter` **只管列间距**；**上下靠 `margin-bottom: --card-row-gap`**；图 `onload` → `scheduleWarehouseMasonryLayout()`。**社区/我的主页**：共用 `layoutCommunityMasonry`，曾把 `.masonry-ready` 的 `margin-bottom` 置 0「只靠 gutter」→ **上下会贴死**（vendor 里 `gutter` 不进 `colYs` 纵向累加）。另有 `getCommunityFeedMeasureInnerWidth` 的 `layoutMax` clamp、列宽按 12px 算而 gutter 16px → **只排出 3 列、右侧留白**。 |
| **实验过程（关键点，勿当已修）** | ① flex 最短列 + 禁全墙重分 ② 改 Masonry + `scheduleFeedMasonryRelayout` + 加载态 72px 占位 ③ `colGap`/`gutter` 统一 16、`getCommunityFeedLayoutWidth` ④ 恢复 `margin-bottom` 后社区仍可能列内不齐 ⑤ 用户反馈：**有缝就会有上下间距差距** → 停止继续调 |
| **涉及** | `features-draft.js`、`styles.css`、`script.js` |
| **后续若再开** | 先对比 `outerHeight`/`margin-bottom`/`is-loading` 占位与卡片库单卡 DOM；勿只改 CSS 变量 |

### 2.8 我的主页作品区收成「一条缝」可滚动（桌面）

| 项 | 内容 |
|----|------|
| **现象** | 「发布作品」Tab 下仅顶部窄条能看到图，条内滚动；下方大片空白网格底 |
| **根因** | `#creationsGrid` 与社区共用规则：`flex: 1 1 0` + `overflow-y: auto`，在 `.feature-body-cards { min-height:0; overflow:hidden }` 链里被压成固定视口高；Masonry 绝对定位内容溢出后在**网格自身**里滚，外壳下方空 |
| **与社区联动** | 共用 `renderPostsIntoContainer` / `layoutCommunityMasonry`；社区改 Masonry 会波及我的主页。曾把 `masonry-ready` 当「已排版」→ **feedSig 未变时跳过修复**，一条缝被缓存 |
| **修复尝试** | ① CSS flex:none ② 我的主页改 flex 多列 ③ `isCreationsFeedLayoutStale` + `repairCreationsFeedLayout` 进页/渲染时强制清 Masonry 残留 |
| **涉及** | `styles.css`、`styles-features.css`、`features-draft.js`（layout 后清 `max-height`） |

### 2.7 我的主页侧栏空白（桌面端）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 点「发布作品」卡片后主区左移约 340px，右侧大片空白，无「作品详情」侧栏；社区页侧栏正常 |
| **根因** | 桌面「我的主页」用可滚动 `.my-home-shell`，`#creationsSidePanel` dock 在 `.community-workspace` flex 行内，被祖先 `overflow: hidden/auto` 裁切或挤出视口；`body.community-panel-open` 只缩主区 `max-width: calc(100% - 340px)`，**留白有了、面板不可见** |
| **排查过程（关键点）** | ① 用户 build `20260605a` 仍有 `.selected` + 右侧空白 → 布局 class 生效、面板未渲染 ② 社区页 workspace 填满视口，主页纵向滚动链不同 ③ 本地测：panel dock 后 `panelRight` ~500 非视口右缘，说明主页 workspace 非全宽 ④ `ensureFeatureSidePanelDocked` 桌面会 `unmountFeatureSidePanel` 挂回 workspace，无法脱离裁剪链 |
| **修复（`20260605b`）** | `shouldMountCreationsPanelOnRoot()`：桌面且 `#pageCreations.active` 时，侧栏挂 `.app-chrome`（移动仍挂 `body`）；CSS `[data-mounted-on-body="1"]` + `position:fixed` 右栏 340px；`syncCreationsSidePanelMount()` 在 open/close/resize 同步；社区 `#communitySidePanel` 仍 workspace dock |
| **涉及文件** | `features-draft.js`（`openPostSidePanel`、`syncCreationsSidePanelMount`）、`styles-features.css` |
| **验收** | 强刷 `window.__APP_BUILD__ === '20260605b'` → 我的主页点卡 → 右侧「作品详情」+ 正文；社区侧栏行为不变 |

### 2.5 其它布局坑（简表）

| 现象 | 根因要点 |
|------|----------|
| 侧栏开整墙重排 | 宽度变窄触发 `recalcCols` + flatten → 列数不变只改 CSS 变量 |
| 切回社区一排白骨架 | `showCommunityFeedSkeleton` 盖住已有 Feed → 有真卡勿 `innerHTML` 骨架 |
| 首屏 400+ 卡卡顿 | `drainUntilDone` 灌满 DOM → 首屏只 drain 约 5 页，其余靠哨兵 |
| 用 grid 自身宽度算列数 | 侧栏开合误判 1 列 → 用 `.community-page-main` / `.community-workspace` 量宽 |

---

## 3. 媒体签名与黑图（高频）

| 现象 | 根因 | 正确做法 |
|------|------|----------|
| 卡片库全黑 + Console 401 | JWT 过期仍疯狂 `media/sign` | 401 → 刷新会话 + 暂停签名 + 提示重登 |
| 社区白卡、Network 上千条红 | `sign-batch` 并发过高、429 仍重试 | 串行队列 + 冷却；prefetch debounce |
| 部分图永不加载 | `SIGN_BUDGET_MAX` 过小 + 卡太多 | 批量 `sign-batch`，提高预算，勿每张单独 sign |
| `posts/sync` 400/超时 | 一次 80+ 条 | `COMMUNITY_SYNC_BATCH_MAX = 80` 分批 |
| 过早删 Feed 空壳卡 | `pruneEmpty` 在 loading 时删卡 | 仅确认 load-failed 后删 |

---

## 4. 生图仓库带宽（P0，未完全解决）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 图片生成 → 子 Tab「仓库」：Network 已传输 **几十～150+ MB**；大量 404/500 后才开始下 2～3 MB/张原图 |
| **根因** | `#imageGenFeed` 未接视口懒加载；`hydrateFeedImages` + `warehouseBoost` 对**全部** img 签名；grid miss 回退 **full** |
| **目标** | 列表仅 `_grid`；视口内才加载；灯箱/下载才 full |
| **详见** | `docs/CURRENT-ISSUES.md` P0-带宽、`docs/CARD-LOADING.md` |

---

## 5. API 522 / 自定义域名

| 项 | 内容 |
|----|------|
| **标签** | 🟡 绕很久（运维） |
| **现象** | `api.prompt-hub.cn` /health 522；前端「暂时无法连接」 |
| **根因** | DNS 里 `api` 的 A/CNAME 与 Worker Custom Domain **冲突**；或域名填成 `api.prompt-hub.cn.prompt-hub.cn` |
| **修复** | 删冲突 DNS；Workers 只绑 `api.prompt-hub.cn`；见 **`docs/FIX-API-522-BEGINNER.md`** |
| **勿再犯** | 改 API 域名后同时查 **DNS Records** 与 **Workers Domains** 两处 |

---

## 6. 前端交互与状态

| 现象 | 根因 | 修复要点 |
|------|------|----------|
| 批量删 N 张后遮罩不消失 | `showBatchProgress` 用计数 +1/-1 错乱 | 改 `batchProgressVisible` 布尔 |
| 切换卡片/生图预览旧图残留 | 异步预览未校验序号 | `panelPreviewSeq` / `imageGenPreviewRenderSeq` |
| 下载错成侧栏选中卡 | 灯箱未绑当前 `cardId`/`postId` | 传上下文 id |
| 列数刷新丢失 | 启动未 `restoreDesktopCardColumns` | `finishAppBootstrap` 恢复 + 写 localStorage |

---

## 7. 数据同步与账号

| 现象 | 说明 |
|------|------|
| 卡片库总数 ≠ 已勾选公开数 | 用 `inspectCardLibraryPublishGap` / 分批 sync，**禁止**盲目全量「与云端对齐」 |
| 换号后社区显示别人作品 | `author_id` 串号 → 换号清 Feed 缓存、对齐 author |
| 自动幽灵 purge | 曾大量丢卡 → **禁止**未经用户确认的全量删除 |
| 兑换会员模式不对 | 须 Worker 部署 `redeem.ts` + 前端读 `creditGrantMode` |

---

## 8. 部署与缓存

| 现象 | 根因 | 做法 |
|------|------|------|
| 用户说修了但仍是旧 UI | 未 `deploy-pages.ps1` 或未强刷 | bump `__APP_BUILD__` → 部署 → 用户 **Ctrl+Shift+R** 看 `window.__APP_BUILD__` |
| 构建号变了仍像旧版 | Service Worker / 浏览器缓存 | 首页脚本会 purge SW；仍不行则 DevTools 清站点数据 |
| 只改了 Worker 未部署 | 任务/兑换/签名在后端 | `cd server` → `npm run deploy` |

---

## 9. SEO / 搜索引擎（误解）

### 9.1 只有电脑 Edge 能搜到，手机/别的浏览器搜不到

| 项 | 内容 |
|----|------|
| **标签** | 🔵 误解（不是代码 bug） |
| **现象** | 仅 Edge 地址栏/必应能搜到 `prompt-hub.cn`；手机百度 App、别的电脑没有 |
| **原因** | ① 各引擎索引**不同步**（百度提交了 ≠ 必应/搜狗/手机百度都有）② Edge 国内默认**必应**，你提交的多半是**百度站长** ③ **个性化**：Edge 可能合并了历史访问、收藏，看起来像「搜得到」④ 新站排名不稳，同一关键词不同设备/地区结果不同 ⑤ 搜的词不一致（「提示词仓库」vs「Prompt Hub」） |
| **建议** | 百度站长持续提交 sitemap + 抓取首页；必应 [Webmaster](https://www.bing.com/webmasters)；用**无痕窗口**多引擎试同一关键词；等 2～4 周，不要每天改 title |
| **详见** | **`docs/SEO-SEARCH-ENGINES.md`** |

### 9.2 搜索结果灰色地球、无站标

| 项 | 内容 |
|----|------|
| **标签** | 🔵 SEO |
| **现象** | 百度/必应左侧无 logo，像「野鸡站」 |
| **根因** | 引擎优先抓 `https://prompt-hub.cn/favicon.ico`；仅 `assets/logo.png` 或 rel 相对路径不够；收录后图标还要 **几天～几周** 才更新 |
| **修复** | 根目录 `favicon.ico` + `assets/favicon-16/48.png` + 首页绝对路径 `link rel="icon"` + 部署后站长平台「重新抓取」 |

### 9.3 搜索结果多条、下面还有知乎/GitHub

| 项 | 内容 |
|----|------|
| **说明** | 同名 GitHub 开源项目、知乎文章是**别的 URL**，无法删除；只能做品牌词 SEO + 外链。知乎子卡片是大站**富摘要**，新站短期难复制。 |

### 9.4 Google 泛词无排名（正常）

| 项 | 内容 |
|----|------|
| **标签** | 🔵 误解 |
| **现象** | Google 搜「提示词仓库」只有 GitHub、AiShort、DeepSeek，没有 prompt-hub.cn |
| **原因** | ① 未在 Search Console 验证/提交 sitemap ② Google 尚未收录 ③ 泛词竞争极强，新站权重低 ④ 应用 `site:prompt-hub.cn` 判断收录，不要用泛词判断 |
| **做法** | 按 **`docs/GOOGLE-SEARCH-CONSOLE-BEGINNER.md`** 验证 → 提交 `sitemap.xml` → 请求编入首页 → 等 1～4 周；同时做品牌词外链 |
| **勿再犯** | 不要指望「提交当天泛词前排」；优先验收 `site:prompt-hub.cn` 和「Prompt Hub 提示词仓库」 |

---


## 10. 改代码前 30 秒自检

1. `features-draft.js` 无重复 `const` / SyntaxError。  
2. 社区改动：搜 `flattenCommunityFeedColumns`、`forceReflow`、`fromImage`。  
3. 主页：`#creationsGrid > .card` 孤儿数为 0。  
4. 部署后 `window.__APP_BUILD__` 与 `index.html` 一致。  
5. `https://prompt-hub.cn/favicon.ico` 返回 200。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| `docs/AI-PITFALLS.md` | 禁止项清单 |
| `docs/COMMUNITY-LAYOUT-FIX.md` | 社区布局时间线 |
| `docs/CURRENT-ISSUES.md` | 当前 P0（带宽等） |
| `docs/SEO-SEARCH-ENGINES.md` | 收录、图标、Google |
| `docs/FIX-API-522-BEGINNER.md` | API 522 |
| `docs/CARD-LOADING.md` | 列表图加载管线 |
