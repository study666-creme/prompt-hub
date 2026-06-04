# 当前问题与进度（2026-06-06）

> **接手顺序**：本文 → `PROJECT_CONTEXT.md` → `CARD-LOADING.md`（含生图仓库带宽）→ `AI-HANDOFF.md`  
> **调试细节**：Network 截图对照 → 本文 **P0-带宽**；Cloudflare 额度 → `docs/DEBUG-GUIDE.md`

---

## 仓库构建号

| 项 | 值 |
|----|-----|
| **当前 Pages** | **`20260605l`**（`window.__APP_BUILD__`） |
| Pages | https://prompt-hub.cn |
| API | https://api.prompt-hub.cn |
| Worker | `prompt-hub-api` |

---

## P0-带宽：生图页「仓库」一进站就几十～上百 MB（**部分改善 · 2026-06-05 已验收**）

> **20260606a / 20260605g+**：列表禁止 `tryFullFallback` full；首屏签名/加载 cap 12；`backfillGridThumbs` 仅可见卡；IO rootMargin 240px。  
> **用户验收**：487 请求、~4.8MB 传输、`big: 0`（无单资源 >500KB）。

### 用户看到的现象（Network，**与是否打开 DevTools 无关**）

| 阶段 | 表现 | 典型数据 |
|------|------|----------|
| **图一（开头）** | 大量 **404**（长 hash 的 jpeg/png URL）+ 反复 **`card-images`** 请求 **500**（Initiator: `supabase.min.js`） | 请求数持续增加（57 → 132 → 244+），已传输仍只有几百 KB |
| **图二/三（随后）** | 404/500 减少或夹杂成功，开始拉 **单张 2～3.7 MB 的 jpeg**（URL 带 `?e=&s=` 私有链） | 已传输 **16 MB → 80 MB → 150 MB+**，资源总量可达 **80～217 MB**，且随滚动/重绘继续涨 |

**页面路径**：顶部 **图片生成** → 子 Tab **仓库**（`#imageGenFeed`，不是主站左侧「卡片库」`#cardsContainer`）。

**用户核心问题（产品层）**：

- 是否每次打开都要先消耗 **几百 MB 流量**？
- 能否 **只看哪张再拉**（视口内懒加载 + 列表只用小图，点开/灯箱才原图）？

**结论（给下一位 AI，可直接写进方案）**：

| 问题 | 答案 |
|------|------|
| 必须每次都拉几百 MB 吗？ | **不应该。** 列表设计上应只拉 `_grid.jpg` 或等价缩略图（几十 KB 级），原图仅在详情/灯箱/下载时拉。 |
| 现在为什么像「全拉」？ | 生图 **仓库 Feed** 与卡片库管线不一致：`hydrateFeedImages` 对 `#imageGenFeed` 开 **`warehouseBoost`**（并发 10～18），对容器内 **所有** `img[data-image-ref]` 批量签名并 `img.src = url`；grid 不存在或签名失败后 **`applyFeedImageSrc` 会回退 `variant: 'full'`**，浏览器随即下载 2～3 MB/张。 |
| 懒加载有没有？ | **卡片库**有 `card-image-loader.js`（IntersectionObserver）；**生图仓库 Feed 未接入同一套**，首屏+滚动插入的卡片会成批 hydrate。 |
| DevTools 会不会导致多请求？ | **不会。** 只是让用户看见了本来就在发的请求。 |

### 技术根因（按优先级）

1. **列表用原图**：`features-draft.js` → `applyFeedImageSrc` / `resolveImageDisplayUrl`；`#imageGenFeed` 不在 `#communityGrid` 时，grid 缓存 miss 后走 **full**（见 `tryFullFallback`）。
2. **批量 hydrate 无视口上限**：`hydrateFeedImages` → `SupabaseSync.hydrateImageElements(..., { warehouseBoost: true })`（`supabase-sync.js` 并发 10～18）。
3. **404 风暴**：老卡无 `_grid.jpg` 时 `pathsForVariant` / `tryAllPaths` 多候选路径 → 每个 ref 多次 sign/GET 404；与 **500**（`card-images` bucket / Worker sign）叠加，请求数暴涨。
4. **滚动加载更多**：`imageGenFeed` 无限滚动不断插入 DOM → 再次 `hydrateFeedImages` → 已加载过的图 + 新图继续拉 full。
5. **卡片库侧（部分已缓解，未闭环）**：`20260603n～q` 已改列表优先 grid、减 prefetch；用户本次截图主要在 **生图仓库**，不能当作卡片库已全好。

### 建议修复顺序（下一条聊天 **P0 拉满**）

