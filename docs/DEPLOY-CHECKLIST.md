# 视频终态 Worker 发布与验证清单

最后核对：2026-07-29

冻结标记存在时只允许测试和 `deploy:dry-run`。禁止生产迁移、`wrangler deploy`、Pages 发布或真实付费生成。

## 发布前置

1. 确认 New API 已先发布结果未知、防重放和稳定幂等键契约。
2. 为生产数据库创建可恢复备份并完成恢复抽检。
3. 按顺序应用并核对：
   - `20260722010000_generation_request_idempotency.sql`
   - `20260722020000_atomic_credit_operations.sql`
   - `20260722030000_apply_credit_delta_idempotency.sql`
4. 确认 Cloudflare 已存在 `prompt-hub-video-generation` 和 `prompt-hub-video-generation-dlq`。
5. 候选必须是已审查的干净 Git 提交，且已获得明确发布授权。

本视频候选不需要 `20260726010000_canvas_collaboration_seat_payments.sql` 或 `20260726020000_canvas_create_node_membership_reward.sql`；它们属于其他发布范围，不得混入本次迁移。

## 本地验证

```powershell
cd D:\canvas\.tmp\prompt-hub-video-terminal-release-20260729
git status --short --branch
npm run check:docs
npm run check:predeploy

cd server
npm ci
npm run typecheck
npm test
npm run deploy:dry-run
```

dry-run 必须显示 `IMAGE_GENERATION_QUEUE`、`VIDEO_GENERATION_QUEUE`、R2、KV 和 `BUILD_SHA`；它不改变线上状态。

## 正式发布

仅在前置全部完成并由用户明确授权后，移除两处冻结标记，从已审查 SHA 执行：

```powershell
cd D:\prompt-hub\server
npm run deploy
```

发布脚本拒绝脏工作树和冻结标记，并把当前 40 位 Git SHA 注入 `BUILD_SHA`。

## 发布后验证

1. `GET https://api.prompt-hubs.com/health` 返回 `ok=true`、`status=ready`，`buildSha` 精确等于发布提交。
2. `npx wrangler queues list` 显示 `prompt-hub-video-generation` 为 `1 producer / 1 consumer`；DLQ 绑定正确。
3. Worker 版本同时保留图片队列、R2、KV、cron 和两个自定义域名。
4. cron 能推进已有 `upstreamTaskId`；`submission_unknown` 不触发第二次视频 POST。
5. 最后才使用一次最低价非 Grok 视频做真实验收，核对单次 POST、单次扣费、明确终态、媒体读取和失败时的单次退款。

## 回滚

Worker 只能回滚到已知良好提交；Secrets 不随代码回滚。数据库迁移包含钱包 RPC 和唯一约束，不能用破坏性逆向 SQL 直接回滚；应先在恢复库验证，再按事故方案切换。任何已扣费且结果未知的任务都禁止重提。
