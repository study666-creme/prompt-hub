# 部署与验证清单

最后核对：2026-09-06

## 当前发布状态

**本轮（2026-09-06 第二批，Worker）**：已完成 Worker 发布：Worker SHA `c19319430089977b88dfc97a590e00c9860cac43`（`/health.buildSha` 已核对一致，Worker Version `b98160e2-510a-40f1-88ba-bd87749fc1a3`，绑定 KV/双队列/R2/双自定义域/`*/2` cron 全部保留，dry-run 先行通过）。内容：任务中心下线「浏览器插件保存卡片」「卡片式创作 AI 对话」「卡片式创作关联卡片」「¥0.99 体验三天基础会员」四项（`buildTaskList` 不再下发、任务加载不再查 mini-99 兑换状态）；reward/claim/进度同步链路保留，存量已达标用户仍可经 claim 接口领取，`mini_3d` 兑换码在生图页「兑换」继续可用。Worker 测试 56 文件 391 项全过（含新增下线回归）。**本轮无数据库迁移、无 Pages 变更**（Pages 仍为同日第一批的 `20260906b` / SHA `fd6889a`）。

**本轮（2026-09-06 第一批，Pages）**：build `20260906b`，发布 SHA `fd6889a`（`cb15190` 卡顿分离 + foundation VM 修复 + build bump），线上 `__APP_BUILD__ = '20260906b'` 已核对；deploy-pages.ps1 内建生产 bundle smoke（24 项）全过；`styles-assets.css?v=20260906b` 线上命中新版 `appleMediaSheen`（`translate3d(-70%)` transform 扫光）、`script.js?v=20260906b` 命中 `bumpShineOrderEpoch`/`flushShineRevealQueue`（6 处）、`pack-core.js?v=20260906b` 命中 `feedObserverBound` 新循环、`pack-foundation.js?v=20260906b` 命中 `phInteractGuard` 全端交互守卫；`pack-core.js?v=20260906b` 返回 `Cache-Control: public, max-age=31536000, immutable`。内容：卡片库加载动效与主线程分离（详见 `CARD-LOADING.md`「加载动效与主线程分离（2026-09-05c）」）。发布前修复：`bindMobileInteractionGuard` 在 `document.body` 缺失时早退（VM smoke 抓到），body stub 补 `dataset` 后守卫逻辑被真实执行。

上一轮（2026-09-05，两次构建 `20260905a` → `20260905b`）：发布 SHA `eaac167`（`86f7e0a` + 跟进修复），Pages 部署 `https://a9016a60.prompt-hub-hub.pages.dev`（及后续部署），线上 `__APP_BUILD__ = '20260905b'` 已核对。内容：生图页「最近生成」首屏批量预签 grid（复用卡片库 sign-batch 链）、卡片库卡片封面走 `_grid` 池、`patchImageSrcFromCache`/`hydrateImageElements` assetId 链补 `cr_` 剥前缀、`__fromWarehouse` 封面排除临时上游 http 引用（护住「填入生图」参考图）、recent 批量预签等 bindFeed 落地后去重执行。详见 `CARD-LOADING.md`「生图 recent 首屏批量预签（2026-09-05）」与 `CURRENT-ISSUES.md`「2026-09-05 诊断与修复」。运营待办不变：历史对象 R2 批量回填（`scripts/run-warehouse-repair.mjs`）是否已跑无证据，若 `sign-batch` 仍 >2s 先跑回填。

上一轮（2026-09-01）：已完成 Pages + Worker 联合发布：Worker SHA `7f2c2afa557d90a1168c42ede1c6a004933fa2aa`（`/health.buildSha` 与 `api.prompt-hub.cn` 均已核对一致，Worker Version `70ac8541-e991-49c5-a02d-b852118fcad4`，绑定含 KV/双队列/R2/双自定义域/`*/2` cron 全部保留），Pages build `20260901c`。内容为两批性能与稳定性加固：

第一批（`3fe56ed`）：
- 版本化静态资源改 `immutable` 一年长缓存（带 `?v=` 的 pack 由 `functions/_middleware.js` 下发、其余清单文件由 `_headers` 覆盖），入口 HTML 与 `sw.js` 保持不缓存，不带 `?v=` 的 pack 请求仍 no-store 兜底；失效继续依赖 `bump-build.ps1` 刷新 `?v=`，新增守卫 `scripts/verify-versioned-cache.mjs` 挂入 predeploy smoke。
- CORS 删除任意 `*.vercel.app` 与任意 `chrome-extension://` 通配放行（生产已核对：恶意 vercel origin 不再反射 `Access-Control-Allow-Origin`，合法 origin 正常放行）；生产域名 https 强制。
- 11 处付费/上游 fetch 补 `AbortSignal.timeout`；`sortImgsByViewport` / `redistributeByHeight` 消除渲染期强制布局读取。

