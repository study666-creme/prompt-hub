# 社区与卡片库布局问题调试指南

> **当前构建**：`20260603j`（2026-06-03）  
> **生图滚轮**：侧栏 / 灯箱 **图片上缩放、图片外换图** — 见下文「问题 D」。  
> **Cloudflare 75% 提醒**：见下文「Cloudflare 请求额度」与 `docs/PROJECT_CONTEXT.md`。

---

## 📋 问题概览

| 问题 | 严重程度 | 影响范围 | 状态 |
|------|---------|---------|------|
| A. 社区侧栏详情空白 | P0 | 社区页交互 | 部分已修（assetId null） |
| B. 社区 Masonry 空洞 | P0 | 社区页布局 | 未完全解决（404 图仍会导致） |
| C. 卡片库加载顺序混乱 | P0 | 卡片库性能 | 已加随机排序；首屏顺序见 CARD-LOADING |
| D. 生图预览滚轮不能缩放 | P1 | 图片生成页 | **✅ 已修 20260603j** |

---

## 问题 D：生图预览滚轮（已修 20260603j）

### 现象（修复前）

- 鼠标放在生图侧栏大图或灯箱图片上，滚轮只会 **换图**，无法 **放大缩小**
- 预期：与快速预览一致 — **图片上滚轮缩放**，**图片外滚轮换图**

### 根因

1. `script.js` → `loadLightboxImage`：当 `__lightboxImageGenNav` 为 true 时，把 `lightboxImage` 的 `onwheel` 绑成 `navigateViewerByWheelThrottled`（换图），未调用 `attachImageZoom`
2. `script.js` → `onViewerShellWheel`：在 `lightboxImage` 上同样优先换图
3. `features-draft.js` → `bindImageGenPreviewWheelScroll`：在 `.imagegen-preview-img-btn` 上滚轮一律换图，未给预览图挂 `attachImageZoom`

### 修复

| 文件 | 改动 |
|------|------|
| `script.js` | 灯箱统一 `resetImageZoom` + `attachImageZoom`；shell 滚轮在 `#lightboxImage` 上直接 return |
| `features-draft.js` | 预览图加载后 `attachImageZoom`；panel 滚轮仅在 **非** `.imagegen-preview-img-btn` 区域换图 |

### 验证步骤

1. 强刷，确认 `window.__APP_BUILD__ === '20260603j'`
2. 打开 **图片生成** → 点右侧 Feed 某张图打开侧栏预览
3. 鼠标 **放在图片上** 滚轮 → 应缩放；放在提示词/空白区滚轮 → 应换图
4. 点击图片进灯箱 → 同上

```javascript
// 控制台快速检查 attachImageZoom 是否挂上
document.querySelector('.imagegen-preview-img-btn img')?.onwheel != null
document.getElementById('lightboxImage')?.onwheel != null
```

---

## Cloudflare 请求额度（Workers + Pages）

### 邮件含义

- 免费账户：**每天 100,000 次请求**（Workers 与 Pages 合计统计方式见 Cloudflare 控制台）
- **75% 提醒** ≈ 当天已用 **75,000 次**
- 重置：**UTC 0:00**（北京时间上午 8:00）

### 一个人会不会刷到 75%？

**会。** 单次「强刷整站」可能产生 **几十～上百次** 请求（HTML + 多份 JS/CSS + API）。若同时：

- 开着生图页，有 **进行中的任务**（轮询 `getGenerationJob` 每 2.5～6 秒一次）
- 频繁 **Ctrl+Shift+R** 或换构建号触发 SW 清缓存
- 社区/卡片库大量 **签名 URL** 走 Worker
- 多个浏览器标签页同时打开

一天内个人测试也可能接近上限，**不一定是被攻击**。

### 如何查看

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧 **Workers 和 Pages**
3. 点 **概述** 或 **分析** → 看 **Requests** 曲线
4. 分别看 **prompt-hub-api**（Worker）与 **prompt-hub-hub**（Pages）哪边更高
5. 站内快速看近 24 小时：`admin.html` → 概览 → **运行监控**（Worker 自计数近似值；图片成功请求抽样折算，404/5xx 精确记录）

### 省额度建议

- 生图完成后关掉生图标签或等任务结束（减少轮询）
- 开发时用 **一个标签页**，避免反复强刷
- 签名 404 会重复请求 — 修掉坏图引用（见问题 A/B）
- 长期流量大再考虑 Workers 付费 $5/月

---

