# 代码导航图

## 入口与构建

| 文件/目录 | 作用 |
|---|---|
| `index.html` | 主站 head、body partial loader、脚本顺序和 build |
| `partials/index-body/` | 主页面 body 拆分片段 |
| `script.js`, `features-draft.js`, `supabase-sync.js` | 本地 loader；生产 staging 合并对应 `legacy/` |
| `legacy/` | 主应用、功能、同步、后台和资产工作台源码片段 |
| `styles.css`, `styles-features.css` | CSS loader/入口 |
| `styles/base/`, `styles/features/` | 拆分 CSS 真源 |
| `pack-*.js` | esbuild 生产包，由 `scripts/build-*.mjs` 生成并跟踪 |
| `scripts/build-pages-runtime.mjs` | Pages staging 合并 loader/片段 |
| `scripts/stage-pages.ps1` | Pages 允许清单、内联产物与首屏资源完整性门禁 |
| `deploy-pages.ps1` | 只从无冻结标记、干净 Git SHA 发布 Pages `main` production 分支，并重试线上 HTTP 冒烟 |
| `scripts/run-predeploy-smoke.mjs` | 前端总验证入口 |

## 按任务找文件

| 任务 | 主要文件 |
|---|---|
| 路由/首屏页面 | `app-router.js`, `index.html` |
| 卡片 CRUD/筛选/分页 | `legacy/script/`, `card-gallery.js` |
| 卡片仓库 UI | `styles-warehouse.css`, `partials/index-body/part-02.html`, `legacy/script/part-04.js`, `legacy/script/part-09.js` |
| 编辑面板多图/移动端遮挡 | `edit-panel-gallery.js`, `card-gallery.js`, `mobile.js`, `styles-mobile.css` |
| 云同步/账号切换 | `supabase-sync.js`, `legacy/supabase-sync/`, `cloud-sync-safety.js`, `sync-orchestrator.js` |
| 卡片图片/文字卡判定 | `card-gallery.js`, `card-image-loader.js`, `card-image-loader-queues.js`, `feed-images.js`, `warehouse-thumb.js` |
| Generated-card save/archive | `legacy/script/part-02.js`, `legacy/supabase-sync/part-05.js` |
| 社区数据/共享首屏请求 | `community-public-feed.js`, `image-gen-feed.js`, `legacy/features-draft/`, `server/src/routes/v1/community.ts` |
| 社区布局 | `feed-layout.js`, `styles/features/` |
| 生图表单 | `legacy/features-draft/`, `imagegen-ref-ui.js`, `imagegen-submit.js` |
| 生图目录缓存/二维计价 | `api-client.js`, `points-system.js`, `legacy/features-draft/part-10.js`, `legacy/features-draft/part-12.js`, `server/src/lib/newapi.ts`, `server/src/routes/v1/generate.ts` |
| 生图任务 | `imagegen-job-runner.js`, `imagegen-poll-warehouse.js`, `imagegen-finish-run.js`, `server/src/routes/v1/generate.ts`, `server/src/lib/fast-provider-queue.ts` |
| 近期生成失败媒体恢复 | `card-image-loader.js`, `image-gen-feed.js`, `styles/features/part-11.css` |
| 上游 provider | `server/src/lib/image-upstream.ts`, provider 对应 `*.ts` |
| 媒体/R2 | `server/src/routes/v1/media.ts`, `server/src/lib/media-cdn.ts`, `server/src/lib/r2-storage.ts` |
| 会员/积分 | `subscription.js`, `membership.js`, `points-system.js`, `server/src/lib/membership-credits.ts` |
| 运营后台 | `admin.html`, `admin.js`, `legacy/admin/`, `server/src/routes/admin/` |
| 资产创作 | `asset-studio.html`, `legacy/asset-studio/`, `server/src/routes/v1/asset-packages.ts` |
| 浏览器扩展 | `extension/`, `server/src/routes/v1/extension.ts` |
| Prompt Hub -> Canvas 深链 | `app-router.js`, `legacy/script/part-04.js`, `legacy/script/part-09.js`, `legacy/script/part-10.js` |
| Canvas 桥接样式 | `styles/base/part-04.css`, `styles/base/part-09.css`, `styles-mobile.css`, `styles-theme.css` |
| Canvas 精确取卡/结果回仓 | `server/src/routes/v1/extension.ts`, `server/src/lib/extension-card.ts` |
| 移动端 | `mobile.js`, `styles-mobile.css` |
| UI 主题/动效 | `styles-theme.css`, `theme.js`, `UI-GUIDELINES.md` |

