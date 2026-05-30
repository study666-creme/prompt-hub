# 卡片库图片加载（为什么比 LabGen 慢、我们怎么优化）

## 和 LabGen / 普通「提示词列表」的差别

| | LabGen 类站点 | Prompt Hub（当前） |
|---|---------------|-------------------|
| 列表数据 | 接口一次返回 **可直接访问的图片 URL**（CDN） | 卡片 JSON 里多是 `storage://...` **私有路径** |
| 浏览器加载 | `<img src="https://cdn...">` 立刻并行下载 | 要先 **批量向 Supabase 换签名 URL**（网络往返） |
| 布局 | 多为固定网格 / 稳定高度 | Masonry 瀑布流，**每张图高度变化要重排** |
| 数量 | 虚拟列表只渲染可见项 | 一页最多 24 张，但曾 **等签名完才插入 DOM** |

所以不是「几张卡就该卡」，而是 **每张图多了一步「换链接」+ 瀑布流重排」**。15 张在弱网下也会明显慢。

## 当前加载管线（构建号 `20260530d` 起）

1. **立刻渲染文字和卡片骨架**（不再 `await` 等签名才插入 DOM）
2. **自有图片**：优先 **Supabase 客户端批量签名**（不走 Worker，避免 429）
3. **后台** `prefetchCardsImages`：最多 **48** 张、并发 **12**；签完 `patchImageSrcFromCache` + `patchVisibleFromCache`
4. **社区同步**：`posts/sync` **批量一条**，禁止对每张卡 `POST /community/posts`（曾触发 429）
3. **视口懒加载** `card-image-loader.js`：只给看得见（+ 下方 280px）的图设 `src`；放大预览用 `variant: 'full'` 原图
4. **Masonry**：合并重排（约 160ms 防抖），避免每张图 load 都 destroy 布局

关键文件：

- `card-image-loader.js` — 懒加载 + 应用 URL
- `supabase-sync.js` — `prefetchCardsImages`、`getCachedDisplayUrl(image, cardId)`
- `script.js` — `renderCards` 非阻塞、`warmCardImagesBackground`

## 本地验证

```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

打开 http://127.0.0.1:5500/ ，F12 → Network：

- 应先看到 **卡片文字**，再陆续出现图片请求（`storage` 签名后的 `https://...`）
- 控制台：`window.__APP_BUILD__` → `'20260606m'`

## 后续可继续做（路线图）

- [ ] 列表专用 **缩略图**（上传时写 `_thumb.jpg`，列表只拉小图）
- [ ] 签名 URL 写入 IndexedDB 会话缓存，刷新少打 Supabase
- [ ] 首屏虚拟列表（>100 张时）
- [ ] 公共读桶 + CDN（需安全评估）