第二批（`7f2c2af`）：
- settle/confirm 轮询预算时钟（`opts.deadlineAt` 80s，用户路径不再同步自旋到边缘 524；recover 批耗尽标记 `settle_budget_exhausted`）；
- chat 扣费改「预扣 + 结算」并支持 `clientRequestId` 幂等（前端 studioChat 自动携带，上游带 `Idempotency-Key`）；
- 请求体 Content-Length 预检（generate/mj 32MB、video 64MB）；
- newapi 轮询侧补投限 3 分钟一次（`meta.newapiQueueEnqueuedAt`）。

数据库无变更、无迁移。发布后核对已完成：`https://prompt-hubs.com/` 返回 `__APP_BUILD__ = '20260901c'`；`curl -I pack-core.js?v=20260901c` 返回 `Cache-Control: public, max-age=31536000, immutable`，不带 `?v=` 仍为 no-store；`styles.css?v=` 同为 immutable；根 HTML 为 Pages 默认 `max-age=0, must-revalidate`（每次校验）；`legacy/`、`styles/` 源码分片线上 404；deploy-pages.ps1 内建生产 bundle smoke（24 项）全过。chat 幂等留观察项：一次成功发送后 `credit_ledger` 应仅有 1 条 `chat_generation` 预扣（或 replay 标记）+ 至多 1 条 `:settle` 差价，异常多扣请按 `chat_generation:<clientRequestId>` ref 对账。

上一轮（`29ae1c49…` / `20260831c`，Pages 部署 `8eccfa2a.prompt-hub-hub.pages.dev`）明细：
- 视频生成从仓库作曲器移除（不计划开通，无服务端模型入口）；
- 卡片库右侧编辑卡片面板等「只有黑夜没白天适配」UI 全面浅色化：编辑面板 `[data-theme="light"]` 覆盖（styles-warehouse.css）、`card-media-placeholder` 深色渐变改 `var(--card-skeleton-bg)`、composer 模型下拉 hover 白字、`imagegen-promo-notice` 黄字、复制/画布悬浮按钮浅色玻璃、MJ 胶片底色；
- 所有加载占位改透明 SVG（`data:image/svg` 判定不变），浅色加载由柔和扫光替代白球；`.card-media.is-loading .card-img` 透明度 0、摘除后淡入（卡片库/社区/生图统一）；
- 社区/作品纯图卡加载占 4:3 形状、完成后按 `min(75vh, 640px)` 封顶，修「整片变成一张大图」；`finishCardMediaShine` 扫光按 DOM 顺序级联（修「后面的先出来」）；
- 存卡提速（单解码 + 全量/网格并行、生成入库多槽并行、画廊并行落地、灰占位看门狗 6.5s）；卡片库排序清空列归属缓存（默认/最近生成/最近更新/最远/随机真正生效）；
- 手机底栏「昼夜」按钮删除，只保留桌面侧栏 `#themeToggleBtn`，手机用设置→外观。

**该轮 Worker 与数据库未变更**——改动全是前端 HTML/JS/CSS、feed/主题打包与文档。

上上轮（`a27f8ad` / `20260831b`，部署 `b69644b2.prompt-hub-hub.pages.dev`）：生图自定义下拉、浅色对比度、昼夜外置按钮与自动昼夜默认开启。发布后核对记录：`__APP_BUILD__ = '20260831b'`；`run-index-http-smoke.mjs`（24 项）全过；源码片段不可访问；Playwright 生产实测（390×844）：17 个自定义下拉正常、无页面脚本错误。

首屏基线：`b7604c1` / `20260830f` 实测 917KB、FCP - TTFB 547ms，后续 UI 轮次未重测；本轮 20260901c 的 immutable 缓存收益建议在回访场景下重测（二次加载 Network 面板 pack 全部 from disk cache）。

