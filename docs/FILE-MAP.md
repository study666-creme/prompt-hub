# 代码导航图（按任务找文件）

> 不必全仓搜索；按任务跳到文件 + 函数名。

---

## 一页总览

| 你想改… | 主文件 | 次要文件 |
|---------|--------|----------|
| 卡片库 CRUD、分组、Masonry | `script.js` | `styles.css`, `mobile.js` |
| 登录 / 登出 / 云拉取 | `script.js` | `supabase-sync.js`, `cloud-sync-safety.js` |
| **社区 Masonry / 我的主页 flex** | `feed-layout.js` | `features-draft.js`（`wireFeedLayout`） |
| **Feed 图片 hydrate / 签名** | `feed-images.js` | `features-draft.js`（`wireFeedImages`） |
| **生图仓库 Feed 排版/渲染** | `image-gen-feed.js` | `features-draft.js`（`wireImageGenFeed`） |
| **社区 Feed、发布、我发布的** | `features-draft.js` | `feed-layout.js`, `feed-images.js`, `image-gen-feed.js` |
| 图片签名 URL | `supabase-sync.js` | `server/src/routes/v1/media.ts` |
| 全站社区 API / DB | `server/src/lib/community-feed.ts` | `server/src/routes/v1/community.ts` |
| 生图扣费 | `features-draft.js` + `api-client.js` | `server/src/routes/v1/generate.ts` |
| **生图 524 / 后台提交** | `server/src/lib/fast-provider-submit.ts` | `server/src/routes/v1/generate.ts`（GrsAI/Apimart 异步） |
| **木瓜慢速线** | `server/src/lib/mooko.ts` · `mooko-submit.ts` · `mooko-drain.ts` | Cron + `POST /generate` 触发 drain |
| **4K 原图下载** | `supabase-sync.js`（`downloadCardFullResBlob`） | `script.js`（`downloadCardImageFile`） |
| **卡片上传 50MB** | `server/src/routes/v1/media.ts` | `supabase-sync.js` · `index.html` 文案 |
| **生图滚轮 / 灯箱** | `script.js`（`attachImageZoom`, `loadLightboxImage`） | `features-draft.js`（预览侧栏） |
| 会员 / 积分 UI | `membership.js`, `subscription.js` | `server/src/routes/v1/me.ts` |
| 部署 Pages | `deploy-pages.ps1` | `index.html`（`__APP_BUILD__`）, `sw.js` |
| 部署 Worker | `server/package.json` scripts | `server/wrangler.toml` |
| 数据库表 | `supabase/migrations/*.sql` | Supabase SQL Editor |
| **备份 / R2** | `docs/SUPABASE-BACKUP-BEGINNER.md` · `docs/R2-MIGRATION.md` · `scripts/sync-supabase-to-r2.mjs` | Pro 恢复后 |
| **迁 MemFire** | `docs/MEMFIRE-MIGRATION.md` · `scripts/memfire-upload-storage.mjs` · `scripts/memfire-preflight.mjs` | 迁前必先备份 |
| R2 读写在 Worker | `server/src/lib/r2-storage.ts` · `MEDIA_STORAGE_MODE` | `wrangler.toml` 绑定 `CARD_IMAGES_R2` |
| **资产创作 / 画布导出** | `asset-studio.js` · `asset-studio.html` | `docs/VIDEO-CANVAS-EXPORT.md`（zip 结构、LibTV 手动 `@`） |

---

## `script.js`（卡片库 + Auth，约 5000+ 行）

