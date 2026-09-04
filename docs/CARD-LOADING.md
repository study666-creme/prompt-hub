# 列表图片加载

复核日期：2026-09-05。下述仓库 UI 对应候选 `20260830f` 后的未发布修复（尚未上线时不要据此描述生产行为）；生产资源以线上 build 和资源 HTTP 冒烟为准。

## 目标

卡片库、社区和生图仓库需要在不拉取 full 原图的前提下快速显示首屏，并在滚动时稳定分页。长期引用存储在 JSON 中，浏览器通过 Worker 批量换取 CDN URL。

## 当前分页

| 列表 | 手机首批 | 桌面首批 | 后续 |
|---|---:|---:|---|
| 卡片库 | 12 | 24 | 滚动哨兵每页追加 |
| 社区/我的主页 | 12 | 24 | IntersectionObserver 追加 |
| 生图仓库 | 12 | 12 | 独立分页 store 追加 |

远端社区 head 可以缓存更多元数据，但首屏 DOM 仍受上表限制。

## 图片链路

```text
storage://card-images/{user}/{file}
  -> sign-batch / community sign-batch
  -> Worker 选择 _grid 路径
  -> /api/v1/media/i|c/{token}
  -> Cloudflare cache
  -> R2，缺失时按 r2-first 回源 MemFire Storage
```

**R2 回源自愈（2026-08-31）**：r2-first 回源命中（R2 缺失、Supabase 有对象）时，`serveCachedStorageImage`
与 `ensureGridPathForSigning` 会通过 `scheduleR2Backfill` 把该对象（含 `_grid`）异步回传 R2。
在此之前，R2 未回填的对象每张卡都走慢速 MemFire 回源（实测 `media/sign` 单张 2–4s、
`sign-batch` 8–9s、`media/i` 4–8s），`_grid` 缺失时还按主图现场生成（单张 16–22s），
这正是卡片库“很卡”的来源。存量缺图请批量回填：

```powershell
# scripts/admin.local.env 需含 MEMFIRE_URL / MEMFIRE_SERVICE_ROLE_KEY（当前库）与 R2_*
set AUDIT_USER_ID=<UUID>
node scripts/run-warehouse-repair.mjs --dry-run
node scripts/run-warehouse-repair.mjs --max 200
node scripts/run-warehouse-repair.mjs --all
```

**grid 物化预算（2026-08-31）**：签名/`/media/i` 命中缺失 `_grid` 时不再同步等 16–22s 的现场缩放。
`materializeGridWithinBudget` 给 3s 预算：超时则交 `waitUntil` 后台继续物化（落 R2，下一轮命中），
本次响应降级到已确认存在的原图路径——列表必须拿到可下载 URL，否则卡片只会停在占位/文字状态
（“点进卡片才有图”就是这么来的：详情走原图立即可见，列表等在缩略图上）。
`materializeCommunityGridIfMissing` 同样按 3s 预算后异步完成。

**生图 recent 首屏批量预签（2026-09-05）**：生图页「最近生成」列表的卡片库卡片
（`__fromWarehouse` 合并进 `cr_` 渲染）此前既不走 sign-batch 批量签名（`bindFeed` 的
`prefetchList` 只对「每项都有 image 的仓库卡」生效，且 `cr_` 图不等容器签名门），
也不优先 `_grid`（`pickCreationFeedImage` 取 `c.image` 原图路径）——缓存未命中时逐张
走单条 `/media/sign`（生产实测 2–4s/张，feed 并发 8–12），首屏十几秒全在排队。
修复（均在主树，随下一构建上线）：

1. `prefetchWarehouseFeedCardsBackground` 在 recent 首屏先跑
   `SupabaseSync.prefetchWarehousePage(list.slice(0,24), 3200, { maxCards: 24 })`
   ——与卡片库同一条批量链路（collectCardOwnedListSignPaths → batchSignPaths →
   `/media/sign-batch`），签名缓存与 `getListDisplayImageSrc` 共享；完成后既有
   `patchContainerFromCache` + `boostImageGenRecentImages` 会把新签 URL 应用到 DOM。