## 🔍 问题 A：社区侧栏详情空白

### 现象描述
- 点击社区卡片后，右侧 340px 侧栏能打开
- **标题显示正常**（如「【西风锁定】日系二次…」）
- **`#communitySideBody` 区域几乎全黑/空白**
- 看不到提示词、作者信息、操作按钮

### 预期行为
与卡片库 `#editPanel` 类似：
- 右侧固定栏内显示预览图
- 完整的提示词内容
- 作者信息
- 操作按钮（复制、收藏、制作同款等）

### 相关代码位置

**HTML 结构**（`index.html`）：
```
.community-workspace
  └── #communitySidePanel
      ├── .community-side-head
      │   ├── #communitySideTitle (标题 - 正常显示)
      │   └── #communitySideClose (关闭按钮)
      └── #communitySideBody (内容区 - 空白问题)
```

**渲染逻辑**（`features-draft.js`）：
- `openPostSidePanel(postId)` - 打开侧栏
- `renderCommunitySidePanel(post)` - 渲染内容到 `#communitySideBody`

### 调试步骤

#### 第一步：检查 DOM 结构
```javascript
// 1. 点击任意社区卡片后，在控制台运行：
const sideBody = document.getElementById('communitySideBody');
console.log('侧栏 body 存在:', !!sideBody);
console.log('innerHTML 长度:', sideBody?.innerHTML?.length || 0);
console.log('子节点数:', sideBody?.childNodes?.length || 0);

// 2. 检查是否有内容但被隐藏
console.log('computed height:', window.getComputedStyle(sideBody).height);
console.log('computed overflow:', window.getComputedStyle(sideBody).overflow);
console.log('computed color:', window.getComputedStyle(sideBody).color);

// 3. 查找关键元素
console.log('提示词元素:', document.querySelector('.community-side-prompt'));
console.log('图片按钮:', document.querySelector('.community-side-img-btn'));
```

**预期结果**：
- 如果 `innerHTML.length > 0` 但看不见 → CSS 问题
- 如果 `innerHTML.length === 0` → 渲染逻辑问题

#### 第二步：检查图片加载状态
```javascript
// 检查侧栏图片
const sideImg = document.querySelector('#communitySideBody .community-side-img-btn');
if (sideImg) {
  console.log('图片元素存在');
  console.log('is-loading class:', sideImg.classList.contains('is-loading'));
  console.log('computed display:', window.getComputedStyle(sideImg).display);
  console.log('computed height:', window.getComputedStyle(sideImg).height);
  
  const img = sideImg.querySelector('img');
  if (img) {
    console.log('img src:', img.src);
    console.log('img complete:', img.complete);
    console.log('img naturalWidth:', img.naturalWidth);
  }
}
```

#### 第三步：检查 CSS 层叠
```javascript
// 检查 body 的 flex 布局
const sidePanel = document.getElementById('communitySidePanel');
console.log('panel display:', window.getComputedStyle(sidePanel).display);
console.log('panel flex-direction:', window.getComputedStyle(sidePanel).flexDirection);
console.log('body min-height:', window.getComputedStyle(sideBody).minHeight);
console.log('body flex:', window.getComputedStyle(sideBody).flex);
```

### 疑似根因分析

#### 根因 1：`is-loading` 样式问题（可能性 80%）
**症状**：
- `.community-side-img-btn.is-loading` 的深色背景占满整个可视区
- 图片被 `display: none` 隐藏
- 下方文案需要滚动才能看到

**验证方法**：
```javascript
// 手动移除 is-loading
document.querySelector('.community-side-img-btn')?.classList.remove('is-loading');
// 如果内容立即显示 → 确认是此问题
```

**修复方向**：
- 检查 `finishCardMediaShine` 是否正确处理 `.community-side-img-btn`
- 确保 `applyFeedImageSrc` 的 `endLoad` 回调能识别侧栏图片路径

#### 根因 2：Flex 布局高度塌陷（可能性 60%）
**症状**：
- `#communitySideBody` 的 `height` 计算为 0 或很小
- 内容存在但被裁切

**验证方法**：
```javascript
// 强制设置高度
document.getElementById('communitySideBody').style.minHeight = '400px';
// 如果内容显示 → 确认是布局问题
```

**修复方向**：
- 在 `styles-features.css` 中为 `.community-side-body` 添加 `min-height: 0`
- 检查父容器 `#communitySidePanel` 的 flex 链是否完整