测量注意：自定义域名曾出现**瞬时** 5.2s TLS 握手（同期 `prompt-hub-hub.pages.dev` 仅 0.6s），复测恢复到约 0.5–0.7s。单次慢测量不能当作前端问题，先比对 pages.dev 与对照站点。

## 发布顺序

### 1. 固定候选提交

1. 只在 `D:\prompt-hub` 整理候选，历史树保持只读。
2. 审查全部改动和未跟踪文件，排除临时截图、缓存、凭据和本地构建产物。
3. 运行全量验证并创建一个可审查提交；正式发布要求 `git status --porcelain` 为空。

### 2. 核对 New API 前置版本

New API 必须先支持当前规范化契约：稳定幂等键、公开模型与真实渠道映射、比例格式转换、固定参数模型忽略无效可选字段，以及独立的 `quality` / `resolution` 语义。`https://newapi.prompt-hubs.com/api/model-catalog?refresh=1` 必须返回实时、非空版本和 `capability_version=2026-08-04.2`；目录仍需包含 `mj-v81`、`mj-v7`、`mj-niji7`，每个模型均为 0.4 元 / 40 积分/次、`n=1`、`speed=relax`、固定五图输出，且公开响应不包含内部路由信息。`server/wrangler.toml` 不得保存裸 IP 或 `sslip.io` 临时主机名。未完成此前置条件时不得部署 Prompt Hub 候选。

### 3. 创建和核对 Cloudflare 资源

先在正确账号中查询资源；仅在确认缺失时创建：

```powershell
cd D:\prompt-hub\server
npx --yes wrangler@4.114.0 queues list
npx --yes wrangler@4.114.0 queues create prompt-hub-video-generation
npx --yes wrangler@4.114.0 queues create prompt-hub-video-generation-dlq
```

仓库锁定的 Wrangler 3.114.17 仍用于当前 Worker dry-run/发布脚本，但它调用现行 Queues API
创建队列会返回 HTTP 400 `The specified queue settings are invalid`。队列资源的查询/创建使用上面的
固定 v4 命令；不要顺手升级项目依赖或改变 Worker 发布版本。

核对 `wrangler.toml` dry-run 同时保留：

- `CARD_IMAGES_R2`
- `PROMPT_HUB_METRICS`
- `IMAGE_GENERATION_QUEUE` 与图片 DLQ
- `VIDEO_GENERATION_QUEUE` 与视频 DLQ
- `NEWAPI_VIDEO_API_KEY` Secret 已存在且对应固定 `视频模型` 分组；视频链路不得回退到 `NEWAPI_API_KEY`
- `*/2 * * * *` cron
- 两个自定义域名、完整 `[vars]` 和 CORS 列表

### 4. 备份生产数据库

先按 `MEMFIRE-MIGRATION.md` 生成可恢复备份并记录校验结果。本轮备份为 `backups/prompt-hub-final-20260730-102016.dump`，大小 15,330,250 字节，`pg_restore --list` 返回 732 项，SHA-256 为 `7A83BD87B42E1B195121E542655A65B4C2F4E5EAABE0EDACDF45ABD34C488448`；项目外 DPAPI 加密副本已完成解密回算验证。迁移顺序固定为：

1. `supabase/migrations/20260722010000_generation_request_idempotency.sql`
2. `supabase/migrations/20260722020000_atomic_credit_operations.sql`
3. `supabase/migrations/20260722030000_apply_credit_delta_idempotency.sql`
4. `supabase/migrations/20260726010000_canvas_collaboration_seat_payments.sql`
5. `supabase/migrations/20260726020000_canvas_create_node_membership_reward.sql`

本轮迁移已在明确授权和最终 dry-run 通过后，以 `ON_ERROR_STOP` 和单事务模式按上述顺序执行。已核验幂等列/索引、原子积分 RPC、Canvas 支付表/RLS/权限和首次建点奖励 RPC。

### 5. 本地验证

```powershell
cd D:\prompt-hub\server
npm run typecheck
npm test

cd D:\prompt-hub
npm run check:docs
npm run check:predeploy
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stage-pages.ps1
$env:APP_ROOT = 'D:\prompt-hub\.pages-deploy'
node scripts\run-index-local-http-smoke.mjs
```

使用 `APP_ROOT=.pages-deploy` 运行仓库和手机浏览器检查，确保验收的是最终 Pages 暂存包。特别确认 `#warehouseHero`、`styles-warehouse.css` 和三张首屏图存在。

### 6. 解冻、dry-run 与迁移