1. **生图仓库 Feed**：列表 **强制 grid only**（禁止列表 `tryFullFallback` full）；侧栏/灯箱/下载才 full。
2. **接入懒加载**：`#imageGenFeed` 使用与 `#cardsContainer` 相同的 `observeContainer` / 仅视口 + rootMargin 内 `loadImg`；**禁止**对整页 `querySelectorAll` 一次 hydrate。
3. **首屏上限**：可见区 + 预取 buffer（例如 ≤12 张）才签名；其余等 IO。
4. **消灭无效请求**：grid 未 `isGridThumbReady` 时不要先把错误 grid 路径写进 `img.src`；404 路径 `markPathMissing` 持久化，避免每张图双 404。
5. **查 500**：Network 里失败 `card-images` / `sign?ref=` → Worker 日志 + Supabase Storage 策略（`USE_STORAGE_TRANSFORM = false` 时依赖真实 `_grid.jpg` 文件）。
6. **后台**：`backfillGridThumbsForCards` 批量补 `_grid.jpg`，减少回退 full。

### 关键文件（定点改，勿通读 `script.js`）

| 文件 | 函数/区域 |
|------|-----------|
| `features-draft.js` | `hydrateFeedImages`, `hydrateFeedImageOne`, `applyFeedImageSrc`, `renderImageGenFeed`, `getImageGenWarehouseFeedList`, `imageGenFeedSignOpts` |
| `supabase-sync.js` | `hydrateImageElements`, `resolveDisplayUrl`, `prefetchCardsImages`, `pathsForVariant`, `backfillGridThumbsForCards` |
| `card-image-loader.js` | `observeContainer`, `loadImg`, `listImageVariant` |
| `script.js` | `hydrateWarehouseGridImages`, `renderCards`, `warmCardImagesBackground` |
| `server/` | `media-cdn.ts`、社区/自有 sign 路由 |

### 验收标准（用户 Network）

- 打开 **图片生成 → 仓库**，首屏 10s 内：**已传输 < 5 MB**（弱网可放宽），请求数以 **可见卡片数 × 1～2** 为量级，无连续 404/500 刷屏。
- 列表单张图片体积 **< 200 KB**（`_grid.jpg`）；点开作品详情/灯箱才出现 MB 级原图。
- 向下滚动：仅新进入视口的卡片新增请求。

### 控制台快速诊断

```javascript
window.__APP_BUILD__
document.querySelectorAll('#imageGenFeed img[data-image-ref]').length
[...document.querySelectorAll('#imageGenFeed img')].slice(0, 5).map(i => ({
  ref: i.dataset.imageRef?.slice(0, 40),
  src: i.src?.slice(0, 60),
  mb: i.complete && i.naturalWidth ? '(loaded)' : 'pending'
}))
performance.getEntriesByType('resource').filter(e => e.transferSize > 500000).length  // 大于 500KB 的资源条数
```

---

## 最近已修（2026-06-05，**不替代 P0 数据 gap**）

| 项 | 构建/说明 |
|----|-----------|
| **Feed 模块拆分** | `feed-images.js` · `image-gen-feed.js` + `wireFeed*`；`features-draft.js` ~10k→~9.5k 行 |
| **MobileUI 统一** | `mobile.js` 唯一 900px 断点；`script.js` / `features-draft.js` 走 `MobileUI.isMobileViewport` |
| **侧栏即时重排** | 社区/生图预览侧栏打开 `recalcCols` + immediate layout；ResizeObserver |
| **拆分回归** | `IMG_LOADING_PLACEHOLDER`、`feedImgStorageAttr` 接线（曾致卡片库/社区无图） |
| 卡片库列表优先 `_grid` | `20260603n～q` |
| P0 生图仓库带宽 cap | `20260606a` + 用户验收 `big:0` |

---

## 历史 P0（社区 / 侧栏，部分已修）

| 优先级 | 类型 | 状态 |
|--------|------|------|
| P0-1 | `communityImgInitialSrc` 传 `null` 崩侧栏 | **已修 20260601r** |
| P0-2 | 签名 404 / Storage 文件不存在 | **未完全解决** |
| P0-3 | `api.prompt-hub.cn` 偶发 `ERR_CONNECTION_CLOSED` | 间歇 |

详见下文「根因结论（2026-05-30）」与 Console 诊断命令。

---

## Cloudflare 每日请求 75% 提醒

- 上限 **100,000/天**；强刷 + 生图轮询 + **每张图多次 404/500 重试** 会快速吃额度。
- 查看：Cloudflare 控制台 → **Workers 和 Pages** → **概述** / **分析**
- 详见 `docs/DEBUG-GUIDE.md`

---

## 根因结论（2026-05-30 · 社区 Console）

```
图片签名 404 / API 断连
        ↓
图加载不出 → Masonry 高度错 → 社区中间空块
        ↓
renderCommunitySidePanel 抛错 → 侧栏全黑
```

**教训**：Network 里签名/404 未收敛前，不要继续只调 Masonry/CSS。

---

## 改代码前约定

- **用户 2026-06-06 明确要求**：本轮只更新文档，**下一条聊天再写代码**。
- 下一条：**P0-带宽（生图仓库懒加载 + 列表仅缩略图）** 优先于社区 CSS 微调。
- 修复后默认 `.\deploy-pages.ps1`；用户纯小白 → 分步 + 可复制命令。
- 勿提交密钥；仅用户要求时 `git commit`。

---

*最后更新：2026-06-06 · 用户 Network 截图：生图仓库 404/500 → 原图几十～上百 MB*