#### 根因 3：innerHTML 被清空（可能性 40%）
**症状**：
- `renderCommunitySidePanel` 执行后，内容又被其他逻辑清空

**验证方法**：
```javascript
// 在 renderCommunitySidePanel 末尾添加断点
// 或在控制台监听 DOM 变化
const observer = new MutationObserver(() => {
  console.log('communitySideBody 内容变化');
});
observer.observe(document.getElementById('communitySideBody'), {
  childList: true,
  subtree: true
});
```

### 对比参考：卡片库 `#editPanel` 的成功模式

**为什么卡片库侧栏正常？**
```javascript
// 卡片库图片加载完成后的处理
// 在 script.js 中搜索 #previewImage 相关逻辑
// 对比社区侧栏的图片处理是否一致
```

**关键差异**：
1. 卡片库使用 `#previewImage`，社区使用 `.community-side-img-btn`
2. 卡片库的 `finishCardMediaShine` 可能只认 `.card-media` 类
3. 社区侧栏的图片路径可能不在 `hydrateFeedImages` 的处理范围内

---

## 🔍 问题 B：社区 Masonry 中间空洞

### 现象描述
- 首屏排版部分正常
- **往下滚动后**，网格中间出现**大块空白**
- 卡片挤在两侧或上下错位
- 列与列之间间距不均匀

### 预期行为
与卡片库 Masonry 一致：
- 列宽 `--card-gap`
- 行距 `--card-row-gap`
- 无大面积空洞
- 卡片紧密排列

### 相关代码位置

**布局逻辑**（`features-draft.js`）：
- `layoutCommunityMasonry()` - 初始化 Masonry
- `scheduleCommunityLayout()` - 延迟重排
- 图片 `load` 事件 → 触发 `layout()`

**CSS**（`styles.css`）：
```css
@media (min-width: 901px) {
  .community-cards {
    /* 社区网格样式 */
  }
}
```

### 调试步骤

#### 第一步：检查 Masonry 实例状态
```javascript
// 滚动到空洞区域后运行
console.log('Masonry 实例:', window.communityMasonryInstance);

// 检查卡片位置
const cards = document.querySelectorAll('#communityGrid .card');
cards.forEach((card, i) => {
  const style = card.style;
  console.log(`卡片 ${i}:`, {
    top: style.top,
    left: style.left,
    width: style.width,
    position: style.position
  });
});
```

#### 第二步：对比卡片库 Masonry
```javascript
// 切换到卡片库页面
// 检查卡片库的 Masonry 配置
console.log('卡片库 Masonry:', window.masonryInstance);

// 对比配置差异
// 重点关注：
// - horizontalOrder
// - columnWidth
// - gutter
// - percentPosition
```

#### 第三步：检查容器宽度变化
```javascript
// 监听侧栏开关时容器宽度
const grid = document.getElementById('communityGrid');
const observer = new ResizeObserver(entries => {
  console.log('communityGrid 宽度变化:', entries[0].contentRect.width);
  // 检查是否触发了 Masonry 重排
});
observer.observe(grid);

// 手动打开/关闭侧栏，观察日志
```

### 疑似根因分析

#### 根因 1：图片晚加载后重排不及时（可能性 90%）
**症状**：
- 图片占位高度小（如 200px）
- 实际加载后高度变大（如 600px）
- Masonry 未及时重新计算位置

**当前尝试**（未完全生效）：
- 去掉逐图 `load` 全量重排
- 改为 500ms 批量重排（后改 120ms）
- 仍然不够及时

**验证方法**：
```javascript
// 监听图片加载
document.querySelectorAll('#communityGrid img').forEach(img => {
  img.addEventListener('load', () => {
    console.log('图片加载完成:', img.src.slice(0, 50));
    console.log('图片高度:', img.naturalHeight);
    // 检查是否触发了 layout
  });
});
```

**修复方向**：
1. **首屏严格顺序加载**：前 12-24 张图片按视觉顺序逐张签名，每张 `load` 后立即 `layout()`
2. **后续批量重排**：第二屏及以后使用 debounce
3. **预设占位高度**：根据图片宽高比预先设置 `min-height`，减少重排幅度

#### 根因 2：`horizontalOrder: false` 导致视觉错位（可能性 70%）
**症状**：
- Masonry 按"最短列"填充，不按 DOM 顺序
- 视觉上看起来像"空洞"，实际是顺序错乱

