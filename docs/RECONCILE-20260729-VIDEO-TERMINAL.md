# 视频结果未知终态最小发布候选

最后核对：2026-07-29

该候选只包含 Prompt Hub Worker 的视频队列、结果未知收敛、原子扣退、发布 SHA 和对应测试/文档。没有卡片静态文件、图片状态机、支付路由、会员任务或 Canvas 席位迁移。

真实上游返回可能同时包含 `status=failed` 和 `error.code=result_uncertain`。错误码优先归一为 `unknown`，任务保持 `processing` 栅栏并对外显示 `submission_unknown`；用户 GET 与 cron 只查询既有 `upstreamTaskId`。结果未知持续 1 小时后写入失败终态，并通过稳定任务 ref 幂等退款。

废弃候选 `92a07c3` 不能发布：它只识别顶层 `status=unknown`，首次不确定结果会立即走旧退款，未覆盖真实错误码优先级、独立队列和跨进程原子退款。

发布前置依次为：New API 能力层先上线；生产数据库可恢复备份；按 `010000 -> 020000 -> 030000` 应用三条迁移；从干净提交完成 Worker 全量测试、typecheck 和 dry-run；取得明确发布授权。发布后必须核对 `/health.buildSha`、视频队列 producer/consumer、DLQ、cron，以及一次最低价非 Grok 视频的单次 POST、单次扣费、终态和媒体读取。