2. `image-gen-feed-cards.js` `creationToFeedHtml` 对 `__fromWarehouse` 卡改用
   `PromptHubCardGallery.pickWarehouseListThumb`（gallery grid 池）选封面，DOM
   `data-image-ref` 直接是 grid 目标路径；jobId 兼容 `genJobId`/`slotJobId`。
   普通临时 `cr_` 记录保持原链路。
3. `patchImageSrcFromCache` / `hydrateImageElements` 的 assetId 推导链补 `cr_` 前缀剥除
   （原来只剥 `wh_`）：批量签名落地后 DOM patch 能命中 `cr_` 卡的 grid 缓存。

不要绕开 `prefetchWarehousePage` 自建生图页批量签名——首屏 warm 必须与卡片库共享
同一个 signedUrlCache 入口，否则两处各签一轮（单签 2–4s/张，40 张卡就是灾难）。

Generated results from `newapi.prompt-hubs.com` are fetched only through the
authenticated Worker media proxy before browser-side validation and upload.

详情、下载、Canvas 插入使用 `variant=full`。列表不得因为 grid 404 自动把所有卡片降级成 full。

## 关键模块

| 文件 | 职责 |
|---|---|
| `card-gallery.js` | 只有真实可解析图片引用存在时才为卡片创建媒体槽 |
| `card-image-loader.js` | 队列、批量签名、解码状态、失效签名重取、失败缓存和视口加载 |
| `card-image-loader-queues.js` | 并发和 cap 配置 |
| `warehouse-thumb.js` | 生图仓库 grid 缩略图请求 |
| `mobile.js` | 手机首屏 cap、滚动 boost |
| `legacy/script/part-09.js` | 卡片 DOM 分页与首屏绑定 |
| `legacy/script/part-02.js`, `part-03.js`, `part-10.js` | 桌面稳定 Grid、列数切换与分页哨兵 |
| `styles-warehouse.css` | 卡片仓库媒体、元数据、空态和手机布局的独立视觉层 |
| `feed-images.js` | 社区/生图引用归一化 |
| `server/src/routes/v1/media.ts` | upload、sign-batch、CDN URL |
| `server/src/lib/media-cdn.ts` | 路径候选、grid 物化和缓存 token |

## 手机滚动规则

`.app-main` 是唯一纵向滚动根。页面、feature shell 和 grid 不得再增加独立 `overflow-y:auto`。横向裁切优先 `overflow-x: clip`，避免浏览器把纵向 visible 计算成新的 auto 滚动容器。

新卡片进入视口可使用轻微 opacity/translate 缓出，但动画不能改变卡片尺寸、触发 Masonry 反复测量或在 `prefers-reduced-motion` 下强制播放。落地实现见下面「卡片入场动效」。

## 聚焦切换与整片可见性（2026-08-29）

- 卡片库"展开/收起"、内联社区/我的主页的切换必须保持卡片**全程可见**。`warehouse-grid-crossfade` 只允许轻微 `translateY`，不允许 `opacity: 0 -> 1`——整片淡出在用户看来就是"卡片库一下消失一下出现"的闪烁。
- `setFocusState` 对同一 view + 同一 focus 状态是幂等 no-op；重复点击活动 tab、双击或重复激活不会重新触发 crossfade、不会重复搬移 `#cardsContainer`。crossfade 与 focus-transition 的 class 清理使用带 token 的定时器，旧定时器不能提前摘掉新一轮动画类。
- 路由离开卡片库时必须调用 `window.WarehouseComposer.exitFocus()`（`warehouse-composer.js`）：它同时恢复 `#cardsContainer`/工具栏的父节点、把借用的 community/creations shell 移回原页面，并清掉 `warehouse-content-focus*` 与 `warehouse-inline-community-active` body class。否则 `switchAppPage` 切到社区/我的主页时目标页 active 但仍被 CSS `display:none`，表现为"点开什么都没有、消失了"。
- **未聚焦首页（不展开）同样使用列容器**。列容器模式下 `.warehouse-scroll-sentinel` 必须 `position:absolute` 脱离 flex 分配：它默认宽度接近整行，若作为静态 flex 项参与分配，会把四个 `flex-basis:0` 的 `.warehouse-focus-col` 挤成约 2px 的细条，分页过程中整片卡片在"细条/正常列宽"间反复切换，正是"不展开也闪"的来源（`styles/base/part-09.css`）。
- 聚焦/展开按钮是左上角 `.app-nav-head` 内的图标按钮（`#warehouseFocusToggleBtn`），不是悬浮文字按钮；非卡片库页面自动隐藏。

