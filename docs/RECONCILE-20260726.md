# Prompt Hub 双树收编记录

最后核对：2026-08-28

> 本文区分“生产已上线”和“主树本地完成”。生产切换必须通过 `/health.buildSha`、Pages build 和线上冒烟取证，不能只凭本地提交或测试通过作结论。

## 当前结论

- **唯一候选源**：`D:\prompt-hub`。
- **历史生产审计源**：`D:\canvas\prompt-hub`，只读，不再作为开发或部署源。
- **生产已上线**：Worker `buildSha=464e06883fc8e304280d49826c58436eab05c2dc`，Pages build `20260828a`；均已通过线上健康检查和静态 bundle 冒烟。
- **本轮变更**：Prompt-first 卡片库首页、黑屏缓存恢复、公开图片模型目录投影和自然高度瀑布流已上线；不新增数据库迁移。

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

## 发布证据

- **New API 已核验**：2026-08-06 稳定域名解析到新服务器并返回 66 个目录型号、非空目录版本和 `capability_version: 2026-08-04.2`；旧地址 `43.153.201.78` 的 80/443 端口均拒绝连接。`mj-v81`、`mj-v7`、`mj-niji7` 保持 0.4 元 / 40 积分/次、固定 Relax 和五图输出，公开目录与定价无内部渠道、域名或映射字段。
- **Cloudflare 资源已核验**：图片/视频 Queue 与 DLQ、`prompt-hub-card-images` R2、`PROMPT_HUB_METRICS` KV 均存在；图片与视频 Queue 均显示 1 producer / 1 consumer。
- **Git 与验证状态**：`ca8cbf6e658766e5d98e9748c258ca4e6f02dab6` 增加视频音轨参数转发、提交阶段日志和回归验证；最终运行提交仍必须从线上 `/health.buildSha` 读取并核对，生产目录必须保持非 stale。
- **数据库备份已核验**：`prompt-hub-final-20260730-102016.dump` 为 15,330,250 字节，`pg_restore --list` 返回 732 项，SHA-256 为 `7A83BD87B42E1B195121E542655A65B4C2F4E5EAABE0EDACDF45ABD34C488448`；项目外 DPAPI 加密副本已完成解密回算。

- **数据库迁移已应用**：最终 dry-run 通过后用单事务按以下顺序应用，并核验列、索引、RPC、支付表、RLS 与 `service_role` 权限：
   - `20260722010000_generation_request_idempotency.sql`
   - `20260722020000_atomic_credit_operations.sql`
   - `20260722030000_apply_credit_delta_idempotency.sql`
   - `20260726010000_canvas_collaboration_seat_payments.sql`
   - `20260726020000_canvas_create_node_membership_reward.sql`

后续正式发布仍必须来自 build bump 和文档状态更新后的最终干净 SHA。部署后 `/health.buildSha` 必须等于该发布 SHA。

## 验证基线

2026-08-08 `ca8cbf6e658766e5d98e9748c258ca4e6f02dab6` 已通过 Worker `npm run typecheck`、55 个测试文件共 374 项测试、36 份文档检查和完整前端预部署冒烟。`generate_audio` 在视频入口、持久 envelope 和 New API body 中保持一致；提交日志只记录无敏感元数据。本任务没有发送付费生成 POST；任何失败或超时都不得在本任务重提。

## 以后如何避免再次分叉

- 只从 `D:\prompt-hub` 的已审查提交发布。
- 每个任务使用独立分支/worktree，不在两个长期检出中并行改同一子系统。
- 代码、测试和受影响文档属于同一个完成条件；文档与运行时代码冲突时，以代码和测试取证并在同一任务修正文档。
- 所有生产部署都记录 Git SHA，并通过 `/health.buildSha` 核对。
