# AI 踩坑清单

这些规则来自真实回归，改前端入口、Feed、图片或同步链路时必须遵守。

## 会导致整站故障

1. **经典脚本重复声明**：拆分片段最终会拼回同一作用域；重复 `const` 会让整包解析失败。提交前必须跑语法和 bundle VM smoke。
2. **脚本顺序改变**：`pack-prelude`、配置、基础包、同步、核心包、生图、Feed 和 `features-draft` 有依赖顺序。不要靠浏览器偶然缓存判断可行。
3. **部署文件回退成 HTML**：脚本 URL 若被 SPA fallback 接成 `index.html`，页面通常只剩文字。生产冒烟必须验证状态码、Content-Type 和首字节不是 `<`。
4. **只改拆分后的聚合文件**：`script.js`、`features-draft.js`、`supabase-sync.js` 在开发环境是 loader，真实大段源码在 `legacy/`；Pages staging 会重新合并，改错层会被覆盖。

## 会导致数据丢失

1. 不得用空 `cards`、`communityPosts` 或 `creations` 覆盖有数据的云端 `user_data`。
2. 账号切换必须清理内存与本地快照归属，再拉取新账号；不能复用上一账号的作者或图片路径。
3. `storage://` 是持久引用，短时 CDN/签名 URL 不是。不要把过期 URL回写到卡片 JSON。
4. 删除卡片涉及 tombstone、社区副本和图片引用计数；没有显式需求时不要执行 purge 或批量删除。

## 会导致图片慢或流量暴涨

1. 列表只请求 `_grid`；full 仅用于详情、画布插入和下载。
2. 手机卡片库与社区首批 DOM 都是 12 张。远端可以预取更多元数据，但不能一次把全部卡片插入 DOM。
3. 不要在每张图片 `load` 时重建整墙或清空列；使用现有 debounce 和增量 append。
4. 404 不应无限重签、递归换路径或持续刷新。候选路径尝试完后进入稳定失败态，并交给后台巡检。
5. `IntersectionObserver` 的滚动根在手机端是 `.app-main`；给中间容器新增 `overflow-y:auto` 会制造双滚动和“首次划不动”。

## 会导致社区错位

1. 社区桌面是 Masonry；我的主页桌面是 flex 多列；手机使用 CSS Grid。不要把三种容器用同一个“修复布局”函数强行统一。
2. 打开侧栏只应对变窄后的容器做一次计划重排，不能 flatten 后全量随机分列。
3. 随机排序应改变数据顺序；布局随机和数据随机不是一回事。
4. 公共 Feed API 可拉取较大的 head 用于缓存，但渲染层仍按 `FEED_PER_PAGE` 分页。

## 修改后最少验证

```powershell
npm run check:predeploy
node scripts/audit-production-scripts.mjs
node scripts/audit-production-mobile-first-screen.mjs
```

改 Worker 时追加：

```powershell
cd server
npm run typecheck
npm test
```

生产验收要记录 build、页面、设备宽度、初始 DOM 数、传输体积和失败 URL；“刷新后好了”不算根因修复。