## 稳定布局与首屏优先级

- 桌面卡片库（非聚焦与聚焦）均使用 **JS 分发的列容器瀑布流**（`.warehouse-focus-columns`，见 `styles/base/part-09.css` 与 `legacy/script/part-03.js`），不用 CSS multi-column：multi-column 会在图片加载时由浏览器反复 balance 重排，把卡片在各列之间搬来搬去，这正是"其他几列被新卡片挤掉/疯狂闪动"的来源。列容器方案下卡片位置由 JS 固定，图片加载只改变该卡片在自己列内的高度，不会把其他列已有卡片挤走；增量分页只把新卡放进当前最矮列（`appendWarehouseFocusCards`），已有卡片原地不动。
- **媒体框保持图片真实比例**（竖图竖卡、横图横卡、无留白），不做固定 `4/3` 裁切——固定比例会把所有卡片压成等高方格，瀑布流就没了。图片未就绪（未 `media-revealed`）时用 `3/4` 占位并带 `min-height: 72px`，加载完成后放开为 `aspect-ratio: auto` 由图片自然高接管。占位阶段**不能加 `max-height`**：那会让所有卡片停在等高占位上，退化成方格。实测占位 396px → 加载完成 397/529px，跳变极小且卡片不再跨列搬动。仍优先加载 `_grid` 缩略图。
- **列归属要跨重建保持**。卡片按 `data-id` 记在 `warehouseFocusColById`（`legacy/script/part-03.js`）里，列表重建后回到原列；只有新卡片才参与"最矮列"选择。挂在 DOM 元素上的 `data-wh-col` 不够用——重建后是新元素，属性会跟着丢。分页追加时 `appendWarehouseFocusCards` 只处理容器直属的新卡，已有卡片不参与重分配。
- `flattenWarehouseFocusColumns` 必须给两次收集**去重**：列容器里的卡片移回直属后，会同时命中"列容器内"和"直属"两个查询，不去重会把同一张卡片收两次，列高被重复累加、分发结果随之抖动。
- 网格加 `scrollbar-gutter: stable`，为纵向滚动条常留槽位：分页追加时滚动条出现会压窄可用宽度，四列整体横移一次，卡片多时这种位移会反复发生。
- 生图最近列表使用固定 `1:1` 媒体框；前 6 张设为 eager，其中前 4 张为高请求优先级，其余卡片继续 lazy。
- 最近列表分页只能把新卡插在 `data-imagegen-feed-footer="recent"` 之前，说明条始终位于所有图片之后，不能隔断第 12 张和后续图片。
- 图片 class/style 变化不再触发整个生图列表的属性级 MutationObserver 扫描；新增直属卡片时才执行布局残留清理。

## 卡片入场动效（2026-08-30）

卡片库此前是**硬生生出现**的：`styles/base/part-09.css` 里那套 `.card-enter-soft` /
`.card-enter` 从未被任何 JS 使用，而且选择器写的是 `#cardsContainer > .card.card-enter-soft`
——只匹配容器的**直接子**卡片。桌面列容器瀑布流把卡片放进 `.warehouse-focus-col`，
这条选择器永远命中不了，属于死代码。

现方案（`legacy/script/part-03.js` 的 `markWarehouseCardsPending` / `revealWarehouseCards`，
样式在 `styles/base/part-09.css`）：

- **用 transition，不用 animation**。瀑布流分发卡片时会 `appendChild` 移动节点，而移动
  节点会重启 CSS animation——这正是当年"整片卡片疯狂闪动"、导致入场动效被整段摘掉的根因。
  transition 只在计算值变化时播放，重插节点不会重放。
- **位移放在 `.card-media` / `.card-body` 上，不放 `.card`**。`.card` 的 `transform` 已被
  hover（`translateY(-6px) scale(1.018)`）占用，两者叠在同一属性上会互相打断，hover 会把
  卡片从入场中途拽走。
