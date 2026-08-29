# 列表图片加载

复核日期：2026-08-29。下述仓库 UI 对应候选 `20260829o`（尚未上线时不要据此描述生产行为）；生产资源以线上 build 和资源 HTTP 冒烟为准。

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

新卡片进入视口可使用轻微 opacity/translate 缓出，但动画不能改变卡片尺寸、触发 Masonry 反复测量或在 `prefers-reduced-motion` 下强制播放。

## 聚焦切换与整片可见性（2026-08-29）

- 卡片库"展开/收起"、内联社区/我的主页的切换必须保持卡片**全程可见**。`warehouse-grid-crossfade` 只允许轻微 `translateY`，不允许 `opacity: 0 -> 1`——整片淡出在用户看来就是"卡片库一下消失一下出现"的闪烁。
- `setFocusState` 对同一 view + 同一 focus 状态是幂等 no-op；重复点击活动 tab、双击或重复激活不会重新触发 crossfade、不会重复搬移 `#cardsContainer`。crossfade 与 focus-transition 的 class 清理使用带 token 的定时器，旧定时器不能提前摘掉新一轮动画类。
- 路由离开卡片库时必须调用 `window.WarehouseComposer.exitFocus()`（`warehouse-composer.js`）：它同时恢复 `#cardsContainer`/工具栏的父节点、把借用的 community/creations shell 移回原页面，并清掉 `warehouse-content-focus*` 与 `warehouse-inline-community-active` body class。否则 `switchAppPage` 切到社区/我的主页时目标页 active 但仍被 CSS `display:none`，表现为"点开什么都没有、消失了"。

## 稳定布局与首屏优先级

- 桌面卡片库（非聚焦与聚焦）均使用 **JS 分发的列容器瀑布流**（`.warehouse-focus-columns`，见 `styles/base/part-09.css` 与 `legacy/script/part-03.js`），不用 CSS multi-column：multi-column 会在图片加载时由浏览器反复 balance 重排，把卡片在各列之间搬来搬去，这正是"其他几列被新卡片挤掉/疯狂闪动"的来源。列容器方案下卡片位置由 JS 固定，图片加载只改变该卡片在自己列内的高度，不会把其他列已有卡片挤走；增量分页只把新卡放进当前最矮列（`appendWarehouseFocusCards`），已有卡片原地不动。
- **媒体框保持图片真实比例**（竖图竖卡、横图横卡、无留白），不做固定 `4/3` 裁切——固定比例会把所有卡片压成等高方格，瀑布流就没了。图片未就绪（未 `media-revealed`）时用 `3/4` 占位并带 `min-height: 72px`，加载完成后放开为 `aspect-ratio: auto` 由图片自然高接管。占位阶段**不能加 `max-height`**：那会让所有卡片停在等高占位上，退化成方格。实测占位 396px → 加载完成 397/529px，跳变极小且卡片不再跨列搬动。仍优先加载 `_grid` 缩略图。
- **列归属要跨重建保持**。卡片按 `data-id` 记在 `warehouseFocusColById`（`legacy/script/part-03.js`）里，列表重建后回到原列；只有新卡片才参与"最矮列"选择。挂在 DOM 元素上的 `data-wh-col` 不够用——重建后是新元素，属性会跟着丢。分页追加时 `appendWarehouseFocusCards` 只处理容器直属的新卡，已有卡片不参与重分配。
- `flattenWarehouseFocusColumns` 必须给两次收集**去重**：列容器里的卡片移回直属后，会同时命中"列容器内"和"直属"两个查询，不去重会把同一张卡片收两次，列高被重复累加、分发结果随之抖动。
- 网格加 `scrollbar-gutter: stable`，为纵向滚动条常留槽位：分页追加时滚动条出现会压窄可用宽度，四列整体横移一次，卡片多时这种位移会反复发生。
- 生图最近列表使用固定 `1:1` 媒体框；前 6 张设为 eager，其中前 4 张为高请求优先级，其余卡片继续 lazy。
- 最近列表分页只能把新卡插在 `data-imagegen-feed-footer="recent"` 之前，说明条始终位于所有图片之后，不能隔断第 12 张和后续图片。
- 图片 class/style 变化不再触发整个生图列表的属性级 MutationObserver 扫描；新增直属卡片时才执行布局残留清理。

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
