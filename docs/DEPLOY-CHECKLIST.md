# 部署与验证清单

最后核对：2026-07-27

## 当前冻结

两处 `DO-NOT-DEPLOY.md` 存在期间禁止正式 Worker/Pages 发布和生产迁移。`npm run deploy:dry-run` 只构建本地产物，允许在冻结期间核验。不要为了让脚本通过而提前删除冻结标记。

## 发布顺序

### 1. 固定候选提交

1. 只在 `D:\prompt-hub` 整理候选，历史树保持只读。
2. 审查全部改动和未跟踪文件，排除临时截图、缓存、凭据和本地构建产物。
3. 运行全量验证并创建一个可审查提交；正式发布要求 `git status --porcelain` 为空。

### 2. 核对 New API 前置版本

New API 必须先支持当前规范化契约：稳定幂等键、公开模型与真实渠道映射、比例格式转换、固定参数模型忽略无效可选字段，以及独立的 `quality` / `resolution` 语义。未完成此前置条件时不得部署 Prompt Hub 候选。

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
- `*/2 * * * *` cron
- 两个自定义域名、完整 `[vars]` 和 CORS 列表

### 4. 备份并迁移生产数据库

先按 `MEMFIRE-MIGRATION.md` 生成可恢复备份并记录校验结果，再依次执行：

1. `supabase/migrations/20260722010000_generation_request_idempotency.sql`
2. `supabase/migrations/20260722020000_atomic_credit_operations.sql`
3. `supabase/migrations/20260722030000_apply_credit_delta_idempotency.sql`
4. `supabase/migrations/20260726010000_canvas_collaboration_seat_payments.sql`
5. `supabase/migrations/20260726020000_canvas_create_node_membership_reward.sql`

迁移需要明确授权。本地收尾和 dry-run 不执行这些 SQL。

### 5. 本地验证

```powershell
cd D:\prompt-hub\server
npm run typecheck
npm test
npm run deploy:dry-run

cd D:\prompt-hub
npm run check:docs
npm run check:predeploy
```

dry-run 允许脏工作区是为了冻结期核验，不能据此发布。保存输出中的 Worker 大小和全部绑定清单，检查没有资源丢失。

### 6. 正式发布

只有前五步完成并获得明确授权后，才能移除两处冻结标记、提交该变更并从干净提交运行：

```powershell
cd D:\prompt-hub\server
npm run deploy
```

受控脚本会拒绝脏工作区或残留冻结标记，并自动注入当前 40 位 Git SHA。

### 7. 生产验收

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
6. Pages 发布后再验证卡片库与 Canvas 完整用户流程。

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
