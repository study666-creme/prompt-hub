# 发布冻结：当前禁止生产部署

最后核对：2026-07-29

本分支是从 `D:\prompt-hub` 审计后抽出的最小视频终态候选；`D:\canvas\prompt-hub` 只保留作历史生产审计。当前生产仍没有视频队列绑定、原子积分 RPC、结果未知 SLA 和构建 SHA，因此禁止直接发布。

本候选本地已收编并验证：

- 视频独立队列、单次原子领取、未知结果退款 SLA、长时 SD 轮询和按明确计费秒数退差价。
- 受控 Worker 发布脚本和 `/health.buildSha`。

已完成的外部前置：

- 2026-07-28 已在正确 Cloudflare 账号创建并复核
  `prompt-hub-video-generation` 与 `prompt-hub-video-generation-dlq`。冻结期间未发布 Worker，
  因此两条新队列当前没有 producer/consumer；正式发布后仍须核对 consumer、DLQ 和 cron 冒烟。

解除冻结前仍必须完成：

1. 备份生产数据库，再按 `docs/DEPLOY-CHECKLIST.md` 的顺序应用三条生成/积分迁移。
2. 核对并先上线与当前规范化参数契约匹配的 New API 能力转换层。
3. 将候选改动整理成干净、可审查的 Git 提交。
4. 从该干净提交重跑全量测试、根目录预部署检查和 Worker dry-run。
5. 获得明确发布授权，再移除两处冻结标记并执行正式发布；发布后核对视频队列 consumer、DLQ 和 cron。

冻结期间禁止：正式 `wrangler deploy`、Pages 发布、生产迁移、删除任一 `DO-NOT-DEPLOY.md`。`npm run deploy:dry-run` 只生成本地产物，不改变线上状态，允许用于核验。

详细决策和发布顺序见 `docs/RECONCILE-20260729-VIDEO-TERMINAL.md`。