**验证方法**：
```javascript
// 临时修改配置
if (window.communityMasonryInstance) {
  window.communityMasonryInstance.destroy();
}
window.communityMasonryInstance = new Masonry('#communityGrid', {
  itemSelector: '.card',
  columnWidth: '.grid-sizer',
  gutter: 16,
  percentPosition: true,
  horizontalOrder: true, // 改为 true
  transitionDuration: 0
});
```

**修复方向**：
- 设置 `horizontalOrder: true`，保持视觉顺序
- 或者在 DOM 插入时就按视觉顺序排列

#### 根因 3：侧栏开关时容器宽度变化未触发重排（可能性 60%）
**症状**：
- 打开侧栏后，`#communityGrid` 宽度从 100% 变为 `calc(100% - 340px)`
- Masonry 未重新计算列数和列宽

**验证方法**：
```javascript
// 手动触发重排
document.getElementById('communitySideClose').addEventListener('click', () => {
  setTimeout(() => {
    if (window.communityMasonryInstance) {
      window.communityMasonryInstance.layout();
    }
  }, 300); // 等待 CSS 过渡完成
});
```

**修复方向**：
- 在 `openPostSidePanel` 和 `closeCommunitySidePanel` 中添加 `relayoutCommunityFeeds()`
- 使用 `ResizeObserver` 监听容器宽度变化

---

## 🔍 问题 C：卡片库首屏加载顺序混乱

### 现象描述
- 卡片库（488 张级别）**加载很慢**
- **后面几页/右侧列已有图，第一页/左侧还在黑占位**
- Masonry 中间也可能有大缝
- 用户反馈"用久了很卡"

### 预期行为
- **先完成第一屏（约 24 张）**
- 再加载滚动后内容
- 视觉上从上到下、从左到右渐进出图

### 相关代码位置

**渲染逻辑**（`script.js`）：
- `renderCards()` - 渲染卡片列表
- `card-image-loader.js` - 图片懒加载
- `supabase-sync.js` 中的 `prefetchWarehousePage` - 预加载

### 调试步骤

#### 第一步：检查首屏图片加载顺序
```javascript
// 刷新页面后立即运行
const imgs = [...document.querySelectorAll('#cardsContainer .card-img')].slice(0, 24);
imgs.forEach((img, i) => {
  const rect = img.getBoundingClientRect();
  console.log(`图片 ${i}:`, {
    top: rect.top,
    left: rect.left,
    loaded: img.complete && img.naturalWidth > 0,
    src: img.src?.slice(0, 60)
  });
});

// 按 top 排序，检查是否按视觉顺序加载
```

#### 第二步：监听签名 URL 请求
```javascript
// 在 Network 面板中筛选 "sign"
// 观察签名请求的顺序和时间
// 检查是否有大量并发请求

// 或在控制台运行
const originalFetch = window.fetch;
window.fetch = function(...args) {
  if (args[0]?.includes?.('sign')) {
    console.log('签名请求:', args[0]);
  }
  return originalFetch.apply(this, args);
};
```

#### 第三步：检查 Masonry 布局顺序
```javascript
// 检查 Masonry 配置
console.log('horizontalOrder:', window.masonryInstance?.options?.horizontalOrder);

// 检查 DOM 顺序 vs 视觉顺序
const cards = document.querySelectorAll('#cardsContainer .card');
cards.forEach((card, i) => {
  const rect = card.getBoundingClientRect();
  console.log(`DOM ${i}:`, { top: rect.top, left: rect.left });
});
```

### 疑似根因分析

#### 根因 1：Masonry `horizontalOrder: false` + 并发签名（可能性 95%）
**症状**：
- DOM 前几项不一定在视觉左上角
- 签名 URL 并发请求（MAX_RESOLVE=12），不按视觉顺序
- 右侧列的图片可能先签名完成

**验证方法**：
```javascript
// 临时改为顺序签名
// 在 card-image-loader.js 中找到签名逻辑
// 将并发改为串行，观察效果
```

**修复方向**：
1. **首屏严格顺序队列**：
   - 按 `getBoundingClientRect()` 的 `top` 和 `left` 排序
   - 前 24 张图片串行签名（或并发≤4）
   - 每张签名完成后立即加载

2. **第二页延迟 observe**：
   - 首屏 N 张 `load` 或 `error` 后，再 observe 第二页
   - 避免首屏与第二页抢带宽

3. **Masonry 改为 `horizontalOrder: true`**：
   - 保证 DOM 顺序 = 视觉顺序
   - 简化加载逻辑

