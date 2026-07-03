# 错误日志（防重复踩坑）

> 与 **`docs/AI-PITFALLS.md`** 互补：PITFALLS = 改代码前禁止项；本页 = **已发生过**的事故（含绕了很久的、高频复发的）。  
> 新事故：先记本页一条，再把可复用规则补进 PITFALLS。

**图例**：🔴 致命/整站 · 🟠 高频 · 🟡 难查/绕很久 · 🔵 运维/SEO/误解

---

## 索引（按频率/危害）

| 标签 | 主题 | 跳转到 |
|------|------|--------|
| 🔴 | 整站白屏 `features-draft.js` 语法 | [§1](#1-整站白屏重复-const-声明) |
| 🔴 | esbuild bundle 全站无图（`/dist/*.js` SPA 回退） | [§1b](#1b-esbuild-bundle-全站无图pages-spa-回退) |
| 🟠 | 社区 flex 布局晃、乱飞、巨图 | [§2](#2-社区--我的主页-feed-布局高频) |
| 🟠 | 我的主页侧栏空白 | [§2.7](#27-我的主页侧栏空白桌面端) |
| 🟠 | 手机切后台生图丢图（sessionStorage + 恢复过严） | [§3b](#3b-手机切后台生图丢图) |
| 🟠 | 卡片库/社区黑图、401、429 签名风暴 | [§3](#3-媒体签名与黑图高频) · [§3d](#3d-卡片库--最近生成灰块列表禁止-full--20260704c-修复) |
| 🟠 | 画布 `Maximum update depth`（节点缩放死循环） | [§3c](#3c-画布节点缩放死循环) |
| 🟠 | 生图仓库一进页几十～上百 MB | [§4](#4-生图仓库带宽-p0-未完全解决) |
| 🟡 | API 522、域名 DNS 冲突 | [§5](#5-api-522--自定义域名) |
| 🟡 | 批量删除遮罩不消失、旧图残留 | [§6](#6-前端交互与状态) |
| 🟡 | 换号串号、公开数≠社区帖、误删卡 | [§7](#7-数据同步与账号) |
| 🔵 | 未部署就测、构建号/SW 缓存 | [§8](#8-部署与缓存) |
| 🔵 | bundle 部署后须 HTTP 验 Content-Type | [§8](#8-部署与缓存) · [§1b](#1b-esbuild-bundle-全站无图pages-spa-回退) |
| 🔵 | 搜索只有 Edge 能搜到、无站标 | [§9](#9-seo--搜索引擎误解) |
| 🔵 | Google 搜「提示词仓库」没有本站 | [§9](#93-google-泛词无排名--正常) · **`docs/GOOGLE-SEARCH-CONSOLE-BEGINNER.md`** |

---

## 1. 整站白屏（重复 const 声明 / 拆模块未接线）

| 项 | 内容 |
|----|------|
| **标签** | 🔴 致命 |
| **现象** | 社区/主页/生图全空；Console：`Identifier 'colsChanged' has already been declared` 或 `IMG_LOADING_PLACEHOLDER is not defined` 或 `feedImgStorageAttr is not defined` |
| **根因** | ① 同一函数内重复 `const` → 整份 `features-draft.js` 解析失败 ② 拆到 `feed-images.js` 后未在 `wireFeedImages` 导出/接线 ③ `wireImageGenFeed` 在 `IMG_LOADING_PLACEHOLDER` 未定义时执行 |
| **修复** | 合并重复 const；`IMG_LOADING_PLACEHOLDER` 保留在 `features-draft` 顶部 const；`feedImgStorageAttr` 经 `FeedImages.init` 接线 |
| **勿再犯** | 改 `wireFeed*` 或拆模块后：强刷 + Console 无 ReferenceError；`!!window.FeatureDraft?.hydrateFeedImages` 为 true |

---

## 1b. esbuild bundle 全站无图（Pages SPA 回退）

| 项 | 内容 |
|----|------|
| **标签** | 🔴 致命 |
| **现象** | 卡片库只剩文字、社区/生图/资产页全空；Console 无 SyntaxError，但 `window.MediaPipeline` / `FeedLayout` / `CardImageLoader` 均为 **false** |
| **根因** | 三包引用 `/dist/*.bundle.js`；Cloudflare Pages **SPA 回退**对不存在的静态路径返回 `index.html`（`Content-Type: text/html`）。浏览器把 HTML 当 JS 执行 → 全局对象未定义 → 图片管线与 Feed 全失效 |
| **为何 VM 冒烟没抓到** | `node --check` / VM 读本地磁盘文件正常；**未 HTTP fetch 线上 URL** 验证返回体 |
| **修复** | ① bundle 输出到**站点根目录**（`core-pipeline.bundle.js` 等）② `index.html` / `sw.js` / `bump-build.ps1` 同步路径 ③ 新增 `verify-bundle-bytes.mjs` + `run-index-http-smoke.mjs`（部署后拉生产 URL，断言非 HTML）④ `deploy-pages.ps1` staging 与 post-deploy 双检 |
| **构建** | `20260622p` |
| **勿再犯** | 新增/移动 bundle 路径后：`SMOKE_BASE=https://prompt-hubs.com node scripts/run-index-http-smoke.mjs`；禁止把运行时 JS 只放在会被 SPA 吞掉的路径（如未在 staging 里的 `/dist/`） |

### 1d. `*.bundle.js` 文件名（20260623f 根治）

| 项 | 内容 |
|----|------|
| **现象** | 浏览器 `<script src="foundation.bundle.js">` 得 HTML；`FeedImages`/`MediaPipeline` 全 false |
| **根因** | Cloudflare Pages 对 **`.bundle.js` 扩展名** 的 script 请求 SPA 回退（普通 `.js` 正常） |
| **修复** | 构建输出改名为 `pack-prelude.js` … `pack-viewer.js` … `pack-extra.js`（**8 pack**）；HTTP 冒烟加 `Sec-Fetch-Dest: script` |
| **构建** | `20260623f`（改名）→ `20260623j`（+ `pack-viewer`） |

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
| **修复** | 已 distributed 时 early return，只维护哨兵；~~开侧栏不 scheduleCommunityLayout~~ → **20260605l** 侧栏打开须 **immediate recalcCols**（见 §2.8） |

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

### 2.6 社区同列上下间距（部分改善 · 暂维持现状）

| 项 | 内容 |
|----|------|
| **状态** | 🟡 **部分解决**（2026-06-05 用户验收 `build 20260605w`）：大体稳定，偶发略大间距明显减轻；**仍可能在图未加载完时出现**，等一会或点卡开侧栏后会自行排齐 → **暂不再改** |
| **现象** | 社区 Feed 同列有时松紧不一；卡片库从未出现；加载阶段偶发「空一大块」，加载完或交互后多能恢复 |
| **已做（20260605v～w）** | ① `feed-layout.js` 拆分，社区 Masonry / 我的主页 flex 分流 ② `getCommunityFeedGaps` 与 `--card-row-gap` / Masonry `gutter` 统一 ③ 排版后写入 `--feed-row-gap` ④ 恢复 `imageGenFeedSignOpts`（误删曾致全站无卡） |
| **架构差异（卡片库 vs 社区）** | **卡片库**：`#cardsContainer` + Masonry；`gutter` 只管列间距；上下靠 `margin-bottom: --card-row-gap`。**社区**：桌面 Masonry 同理；`diagnose` 里 `orphanCards`/`directCards` 在 Masonry 下为直挂 `.card` 数量，**非 flex 孤儿**，勿误判 |
| **临时规避（用户可用）** | 首屏/分页后稍等图片加载；或点任意卡片开侧栏 → 触发 debounce 重排后间距正常 |
| **涉及** | `feed-layout.js`、`features-draft.js`、`styles.css`、`script.js` |
| **后续若再开** | 对比加载态占位高度、`finishCardMediaShine` → `scheduleFeedMasonryRelayout` 时机；勿恢复全墙 flex 重分 |

### 2.8 我的主页作品区收成「一条缝」可滚动（桌面）

| 项 | 内容 |
|----|------|
| **现象** | 「发布作品」Tab 下仅顶部窄条能看到图，条内滚动；下方大片空白网格底 |
| **根因** | `#creationsGrid` 与社区共用规则：`flex: 1 1 0` + `overflow-y: auto`，在 `.feature-body-cards { min-height:0; overflow:hidden }` 链里被压成固定视口高；Masonry 绝对定位内容溢出后在**网格自身**里滚，外壳下方空 |
| **与社区联动** | 共用 `renderPostsIntoContainer` / `layoutCommunityMasonry`；社区改 Masonry 会波及我的主页 |
| **根因（20260605t 诊断）** | 控制台 `__APP_BUILD__` 已是新号，但 `index.html` 仍 `features-draft.js?v=20260605n` → **跑旧 JS**（`masonryReady:true`、`orphanCards:206`）。`bump-build.ps1` 只改内联构建号，未同步脚本 `?v=` |
| **架构分流（进行中）** | `getFeedLayoutMode`：社区 `masonry`、我的主页 `flex-columns`；`layoutFeedFlexColumns` 独立入口；`bump-build` 同步 `features-draft.js` 等 `?v=` |
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

### 2.8 侧栏遮住最右列 / 生图预览迟滞重排（2026-06-05）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 |
| **现象** | 社区/生图点开侧栏后最右卡片被挡；生图预览侧栏要等 ~0.5s 才跳布局 |
| **根因** | 侧栏占 340px 后主区变窄，但 Masonry 仍用旧列宽；`syncCommunityFeedColumnCount` 对 **communityGrid Masonry 无 op**；生图 `scheduleImageGenFeedLayout` debounce 160ms + 多次 setTimeout |
| **修复（`20260605l`）** | `relayoutFeedGridAfterSidePanel`；`scheduleImageGenFeedLayout({ immediate: true })`；`FeedLayout.bindResizeRelayout` 宽度变化 >100px 即时；`.imagegen-side` ResizeObserver |
| **勿再犯** | 拆模块后社区卡片仍依赖 `feedImgStorageAttr`（在 `feed-images.js`），须 `wireFeedImages` 接线 |

### 2.5 其它布局坑（简表）

| 现象 | 根因要点 |
|------|----------|
| 侧栏开整墙重排 | ~~仅加 selected 不重排~~ → **20260605l** 须 `relayoutFeedGridAfterSidePanel` immediate；宽度变窄 `recalcCols` |
| 切回社区一排白骨架 | `showCommunityFeedSkeleton` 盖住已有 Feed → 有真卡勿 `innerHTML` 骨架 |
| 首屏 400+ 卡卡顿 | `drainUntilDone` 灌满 DOM → 首屏只 drain 约 5 页，其余靠哨兵 |
| 用 grid 自身宽度算列数 | 侧栏开合误判 1 列 → 用 `.community-page-main` / `.community-workspace` 量宽 |

---

## 3b. 手机切后台生图丢图

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 |
| **现象** | 手机生图后切到别的 App / 别的页面 / 锁屏，回来图没了或一直「生成中」；电脑较少 |
| **根因** | ① iOS/Android 后台 **挂起 JS**，轮询停 ② 任务状态只写 `sessionStorage`，部分浏览器重载后丢 ③ 回到前台只在「生图页 active」才恢复 ④ 已完成任务若 session 丢失则 `shouldAutoRecoverCompletedJob` 跳过 |
| **修复** | `localStorage` 备份 pending + session 任务；切后台 `pagehide` 持久化；回到前台 **任意页面** 强制 `resumePendingGenerationJobs`；离开生图 Tab 也触发同步 |
| **20260623a+** | 失败任务 12 分钟内标红（不再无限「恢复中」）；成功/失败自动刷新占位；生图页首开立即 hydrate（不再等 prefetch 才出图） |
| **用户侧** | 生图后尽量等 1～2 分钟再切走；回来切到生图「作品」Tab 或卡片库查看；仍无图可强刷 |
| **勿再犯** | 生图恢复逻辑改动后：手机提交 → 切微信 30s → 回来查卡片库是否有 `genJobId` 对应卡 |

---

## 3. 媒体签名与黑图（高频）

| 现象 | 根因 | 正确做法 |
|------|------|----------|
| 卡片库全黑 + Console 401 | JWT 过期仍疯狂 `media/sign` | 401 → 刷新会话 + 暂停签名 + 提示重登 |
| 社区白卡、Network 上千条红 | `sign-batch` 并发过高、429 仍重试 | 串行队列 + 冷却；prefetch debounce |
| 部分图永不加载 | `SIGN_BUDGET_MAX` 过小 + 卡太多 | 批量 `sign-batch`，提高预算，勿每张单独 sign |
| `posts/sync` 400/超时 | 一次 80+ 条 | `COMMUNITY_SYNC_BATCH_MAX = 80` 分批 |
| 过早删 Feed 空壳卡 | `pruneEmpty` 在 loading 时删卡 | 仅确认 load-failed 后删 |
| 大量灰块/黑卡（848 张库） | ① `MEDIA_STORAGE_MODE=r2` 只读 R2，Supabase 有图也 404 ② 回归：`/generated/` 全走慢速 `warehouse-thumbs` ③ R2 同步未完成 | Worker 改 **`r2-first`**；`cardNeedsWarehouseThumbServer` / `needsServerThumb` 恢复走 **`sign-batch`**；进卡片库 `bootstrapWarehouseMediaCache({ clearAllMissing: true })`；缺文件跑 `node scripts/sync-supabase-to-r2.mjs --skip-existing` |
| 侧栏/标题品牌被缩短 | UI 改动误删 SEO 前缀 | 侧栏 **「卡藏」**；`<title>` **卡藏 · 卡片式提示词仓库 — …**（build `20260702g`） |

### 3d. 卡片库 / 最近生成灰块（列表禁止 full · 20260704c 修复）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 848 张卡片库按「最近生成」大量灰块；侧栏/大图有时能看、列表缩略图黑；Console 成批 **404**（`.png` hash 路径）；「最近」Tab 5 条里 2～3 条无缩略图 |
| **根因** | ① `isWarehouseBlockedFullUrl` 在 `#cardsContainer` / `#imageGenFeed` **一律拦截** `/generated/` 的 full CDN URL → `getGenerationImageUrl` 能返回图但 `applyUrlToImg` 拒绝 ② `getListDisplayImageSrc` 默认 `allowFullFallback: false`，`_grid` 未签好时首屏永远占位 SVG ③ 一次加载失败 `markPathMissing` + `ph_missing_paths_v1` 持久化，后续永不重试 ④ 坏 `storage://` 挡住 MJ `mjCompositeUrl` / 四宫格备用源 ⑤ `repairRecentCreationImagesQuiet` 见 storage ref 就 skip |
| **修复（build `20260704c`）** | 自有生图卡（`genJobId` / `cr_`）grid 未就绪时 **允许 full 列表缩略**；`pickCreationFeedImage` + 多 ref fallback；打开页/升构建号 **清 missing 缓存**（`index.html` bump 逻辑）；最近 Feed 失败 **不再 markPathMissing**；加强 quiet repair |
| **为何能「自己补回来」** | 强刷到新构建号 → 清错误 missing 标记 → 列表可加载 CDN full → `CardImageLoader` / `WarehouseThumb` / 登录后 idle `repairGeneratedCardImagesQuiet` 陆续拉图，无需手跑控制台 |
| **仍补不回** | Console 404 且 **`genJobId` 无 + 云端 API 无图** → 原图从未进 R2/Supabase 或上游链已过期；跑 `runWarehouseBulkRepair` 仍 0 则真丢 |
| **诊断** | 卡片库：`await diagnoseGreyWarehouseCards(12)` · 最近 Tab：`await FeatureDraft.diagnoseRecentFeedThumbs(8)` |
| **勿再犯** | 列表区禁止 full 时须 **排除自有 `/generated/` 卡**；repair 不能因已有 `storage://` 就 skip；改 `__APP_BUILD__` 时保留清 `ph_missing_paths_v1` |

---

## 3c. 画布节点缩放死循环

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频（无限画布） |
| **现象** | 本地 `/canvas/:id` 红屏：`Maximum update depth exceeded`；栈在 `canvas-client-page.tsx` → `handleNodeResize` → `setNodes` |
| **根因** | 节点缩放或 hover 工具栏联动时，**宽高/位置未变**仍反复 `setNodes`，React 同步更新超过深度上限；与「全节点 hover 工具栏」改动叠加后更易触发 |
| **修复** | ① `handleNodeResize` / `handleConfigNodeChange`：**几何与 metadata 未变则 return prev** ② `canvas-node` 缩放：**重复 emit 跳过** ③ `keepNodeToolbar` / hover：**同 id 不重复 setState** |
| **仓库** | `infinite-canvas-jay` · `canvas-client-page.tsx` + `canvas-node.tsx` |
| **勿再犯** | 凡节点 `setNodes` 映射，先比对 width/height/position；工具栏显隐用 functional update 去重 |

---

## 4. 生图仓库带宽（P0，**部分改善 · 20260605 验收**）

| 项 | 内容 |
|----|------|
| **标签** | 🟠 高频 · 🟡 绕很久 |
| **现象** | 图片生成 → 子 Tab「仓库」：Network 已传输 **几十～150+ MB**（修复前） |
| **根因** | `#imageGenFeed` 批量 hydrate + grid miss 回退 full |
| **修复** | 列表 cap 12、禁止列表 full fallback、IO 240px；用户验收 ~4.8MB、`big:0` |
| **剩余** | 404/500 风暴、老卡无 `_grid` 仍可能偶发 full |
| **详见** | `docs/CURRENT-ISSUES.md` P0-带宽、`docs/FEED-MODULES.md` |

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
| **esbuild bundle 后全站无图** | `/dist/*.js` 被 Pages SPA 回退成 HTML | bundle 放根目录 `*.bundle.js`；部署后跑 `run-index-http-smoke.mjs`（见 **§1b**） |
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
5. 部署后 `node scripts/run-index-http-smoke.mjs`（或 `SMOKE_BASE=https://prompt-hubs.com`）三个 `*.bundle.js` 须为 JS 非 HTML。  
6. `https://prompt-hub.cn/favicon.ico` 返回 200。

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
