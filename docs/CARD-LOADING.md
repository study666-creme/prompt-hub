# 卡片库图片加载（为什么比 LabGen 慢、我们怎么优化）

## 和 LabGen / 普通「提示词列表」的差别

| | LabGen 类站点 | Prompt Hub（当前） |
|---|---------------|-------------------|
| 列表数据 | 接口一次返回 **可直接访问的图片 URL**（CDN） | 卡片 JSON 里多是 `storage://...` **私有路径** |
| 浏览器加载 | `<img src="https://cdn...">` 立刻并行下载 | 要先 **批量向 API/Supabase 换签名 URL** |
| 布局 | 多为固定网格 / 稳定高度 | Masonry 瀑布流，**每张图高度变化要重排** |
| 数量 | 虚拟列表只渲染可见项 | 一页 24 张 + 懒加载预取 |

所以不是「几张卡就该卡」，而是 **每张图多一步换链接 + 瀑布流重排**。当前已通过 grid 缩略图 + 懒加载把首屏压到 **~1 MB 级已传输**（2026-06 用户验收）。

## 当前加载管线（build `20260702g` 起 · 含手机）

1. **立刻渲染文字和卡片骨架**（不等签名才插入 DOM）
2. **进入卡片库**：`bootstrapWarehouseMediaCache({ clearAllMissing: true })` 清掉旧 404 缓存
3. **`bindWarehouse`**：`prefetchList` + `observeContainer` 单链路（勿在 `renderCards` 再 prefetch 一遍）
4. **自有 storage 图**：batch `sign-batch` 签 `_grid`（勿把所有 `/generated/` 都打进慢速 `warehouse-thumbs`）
5. **生图卡（无 storage、需服务端 thumb）**：`WarehouseThumb` → `warehouse-thumbs`
6. **Worker 存储**：`MEDIA_STORAGE_MODE=r2-first`（R2 优先，Supabase 回退；纯 `r2` 会导致老卡全 404）
7. **手机首屏**：`warehousePrefetchCap` **24**；`loadImg` 最多等 prefetch **320ms**
8. **桌面 Masonry**：图加载后 **`layout()` 轻量重排**，非整网格 `reloadItems`
9. **`whSig` 未变**：`softHydrate` 代替清空 DOM

关键文件：

- `docs/MOBILE-LOADING.md` — **手机 P0 排查手册（必读）**
- `mobile.js` — `MOBILE_PERF`、滚动补载
- `card-image-loader.js` — 懒加载 + 应用 URL
- `supabase-sync.js` — `prefetchCardsImages`、`getCachedDisplayUrl`
- `script.js` — `renderCards` → `hydrateWarehouseGridImages` → **`CardImageLoader.bindWarehouse`**
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

## 变更日志

| 日期 | 构建/版本 | 说明 |
|------|-----------|------|
| 2026-07-02 | Worker `r2-first` + Pages `20260702g` | 灰块回归：`sign-batch` 路径恢复；进库清 404 缓存；品牌 UI |
| 2026-07-02 | `sync-supabase-to-r2.mjs` | 缺 R2 原图时用户本机跑 `--skip-existing`（配置 `scripts/admin.local.env`） |
| 2026-06-07 | `20260702b` | 首屏 batch 签名 + 预取 cap 24；P0 带宽验收关闭 |

---

*最后更新：2026-07-02 · 灰块回归修复 + r2-first*
