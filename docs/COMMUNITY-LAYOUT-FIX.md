# 社区布局修复说明

> **2026-06-04 重要**：桌面社区已改为 **flex 多列**（非 Masonry）。后续 AI 请先读 **`docs/AI-PITFALLS.md`**，勿再「每张图加载全墙重排」或 append 时清空所有列。

### 2026-06-04 flex 列稳定（`features-draft.js`）

| 问题 | 修复 |
|------|------|
| 持续晃动 / 点卡片乱飞 | append 仅最短列插入；`fromImage` no-op；已 distributed 不 flatten |
| 整站白屏 | 勿在同一函数重复 `const colsChanged` |
| 点击侧栏整墙重排 | 开侧栏不 `scheduleCommunityLayout`；列数不变只改 CSS 变量 |

---

## 修复的问题（历史 Masonry）

### 1. 社区侧栏详情空白
**现象**：点击社区卡片后，右侧 340px 侧栏能打开，标题显示正常，但 `#communitySideBody` 区域几乎全黑/空白，看不到提示词、作者、按钮。

**根因**：
- `.community-side-body` 缺少 `min-height: 0`，导致 flex 子元素高度塌陷
- `.community-side-img-btn.is-loading` 的深色背景占满可视区，图片和文案被隐藏
- `finishCardMediaShine` 只处理 `.card-media`，不处理侧栏的 `.community-side-img-btn`

**修复方案**：
- 添加 CSS 修复：确保侧栏 body 有正确的 flex 布局（`min-height: 0`）
- 扩展 `finishCardMediaShine` 函数支持侧栏图片按钮
- 监听侧栏打开事件，强制检查内容可见性

### 2. 社区 Masonry 中间空洞
**现象**：社区网格中间出现大片空白，图片加载后位置不对，视觉顺序混乱。

**根因**：
- `horizontalOrder: false` 导致 Masonry 按最短列填充，视觉顺序与 DOM 不一致
- 图片晚加载变高后，Masonry 重排不及时
- 侧栏开关时容器宽度变化，未触发 Masonry 重排

**修复方案**：
- 强制 `horizontalOrder: true`，保持视觉顺序
- 图片加载完成后立即触发重排（首屏优先）
- 监听侧栏开关，触发 Masonry 重排

### 3. 卡片库首屏加载顺序混乱
**现象**：卡片库首屏加载时，后面的图先出，首屏还在黑占位，视觉顺序混乱。

**根因**：
- Masonry `horizontalOrder: false`，DOM 前几项不在视觉左上
- 签名 URL 并发请求（MAX_RESOLVE=12），不按视觉顺序
- IntersectionObserver `rootMargin` 过大（260px），第二屏提前加载
- 每图 load 触发 Masonry 重排，导致 layout thrashing

**修复方案**：
- 修复卡片库 Masonry 配置：强制 `horizontalOrder: true`
- 优化首屏图片加载顺序：减小 `rootMargin` 到 50px
- 批量 Masonry 重排：每 6 张图片触发一次重排，避免 layout thrashing

## 使用方法

修复补丁已自动加载，无需手动操作。如果遇到问题，可以在浏览器控制台执行：

```javascript
// 手动触发布局修复
window.fixCommunityLayout();
```

## 技术细节

### CSS 修复
```css
.community-side-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  display: flex !important;
  flex-direction: column !important;
}
```

### JavaScript 补丁
- `patchFinishCardMediaShine()` - 扩展图片加载完成处理
- `patchCommunityMasonryConfig()` - 修正 Masonry 配置
- `enhanceCommunityImageRelayout()` - 优化图片重排
- `watchSidePanelResize()` - 监听侧栏开关
- `patchWarehouseMasonryConfig()` - 修正卡片库 Masonry
- `optimizeWarehouseImageLoading()` - 优化首屏加载
- `batchWarehouseMasonryLayout()` - 批量重排

## 验证步骤

### 验证侧栏修复
1. 打开社区页面
2. 点击任意卡片
3. 检查右侧侧栏是否显示完整内容（图片、提示词、作者、按钮）
4. 图片应该可见，不应该是全黑背景

### 验证 Masonry 修复
1. 打开社区页面
2. 滚动查看网格布局
3. 检查是否有大片空白
4. 图片加载后位置应该正确
5. 开关侧栏后布局应该自动调整

### 验证卡片库修复
1. 打开卡片库页面
2. 刷新页面
3. 首屏图片应该按从左到右、从上到下的顺序加载
4. 不应该出现后面的图先出、首屏还在黑占位的情况

## 文件位置

- 修复补丁：`hotfix-community-layout.js`
- 引入位置：`index.html` 第 1234 行（在 `hotfix-image-layout.js` 之后）

## 注意事项

- 修复补丁会在页面加载时自动执行
- 如果遇到问题，可以在控制台查看 `[Hotfix]` 开头的日志
- 修复补丁不会影响现有功能，只是修正布局问题
- 如果需要禁用修复，可以在 `index.html` 中注释掉引用行

## 相关文档

- [CURRENT-ISSUES.md](./CURRENT-ISSUES.md) - 当前已知问题
- [DEBUG-GUIDE.md](./DEBUG-GUIDE.md) - 调试指南
- [COMMUNITY-ARCHITECTURE.md](./COMMUNITY-ARCHITECTURE.md) - 社区架构说明