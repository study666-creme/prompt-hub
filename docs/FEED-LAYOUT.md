# Feed 排版模块（`feed-layout.js`）

社区 / 我的主页 / 个人弹层作品列表的 DOM 排版与 `features-draft.js` 业务解耦。

## 模式对照

| 容器 ID | 桌面 | 手机 |
|---------|------|------|
| `communityGrid` | Masonry（列距 `gutter`；**上下间距靠 CSS `margin-bottom`**） | CSS 两列 `mobile-grid` |
| `creationsGrid` | flex 多列 `.community-feed-col`（文档流） | `mobile-grid` |
| `userProfileGrid` | Masonry | Masonry |

## 调试（控制台）

```javascript
({
  build: window.__APP_BUILD__,
  community: window.FeedLayout?.diagnose?.('communityGrid'),
  creations: window.FeedLayout?.diagnose?.('creationsGrid')
})
```

### 如何读 `diagnose`

| 字段 | 社区 Masonry | 我的主页 flex |
|------|----------------|----------------|
| `mode` | `masonry` | `flex-columns` |
| `feedCols` | 0（正常，无 `.community-feed-col`） | ≥2 |
| `orphanCards` / `directCards` | 直挂 `#communityGrid > .card` 数量（**Masonry 正常**） | 应为 **0** |
| `masonryReady` | `true` | `false` |

我的主页额外验收：

```javascript
({
  mode: window.FeatureDraft?.getFeedLayoutMode?.('creationsGrid'),
  feedCols: document.querySelectorAll('#creationsGrid > .community-feed-col').length,
  orphanCards: document.querySelectorAll('#creationsGrid > .card').length
})
```

## 文件职责

- **`feed-layout.js`**：列数、flex 分卡、Masonry 实例、resize/图片 debounce 重排、`diagnose`。
- **`features-draft.js`**：帖子数据、渲染 HTML、`wireFeedLayout()` 注入依赖。

## 社区上下间距（2026-06-05 现状）

**部分改善，暂维持现状。**

- 列/行 gap 已与 `--card-row-gap` 对齐；排版后写入 `--feed-row-gap`。
- 用户反馈：多数时候稳定；偶发略大间距不如以前明显。
- **仍可能在图片未加载完时出现**，等一会或点卡片开侧栏后通常会排齐（debounce Masonry 重排）。
- 勿与我的主页 flex 共用「已排版」判断；勿恢复全墙 flex 重分。

详见 `docs/ERROR-LOG.md` §2.6。

## 部署注意

`index.html` 中 `feed-layout.js?v=`、`features-draft.js?v=` 须与 `window.__APP_BUILD__` 一致；`scripts/bump-build.ps1` 会同步脚本版本号。