| 区域 | 函数/变量 | 作用 |
|------|-----------|------|
| 初始化 | `init()` IIFE 末尾 | `openDB`, `initSupabaseAuth`, `finishAppBootstrap` |
| 登录后 | `handleCloudAfterLogin` | 拉 `user_data`、合并卡片、触发 `FeatureDraft.reconcileCommunityWithCards` |
| 登录 UI | `completeAuthSession`, `authSignIn` | Supabase session；`promptrepo_post_logout` 标志 |
| 退出 | `purgeSignedOutLocalData`, `bootstrapWhenLoggedOut` | 清本地卡/社区缓存 |
| 卡片数据 | `cards`, `window.__promptHubCards` | 内存主列表；`persistPromptHubCards` 写 IDB+云 |
| 墓碑 | `recordCardDeletion`, `getDeletedCardTombstones` | 删卡后防止云端复活 |
| 导航 | `switchAppPage` | `warehouse` / `community` / `creations` / `imagegen` |
| 云同步 | `pullFromCloud`, `pushToCloud`, `syncCloudNow` | `user_data` JSON |

---

## `features-draft.js`（社区 + 生图，约 9500 行）

| 区域 | 函数/变量 | 作用 |
|------|-----------|------|
| 排版入口 | `wireFeedLayout()` | 启动时注入 `FeedLayout.init(deps)` |
| 图片入口 | `wireFeedImages()` | 注入 `FeedImages.init(deps)` → `hydrateFeedImages` 等 |
| 生图 Feed | `wireImageGenFeed()` | 注入 `ImageGenFeed.init(deps)` → `renderImageGenFeed` 等 |
| 状态 | `communityPosts` | 账号私有社区帖（localStorage + 云 JSON） |
| 状态 | `publicFeedPosts` | **全站 API Feed 缓存**（`20260614b` 新增） |
| 拉 Feed | `refreshPublicCommunityFeed` | `PromptHubApi.getCommunityFeed` |
| 展示列表 | `getAllCommunityPosts` | 合并 public + local + `buildPostsFromPublishedCards` |
| 对齐卡片库 | `reconcileCommunityWithCards`, `pruneOwnOrphanCommunityPosts` | **易误删「库中无卡」的社区帖** |
| 渲染 | `renderCommunity`, `renderCommunityNow`, `renderPostsIntoContainer` | Masonry / flex / 空态 / loading |
| 布局 | `layoutCommunityMasonry`, `scheduleCommunityLayout` | 委托 `FeedLayout.*` |
| 同步 | `runSyncCardLibraryToCommunity`, `syncEligibleCardsToCommunity` | 卡片库 → 社区 |
| 恢复 | `restoreCardsFromCommunityFeed` | 社区 → 卡片库（`20260614b`） |
| 导出 | `window.FeatureDraft` | 外部调用入口 |
| 调试 | `window.forceRefreshAllImages` | 手动刷新各 Feed 图片与排版 |
| 生图预览 / 灯箱 | `renderImageGenPreview`, `bindImageGenPreviewWheelScroll`, `navigateImageGenPreviewByWheel` |
| **生图滚轮缩放** | `attachImageZoom`, `loadLightboxImage`, `onViewerShellWheel`（`script.js`） |
| 批量社区公开 | `batchPublishCommunity`, `batchUnpublishCommunity`（`script.js`） |
| 生图 Feed / 轮询 | `renderImageGenFeed`（`image-gen-feed.js`）, `pollGenerationJobUntilDone` | 进行中任务会周期性打 Worker |

---

## `feed-images.js`（Feed 图片，约 550 行）

| 区域 | 函数 | 作用 |
|------|------|------|
| 签名 | `imageGenFeedSignOpts`, `communityImageSignOpts` | 列表图 resolve 选项 |
| hydrate | `hydrateFeedImages`, `applyFeedImageSrc` | 社区/生图 Feed 出图 |
| 清理 | `removeBrokenCommunityFeedCard`, `stripFailedFeedMedia` | 坏图卡片处理 |

---

## `image-gen-feed.js`（生图仓库 Feed，约 660 行）

