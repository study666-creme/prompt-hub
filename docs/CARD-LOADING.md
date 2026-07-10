# 列表图片加载

## 目标

卡片库、社区和生图仓库需要在不拉取 full 原图的前提下快速显示首屏，并在滚动时稳定分页。长期引用存储在 JSON 中，浏览器通过 Worker 批量换取 CDN URL。

## 当前分页

| 列表 | 手机首批 | 桌面首批 | 后续 |
|---|---:|---:|---|
| 卡片库 | 12 | 24 | 滚动哨兵每页追加 |
| 社区/我的主页 | 12 | 24 | IntersectionObserver 追加 |
| 生图仓库 | 12 | 12 | 独立分页 store 追加 |

远端社区 head 可以缓存更多元数据，但首屏 DOM 仍受上表限制。

## 图片链路

```text
storage://card-images/{user}/{file}
  -> sign-batch / community sign-batch
  -> Worker 选择 _grid 路径
  -> /api/v1/media/i|c/{token}
  -> Cloudflare cache
  -> R2，缺失时按 r2-first 回源 MemFire Storage
```

详情、下载、Canvas 插入使用 `variant=full`。列表不得因为 grid 404 自动把所有卡片降级成 full。

## 关键模块

| 文件 | 职责 |
|---|---|
| `card-image-loader.js` | 队列、批量签名、IO、失败缓存和视口加载 |
| `card-image-loader-queues.js` | 并发和 cap 配置 |
| `warehouse-thumb.js` | 生图仓库 grid 缩略图请求 |
| `mobile.js` | 手机首屏 cap、滚动 boost |
| `legacy/script/part-09.js` | 卡片 DOM 分页与首屏绑定 |
| `feed-images.js` | 社区/生图引用归一化 |
| `server/src/routes/v1/media.ts` | upload、sign-batch、CDN URL |
| `server/src/lib/media-cdn.ts` | 路径候选、grid 物化和缓存 token |

## 手机滚动规则

`.app-main` 是唯一纵向滚动根。页面、feature shell 和 grid 不得再增加独立 `overflow-y:auto`。横向裁切优先 `overflow-x: clip`，避免浏览器把纵向 visible 计算成新的 auto 滚动容器。

新卡片进入视口可使用轻微 opacity/translate 缓出，但动画不能改变卡片尺寸、触发 Masonry 反复测量或在 `prefers-reduced-motion` 下强制播放。

## 失败处理

1. 先区分外链 404、R2 miss、Storage miss、签名 401 和 API 5xx。
2. 同一路径候选只尝试有限次数；失败写入短期缓存，防止滚动时刷请求。
3. 纯文字卡片不渲染图片占位符。
4. 只有对象确实存在但缺 grid 时才生成缩略图。
5. 不删除卡片或图片来消除灰卡；使用后台抽检定位元数据与对象差异。

## 验收

```powershell
npm run check:predeploy
node scripts/audit-production-mobile-first-screen.mjs
```

手机生产基线见 `CURRENT-ISSUES.md`。浏览器检查首批卡片数、单图体积、是否出现 full 路径、滚动后是否按页增加，以及 404 是否重复刷屏。
