# 错误日志（防重复踩坑）

> 与 **`docs/AI-PITFALLS.md`** 同步维护；新坑优先写进 PITFALLS 表格，本页记**日期 + 现象 + 根因 + 修复构建号**。

---

## 2026-06-04 · 我的主页整宽巨图（`20260604a`）

| 项 | 内容 |
|----|------|
| **现象** | 「我的主页」发布作品区只有一张图铺满整行，像单列巨图 |
| **根因** | 桌面 flex 多列已创建 `.community-feed-col`，但部分 `.card` 仍挂在 `#creationsGrid` 直层；CSS `#creationsGrid.community-feed-grid > .card { width:100% }` 使直层卡占满容器宽。`ensureCommunityFeedColumnLayout()` 见到已有列即 `return`，未把孤儿卡塞进列 |
| **修复** | `ensureCommunityFeedColumnLayout` 检测 orphan；`repairCreationsFeedLayout()`；`getCreationsFeedColumns` + `promptrepo_myhome_columns`；直层孤儿卡 `display:none` 兜底；`#creationsGrid` 初始带 `community-feed-columns` |
| **勿再犯** | 改布局后必须在 DOM 里确认：卡只在 `.community-feed-col` 内，无 `:scope > .card`（除 sentinel） |

---

## 2026-06-04 · 社区新图加载整页晃眼（`20260604a`）

| 项 | 内容 |
|----|------|
| **现象** | 社区不断加载新图时，已在屏上的卡片被挤下去、布局来回跳 |
| **根因** | `scheduleCommunityFeedImageBalance` 在每张图 load 后 debounce 调用 `distributeCommunityFeedColumns({ forceReflow:true })`，全量按列高重分 |
| **修复** | 移除该重平衡；`scheduleCommunityLayout` 的 `fromImage` 保持 no-op；`finishCardMediaShine` 不触发社区 layout |
| **勿再犯** | flex 多列 Feed **禁止**图片 onload 全墙 `forceReflow`；仅分页 append 用 `newCards` 插入最短列 |

---

## 2026-06-04 · 社区整站白屏

见 `AI-PITFALLS.md` — 重复 `const colsChanged` 导致 `features-draft.js` 解析失败。

---

## 相关

- `docs/AI-PITFALLS.md` — 完整禁止清单  
- `docs/COMMUNITY-LAYOUT-FIX.md` — 布局修复时间线  
