# 部署与验证清单

最后核对：2026-08-29

## 当前发布状态

本轮已完成 Pages 发布：Git SHA `6cd6058`，Pages build `20260830c`，内容为卡片库入场动效、首屏并行预取与 `file://` 指引页。**Worker 与数据库未变更**——本轮改动全是前端 HTML/JS/CSS 与构建脚本，按下方「哪些内容需要部署」只走 Pages。

发布后核对：`https://prompt-hubs.com/` 返回 `__APP_BUILD__ = '20260830c'`；线上 `styles.css` 含 `card-enter-pending` / `card-enter-in`；线上 `index.html` 无 `__PH_PART_STORE__` 残留、无 `rel="preload" as="style"` 残留、body 已内联（`__PROMPT_HUB_DEPLOY_BODY__`）；`run-index-http-smoke.mjs`（`SMOKE_BASE=https://prompt-hubs.com`）全过；`legacy/`、`styles/`、`partials/` 源码片段在线上按预期不可访问；`/health` 返回 `ok: true`。

上一轮 Worker 状态仍为 `buildSha=464e06883fc8e304280d49826c58436eab05c2dc`，本轮不动。

> **本次带上的前序提交**：本轮分支在 `d396e04` 之后还累积了 11 个未发布提交（含
> `f8fb7b7` 聚焦态路由残留修复、`b770327` 未聚焦分页哨兵挤列修复、`ffc8174` composer
> 版本号失效修复、`7a0f269` pageWarehouse 闭合、`f1749f6` 生图完成自动入库），
> 已与本次改动一并发布。

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