#### 根因 2：IntersectionObserver `rootMargin` 过大（可能性 80%）
**症状**：
- `rootMargin: 260px` 导致第二屏图片提前进入可视区
- 与首屏图片并发签名

**验证方法**：
```javascript
// 临时改小 rootMargin
// 在 card-image-loader.js 中找到 IntersectionObserver 配置
// 改为 rootMargin: '50px'
```

**修复方向**：
- 首屏 `rootMargin: 0px`，严格只加载可见图片
- 第二屏及以后 `rootMargin: 100px`

#### 根因 3：`prefetchWarehousePage` 后台预加载抢带宽（可能性 70%）
**症状**：
- 后台签名第 13～48 张图片
- 与首屏图片抢带宽

**验证方法**：
```javascript
// 临时禁用预加载
// 在 supabase-sync.js 中注释掉 prefetchWarehousePage 调用
```

**修复方向**：
- 首屏完成后再启动预加载
- 或降低预加载优先级（使用 `requestIdleCallback`）

#### 根因 4：每图 `load` 触发 Masonry 重排导致卡顿（可能性 90%）
**症状**：
- 每张图片加载完成后触发 `masonryInstance.layout()`
- 488 张图片 = 488 次重排
- 长时间 layout thrashing

**验证方法**：
```javascript
// 监听 layout 调用次数
let layoutCount = 0;
const originalLayout = window.masonryInstance.layout;
window.masonryInstance.layout = function() {
  layoutCount++;
  console.log('layout 调用次数:', layoutCount);
  return originalLayout.apply(this, arguments);
};
```

**修复方向**：
1. **批量重排**：
   - 收集 N 张图片 `load` 事件
   - 使用 `requestAnimationFrame` 批量 `layout()`

2. **虚拟列表**：
   - 只渲染可见区域 + 上下各 1 屏
   - 减少 DOM 节点数

3. **列表专用缩略图**：
   - 上传时生成 `_grid` variant（如 400x400）
   - 列表只加载缩略图，减少字节数

---

## 🎯 修复优先级建议

### 第一优先级（立即修复）
1. **问题 A - 社区侧栏空白**
   - 影响：用户无法查看社区作品详情
   - 修复难度：中等
   - 预计工时：2-4 小时

2. **问题 C - 卡片库加载顺序**
   - 影响：用户体验差，"用久了很卡"
   - 修复难度：中等
   - 预计工时：4-6 小时

### 第二优先级（后续优化）
3. **问题 B - 社区 Masonry 空洞**
   - 影响：视觉体验差，但不影响功能
   - 修复难度：中等
   - 预计工时：3-5 小时

---

## 🛠️ 修复前准备

### 1. 创建恢复点
```javascript
await DataSafety.createRecoveryPoint('before_layout_fix');
```

### 2. 本地测试环境
```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

### 3. 测试数据准备
- 卡片库：至少 100 张卡片（含图片）
- 社区：至少 50 条帖子
- 测试账号：已登录状态

### 4. 浏览器 DevTools 设置
- Network 面板：勾选 "Disable cache"
- Performance 面板：准备录制
- Console 面板：保留日志

---

## 📝 修复后验证清单

### 问题 A 验证
- [ ] 点击社区卡片，侧栏能正常显示内容
- [ ] 提示词、作者、按钮都可见
- [ ] 图片能正常加载
- [ ] 滚动侧栏，内容完整

### 问题 B 验证
- [ ] 社区首屏排版正常
- [ ] 滚动到底部，无大块空洞
- [ ] 列与列之间间距均匀
- [ ] 打开/关闭侧栏，布局自动调整

### 问题 C 验证
- [ ] 卡片库首屏 24 张图片在 3 秒内加载完成
- [ ] 图片按从上到下、从左到右顺序出现
- [ ] 滚动流畅，无明显卡顿
- [ ] 长时间使用（10 分钟），性能无明显下降

---

## 🔗 相关文档

- [HANDOVER.md](HANDOVER.md) - 项目交接文档
- [CURRENT-ISSUES.md](CURRENT-ISSUES.md) - 当前问题汇总
- [HOTFIX-IMAGE-LAYOUT.md](HOTFIX-IMAGE-LAYOUT.md) - 图片布局修复详解
- [PERFORMANCE-OPTIMIZATION.md](PERFORMANCE-OPTIMIZATION.md) - 性能优化文档

---

**最后更新**：2026-05-30  
**文档作者**：Claude (Anthropic)  
**下一步**：根据本文档进行 DevTools 调试，确认根因后再修改代码
