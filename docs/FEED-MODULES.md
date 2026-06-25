# Feed 模块拆分（2026-06-05）

> 与 `feed-layout.js`（排版）、`feed-images.js`（出图）、`image-gen-feed.js`（生图列表）配套。业务状态仍在 `features-draft.js`。

## 脚本顺序（`index.html`）

```
mobile.js → script.js → feed-layout.js → feed-images.js → image-gen-feed.js → community-public-feed.js → features-draft.js
```

- `mobile.js` 须在 `script.js` 之前（`MobileUI.isMobileViewport` 唯一来源）
- 三个 feed 模块须在 `features-draft.js` 之前

## 模块职责

| 模块 | 导出 | 职责 |
|------|------|------|
| `feed-layout.js` | `FeedLayout.*` | 社区 Masonry / 我的主页 flex / 手机 grid |
| `feed-images.js` | `FeedImages.*` | URL 解析、hydrate、`imageGenFeedSignOpts`、`feedImgStorageAttr` |
| `image-gen-feed.js` | `ImageGenFeed.*` | 生图仓库 Masonry、渲染、分页 |
| `community-public-feed.js` | `CommunityPublicFeed.*` | 全站社区 Feed API、缓存、分页拉取 |
| `features-draft.js` | `FeatureDraft.*` | `wireFeedLayout` / `wireFeedImages` / `wireImageGenFeed` |

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
