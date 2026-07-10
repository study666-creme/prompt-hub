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
| `scripts/run-predeploy-smoke.mjs` | 前端总验证入口 |

## 按任务找文件

| 任务 | 主要文件 |
|---|---|
| 路由/首屏页面 | `app-router.js`, `index.html` |
| 卡片 CRUD/筛选/分页 | `legacy/script/`, `card-gallery.js` |
| 编辑面板多图 | `edit-panel-gallery.js`, `card-gallery.js` |
| 云同步/账号切换 | `supabase-sync.js`, `legacy/supabase-sync/`, `cloud-sync-safety.js`, `sync-orchestrator.js` |
| 卡片图片 | `card-image-loader.js`, `card-image-loader-queues.js`, `warehouse-thumb.js` |
| 社区数据 | `community-public-feed.js`, `legacy/features-draft/`, `server/src/routes/v1/community.ts` |
| 社区布局 | `feed-layout.js`, `styles/features/` |
| 生图表单 | `legacy/features-draft/`, `imagegen-ref-ui.js`, `imagegen-submit.js` |
| 生图任务 | `imagegen-job-runner.js`, `imagegen-poll-warehouse.js`, `server/src/routes/v1/generate.ts` |
| 上游 provider | `server/src/lib/image-upstream.ts`, provider 对应 `*.ts` |
| 媒体/R2 | `server/src/routes/v1/media.ts`, `server/src/lib/media-cdn.ts`, `server/src/lib/r2-storage.ts` |
| 会员/积分 | `subscription.js`, `membership.js`, `points-system.js`, `server/src/lib/membership-credits.ts` |
| 运营后台 | `admin.html`, `admin.js`, `legacy/admin/`, `server/src/routes/admin/` |
| 资产创作 | `asset-studio.html`, `legacy/asset-studio/`, `server/src/routes/v1/asset-packages.ts` |
| 浏览器扩展/Canvas | `extension/`, `server/src/routes/v1/extension.ts` |
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

## 修改原则

先确认文件是 loader、拆分真源还是生成包。不要同时手改源片段和生成包；运行构建脚本生成 pack。新增模块优先进入现有 pack 和 wire 机制，不再把大型实现塞回 `features-draft.js` loader。
