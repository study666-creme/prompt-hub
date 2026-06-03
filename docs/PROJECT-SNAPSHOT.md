# Prompt Hub — 项目规划与现状（详细版）

> 更新：**2026-06-03** · 构建 **20260603j**  
> 给产品/协作方阅读；技术接手仍优先 `CURRENT-ISSUES.md` + `AI-HANDOFF.md`。

---

## 1. 产品定位

**Prompt Hub（提示词仓库）** 是面向 AI 绘图/写作用户的 **提示词资产管理平台**：

- 本地优先、登录后云同步（Supabase `user_data` + Storage）
- 卡片库（多库、分组、瀑布流、OCR、批量操作）
- 提示词社区（发布、点赞、Feed）
- 图片生成（积分扣费、Worker 代理）
- 资产创作（独立页 `asset-studio.html`，文档 + 关联图 + AI 对话/生图）
- 浏览器扩展（采集提示词到主站）
- 会员/积分/任务中心/激活码

**部署架构**

| 层 | 地址 / 名称 |
|----|-------------|
| 静态站 | https://prompt-hub.cn（Cloudflare Pages，项目 `prompt-hub-hub`） |
| API | https://api.prompt-hub.cn（Worker `prompt-hub-api`） |
| 数据库/鉴权 | Supabase（Auth + Postgres + Storage `card-images`） |

---

## 2. 信息架构（用户看到的结构）

```
Prompt Hub 主站 (index.html)
├── 提示词社区      — 全站 Feed、点赞、发布
├── 图片生成        — 积分生图、历史任务
├── 卡片资产        — 多卡片库侧栏、市场（演示）
│   └── 卡片库      — 默认库 / 我的风格库 / 自建库
├── 资产创作        — 跳转 asset-studio.html（限免，需登录编辑）
├── 我的主页        — 头像、关注/粉丝、作品与资产包 Tab
├── 任务中心        — 成长任务、限免说明
└── 设置 / 会员 / 充值 / 插件采集

资产创作 (asset-studio.html)
├── 项目切换        — 多项目，每项目独立卡片+文档
├── 左侧卡片资产    — 从主站「导入卡片库」后按分组展示
├── 中间文档树      — 文件夹 + 文档、关联图、@提及卡片
└── 右侧 AI         — 对话、生图（扣积分）
```

---

## 3. 技术栈与关键文件

| 类别 | 技术 | 主要文件 |
|------|------|----------|
| 前端 | 原生 JS SPA，无框架 | `script.js`、`features-draft.js`、`features-assets.js` |
| 图片 | Storage 私有路径 → 签名 URL | `supabase-sync.js`、`card-image-loader.js` |
| 资产创作 | 独立页面 | `asset-studio.js/html/css` |
| API | Cloudflare Worker | `server/src/` |
| 扩展 | MV3 | `extension/` |
| 背景动效 | ogl（esm.sh） | `ripple-grid.js` |

**数据流（卡片库图片）**

1. 卡片 JSON 存 `storage://card-images/{uid}/{cardId}.jpg`
2. 列表渲染先出文字骨架 + 占位图
3. `prefetchCardsImages` 批量签名（最多 32 张/次，并发 8）
4. `patchImageSrcFromCache` 把缓存 URL 写入 `<img>`
5. `card-image-loader.js` 视口懒加载其余图片

---

## 4. 规划路线图（产品向）

### 已完成 / 可用

- [x] 登录、云同步、紧急备份（IndexedDB）
- [x] 多卡片库（默认库 + 风格库 + 自建库），分库独立分组
- [x] 社区 Feed、点赞 API、我的主页
- [x] 会员五档 + 激活码 + 积分生图
- [x] 资产创作限免、导入主站卡片库、新手指引
- [x] 任务中心扩展任务（插件保存、资产对话、关联卡片）
- [x] Chrome 扩展 v1.x 采集
- [x] 生图侧栏/灯箱：图片上滚轮缩放、外滚轮换图（20260603j）
- [x] 卡片库随机排序、批量开/关社区公开、2.5D 国漫画风

### 进行中（2026-06-03）

- [ ] 卡片库图片首屏加载稳定 &lt; 5s（批量签名 + 预取加大）
- [ ] Cloudflare 免费额度监控（100k 请求/天；生图轮询 + 强刷会快速消耗）
- [ ] 历史脏数据：Storage 已删但卡片仍引用 → 404 占位

### 中期

- [ ] 列表专用缩略图（上传时生成 `_thumb.jpg`）
- [ ] 签名 URL 持久化到 IndexedDB，刷新少打 Supabase
- [ ] 资产包市场上线（当前演示）
- [ ] 社区他人图片 CDN/批量签

### 长期

- [ ] PWA / TWA 上架应用商店（见 `docs/APP-STORE.md`）
- [ ] 扩展 Chrome Web Store 正式上架

---

## 5. 当前样子（实测状态 · 20260603j）

### 主站卡片库

- 侧栏：**图片生成 → 卡片资产 → 资产创作**；专业会员侧栏金色样式
- **默认库**约 50 张卡，**我的风格库**可空；分组「全部 / 未分类 / 自定义」
- 图片：依赖签名；首屏预取 **32 张**、并发签 **8**、渲染后 `patchImageSrcFromCache`
- 若大量灰块 + Network 404：多为 Storage 文件已删，非「没图」

### 资产创作

- 登录后可编辑；未导入时左侧显示「点击导入卡片库」
- 导入弹窗：**两张独立大卡片**（默认库 / 风格库），封面为库内第一张可用图，底部叠字为**库名 + 张数**
- 从 IndexedDB / localStorage 读主站数据（独立页无 `window.__promptHubCards`）

### 会员与账号

- 测试账号：`2705367723@qq.com`（专业会员，截图 2026-07 到期）
- 侧栏显示「专业会员」与到期日

### 控制台常见项

| 现象 | 说明 |
|------|------|
| `ogl` 404（jsdelivr） | 已改 `esm.sh`，强刷后应消失 |
| `runPanelImageOcr` | 已修复（20260530a） |
| Storage 404 | 路径在 `missingPathCache` 会跳过，减少重复签 |

---

## 6. 部署与验证

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
# API 有改动时：
cd server
.\deploy.ps1
```

浏览器控制台：

```javascript
window.__APP_BUILD__   // 应为 20260602w
```

**强刷**：主站与 `asset-studio.html` 各 **Ctrl+Shift+R** 一次。

---

## 7. 文档索引

| 文档 | 用途 |
|------|------|
| [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) | AI 短上下文、部署阶段 |
| [CURRENT-ISSUES.md](./CURRENT-ISSUES.md) | P0 问题清单 |
| [CARD-LOADING.md](./CARD-LOADING.md) | 图片慢的原因与管线 |
| [MEMBERSHIP-CREDITS.md](./MEMBERSHIP-CREDITS.md) | 会员与积分 |
| [BROWSER-EXTENSION.md](./BROWSER-EXTENSION.md) | 插件 |

---

*维护：每轮大改后更新构建号与本文件「当前样子」一节。*
