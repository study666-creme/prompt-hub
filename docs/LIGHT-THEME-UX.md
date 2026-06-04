# 日光模式（浅色）可读性优化

> 用户反馈：白天布局偏小、字体与背景颜色接近、看不清楚。  
> 本文供产品/前端迭代参考；**20260604k** 已做第一轮 CSS 微调。

---

## 根因（为什么「整体偏小」）

1. **全站缩放 `--ui-scale: 0.72`**（`styles.css` · `.app-chrome`）  
   整个界面画布按 72% 缩放，侧栏、卡片、正文字号**一起变小**。这是最主要原因，不是单改 `font-size` 能完全解决的。

2. **浅色变量对比偏软**  
   `--text-muted: #636366` 在 `#f2f2f7` 网格背景上对比度不足；`.panel-hint`、奖励说明、卡片次要信息偏淡。

3. **装饰背景干扰**  
   `[data-theme="light"] .ripple-grid-bg { opacity: 0.35 }` 网格线叠在浅灰字上，进一步降低可读感。

---

## 已实施（20260604k 起，仅日光模式）

| 项 | 改动 |
|----|------|
| 缩放 | `[data-theme="light"] { --ui-scale: 0.82; }`（暗色仍 0.72） |
| 字色 | `--text-muted` / `--text-secondary` 加深 |
| 说明文案 | `.panel-hint`、`.feature-empty`、奖励区字号约 14px、行高 1.55 |
| 卡片次要信息 | `.card-desc`、`.card-time`、`.community-author-link` 对比度提高 |

部署后让用户强刷验 `window.__APP_BUILD__`。

---

## 建议的后续优化（按优先级）

### P1 — 用户可控

- **设置里增加「界面大小」**：72% / 82% / 100% 三档，写 `localStorage` 覆盖 `--ui-scale`。  
- 默认日光 **0.82**，暗色 **0.72**（或统一 0.8）。

### P2 — 对比度（WCAG）

- 正文与背景对比 ≥ **4.5:1**（AA）；次要说明 ≥ **3:1**。  
- 用 Chrome DevTools → Accessibility 检查 `.panel-hint`、`.app-nav-item`、`.card-time`。  
- 避免浅灰字直接落在 `ripple-grid` 上：说明区加 `background: rgba(255,255,255,0.92)` 圆角底。

### P3 — 字号阶梯（仅 light）

```css
[data-theme="light"] {
  --font-sm: 14px;
  --font-base: 15px;
  --font-lg: 17px;
}
```

### P4 — 社区/主页卡片

- 卡片标题 `--font-lg` + `font-weight: 600`  
- 作者标签：浅底深字（如 `#fff` 底 + `#1c1c1e` 字），勿白字浅灰底  
- 「奖励规则」折叠块：默认可收起，减少占屏

### P5 — 效率模式联动

- `body.efficiency-mode` 下关闭网格背景时，日光模式自动提高 `--text-muted` 一级。

---

## 验收清单（给用户）

1. 切换到日光（太阳图标）。  
2. 看侧栏菜单、主页奖励说明、社区卡片标题——应比改前**更大、更深**。  
3. 若仍嫌小：设置里将来用「界面大小」调到 100%（待做）。  

---

## 勿做的事

- 不要只改暗色变量却忘记 `[data-theme="light"]` 块。  
- 不要为可读性在社区 Feed 恢复「每张图加载全墙 Masonry 重排」（见 `docs/AI-PITFALLS.md`）。
