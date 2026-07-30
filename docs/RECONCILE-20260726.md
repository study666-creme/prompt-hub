# Prompt Hub 双树收编记录

最后核对：2026-07-30

> 本文区分“生产已上线”和“主树本地完成”。冻结标记存在期间，任何本地完成项都不能写成线上能力。

## 当前结论

- **唯一候选源**：`D:\prompt-hub`。
- **历史生产审计源**：`D:\canvas\prompt-hub`，只读，不再作为开发或部署源。
- **当前生产**：Worker 仍来自历史树的旧版本，不包含本轮主树的完整安全层。Pages 显示 `20260729b`，但缺少候选仓库首屏 DOM 与独立 CSS，不能据此认定候选已完整上线。
- **当前候选**：`4fcb4b0cf61a1d6260d7fd6485c2d282da71614f` 已提交并从干净工作区完成全量验证；New API 与 Cloudflare 资源已核验。生产数据库新鲜备份和五项迁移仍未完成，冻结标记仍存在，因此不能部署。

双树文件完全相同不是目标。目标是逐项审计生产行为，将需要保留的能力以主树现有契约安全实现，并明确拒绝会重复付费、泄露渠道或回退公开接口的历史实现。

## 已在主树完成

| 子系统 | 本地主树状态 | 关键约束 |
|---|---|---|
| 图片生成 | 已收编 | `queued` 单次领取；未知结果、`not_found` 和队列重投不再次 POST；客户端秒级 poll，cron 兜底 poll/archive |
| 视频生成 | 已重写 | 独立视频队列；CAS + attempt ID 单次领取；有任务 ID 的长时 `processing` 不设生成超时；未知建单结果 1 小时后进入持久退款槽 |
| 视频计费 | 已收编 | 只信任明确 `billed_duration_seconds`；差价退款使用独立幂等 ref `<jobId>:duration-adjustment` |
| 路由一致性 | 已收编 | submit、poll、content 保留同一 `routeChannelId`；内容只通过上游 task content 接口获取 |
| 支付 | 已收编 | EasyPay 回调审计、陈旧订单监控、Canvas 席位迁移；`/payments` 为主入口，`/wallet` 为兼容别名；新订单仅支付宝，历史微信回调继续结算 |
| 会员任务 | 已收编 | 首次创建 Canvas 节点通过 `grant_canvas_create_node_reward` 原子标记并奖励一次 |
| 发布治理 | 已收编 | Worker/Pages 正式发布拒绝冻结标记和脏工作区；构建注入 Git SHA；`/health` 返回 `buildSha`；Pages 暂存强制验证仓库首屏 DOM/CSS/图片 |

## 明确拒绝的历史实现

- 将 `outcome_unknown`、`running` 或长时间 lease 自动改回可提交状态。
- 在状态查询 GET 中对未知付费任务触发重新 POST。
- 将上游 `not_found` 直接解释为“从未建单”并自动重投。
- 接受用户手填 task ID 恢复或接管付费任务。
- 直接请求数据库里任意 `resultUrl`；视频内容必须走已配置 New API 基址和 task ID。
- 在 Prompt Hub 内按某个具体视频模型拼接私有上游参数。比例格式转换、固定分辨率忽略和 provider 特有字段属于 New API 能力层。
- 用历史树的整文件覆盖主树公开模型投影、原子积分 RPC 或安全错误响应。

## 发布前置状态

- **New API 已核验**：2026-07-30 公开目录返回 `capability_version: 2026-07-29.1`；`sd2.0-pro` 的公开契约为 4–15 秒、固定 720p、最多 9 图/3 视频/3 音频。
- **Cloudflare 资源已核验**：图片/视频 Queue 与 DLQ、`prompt-hub-card-images` R2、`PROMPT_HUB_METRICS` KV 均存在。视频 Queue 在候选 Worker 发布前没有 producer/consumer，符合冻结期预期。
- **Git 与验证已完成**：候选提交为 `4fcb4b0cf61a1d6260d7fd6485c2d282da71614f`，全量验证结果见下节。
- **仍阻塞发布**：生产数据库尚未生成本次发布前的新鲜可恢复备份。

备份完成并获得解冻授权后，按以下顺序应用迁移：
   - `20260722010000_generation_request_idempotency.sql`
   - `20260722020000_atomic_credit_operations.sql`
   - `20260722030000_apply_credit_delta_idempotency.sql`
   - `20260726010000_canvas_collaboration_seat_payments.sql`
   - `20260726020000_canvas_create_node_membership_reward.sql`

正式发布必须来自解冻、build bump 和文档状态更新后的最终干净 SHA。部署后 `/health.buildSha` 必须等于该发布 SHA。

## 验证基线

2026-07-30 候选 `4fcb4b0cf61a1d6260d7fd6485c2d282da71614f` 验证已通过：Worker `npm run typecheck`、50 个测试文件共 340 项测试、根目录 `npm run check:docs` 与 `npm run check:predeploy`、Pages 暂存 HTTP 冒烟、仓库桌面/手机/空态浏览器验收，以及生图批量可靠性、提交反馈、最近生成留存、缺图清理、卡片操作布局、访客隔离和手机首屏专项。冻结标记仍存在，因此本轮未构建 Worker dry-run；历史 dry-run 结果不能替代解冻后从最终干净 SHA 重跑。以上只证明本地主树候选，不证明生产已上线。

## 以后如何避免再次分叉

- 只从 `D:\prompt-hub` 的已审查提交发布。
- 每个任务使用独立分支/worktree，不在两个长期检出中并行改同一子系统。
- 代码、测试和受影响文档属于同一个完成条件；文档与运行时代码冲突时，以代码和测试取证并在同一任务修正文档。
- 所有生产部署都记录 Git SHA，并通过 `/health.buildSha` 核对。
