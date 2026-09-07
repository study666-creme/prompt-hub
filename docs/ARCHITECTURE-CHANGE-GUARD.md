# 架构改动护栏

## 先判断改动类型

| 类型 | 例子 | 处理方式 |
|---|---|---|
| 局部修复 | 一个状态判断、CSS 溢出、错误参数 | 定点修改并跑相关回归 |
| 共享行为变更 | 图片签名、同步合并、Feed 分页 | 明确影响面，补跨页面验证 |
| 架构调整 | 换数据真源、重排脚本顺序、迁存储 | 先写风险、回滚和分阶段方案 |

## 不可破坏的契约

1. `user_data.data.cards` 是登录用户卡片真源；本地快照不能反向清空云端。
2. 图片持久引用使用 `storage://`；R2/Storage 的选择由 Worker 管理。
3. 根目录 loader、拆分片段、生产 pack 和 Pages staging 必须保持一致。
4. 社区公共表、用户私有社区副本和卡片发布标记是三层数据，不能随意合并成单一数组。
5. 手机 `.app-main` 是唯一纵向滚动根。
6. 积分、会员、激活码和生图结算只能由 Worker 写入。
7. 图片/视频付费 POST 只能由持久 `queued` 状态通过 CAS 领取一次；未知结果、task 404 或超时不能自动重提。
8. 公开模型只暴露规范化参数和匿名路由；provider 特有转换属于 New API，真实渠道不得下发浏览器。
9. 有 `upstreamTaskId` 的视频 `result_uncertain` 只能只读 GET 同一个 NewAPI task ID：显式线路沿用持久化 `routeChannelId`，普通公开视频由 NewAPI 持久任务的原始 `ChannelId` 锁回提交渠道；不得重发生成 POST、重新选路或切换渠道。
10. `result_uncertain` 持续 1 小时仍无法确认时，必须通过幂等 `refund_pending` / `refunded` 收敛为失败；cron 顺序必须先 poll、后 timeout finalize，避免成功与退款竞态。

## 跨模块改动说明

开始前写清四件事：要解决的现象、实际根因层、可能受影响的页面/数据、如何回滚。优先把改动拆成“兼容接入 -> 数据迁移 -> 删除旧路径”，不要一次同时换接口、状态格式和 UI。

## 高风险文件

- `supabase-sync.js`, `cloud-sync-safety.js`: 账号与数据合并
- `card-image-loader.js`, `warehouse-thumb.js`: 全站图片带宽与失败重试
- `community-public-feed.js`, `feed-layout.js`: 社区数据和布局
- `legacy/script/`, `legacy/features-draft/`: 主应用状态与分页
- `server/src/routes/v1/generate.ts`: 扣费、上游任务和退款
- `server/src/routes/v1/video.ts`, `server/src/lib/video-provider-*.ts`: 视频单次提交、轮询、退款和计费
- `server/src/lib/membership-credits.ts`, `supabase/migrations/`: 钱包锁、幂等流水和会员奖励
- `server/src/lib/r2-storage.ts`: 图片读写与回源

这些文件不是禁止修改，而是必须以可复现证据和更宽的测试覆盖为前提。
