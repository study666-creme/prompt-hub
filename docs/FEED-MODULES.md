# Feed 模块拆分（2026-06-05）

> 与 `feed-layout.js`（排版）、`feed-images.js`（出图）、`image-gen-feed.js`（生图列表）配套。业务状态仍在 `features-draft.js`。

## 脚本顺序（`index.html`）

```
mobile.js → script.js → pack-feed.js → community-public-feed.js → features-draft.js
pack-imagegen.js（含 imagegen-gen-errors.js）在 pack-feed 之前加载
```

- `mobile.js` 须在 `script.js` 之前（`MobileUI.isMobileViewport` 唯一来源）
- `pack-feed.js` + `community-public-feed.js` 须在 `features-draft.js` 之前
- `community-public-feed.js` 独立带 `?v=`，**不在** `pack-feed.js` 内（防旧 bundle 缓存）

## 模块职责

| 模块 | 导出 | 职责 |
|------|------|------|
| `feed-layout.js` | `FeedLayout.*` | 社区 Masonry / 我的主页 flex / 手机 grid |
| `feed-images.js` | `FeedImages.*` | URL 解析、hydrate、`imageGenFeedSignOpts`、`feedImgStorageAttr` |
| `image-gen-feed.js` | `ImageGenFeed.*` | 生图仓库 Masonry、渲染、分页 |
| `community-public-feed.js` | `CommunityPublicFeed.*` | 全站社区 Feed API、缓存、分页拉取 |
| `imagegen-gen-errors.js` | `ImageGenGenErrors.*` | 生图错误文案、可恢复判定、轮询间隔 |
| `imagegen-job-runner.js` | `ImageGenJobRunner.*` | pending 持久化、轮询、resume 恢复、API 任务匹配 |
| `features-draft.js` | `FeatureDraft.*` | `wireFeedLayout` / `wireFeedImages` / `wireImageGenFeed` / `wireCommunityPublicFeed` |

## 接线（解析时执行）

```javascript
wireFeedImages();      // FeedImages.init(deps)
wireImageGenFeed();    // ImageGenFeed.init(deps)
wireFeedLayout();      // FeedLayout.init(deps)
```

## 侧栏打开时的排版

桌面打开社区/我的主页/生图预览侧栏后，主区变窄 → 须 **立即** `recalcCols` 重排 Masonry/flex，否则最右列被侧栏遮住。

- 社区/我的主页：`relayoutFeedGridAfterSidePanel()` → `scheduleCommunityLayout({ immediate: true, recalcCols: true })`
- 生图预览：`scheduleImageGenFeedLayout({ immediate: true })` + `.imagegen-side` ResizeObserver

## 验收

```javascript
({
  build: window.__APP_BUILD__,
  modules: { FeedLayout: !!window.FeedLayout, FeedImages: !!window.FeedImages, ImageGenFeed: !!window.ImageGenFeed },
  mobile: window.MobileUI?.isMobileViewport?.()
})
```