## 数据与运维

| 路径 | 作用 |
|---|---|
| `supabase/schema.sql` | 当前数据库结构快照 |
| `supabase/migrations/` | 有序迁移历史，MemFire 同样使用 |
| `server/.dev.vars.example` | Worker 本地变量模板 |
| `scripts/admin.local.env.example` | 备份、巡检和运营脚本模板 |
| `scripts/pg-dump-for-migrate.ps1` | PostgreSQL custom dump |
| `scripts/memfire-restore.ps1` | 向空 MemFire 项目恢复 dump |
| `scripts/audit-card-images.mjs` | 指定用户图片元数据/R2 诊断 |
| `scripts/run-warehouse-repair.mjs` | 指定用户 R2 回填，先 dry-run |

## Canvas 桥接文件归属

| 文件 | 作用 |
|---|---|
| `app-router.js` | 校验 Canvas 地址和卡片 ID，构造 `ph*` 深链，管理新窗口与一次性返回标记 |
| `legacy/script/part-04.js` | 向卡片仓库暴露 Canvas 打开函数并关闭移动端浮层 |
| `legacy/script/part-09.js` | 渲染桌面、移动端和右键入口；页面从 Canvas 返回时触发强制云端拉取 |
| `legacy/script/part-10.js` | 卡片容器的 Canvas 按钮事件委托 |
| `server/src/routes/v1/extension.ts` | `GET /cards/:cardId` 和 `POST /canvas-results` 的鉴权、校验与响应 |
| `server/src/lib/extension-card.ts` | 精确卡片映射、内部存储引用校验与来源键幂等追加 |
| `scripts/verify-canvas-bridge.mjs` | 深链参数、安全载荷、窗口隔离和返回标记 VM 回归 |
| `scripts/verify-canvas-card-handoff-browser.mjs` | Chromium 点击深链及移动端按钮布局回归 |
| `server/src/lib/extension-card.test.ts`, `server/src/routes/v1/extension.test.ts` | Worker 精确取卡、来源校验与结果回仓幂等测试 |

桥接实现属于 `20260730a` Prompt Hub 发布候选；Canvas 仓库对深链和回仓端点的消费不归这些文件所有，Prompt Hub 侧上线不等于跨仓库链路已完成。

## 卡片仓库 UI 归属

2026-07-30 复核的未部署候选把仓库视觉覆盖集中在 `styles-warehouse.css`，不修改拆分 CSS 真源。`partials/index-body/part-02.html` 负责紧凑概览、工具栏图标和搜索结构；`styles-mobile.css` 负责窄屏工具栏收缩；`mobile.js` 负责编辑面板打开时持续隐藏底部导航。`legacy/script/part-04.js` 同步概览中的卡片数与当前分组；`legacy/script/part-09.js` 输出类型、分组、时间元数据和可操作空态。

桌面、手机和空仓状态由 `scripts/verify-warehouse-ui-browser.mjs` 验收。脚本同时检查 320/360px 工具栏无重叠，以及编辑面板滚动后底部导航仍隐藏、保存和关闭按钮仍可达。它使用本地模拟的 `_grid` CDN URL，不触发真实 API、生产存储或部署流程；设置 `APP_ROOT=.pages-deploy` 时直接验收最终 Pages 暂存包。

## 修改原则

先确认文件是 loader、拆分真源还是生成包。不要同时手改源片段和生成包；运行构建脚本生成 pack。新增模块优先进入现有 pack 和 wire 机制，不再把大型实现塞回 `features-draft.js` loader。
