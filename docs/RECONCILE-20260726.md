# Prompt Hub 双树收编记录

最后核对：2026-07-27

> 本文区分“生产已上线”和“主树本地完成”。冻结标记存在期间，任何本地完成项都不能写成线上能力。

## 当前结论

- **唯一候选源**：`D:\prompt-hub`。
- **历史生产审计源**：`D:\canvas\prompt-hub`，只读，不再作为开发或部署源。
- **当前生产**：仍来自历史树的旧版本，不包含本轮主树的完整安全层。
- **当前候选**：主树仍是脏工作区，迁移未应用，队列未核验，不能部署。

双树文件完全相同不是目标。目标是逐项审计生产行为，将需要保留的能力以主树现有契约安全实现，并明确拒绝会重复付费、泄露渠道或回退公开接口的历史实现。

## 已在主树完成

| 子系统 | 本地主树状态 | 关键约束 |
|---|---|---|
| 图片生成 | 已收编 | `queued` 单次领取；未知结果、`not_found` 和队列重投不再次 POST；客户端秒级 poll，cron 兜底 poll/archive |
| 视频生成 | 已重写 | 独立视频队列；CAS + attempt ID 单次领取；有任务 ID 的长时 `processing` 不设生成超时；未知建单结果 1 小时后进入持久退款槽 |
| 视频计费 | 已收编 | 只信任明确 `billed_duration_seconds`；差价退款使用独立幂等 ref `<jobId>:duration-adjustment` |
| 路由一致性 | 已收编 | submit、poll、content 保留同一 `routeChannelId`；内容只通过上游 task content 接口获取 |
| 支付 | 已收编 | EasyPay 回调审计、陈旧订单监控、Canvas 席位迁移；`/payments` 为主入口，`/wallet` 为兼容别名 |
| 会员任务 | 已收编 | 首次创建 Canvas 节点通过 `grant_canvas_create_node_reward` 原子标记并奖励一次 |
| 发布治理 | 已收编 | 正式发布拒绝冻结标记和脏工作区；构建注入 Git SHA；`/health` 返回 `buildSha` |

## 明确拒绝的历史实现

- 将 `outcome_unknown`、`running` 或长时间 lease 自动改回可提交状态。
- 在状态查询 GET 中对未知付费任务触发重新 POST。
- 将上游 `not_found` 直接解释为“从未建单”并自动重投。
- 接受用户手填 task ID 恢复或接管付费任务。
- 直接请求数据库里任意 `resultUrl`；视频内容必须走已配置 New API 基址和 task ID。
- 在 Prompt Hub 内按某个具体视频模型拼接私有上游参数。比例格式转换、固定分辨率忽略和 provider 特有字段属于 New API 能力层。
- 用历史树的整文件覆盖主树公开模型投影、原子积分 RPC 或安全错误响应。

## 仍是发布阻塞的外部步骤

1. Cloudflare 中创建并核对 `prompt-hub-video-generation` 和 `prompt-hub-video-generation-dlq`；确认图片队列、R2、KV、cron 仍存在。
2. 对生产数据库做可恢复备份，随后按以下顺序应用：
   - `20260722010000_generation_request_idempotency.sql`
   - `20260722020000_atomic_credit_operations.sql`
   - `20260722030000_apply_credit_delta_idempotency.sql`
   - `20260726010000_canvas_collaboration_seat_payments.sql`
   - `20260726020000_canvas_create_node_membership_reward.sql`
3. New API 先部署当前能力契约：规范化比例、忽略模型不支持的可选参数、保持 `quality` 与 `resolution` 语义分离、支持稳定幂等键和真实渠道目录。
4. 整理并审查主树提交；正式发布必须来自干净提交。
5. 执行 `npm run check:docs`、`npm run check:predeploy`、Worker typecheck/test 和 `npm run deploy:dry-run`。
6. 获得发布授权后再解除冻结。部署后 `/health.buildSha` 必须等于发布提交 SHA。

## 验证基线

2026-07-27 收尾验证已通过：Worker `npm run typecheck`、46 个测试文件共 283 项测试、根目录 `npm run check:docs`、`npm run check:predeploy` 和 `server npm run deploy:dry-run`。dry-run 产物为 1990.07 KiB（gzip 390.99 KiB），解析后的配置保留 13 个普通变量、R2、KV、双生产者/双 consumer、两个 DLQ、cron 和两个自定义域名。以上只证明本地主树候选，不证明生产已上线。

## 以后如何避免再次分叉

- 只从 `D:\prompt-hub` 的已审查提交发布。
- 每个任务使用独立分支/worktree，不在两个长期检出中并行改同一子系统。
- 代码、测试和受影响文档属于同一个完成条件；文档与运行时代码冲突时，以代码和测试取证并在同一任务修正文档。
- 所有生产部署都记录 Git SHA，并通过 `/health.buildSha` 核对。