| 区域 | 函数 | 作用 |
|------|------|------|
| Masonry | `layoutImageGenFeedMasonry`, `scheduleImageGenFeedLayout` | 桌面瀑布流 |
| 渲染 | `renderImageGenFeed`, `buildFeedCardHtml` | 仓库/社区 Tab 列表 |
| 分页 | `bindImageGenFeedPagedScroll` | 滚动加载更多 |

---

## `feed-layout.js`（Feed 排版，约 850 行）

| 区域 | 函数 | 作用 |
|------|------|------|
| 模式 | `getMode`, `useFlexColumns`, `useMobileGrid` | 社区 Masonry / 我的主页 flex / 手机 grid |
| 排版 | `layout`, `layoutFlex`, `schedule` | Masonry 实例与 flex 分列 |
| 修复 | `repairCreations`, `repairFlex`, `diagnose` | 条缝/孤儿卡检测与修复 |
| 调试 | `FeedLayout.diagnose('communityGrid')` | 见 `docs/FEED-LAYOUT.md` |

---

## `supabase-sync.js`

| 函数 | 作用 |
|------|------|
| `init`, `onAuthStateChange` | Session |
| `pullCloudData` / `pushCloudData` | `user_data` 表 |
| `signCommunityMediaRef`, `prefetchCommunityDisplayUrls` | 社区图签名 |
| `uploadCardImage`, `normalizeImageRef` | Storage `card-images/{uid}/…` |

---

## `cloud-sync-safety.js`

| 函数 | 作用 |
|------|------|
| `mergePayload` | 登录拉云时合并 cards / communityPosts |
| `mergeCommunityPostsList` | 按 `sourceCardId` / `id` 合并社区帖 |
| `validatePush` | 防止空数组覆盖云端 |

---

## `api-client.js`

| 函数 | 路径 |
|------|------|
| `getCommunityFeed` | `GET /api/v1/community/feed` |
| `publishCommunityPost` | `POST /api/v1/community/posts` |
| `syncCommunityPostsBatch` | `POST /api/v1/community/posts/sync` |
| `signCommunityMediaRef` | `GET /api/v1/media/community/sign` |

---

## `server/src/lib/community-feed.ts`

| 函数 | 作用 |
|------|------|
| `listPublicCommunityFeed` | 读 `community_posts`，去重，可选 repair |
| `repairMisattributedCommunityAuthors` | 图片路径 UUID ≠ author_id 时修正 |
| `unpublishGhostCommunityPosts` | 下架无效作者/无图帖 |
| `upsertCommunityPost` | 发布；校验图片归属 |
| `dedupeCommunityFeedPosts` | 同 `source_card_id` 保留最新 |

---

## `index.html` 脚本加载顺序（节选）

1. `supabase-config.js` / `api-config.js`
2. `supabase-sync.js` · `cloud-sync-safety.js` · `api-client.js`
3. `masonry.pkgd.min.js`
4. **`mobile.js`**（`MobileUI.isMobileViewport` 唯一来源，须在 `script.js` 之前）
5. `script.js`
6. **`feed-layout.js`** → **`feed-images.js`** → **`image-gen-feed.js`**（均须在 `features-draft.js` 之前）
7. `features-draft.js` · `community-gacha.js` · `features-assets.js`
8. `pwa-install.js`

> 手机断点 **900px** 仅定义在 `mobile.js`（`MobileUI.isMobile` / `isMobileViewport` 等价）。

> `hotfix-image-layout.js` 已废弃（逻辑并入 `features-draft.js`）；`hotfix-community-layout.js` 已删除。

---

## localStorage / sessionStorage 键（社区相关）

| 键 | 含义 |
|----|------|
| `promptrepo_community_posts` | 本地社区帖副本 |
| `promptrepo_public_feed_cache` | 游客/离线 Feed 缓存 |
| `promptrepo_post_logout` | 退出标志（影响登录） |
| `promptrepo_last_uid` | 上次登录 uid |
| `promptrepo_app_build` | 构建号比对自动刷新 |

详见 `docs/DATA-MODEL.md`。
