# 发布冻结：当前禁止生产部署

最后核对：2026-07-30

`D:\prompt-hub` 是唯一候选主树，`D:\canvas\prompt-hub` 只保留作历史生产审计。当前只有本文件这一处冻结标记；历史树标记已不存在，但历史树仍不得作为发布源。当前生产 Worker 仍未包含主树本轮的生成幂等、原子积分、视频状态机和构建 SHA，因此任何一棵树都不能直接发布。

生产 Pages 当前标记为 `20260729b`，但该部署遗漏了候选仓库的 `#warehouseHero` 内联 DOM 和 `styles-warehouse.css`，所以构建号本身不能作为资源完整性证据。主树候选已增加暂存与线上 HTTP 硬门禁，尚未发布。

主树候选 `4fcb4b0cf61a1d6260d7fd6485c2d282da71614f` 已提交，并从干净工作区通过定向验证：

- 图片单次付费提交、未知结果退款 SLA、poll/archive 推进与卡片库交付修复。
- 视频独立队列、单次原子领取、未知结果退款 SLA、长时 SD 轮询和按明确计费秒数退差价。
- 支付审计、陈旧订单监控、Canvas 协作席位迁移、`/wallet` 兼容入口。
- Canvas 首次创建节点的一次性会员奖励及原子数据库 RPC。
- 受控 Worker 发布脚本和 `/health.buildSha`。
- Pages 干净 SHA 发布守卫，以及卡片仓库首屏 DOM、CSS、三张广告图的暂存/HTTP 验证。

已完成的外部前置：

- 2026-07-30 公开目录确认 New API 已上线 `capability_version: 2026-07-29.1`；`sd2.0-pro`
  明确支持 4–15 秒、固定 720p、最多 9 张参考图、3 个参考视频和 3 个参考音频。
- 2026-07-30 已在正确 Cloudflare 账号复核图片/视频 Queue 与 DLQ、`prompt-hub-card-images`
  R2 桶和 `PROMPT_HUB_METRICS` KV。冻结期间未发布候选 Worker，因此两条视频队列当前没有
  producer/consumer；正式发布后仍须核对 consumer、DLQ 和 cron 冒烟。
- 候选已通过 Worker 50 个测试文件共 340 项测试、类型检查、根目录文档/预部署门禁、Pages
  暂存 HTTP 冒烟，以及仓库桌面/手机/空态和生图专项浏览器验收。

解除冻结前仍必须完成：

1. 备份生产数据库并记录可恢复性证据；生产迁移只能在解冻后按 `docs/DEPLOY-CHECKLIST.md` 的顺序应用。
2. 获得明确发布授权后运行 build bump、移除本冻结标记并提交干净发布 SHA；再运行 Worker dry-run、按顺序应用迁移和执行正式发布。发布后核对视频队列 consumer、DLQ 和 cron。

冻结期间禁止：构建生产 Worker 镜像、正式 `wrangler deploy`、Pages 发布、生产迁移或删除本 `DO-NOT-DEPLOY.md`。

详细决策和发布顺序见 `docs/RECONCILE-20260726.md`。