- **顺序是硬要求**：`renderCards` 先把新卡片标成 `card-enter-pending`（`opacity: 0`）再交给
  布局，最后才调 `revealWarehouseCards`。`layoutMasonryGrid` 是更早注册的 rAF，所以放行时
  卡片已经落到最终列，不会边入场边被搬。
- 错峰 `28ms`/张，最多累计 10 档（约 280ms），避免整片卡片"啪"地一起出现。
- 入场结束会摘掉 `card-enter-in`：它覆盖了 `.card` 原本的 transition，留着会让 hover 变迟钝。
- 兜底 1500ms 保险丝：任何异常分支下都必须保证卡片可见，绝不允许停在 `opacity: 0`。
- `prefers-reduced-motion: reduce` 时 JS 直接跳过标记，CSS 侧也一并降级为无动画。

回归：`node scripts/verify-warehouse-card-entrance-browser.mjs`（含"重排后不重放、不留隐藏卡片"断言）。

## 首屏并行预取（2026-08-30）

首屏原本要用 **39 次串行同步 XHR** 取内容：6 个 `partials/index-body/part-*.html`、
13 个 `legacy/script/part-*.js`、7 个 `legacy/supabase-sync/part-*.js`、
13 个 `legacy/features-draft/part-*.js`，合计约 1.36MB。同步 XHR 会完全冻结主线程，
串行又让每个分片各付一次 RTT，是首屏卡顿的主因。

改法：

- `index.html` 在 `<head>` 解析期用 `fetch` **一次性并行**发出全部请求，响应文本存进
  `window.__PH_PART_STORE__.text`（键 = 分片相对路径，不含 `?v=`）。
- 同步加载器（body 片段 loader 与各 legacy 拆分 loader）先查这张表，**未命中才退回同步
  XHR**，所以是纯增益、不会引入新的失败模式。
- 关键路径优先：body 片段与 `legacy/script` 分片用 `priority: 'high'`，
  `supabase-sync` / `features-draft` 用 `'low'`（它们要到 body 末尾才用得上）。
- 拆分加载器是**生成物**：`scripts/create-legacy-runtime-split.mjs` 的模板已同步改好，
  重新拆分时会自动带上这段查表逻辑。

同一套机制也修掉了 CSS 的 `@import` 瀑布：`styles.css` / `styles-features.css` 只是
`@import` 清单，浏览器必须先下载解析它才能发现 20 个真实分片，等于全部样式多等一次阻塞
往返。`index.html` 用 `__PROMPT_HUB_CSS_PRELOAD_START__/END__ <entry>` 标记维护对应的
`<link rel="preload">` 块，版本号由 `scripts/create-css-runtime-split.mjs` 在重新拆分时同步重写。

实测（本机 HTTP/1.1，56 个首屏请求争 6 条连接，属悲观下限）：同步 XHR 39 → 6，
`DOMContentLoaded` 960ms → 554ms。生产 HTTP/2 可多路复用，同步 XHR 应趋近 0。

## 失败处理

1. 先区分外链 404、R2 miss、Storage miss、签名 401 和 API 5xx。
2. 同一路径候选只尝试有限次数；失败写入短期缓存，防止滚动时刷请求。
3. URL 字符串存在不代表图片加载成功。浏览器只有在图片仍处于请求中且已绑定失败监听，或 `complete` 且解码出有效像素时才保留当前 URL；已完成但无像素的签名 URL 会失效对应路径和引用缓存，并绕过旧签名缓存重新解析一次。下载超时会清理 pending token 和旧 `src`，保留有限重试入口，不把图片永久卡在加载状态。
4. 纯文字卡片不渲染图片占位符。生成任务 ID、来源 ID 或生图标签本身不构成图片引用。
5. 只有对象确实存在但缺 grid 时才生成缩略图。
6. 失败的近期生成/生图仓库媒体只移除失败的媒体槽并保留文字卡，避免黑色方块和浏览器破图图标；不会删除卡片或原始引用。只有现有权威 404/410 清理路径可以移除确实不存在的近期记录，其他错误继续保留数据并按有限恢复链处理。

## 生图列表缩略图预热（2026-08-09）

