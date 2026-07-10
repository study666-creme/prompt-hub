# 手机端加载 / 腰斩问题（P0 排查手册）

> **接手顺序**：本文 → `CARD-LOADING.md` → `AI-PITFALLS.md` §手机  
> 最后更新：**2026-06-30** · build **`20260630b`** 起

---

## 典型现象

| 现象 | 常见根因 |
|------|----------|
| **点卡片卡半天 / 多点卡死** | 手机点卡片曾 **整页弹编辑侧栏** + `updatePreview` 联网签 URL + `openEditPanel` 触发全网格 `enforceMobileCardGrid`（**20260630b** 已改：手机点卡片不弹侧栏，仅「编辑」按钮） |
| 卡片库只有置顶 4 张有图，其余纯文字/灰块 | ① `renderCards` 曾 **await prefetch 才插 DOM**（已删）② warehouse-thumbs 慢/空 |
| 下半屏纯黑、滑不动 | 多层 `overflow-y:auto`（`feature-shell` / `feature-body` / grid）+ Masonry inline height |
| 生图「作品」只能看 2 张、滑不动 | **`styles-features.css` 5330 行** `#pageImageGen { overflow:hidden; flex:1 }` 裁切一屏 |
| 桌面正常、手机几乎不可用 | 手机单独 cap（`MobileUI.MOBILE_PERF`）+ 滚动架构与桌面不同 |

---

## 手机架构（2026-06-28 定稿）

```
body (100dvh, overflow:hidden)
  app-chrome
    app-main  ← **唯一滚动根** (overflow-y:auto, padding-bottom 底栏)
      app-page.active (flex:none, height:auto, overflow:visible)
        feature-shell / main-content (overflow:visible)
          #cardsContainer / #communityGrid / #imageGenFeed
    mobile-bottom-nav (fixed)
```

**禁止**在手机社区/卡片库/生图 feed 给中间层加 `overflow-y:auto` 或 `flex:1 min-height:0`。

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `mobile.js` | `MOBILE_PERF`、`bindMobileAppMainScrollBoost`、`scheduleMobileImageBoostBurst` |
| `card-image-loader.js` | IO root → `.app-main`；`whenContainerReady`（**卡片库/生图 feed 不阻塞**）；`boostWarehouseImages` |
| `script.js` | `renderCards` **先插 DOM 再异步 prefetch**；`warehouseScrollRoot` → `.app-main` |
| `warehouse-thumb.js` | 生图卡 `POST warehouse-thumbs` 批量 grid（手机 batch=24 delay=0） |
| `supabase-sync.js` | `prefetchCardsImages` 并行签 grid + warehouse-thumbs |
| `image-gen-feed.js` | 手机 feed prefetch/boost 24 |
| `styles-features.css` / `styles-mobile.css` | 手机单滚动 CSS（文件末尾兜底块） |

---

## 参数（`mobile.js` · `MOBILE_PERF`）

| 键 | 含义 | 20260629d 值 |
|----|------|----------------|
| `warehousePrefetchCap` | 首屏预热卡数 | 24 |
| `cardEagerCap` / `cardFirstScreenCap` | 不等 IO 直接 load 的上限 | 24 |
| `MOBILE_PER_PAGE` | 卡片库移动端首批 DOM / 分页数量 | 24 |
| `igFeedPatchMax` / `igFeedPrefetchCap` / `igFeedBoostMax` | 生图 feed | 24 |
| `maxResolve` / `maxDownload` | 并发签 URL / 下载 | 12 / 10 |
| `warehouseThumbBatch` | warehouse-thumbs 每批 | 24 |
| `warehouseThumbDelay` | 批间隔 | **0**（手机立即 flush） |
| `firstScreenCapMs` | 首屏预热最长等待 | 5000ms |

**勿再**把手机 cap 压到 8 以下「省流量」——会导致 840 张库几乎只有置顶有图。

移动端必须只由 `.app-main` 纵向滚动。需要裁掉横向溢出时使用 `overflow-x: clip`；`overflow-x: hidden` 会让同元素的 `overflow-y: visible` 按 CSS 规范计算成 `auto`，重新制造双滚动根。

---

## 加载时序（2026-06-29 定稿）

1. `renderCards` 立刻插入 DOM（placeholder SVG）
2. `bindWarehouse` 并行：`prefetchList` + `observeContainer`
3. **`loadImg` 最多等 prefetch 320ms**（`whenContainerReady`），视口内即开载
4. `IntersectionObserver` root = `.app-main`，`rootMargin` 520px
5. `scheduleMobileImageBoostBurst`：切页后 12 秒内每 2 秒 `boostActivePageImages`
6. `.app-main` scroll → `boostWarehouseImages`（**分页仅 IO 哨兵**，scroll 不再双触发 `loadNextWarehousePage`）

---

## 30 秒自检（让用户 F12 或 Eruda 跑）

```javascript
(() => {
  const main = document.querySelector('.app-main');
  const wh = document.getElementById('cardsContainer');
  const ig = document.getElementById('imageGenFeed');
  return {
    build: window.__APP_BUILD__,
    mainOverflow: main ? getComputedStyle(main).overflowY : null,
    mainScrollH: main?.scrollHeight,
    mainClientH: main?.clientHeight,
    gridCards: wh?.querySelectorAll('.card').length,
    gridWithImg: wh ? [...wh.querySelectorAll('.card-img')].filter(i => i.complete && i.naturalWidth > 8).length : 0,
    igCards: ig?.querySelectorAll('.imagegen-feed-card').length,
    igWithImg: ig ? [...ig.querySelectorAll('img[data-image-ref]')].filter(i => i.complete && i.naturalWidth > 8).length : 0,
    perf: window.MobileUI?.getPerf?.()
  };
})();
```

期望：`mainOverflow === 'auto'`；数秒内 `gridWithImg` / `igWithImg` 持续增加。

---

## 修完必做

1. `.\scripts\bump-build.ps1` → `.\deploy-pages.ps1`
2. 用户 **强刷**（手机：清除站点数据或无痕）确认 `window.__APP_BUILD__`
3. 卡片库：首屏 24 张内数秒内出图；**向下滑**后续继续加载
4. 生图 → 仓库 tab：首屏 12+ 张卡片 DOM，图陆续出现
5. 社区：卡片库 → 社区 → 卡片库，无下半屏黑区
6. 更新 `docs/PROJECT_CONTEXT.md` 构建号

---

## 历史踩坑（勿重复）

1. **`#pageImageGen` feed 视图 `overflow:hidden`** → 生图「作品」只能看 2 张（20260629e 改 visible + flex:none）
2. **`whenContainerSigned` 阻塞 loadImg** → 整批 prefetch 完才出图（20260629c 改 `whenContainerReady` 立即 resolve）
3. **`feedObserverBound` 阻止 IO 重绑** → 切页后懒加载失效（20260629c）
4. **cap 不一致 8/12/16** → prefetch 24 但 patch/boost 只 10（20260629c 统一 24）
