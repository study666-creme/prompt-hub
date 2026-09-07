# 数据模型与存储分层

最后核对：2026-07-30。五项发布迁移已在生产单事务应用并完成契约核验。

## 四层数据

```text
MemFire Postgres/Auth
  profiles, user_data, community_posts, generation_requests,
  credit_ledger, activation_codes, membership_*, asset_packages ...

Cloudflare R2 / MemFire Storage
  card-images/{user_uuid}/...

Worker/CDN URL
  短期签名和边缘缓存，不是持久数据

浏览器
  IndexedDB 快照 + localStorage/sessionStorage UI 状态
```

## 核心表

| 表 | 用途 | 写入者 |
|---|---|---|
| `user_data` | 每用户一行 JSON：卡片、分组、设置和功能切片 | 用户 RLS/Worker |
| `profiles` | 会员、积分汇总、配额和统计 | Worker |
| `credit_ledger` | 积分流水 | Worker |
| `activation_codes`, `code_redemptions` | 卡密和核销 | Worker/admin |
| `generation_requests` | 图片/视频任务、幂等请求键、提交状态、结果和退款状态 | Worker |
| `payment_orders`, `payment_events`, `payment_webhook_events` | Canvas 席位订单/事件与通用支付回调审计 | Worker |
| `community_posts` | 全站公开帖子 | Worker |
| `community_post_likes`, `community_notifications` | 点赞和通知 | Worker |
| `membership_task_*` | 任务进度与领取 | Worker |
| `asset_packages*` | 资产包和用户权益 | Worker |
| `site_settings` | 后台可配置模型目录 | Worker/admin |

Schema 真源是 `supabase/schema.sql` 与 `supabase/migrations/`。MemFire 使用 Supabase-compatible schema，所以目录名暂不改。

## 2026-07-30 生产迁移

以下迁移已在生产备份后用单事务按时间戳顺序执行：

1. `20260722010000_generation_request_idempotency.sql`：生成请求稳定 ID 和所有权约束。
2. `20260722020000_atomic_credit_operations.sql`：钱包行锁下的扣费、退款、会员日积分和试用 RPC。
3. `20260722030000_apply_credit_delta_idempotency.sql`：旧积分增减入口补幂等契约。
4. `20260726010000_canvas_collaboration_seat_payments.sql`：Canvas 协作席位订单与支付结算。
5. `20260726020000_canvas_create_node_membership_reward.sql`：首次建点 claim 与会员奖励原子提交。

执行后已验证 `generation_requests.client_request_id` 与唯一索引、`consume_user_credits` / `refund_user_credits` / `apply_credit_delta`、`payment_orders` / `payment_events`、`grant_canvas_create_node_reward`，以及 `service_role` 的函数/表权限。备份校验和与执行记录见 `DEPLOY-CHECKLIST.md`。

## 生成状态元数据

`generation_requests.meta` 是状态机信封，不是前端可自由修改的 JSON。关键字段包括：

- 图片：`fastSubmitState`、`fastSubmitAttemptId`、`fastSubmitOutcomeUnknownAt`、归档状态。
- 视频：`videoSubmitState`、`videoSubmitAttemptId`、`videoSubmitEnvelope`、`upstreamTaskId`、`routeChannelId`、`refundState`。
- 计费：`debitSplit`、`credits`、`billingUnitCredits`、`actualDurationSeconds`、`billingReconciliationState`。

`queued` 是唯一可领取付费提交的状态。`running` 和 `outcome_unknown` 表示上游可能已经收费，不能自动改回 `queued`。

## 用户 JSON

`user_data.data` 常见字段：

- `cards`: 卡片主数据
- `customGroups`, `globalFields`: 仓库结构
- `settings`: 筛选、发布默认值、tombstone 等
- `communityPosts`: 当前账号社区副本
- `creations`: 生图历史/最近生成数据
- 其他功能切片由 `FeatureDraft.getCloudSlice` 合并

卡片常用字段包括 `id`、`title`、`prompt`、`image`、`cardImages`、`groupId`、`tags`、`pinned`、`updatedAt`、`publishedToCommunity`、`communityPostId`、`genJobId` 和 `referenceAssets`。

## 图片引用

| 形式 | 处理 |
|---|---|
| `storage://card-images/{uid}/{path}` | 推荐持久格式，需 Worker 签名 |
| `https://.../api/v1/media/...` | 短期 CDN 展示 URL，不回写 JSON |
| 第三方 `https://...` | 可展示但源站失效后无法恢复 |
| `data:image/...` | 本地待上传，不应长期同步到大 JSON |

`referenceAssets` 记录参考图来源元数据，`refImages` 保存真正提交上游的引用。数组索引、`sourceCardId` 和 `jobId` 要保持对应。

## 社区一致性

`community_posts` 是公共展示真源；`communityPosts` 是用户私有副本；卡片发布字段是意图。去重优先 `source_card_id`，不能仅按 prompt 文本合并不同作者帖子。

## 数据库查询示例

```sql
select id, author_id, source_card_id, published, created_at
from public.community_posts
where published = true
order by created_at desc
limit 50;
```

公开文档和脚本示例必须使用占位 UUID，不写真实用户 ID。