- Worker 无 Canvas 且 MemFire 不支持 `render/image` 变换，`_grid` 无法在服务端生成；改为**浏览器端生成**：`finishImageGenRun` 归档成功后，`uploadGeneratedGridThumb` 用 `ImageGenRefCompress.compressRefImageFromSource(640px JPEG, crossOrigin)` 压缩原图，经 `/api/v1/media/upload` 上传为 `{user}/generated/{job}_grid.jpg`，失败静默。
- 上传成功后 `WarehouseThumb.invalidateGridCache` 清除本地缓存，feed 重新解析立即命中 R2 上的 `_grid`（签名 ~0.7s、约 60KB），不再触发服务端现场生成或加载 full 原图。

## 验收

## 白天适配与出图动效（2026-08-31）

- 所有加载占位改为**透明** SVG（`cardImgInitialSrc`(legacy/script/part-05.js)、
  `imgPlaceholderSrc`(legacy/supabase-sync/part-04.js)、`IMG_LOADING_PLACEHOLDER`×2
  (feed-images.js、legacy/features-draft/part-01.js)），但都保留 `data:image/svg`
  前缀，`isPlaceholderCardImg` / `isPlaceholderImgSrc` 判定不变；加载观感统一由
  `--card-skeleton-bg`（浅色 `#e5e5ea`）呈现，消除写死深灰块。
- 图片**淡入**：`.card-media.is-loading .card-img`/`card-media--await .card-img`
  透明度 0（warehouse styles/base/part-03.css、社区 features/part-08.css、生图
  features/part-07.css），`.is-loading` 摘除后随现有 `transition: opacity 0.28–0.4s`
  淡入——修「图片突脸」。社区/作品**纯图卡**加载中占 4:3 形状（features/part-11.css），
  完成后图片按 `max-height: min(75vh, 640px)` 封顶\uff08styles/base/part-09.css 与
  features/part-11.css），修「整片变成一张大图」。\uff08\u6ce8\uff1a2026-08-31d \u8d77\u56fe\u7247\u6062\u590d\u81ea\u7136\u9ad8\u5ea6\uff08max-height: none\uff09\uff0c\u7ad6\u56fe\u5168\u5305\u88f9\u4e0d\u518d\u51fa\u73b0\u7070\u8fb9\uff1b\u52a0\u8f7d\u5360\u4f4d + \u6de1\u5165\u8d1f\u8d23\u6d88\u9664\u7a81\u8138\u3002\uff09
- **加载顺序**：`finishCardMediaShine` 的媒体扫光级联延迟从「按 cardId 哈希随机
  （0–200ms）」改为**按 DOM 顺序**（`revealRoot` 内卡片索引 × 34ms，上限 300ms），
  保证靠前的卡片先亮先出。图片请求本身仍是并行（队列并发上限），依赖网络耗时，
  无法严格序贯；首屏/cap/viewport 优先逻辑见「首屏并行预取」。
- 深浅色：浅色模式加载态由「白色光球」改为柔和扫光（styles-theme.css
  `card-loading-sheen`）。
## 放弃高度封顶、全图回退与 MJ 拆卡（2026-08-31d）

