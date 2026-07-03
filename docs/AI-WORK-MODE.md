# AI 工作模式（2026-06 起 · 用户明确要求）

## 核心原则

**禁止**在社区/卡片库/图片加载等 P0 问题上做「最小 diff 试探」。

- 每轮按**根因**处理，允许**多文件联动、整段重写**（如 `card-image-loader.js`、`renderCards` 图片管线、社区 Grid CSS）。
- 先读 `docs/CURRENT-ISSUES.md` + `docs/CARD-LOADING.md`，再改代码。
- 每轮结束更新 `docs/PROJECT_CONTEXT.md` 构建号与验证步骤。
- 简体中文；不提交密钥；仅用户要求时 git commit。

## P0 问题分工（勿混为一谈）

| 现象 | 负责层 |
|------|--------|
| 卡片库网格无图、侧栏有图 | `renderCards` + `SupabaseSync.hydrateImageElements` + `CardImageLoader` |
| 社区卡片叠在一起 / 间距乱 | CSS `column-count` 瀑布流 + 禁 Masonry + 清 inline 定位 |
| **手机只有首屏几张有图 / 下半屏黑** | **`docs/MOBILE-LOADING.md`** · `.app-main` 单滚 · `whenContainerReady` · cap 24 |

## 验证清单（每轮必做）

1. `window.__APP_BUILD__` 与 `index.html` 一致  
2. 卡片库：首屏 24 张，**视口内**图片应在数秒内出现（非仅文字块）  
3. 社区：`#communityGrid` 含 `community-feed-grid`，桌面 **≥2 列**（侧栏打开时视宽度而定）  
4. Console 无红色 `ReferenceError`
