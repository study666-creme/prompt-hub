# 卡片库图片加载（为什么比 LabGen 慢、我们怎么优化）

## 和 LabGen / 普通「提示词列表」的差别

| | LabGen 类站点 | Prompt Hub（当前） |
|---|---------------|-------------------|
| 列表数据 | 接口一次返回 **可直接访问的图片 URL**（CDN） | 卡片 JSON 里多是 `storage://...` **私有路径** |
| 浏览器加载 | `<img src="https://cdn...">` 立刻并行下载 | 要先 **批量向 API/Supabase 换签名 URL** |
| 布局 | 多为固定网格 / 稳定高度 | Masonry 瀑布流，**每张图高度变化要重排** |
| 数量 | 虚拟列表只渲染可见项 | 一页 24 张 + 懒加载预取 |

所以不是「几张卡就该卡」，而是 **每张图多一步换链接 + 瀑布流重排**。当前已通过 grid 缩略图 + 懒加载把首屏压到 **~1 MB 级已传输**（2026-06 用户验收）。

## 当前加载管线（build `20260625e` 起）

1. **立刻渲染文字和卡片骨架**（不等签名才插入 DOM）
2. **自有图片**：Supabase 客户端批量签名 + Worker `sign-batch`（社区）
3. **后台 prefetch**：cap 并发；签完 `patchImageSrcFromCache`
4. **视口懒加载** `card-image-loader.js`：视口 + rootMargin 内才设 `src`；灯箱/详情才 full
5. **Masonry**：合并重排（防抖）

关键文件：

- `card-image-loader.js` — 懒加载 + 应用 URL
- `supabase-sync.js` — `prefetchCardsImages`、`getCachedDisplayUrl`
- `script.js` — `renderCards` → `hydrateWarehouseGridImages`
- `features-draft.js` — 生图仓库 Feed hydrate（与卡片库共用 grid-only 策略）

## 验收标准（2026-06-07 · **已通过**）

| 页面 | 指标 |
|------|------|
| 卡片库 | 首屏已传输 **< 2 MB**，DOMContentLoaded **< 2 s** |
| 社区 | 同上量级 |
| 生图 → 仓库 | 首屏 **sign-batch**，非 MB 级单图刷屏 |

用户实测（build `20260625d`）：卡片库 **889 kB / 1.0 s**；社区 **865 kB / 534 ms**。

## 生图页「仓库」Feed（`#imageGenFeed`）

2026-06 已与卡片库对齐：**列表 grid only**、懒加载、首屏 cap。勿再按「一进站几百 MB」排查，除非 Network 复现。

## 生图「生成中」与卡片「加载中」扫光

- **加载完成**：`media-shine-reveal` + `@keyframes card-beam-trbl`（播一次）
- **加载中 / 生成中**：`animation: card-beam-loading` 循环
- 勿另写一套扫光

## 本地验证

```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

F12 → Network：应先看到卡片文字，再陆续出现 grid 图请求；`window.__APP_BUILD__` 应为当前构建号。

## 后续 backlog（非 P0）

- [ ] 签名 URL IndexedDB 会话缓存（刷新少打 Supabase）
- [ ] 超大库（>500 张）虚拟列表
- [ ] Masonry 左右列加载顺序边缘 case
- [ ] 公共读桶 + CDN（需安全评估）

---

*最后更新：2026-06-07 · 首屏带宽 P0 关闭*
