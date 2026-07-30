# 社区架构

## 数据层

| 层 | 数据 | 用途 |
|---|---|---|
| `community_posts` | 已发布公共帖 | 游客和登录用户 Feed 真源 |
| `user_data.data.communityPosts` | 当前账号私有副本 | 跨设备编辑与恢复 |
| `cards[].publishedToCommunity` | 发布意图 | 保存卡片时同步公共帖 |
| `promptrepo_public_feed_cache` | 5 分钟浏览器缓存 | 快速恢复首屏 |

这四层不能当成同一个数组。公共 Feed 以 API 为准，私有副本和卡片用于合并、发布与恢复。

## 读取流程

```text
进入社区
  -> CommunityPublicFeed 读取有效缓存
  -> GET /api/v1/community/feed?limit=100&offset=0
  -> 归一化、去重、按活动排序
  -> paged store
  -> 手机 12 / 桌面 24 张进入 DOM
  -> 滚动哨兵追加下一页
```

API head 较大是为了减少后续 RTT 和支持随机/排序，不代表要一次渲染全部帖子。

公共 Feed 的任意非空缓存都可以用于首屏，不要求缓存先达到桌面端一页的 24 条。缓存不足一页时先渲染已有帖子，再用同一个共享 Promise 后台刷新；社区页与生图页的「获取」标签复用该请求，不各自启动重试链。排序或范围切换即使跳过新请求，也必须订阅正在进行的共享请求并在完成后重绘。首屏 head 请求使用 8 秒超时且不做嵌套自动重试，失败后自动刷新冷却 30 秒，用户点击「重试」仍可立即发起一次请求。服务端明确返回 `hasMore: false` 时，首屏列表和游标以该响应为准，并清除不再存在的缓存帖子；存在后续页时也以 API `nextOffset` 继续，不使用缓存长度跳页。

## 写入流程

```text
保存卡片 + publishedToCommunity
  -> syncCardToCommunity
  -> POST /api/v1/community/posts
  -> upsert community_posts
  -> 用户 JSON 延迟同步
```

下架使用 DELETE/同步接口更新公共表，并保留必要 tombstone，防止旧设备重新发布。

## 排版模式

| 容器 | 桌面 | 手机 |
|---|---|---|
| `communityGrid` | Masonry | CSS Grid |
| `creationsGrid` | flex 多列 | CSS Grid |
| `userProfileGrid` | Masonry | 响应式 grid/Masonry |

`feed-layout.js` 负责列数、Masonry 实例、增量 append 和诊断；`features-draft` 负责数据与 HTML。图片加载后只进行 debounce 布局，不清空容器、不全量 round-robin 分列。

## 关键文件

- `community-public-feed.js`: API 缓存、远端分页、归一化
- `legacy/features-draft/part-01.js`: paged store 与 DOM 增量追加
- `feed-layout.js`: 社区、主页和用户页布局
- `feed-images.js`: 图片引用与批量签名
- `server/src/routes/v1/community.ts`: 发布、删除、点赞、通知
- `server/src/lib/community-feed.ts`: 查询和公共帖子转换

## 排查

```javascript
({
  build: window.__APP_BUILD__,
  community: window.FeedLayout?.diagnose?.('communityGrid'),
  creations: window.FeedLayout?.diagnose?.('creationsGrid')
})
```

先比较 API `posts.length`、paged store 数量和 DOM 唯一 `data-post-id` 数量。若数据正确而布局错，再检查 Masonry 模式、容器宽度、重复卡片和图片 load 后的重排次数。
