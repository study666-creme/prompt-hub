# 运营监控

最后核对：2026-08-08。生产 Worker `buildSha=ca8cbf6e658766e5d98e9748c258ca4e6f02dab6`；运行版本继续以 `/health.buildSha` 为准。

## 入口

- 页面：`https://prompt-hubs.com/admin.html` → 概览 → 运行监控
- 接口：`GET /api/admin/dashboard/monitoring?hours=24`
- 发布身份：`GET https://api.prompt-hubs.com/health`

`/health` 必须返回 `ok`、`status`、`buildSha` 和支付配置摘要。正式发布的 `buildSha` 应是 40 位小写 Git SHA；`unversioned` 只允许本地开发出现。

## 生成监控

排查 Canvas 视频提交时，按 `clientRequestId` 关联 Worker 日志。提交日志只记录 `jobId`、`clientRequestId`、模型、阶段、task ID 和错误码，不记录提示词、访问令牌或素材 URL。`received` 证明 Prompt Hub 已收到请求；`newapi_submit` 后没有 `accepted`，说明问题发生在 Prompt Hub 到 New API 的提交或响应；出现 `accepted` 则应继续根据持久化 task ID 排查 New API 或模型端状态。

`NEWAPI_API_BASE_URL` 必须为 `https://newapi.prompt-hubs.com`，不能固定当前解析 IP 或 `sslip.io` 临时域名。巡检 `GET /api/v1/generate/models` 时同时确认 `catalogStale=false`、`catalogVersion` 与 `pricingVersion` 非空；新服务未单独发布价格版本时，后者等于覆盖完整价格负载的目录版本。若目录退回 stale，先只读检查稳定域名的 `/api/model-catalog?refresh=1` 和 Worker binding，不得用付费 POST 反复探活。

### 图片

- 前端正常按秒 poll；cron 每 2 分钟兜底推进 submit、poll 和 archive。
- 关注 `queued` 堆积、`running` / `outcome_unknown` 超过 1 小时、`refund_pending`、归档失败和图片 404。
- 上游已完成但本地归档未完成时应继续给客户端临时图，不能重新生成。

### 视频

- `NEWAPI_VIDEO_API_KEY` 必须单独存在并固定绑定 `视频模型` 分组；不要与文字/图片的 `NEWAPI_API_KEY` 共用，也不要配置为 `auto`。
- 图片和视频队列必须分别查看，视频慢建单不能挤占图片 consumer。
- `queued` 长时间堆积表示视频 queue binding、consumer 或 cron 异常。
- `submitted` 且有 `upstreamTaskId` 的正常 processing 任务可以排队数百或数千秒，不应仅按生成时长判失败。
- 带 `upstreamTaskId` 的任务进入 `result_uncertain` 后，后台必须只读 GET 同一个 NewAPI task ID。显式线路使用持久化 `routeChannelId`；普通公开视频依赖 NewAPI 持久任务中的原始 `ChannelId` 锁回提交渠道。不能重发生成 POST，也不能切换渠道重新查询或提交。
- `result_uncertain` 持续 1 小时仍无法确认时应幂等进入 `refund_pending`，随后收敛为明确失败和 `refunded`；`running` / `outcome_unknown` 且没有可靠 task ID 也遵循一小时 SLA。
- 每轮 cron 必须先 poll，再执行 timeout finalize。告警中若同时出现恢复成功和退款候选，先核对该顺序，避免刚成功的任务被提前退款。
- task `not_found` 的 SLA 起点只记录第一次，重复轮询不能刷新。
- `billingReconciliationState=pending` 表示已完成但时长差价退款待恢复；只接受明确 `billed_duration_seconds`。

## 支付监控

- cron 同时运行 `monitorPendingPaymentOrders`，用于发现陈旧订单，不替代支付回调。
- 查看 Canvas 席位的 `payment_orders` / `payment_events`、通用支付的 `payment_webhook_events` 与运营流水，区分 `pending`、`processing`、`paid`、`failed` 和 `refunded`。
- Canvas 协作席位商品默认由 `CANVAS_COLLABORATION_SEAT_PRODUCT_ENABLED=0` 隐藏；数据库迁移和回调验收前不要开启。

## 卡片库与存储巡检

- Pages 发布前后必须确认 `/prompts/` 的内联 HTML 包含 `#warehouseHero`，`/styles-warehouse.css` 返回 `text/css` 而不是 SPA HTML 回退，三张 `assets/studio-preset/*.png` 首屏图均返回 `image/*`。`scripts/run-index-http-smoke.mjs` 已将这些条件设为硬失败。
- 卡片库：`GET /api/admin/cards/summary`、`GET /api/admin/cards?...`；`checkImages=1` 只抽检当前页。
- 存储扫描按需触发且只读。不能用全桶对象字节反写 `profiles.storage_bytes`，桶中含缩略图和生成归档。
- R2/Storage 删除前必须核对引用与备份；巡检不能自动删除用户卡片。

## Cloudflare 绑定

生产 Worker 必须同时存在：

```toml
[[r2_buckets]]
binding = "CARD_IMAGES_R2"

[[kv_namespaces]]
binding = "PROMPT_HUB_METRICS"

[[queues.producers]]
binding = "IMAGE_GENERATION_QUEUE"
queue = "prompt-hub-image-generation"

[[queues.producers]]
binding = "VIDEO_GENERATION_QUEUE"
queue = "prompt-hub-video-generation"

[triggers]
crons = ["*/2 * * * *"]
```

队列还必须分别配置 DLQ。实际 ID 和绑定以 `server/wrangler.toml` 与 Cloudflare Dashboard 为准，不从旧文档复制。

## 告警优先级

1. **P0**：重复付费 POST、重复扣费、跨用户任务/媒体访问、支付回调重复结算。
2. **P1**：队列持续堆积、退款槽无法清空、上游已完成但客户端长期拿不到结果、`/health` degraded。
3. **P2**：归档重试、缩略图缺失、单个模型目录暂时不可用。

处置时先保留任务和审计记录。不要通过重开 paid submit、删除失败记录或手工改余额来“清队列”。