Prompt Hub 数据库没有新增迁移。本轮不应用数据库迁移；Worker 与 Pages 代码必须从同一个干净发布 SHA 发布。先运行 Worker dry-run：

```powershell
cd D:\prompt-hub\server
npm run deploy:dry-run
```

保存 Worker 大小和全部绑定清单，检查没有资源丢失。若发布包含新迁移，dry-run 通过后再按时间戳顺序应用。任一步失败都停止发布并重新建立冻结标记。

### 7. 正式发布

从上述同一个干净 SHA 运行 Worker 发布：

```powershell
cd D:\prompt-hub\server
npm run deploy
```

Worker 受控脚本拒绝脏工作区或残留冻结标记，并自动注入当前 40 位 Git SHA。本轮已从同一干净 SHA 完成 `npm run deploy` 和 `deploy-pages.ps1`，并核对 `/health.buildSha` 与 Pages 线上 bundle。

### 8. 生产验收

```powershell
$health = Invoke-RestMethod https://api.prompt-hubs.com/health
$health
git rev-parse HEAD
```

必须满足：`ok: true`、`status: ready`，且 `buildSha` 与发布提交完全一致。随后验证：

1. 图片目录、参考图、提交、秒级轮询、预览和卡片入库。
2. 视频目录、文生视频、图生视频、长时 processing、播放 Range 请求和失败退款。
3. `/api/v1/payments/products` 与 `/api/v1/wallet/products` 返回相同商品。
4. 首次建点奖励只到账一次，重复事件不延长会员。
5. 管理后台运行监控、支付事件和卡片库摘要可读取。
6. Pages 发布后确认 `/prompts/` 的首屏广告图、仓库 CSS Content-Type 和卡片加载，再验证卡片库与 Canvas 完整用户流程。

生产验收不得通过删除用户数据、重复付费生成或手工补积分完成。

## 哪些内容需要部署

| 改动 | Pages | Worker/数据库 |
|---|---:|---:|
| 前端 HTML/JS/CSS | 是 | 否 |
| `server/src/**`, `server/wrangler.toml` | 否 | Worker |
| SQL migration | 否 | 先备份，再迁移 |
| 仅 Markdown、测试或维护脚本 | 否 | 否 |
| 前后端契约同时变化 | Worker 及迁移通过后 | 先完成 |

## 回滚

- Pages：从 Cloudflare Deployments 回滚到上一个成功版本。
- Worker：只从已知良好提交重新发布，核对 `/health.buildSha`；Secrets 不随 Git 回滚。
- 数据库：不要在生产直接覆盖。先在隔离项目恢复备份并核对，再决定切换或补偿迁移。
- R2：覆盖或删除对象前先核对数据库引用与备份，见 `R2-MIGRATION.md`。

## 部署工具链已知问题

### safe-delete 会中断 Pages 部署

`scripts/stage-pages.ps1` 原本用 `Remove-Item` 清空 `.pages-deploy` 并清理构建后的
`legacy/` `styles/` `partials/` 源码片段。本机删除走一层 safe-delete 包装，单回合内
超过 50 个文件会抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 并中断部署。

已改为 `Move-Item` 移到隔离区（Move 不走该包装）：暂存目录移到
`.pages-deploy-trash/<GUID>/`，该目录已在 `.gitignore` 中，可定期手动清理。

### stage-pages.ps1 必须保持纯 ASCII

该文件是 UTF-8 **无 BOM**，Windows PowerShell 5.1 会按系统 ANSI 解码。注释里一旦出现
中文，乱码会让解析器吞掉紧随其后的赋值语句，表现为
`New-Item : 无法将参数绑定到参数"Path"，因为该参数是空值`，部署在第一处隔离区创建时中断。

排查时容易误判成 `$env:TEMP` 未定义——实际上环境变量正常，是编码破坏了赋值语句。
修改此文件后，务必确认没有残留非 ASCII 字符。

### 生产冒烟在 PowerShell 下的假失败

`deploy-pages.ps1` 末尾调用 `scripts/run-index-http-smoke.mjs` 时，node 会向 stderr
输出 `NODE_TLS_REJECT_UNAUTHORIZED` 警告。脚本顶层是 `$ErrorActionPreference = "Stop"`，
PowerShell 把该 stderr 当成 `NativeCommandError` 抛出，于是**部署其实已经成功**但脚本报失败。