- 社区/作品纯图卡加载完成后恢复**自然高度全宽展示**（styles/base/part-09.css、styles/features/part-11.css 的 `max-height: none`），修「竖图周围出现相框」；保留 4:3 加载占位 + 淡入（「突脸」/闪屏仍由占位与淡入控制）。
- **生图仓库列表缩略失败不再直接折叠成文字卡**：`finalizeWarehouseCardMediaFailure`（legacy/script/part-04.js）在折叠前先尝试一次 **full 变体**（`resolveDisplayUrl(ref, { variant: 'full', allowFullFallback: true, tryAllPaths: true })`，`img.dataset.whFullFallback` 显式记录）；原图可解析则保留媒体并以原图亮图，只有确定无法解析才走原折叠路径。其它失败路径在该卡还原中/已还原时不再折叠。
- **生成记录（cr_）媒体失败**：`finalizeRecentCreationMediaFailure`（card-image-loader.js）改为先让 `confirmPermanentlyMissingRecentCreation` 的 full 恢复链跑完（`getGenerationImageUrl(jobId, { variant: 'full' })` 成功则 `recentFullRetried=1` 且保留媒体亮原图），只有恢复失败/确认缺失才摘除媒体——修「画布/生图卡加载后又变成文字卡」。
- **MJ 拆卡改动已撤回**（用户要求暂保留一卡多图机制）：imagegen-finish-run.js 与 part-03.js 恢复为单卡存 gallery，旧存多图卡与新生成均保留多图展示。
- **排序时间戳归一化（2026-08-31e）**：`getRecentCreationsForFeed`（frontend part-02）与 `sortCardsWithPins`（legacy/script/part-04.js）改为 `phTimeOf`归一化（epoch 数字/数字串/ISO 字符串），避免字符串时间戳相减为 NaN 导致排序退化为原序。
- **主页/画布生图入口显式传模型与尺寸（2026-08-31e）**：`runImageGenWithPrompt(prompt, opts)`（imagegen-submit.js）支持 `opts.model/size/resolution/quality`覆盖，warehouse-composer.js `submitImage` 直接传入选中模型（修「主页选商汤但提交却是生图页停留的 MJ」）。
- **商汤等像素尺寸模型统一比例展示（2026-08-31e）**：编辑页尺寸选项把 `WxH` 折算为比例（part-12 `imageGenRatioFromPixel`），提交时 `imageGenSizeForSubmit` 反查回规范像素值（否则服务端 `declaredValue` 回落 options[0]，所有比例变正方形）。


```powershell
npm run check:predeploy
node scripts/audit-production-mobile-first-screen.mjs
```

失效签名、MJ 多图、近期生图和文字卡的本地回归：

```powershell
node scripts/verify-card-gallery-regression.mjs
$env:PLAYWRIGHT_PACKAGE_DIR = '<playwright package directory>'
$env:BROWSER_EXECUTABLE_PATH = '<Chrome or Edge executable>'
node scripts/verify-card-image-loader-retry-browser.mjs
node scripts/verify-card-image-loader-missing-cleanup-browser.mjs
node scripts/verify-recent-image-resolution-browser.mjs
node scripts/verify-imagegen-failed-media-collapse-browser.mjs
node scripts/verify-imagegen-finish-immediate-browser.mjs
node scripts/verify-imagegen-feed-retention-browser.mjs
```

仓库 UI 可使用独立浏览器验收，不访问生产 API：

```powershell
$env:PLAYWRIGHT_PACKAGE_DIR = '<playwright package directory>'
$env:SCREENSHOT_DIR = '<optional screenshot directory>'
$env:APP_ROOT = 'D:\prompt-hub\.pages-deploy'
node scripts/verify-warehouse-ui-browser.mjs
```

## Generated-card archive invariant

Reviewed: 2026-08-03.

When a signed-in user saves a generated result with `copyStorage`,
`legacy/script/part-02.js` requires `archiveGeneratedCardImage` to return a
verified `storage://` reference before persisting the card. Temporary upstream
URLs and SVG loading placeholders are never accepted as durable primary media.
If archival fails, the new card is removed instead of leaving a broken or black
card. The paid acceptance guard likewise ignores `data:image/svg` and requires
decoded raster pixels before recording a successful result.

## Recent Generation Thumbnails (2026-08-03)

Recent generation cards are resolved through `CardImageLoader` and use the
`_grid` variant for list media. The loader promise is returned to the feed
thumbnail workers, so at most three recent thumbnails are resolved in parallel
and a 4K source is never downloaded merely to render a list card. Full media is
reserved for the detail view.

The browser regression also verifies that the first six recent thumbnails are
eager, the first four have high fetch priority, retained decoded images are not
replaced during pending/failed updates, and the recent-list footer remains
after the thirteenth paginated card.

该检查注入 8 张 `_grid` 图卡和 4 张文本卡，覆盖桌面、320/360/390px 手机及空仓状态，并验证媒体槽、三张首屏广告图、类型元数据、窄屏工具栏、编辑面板触摸滚动、保存/关闭按钮可达性和横向溢出。Pages 的 HTTP 冒烟还会确认仓库 CSS 未被 SPA HTML 回退替代。

手机生产基线见 `CURRENT-ISSUES.md`。浏览器检查首批卡片数、单图体积、是否出现 full 路径、滚动后是否按页增加，以及 404 是否重复刷屏。
