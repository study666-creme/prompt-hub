# 卡片库图片加载（为什么比 LabGen 慢、我们怎么优化）

## 和 LabGen / 普通「提示词列表」的差别

| | LabGen 类站点 | Prompt Hub（当前） |
|---|---------------|-------------------|
| 列表数据 | 接口一次返回 **可直接访问的图片 URL**（CDN） | 卡片 JSON 里多是 `storage://...` **私有路径** |
| 浏览器加载 | `<img src="https://cdn...">` 立刻并行下载 | 要先 **批量向 Supabase 换签名 URL**（网络往返） |
| 布局 | 多为固定网格 / 稳定高度 | Masonry 瀑布流，**每张图高度变化要重排** |
| 数量 | 虚拟列表只渲染可见项 | 一页最多 24 张，但曾 **等签名完才插入 DOM** |

所以不是「几张卡就该卡」，而是 **每张图多了一步「换链接」+ 瀑布流重排」**。15 张在弱网下也会明显慢。

## 当前加载管线（构建号 `20260530d` 起）

1. **立刻渲染文字和卡片骨架**（不再 `await` 等签名才插入 DOM）
2. **自有图片**：优先 **Supabase 客户端批量签名**（不走 Worker，避免 429）
3. **后台** `prefetchCardsImages`：最多 **48** 张、并发 **12**；签完 `patchImageSrcFromCache` + `patchVisibleFromCache`
4. **社区同步**：`posts/sync` **批量一条**，禁止对每张卡 `POST /community/posts`（曾触发 429）
3. **视口懒加载** `card-image-loader.js`：只给看得见（+ 下方 280px）的图设 `src`；放大预览用 `variant: 'full'` 原图
4. **Masonry**：合并重排（约 160ms 防抖），避免每张图 load 都 destroy 布局

关键文件：

- `card-image-loader.js` — 懒加载 + 应用 URL
- `supabase-sync.js` — `prefetchCardsImages`、`getCachedDisplayUrl(image, cardId)`
- `script.js` — `renderCards` → `hydrateWarehouseGridImages` → `CardImageLoader.bindWarehouse`

## 本地验证

```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

打开 http://127.0.0.1:5500/ ，F12 → Network：

- 应先看到 **卡片文字**，再陆续出现图片请求（`storage` 签名后的 `https://...`）
- 控制台：`window.__APP_BUILD__` → `'20260606p'`

## 首屏 3 秒：难点与「流畅感」策略（2026-06）

**为什么难做到「3 秒内全部高清图」**

- 列表里是 `storage://` 私有路径，每张图要先 **Worker/Supabase 签名** 再下载（LabGen 类站点接口直接给 CDN URL）。
- 社区他人作品走 `signCommunityMediaRef`，目前 **逐张** 请求，RTT 叠加明显。
- Masonry 瀑布流要等图片高度才能稳定布局。

**已做（20260606l 起）**

- 文字/骨架 **立刻** 插入 DOM，不等签名
- 渲染后马上 `patchImageSrcFromCache`
- 签图并发 8～12、社区预取 cap 28～56
- 视口懒加载 + 首屏 14 张立即 hydrate

**下一步（真正接近 3 秒全清晰）**

1. [x] 服务端 **批量社区签名** `POST /api/v1/media/community/sign-batch`（20260606o）
2. [x] 上传时写 **缩略图** `_grid.jpg`，列表只拉小图（20260606p）
3. [x] 签名 URL 写入 sessionStorage 会话缓存（已有 `ph_signed_urls_v1`）

**产品目标**：用户 3 秒内应看到 **完整布局 + 占位动画 + 陆续变清晰**，而非白屏或长时间空白格。

## 生图「生成中」与卡片「加载中」扫光（20260601j）

- **加载完成**：`media-shine-reveal` + `@keyframes card-beam-trbl`（播一次）
- **加载中 / 生成中**：同一光带样式，`animation: card-beam-loading`（`card-beam-trbl` 轨迹循环）
- 选择器：`.card-media.is-loading::after`、`.imagegen-gen-pending::after`
- 浅色主题卡片库仍用光球；生图占位与深色一致用光带
- 勿再单独写 `background-position` 扫光或外置斜条（易错位、只亮一角）

## 首屏加载顺序（2026-05-30 · **未解决** · 问题 C）

用户反馈（488 张级卡片库）：

- **期望**：第一页 / 第一屏先出图，再加载后面分页。
- **实际**：后面几页或 Masonry 右侧列先有图，左侧/第一页仍黑占位；整体慢，用久易卡。

已试（20260601p/q，**用户称无效**）：首屏 eager 24、缩小 IO rootMargin、Masonry 后再 observe、视觉序分批 load、`WAREHOUSE_FAST_FIRST` 24。

疑因与下一步见 **`docs/CURRENT-ISSUES.md` 问题 C**。

---

## 生图页「仓库」Feed（`#imageGenFeed`）— 用户实测 2026-06-06 · **P0 未解决**

与主站 **卡片库**（`#cardsContainer` + `card-image-loader.js`）不是同一条管线。

| | 卡片库（目标态） | 生图 → 仓库 Feed（当前） |
|---|------------------|-------------------------|
| 懒加载 | `observeContainer`，视口内才 `loadImg` | `hydrateFeedImages` 对容器内 **全部** `img` 批量处理 |
| 缩略图 | 优先 `_grid.jpg` / `VARIANT_GRID` | grid miss 后 `applyFeedImageSrc` 可 **回退 full 原图** |
| 并发 | prefetch cap、IO rootMargin | `warehouseBoost: true` → hydrate 并发 **10～18** |
| 用户 Network | 修后应 < 几 MB 首屏 | 实测 **80～217 MB 资源**、**150+ MB 已传输**、244+ 请求 |

**两阶段现象**（用户截图）：

1. 先刷 **404** + **`card-images` 500**（签名/路径错误，请求数持续涨）。
2. 签名成功后浏览器开始下 **2～3.7 MB/张** 的 jpeg（私有链 `?e=&s=`），流量陡增。

**产品答案**：**不是**每次打开都必须几百 MB；应 **只看哪张再拉**（IntersectionObserver + 列表仅 grid + 详情才 full）。当前实现接近「Feed 里有多少张卡就签多少张、能下原图就下原图」。

**下一条 AI 改哪里**：`features-draft.js`（`hydrateFeedImages`、`applyFeedImageSrc`）；让 `#imageGenFeed` 复用 `card-image-loader.js`；`supabase-sync.js` 禁止列表路径 `tryFullFallback` 除非侧栏/灯箱。

验收见 **`docs/CURRENT-ISSUES.md` → P0-带宽**。

---

## 后续可继续做（路线图）

- [x] 列表缩略图 `_grid.jpg`（上传管线已有，**需 backfill 老卡 + 生图 Feed 强制使用**）
- [ ] **生图仓库 Feed 懒加载 + 禁止列表 full**（P0，20260606a 部分改善，待 Network 验收）
- [ ] 签名 URL 写入 IndexedDB 会话缓存，刷新少打 Supabase
- [ ] 首屏虚拟列表（>100 张时）
- [ ] 公共读桶 + CDN（需安全评估）
