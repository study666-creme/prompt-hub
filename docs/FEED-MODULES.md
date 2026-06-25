# Feed / 生图模块拆分（2026-06-07）

> 与 `feed-layout.js`、`feed-images.js`、`image-gen-feed.js` 配套。业务状态仍在 `features-draft.js`。  
> **勿**从 git 旧版 `features-draft.js` 整块恢复生图逻辑 — 见 `docs/AI-PITFALLS.md` 模块化条目。

## 脚本顺序（`index.html`）

```
mobile.js → script.js → pack-imagegen.js → pack-feed.js → community-public-feed.js → features-draft.js
```

- `mobile.js` 须在 `script.js` 之前（`MobileUI.isMobileViewport` 唯一来源）
- `pack-imagegen.js` 须在 `pack-feed.js` / `features-draft.js` 之前
- `community-public-feed.js` 独立带 `?v=`，**不在** `pack-feed.js` 内（防旧 bundle 缓存）

## Feed 四模块

| 模块 | 导出 | 职责 |
|------|------|------|
| `feed-layout.js` | `FeedLayout.*` | 社区 Masonry / 我的主页 flex / 手机 grid |
| `feed-images.js` | `FeedImages.*` | URL 解析、hydrate、`imageGenFeedSignOpts`、`feedImgStorageAttr` |
| `image-gen-feed.js` | `ImageGenFeed.*` | 生图仓库 Masonry、渲染、分页 |
| `community-public-feed.js` | `CommunityPublicFeed.*` | 全站社区 Feed API、缓存、分页拉取 |

## 生图 pack 子模块（`pack-imagegen.js`）

| 模块 | 全局 | 职责 |
|------|------|------|
| `imagegen-gen-errors.js` | `ImageGenGenErrors` | 错误文案、可恢复判定、轮询间隔 |
| `imagegen-job-runner.js` | `ImageGenJobRunner` | pending、轮询、resume、API 任务匹配 |
| `imagegen-poll-warehouse.js` | `ImageGenPollWarehouse` | 轮询结果落仓库、MJ 多图 |
| `imagegen-submit.js` | `ImageGenSubmit` | `runImageGenWithPrompt` 提交 |
| `imagegen-finish-run.js` | `ImageGenFinishRun` | `finishImageGenRun` 收尾 |
| `imagegen-ref-resolve.js` | `ImageGenRefResolve` | `resolveRefUrlsFromList` |
| `imagegen-ref-compress.js` | `ImageGenRefCompress` | 参考图压缩 |
| `imagegen-warehouse-save.js` | `ImageGenWarehouseSave` | `saveGeneratedToWarehouse` |
| `imagegen-warehouse-repair.js` | `ImageGenWarehouseRepair` | 仓库卡片图修复 |

`features-draft.js` 通过薄代理调用：`jr()` job-runner、`pw()` poll-warehouse、`fr()` finish-run、`ig()` submit、`rr()` ref-resolve、`wr()` repair 等。

## 仍留在 `features-draft.js`（有意不迁）

| 区域 | 说明 |
|------|------|
| 参考图 UI | `bindImageGenUpload`、`renderImageGenRefGallery`、标注器 — 下一步可选 `imagegen-ref-ui.js` |
| 社区 / 我的主页 | `renderCreations`、`renderCommunity`、发布开关 |
| 表单 / 模型选择 | `initImageGenForm`、`applyImageGenModelCatalog` |
| 状态变量 | `imageGenPendingJobs`、`creations`、`communityPosts` |

## 接线（`bootstrapFeatureDraft`）

```javascript
wireAllFeedModules();  // 顺序：JobRunner → Repair → RefCompress → WarehouseSave → RefResolve → FinishRun → Poll → Submit → Feed*
window.FeatureDraft = buildFeatureDraftExports();
```

## 部署前审计

```powershell
node scripts/audit-features-draft-exports.mjs   # export 不得引用未定义符号
node scripts/audit-features-draft-wire.mjs      # job-runner wire 不得裸引用
```

## 侧栏打开时的排版

桌面打开社区/我的主页/生图预览侧栏后，主区变窄 → 须 **立即** `recalcCols` 重排 Masonry/flex。

## 验收

```javascript
({
  build: window.__APP_BUILD__,
  modules: {
    FeedLayout: !!window.FeedLayout,
    FeedImages: !!window.FeedImages,
    ImageGenFeed: !!window.ImageGenFeed,
    ImageGenJobRunner: !!window.ImageGenJobRunner?.init
  },
  featureDraft: !!window.FeatureDraft?.hydrateFeedImages
})
```
