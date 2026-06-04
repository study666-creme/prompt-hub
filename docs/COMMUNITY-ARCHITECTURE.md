# 社区模块架构与数据流

> 对应文件：`features-draft.js`、`server/src/lib/community-feed.ts`、`api-client.js`  
> 已知故障：`docs/CURRENT-ISSUES.md`  
> **踩坑（必读）**：`docs/AI-PITFALLS.md` — 社区 flex 列、禁止全墙重排、SyntaxError 炸站

### 桌面布局（2026-06-05）

- **社区 `#communityGrid`**：桌面 **Masonry**（`feed-layout.js`）；`gutter` 管列距，上下靠 `margin-bottom: --card-row-gap`。
- **我的主页 `#creationsGrid`**：桌面 **flex 多列**（`.community-feed-col`），新卡 append 到最短列。
- **禁止**：`flattenCommunityFeedColumns` + 全量 round-robin（除非列结构损坏）；`finishCardMediaShine` 触发全墙 flex 重分。
- **分页**：首屏 `drainCommunityFeedPages(5)`；滚到底哨兵再 `loadNextCommunityFeedPage`。
- **排版模块**：`feed-layout.js` + `features-draft.js` 内 `wireFeedLayout()`；详见 `docs/FEED-LAYOUT.md`。

---

## 产品行为（预期）

| 角色 | 预期 |
|------|------|
| 游客 | 浏览 `全部作品`；点赞/收藏需登录；图走社区签名 API |
| 登录用户 | 看全站 Feed + 自己的发布；可从卡片库「发布到社区」 |
| 作者 | 在卡片库下架/删除；同步到 `community_posts` |

---

## 请求链路（读 Feed）

```
用户打开「提示词社区」
  → switchAppPage('community')
  → FeatureDraft.onAppChange('community')
  → renderCommunity({ immediate: true })
  → renderCommunityNow
       ├─ refreshPublicCommunityFeed()     // GET /api/v1/community/feed
       │     └─ publicFeedPosts = r.data.posts
       ├─ maybeReconcileCommunityWithCards // 登录时，与 __promptHubCards 对齐
       └─ getAllCommunityPosts()
             └─ merge(publicFeedPosts, communityPosts, buildPostsFromPublishedCards)
  → renderPostsIntoContainer → Masonry
```

**写帖链路：**

```
卡片保存 + publishedToCommunity
  → syncCardToCommunity (features-draft.js)
  → pushPostToPublicFeed → POST /api/v1/community/posts
  → upsertCommunityPost (community-feed.ts) → community_posts 表
  → scheduleCloudPush → user_data.data.communityPosts
```

---

## API 端点

| 方法 | 路径 | 认证 | 实现 |
|------|------|------|------|
| GET | `/api/v1/community/feed?limit=&offset=` | 否 | `communityFeedHandler` |
| POST | `/api/v1/community/posts` | Bearer | `upsertCommunityPost` |
| POST | `/api/v1/community/posts/sync` | Bearer | `syncAuthorCommunityPosts` |
| DELETE | `/api/v1/community/posts/:id` | Bearer | `unpublishCommunityPost` |
| GET | `/api/v1/media/community/sign` | 否* | 社区图签名 |

\* 具体见 `media.ts`；游客可读已发布帖的图。

Feed 首屏（offset=0）Worker 会尝试：

1. `repairMisattributedCommunityAuthors`
2. `unpublishGhostCommunityPosts`
3. `unpublishDuplicateCommunityPosts`

---

## 关键函数行为（易踩坑）

### `reconcileCommunityWithCards(cardList)`

- 目的：本地 `communityPosts` 与卡片库一致。
- **风险**：`source_card_id` 不在 `cardList` 时，历史上会 **从 communityPosts 移除** 该帖（即使 DB 仍有）。
- `20260614b`：对 **当前用户** 的帖，若仅在 `publicFeedPosts` 存在，尝试保留到 `ownBySource`。

### `pruneOwnOrphanCommunityPosts`

- 删掉「自己的帖」但卡片库无对应 id 的项（`publicFeedPosts` 在 20260614b 加入白名单）。

### `filterCommunityPostsForDisplay`

- 过滤 mock、墓碑、`authorId` 非 UUID。
- `skipCardTombstones: true` 时用于 **publicFeedPosts**（避免删卡后全站帖消失）。

### `mergePostsLists` / `communityPostDisplayKey`

- 去重键：`sourceCardId` 或 `prompt + 图片 owner`。
- 同 prompt 多条可能合并为一条（游客曾见「重复」原因之一）。

---

## UI 入口

| 入口 | 位置 |
|------|------|
| 同步卡片库 → 社区 | 社区顶栏 `communitySyncLibraryBtn`；卡片库设置 → 社区 |
| 从社区恢复卡片库 | 卡片库设置 → 社区（`restoreCardsFromCommunityFeed`） |
| 从云端恢复卡片 | 卡片库设置 → 数据管理 / 空态按钮 `syncCloudNow` |

左侧 **「设置」** = 外观/昼夜；**卡片库设置** = ⚙️ 字段 & 设置。

---

## 布局

- 桌面：`Masonry`（`layoutCommunityMasonry`），列数 `--card-columns`。
- 移动：`useCssGridForCommunityFeed` → CSS Grid。
- 侧栏详情：`communitySidePanel` + `#communitySideBody`；`openPostSidePanel` → `renderCommunitySidePanel`。
- 结构参考卡片库：`#cardsContainer` | `#editPanel`（340px）→ 社区为 `#communityGrid` | `#communitySidePanel`（`.community-workspace`）。

抖动：图片 `load` → `scheduleCommunityLayout` → `instance.layout()`。

### 已知布局故障（2026-05-30 · 未解决）

详见 **`docs/CURRENT-ISSUES.md` 问题 A/B**。摘要：

| 问题 | 现象 |
|------|------|
| **A 侧栏空白** | 侧栏打开、标题有，`communitySideBody` 无可见内容（全黑） |
| **B Masonry 空洞** | 滚动后网格中间大块空白、列距不齐 |

关键文件：`features-draft.js`（`renderCommunitySidePanel`、`layoutCommunityMasonry`）、`styles-features.css`（`.community-side-*`）、`styles.css`（桌面 `#communityGrid` Masonry 规则）。

---

## 调试清单

1. Network：`/api/v1/community/feed` 状态码与 `posts.length`。
2. `publicFeedAt` 是否 > 0（否则游客 loading）。
3. `communityPosts.length` vs `publicFeedPosts.length`。
4. `__promptHubCards.length` 与 DB `source_card_id` 集合是否交集。
5. `settings.deletedCardTombstones` 是否误伤。
6. 侧栏：`#communitySideBody` 的 `innerHTML` 长度与 `.community-side-prompt` 是否存在（问题 A）。
7. 空洞处 `.card` 的 inline `top/left/width` 与 Masonry 实例是否一致（问题 B）。
8. SW 与 `__APP_BUILD__` 是否最新。