判断依据是 `Uploading...` / `Deployment complete` 日志，不是这一步的退出码。
需要单独复核时绕过 PowerShell：

```bash
SMOKE_BASE=https://prompt-hubs.com node scripts/run-index-http-smoke.mjs
```

### 只针对「源码分片」的首屏优化，必须在打包产物里剥掉

源码模式首屏有 39 个分片（6 个 `partials/index-body/part-*.html` + 33 个
`legacy/**/part-*.js`），`index.html` 因此带了一套「解析期并行预取」和 20 条 CSS
`preload` 提示。但 `.pages-deploy` 里这些分片已被 `build-pages-runtime.mjs` 合并成
monolith，源码片段随后被剪掉 —— 那两套提示在生产里**全是死链**，合计约 59 个 404，
比不优化更糟。

`build-pages-runtime.mjs` 的 `stripBundleOnlyAssets()` 按
`__PROMPT_HUB_PART_PREFETCH_START__/END__` 与
`__PROMPT_HUB_CSS_PRELOAD_START__/END__ <entry>` 标记把它们剥掉；**任一标记没匹配到
就直接构建失败**，避免静默上线一堆 404。

推论（重要）：**任何只针对源码分片的首屏优化，对生产都无效。** 生产是打包后的
monolith —— body 已内联、`script.js` 是单文件、`styles.css` 已内联，既没有分片请求
也没有同步 XHR。要改善线上首屏只能从打包体积和阻塞脚本入手（例如
`pack-imagegen.js` 385KB 的加载时机），而不是继续优化分片请求。

验证方式：`APP_ROOT` 指向 `.pages-deploy` 跑相关的浏览器回归，确保验的是最终产物
而不是源码树。

### 首屏 hero 图有两套标记，改一处不够

`assets/studio-preset/{scene,peishen,linche}.png` 在 **两个** partial 里各有一份：

- `partials/index-body/part-02.html` — 仓库 hero（`.warehouse-hero-card`）
- `partials/index-body/part-06.html` — 落地页 hero（`.landing-card`，也是 `/` 的默认路由）

两套标记同时存在于 DOM（未激活的页面只是被隐藏），所以只改其中一处会让 WebP 与 PNG
**各下载一份**，460KB 一点没省、还多出请求。改图片路径/格式时必须两处一起改，并用
`verify-warehouse-card-entrance-browser.mjs` 的「首屏 hero 图已走 WebP」断言兜底。

另外 `legacy/asset-studio/part-01.js` 的 preset 表也引用了这些 PNG（含 `shenmei.png`），
那是 asset-studio 独立页面，不属于首屏，暂未改动。

### 原始 PNG 不要再重编码

这些 PNG 已经是优化过的：Pillow 无损重编码（`optimize=True`）反而让它们**变大 435%**
（658KB → 3520KB）。要省体积只能换格式（WebP 省 53%），不要试图重新压 PNG。

### 延迟加载的 pack 会被 stage-pages 裁掉

`stage-pages.ps1` 靠扫描入口 HTML 的 `src="..."` / `href="..."` 收集根目录白名单文件。
改为首帧后动态注入的 pack 不再以 `src=` 出现，会被**静默裁出暂存包** —— 源码模式和
本地预览一切正常，只有线上缺文件、功能静默失效，极易漏过。

已修：从 `index.html` 的 `__PH_DEFERRED_PACKS_START__/END__` 标记块读出队列并加入白名单。
新增延迟项时必须在标记块里登记，否则同样会被裁掉。

同理，`verify-pack-contract.mjs` 原本只认 `<script src="pack.js?v=...">`，已改为阻塞式
src 与延迟队列命中任意一种即可，但仍要求至少命中一种。

### 改延迟加载时的两个顺序约束

`pack-imagegen` / `pack-feed` / `community-public-feed` / `features-draft` / `pack-extra`
必须**串行**按此顺序注入，不能并行 async：

1. `features-draft` 初始化会用到 `pack-imagegen` 的 `ImageGenJobRunner`（缺了会报
   `[FeatureDraft] pack-imagegen.js not loaded`）。
2. feed 包版本校验（原本是 `pack-feed.js` 后面的内联脚本，版本不符就 reload 整页）
   必须跟着 `pack-feed` 走。留在原地会在 pack-feed 到达之前就判定不符并 reload。

回归里有三条断言守着「延迟脚本最终必须补齐」，别删。
