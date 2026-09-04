# 当前问题与回归基线

最后核对：2026-08-03

## 本轮已关闭发布项

| 原优先级 | 已关闭问题 | 生产证据 |
|---|---|---|
| P0 | 双树与脏工作区不能形成可追溯发布 | 生产只从 `D:\prompt-hub` 的干净提交发布，`/health.buildSha` 返回当前发布 SHA |
| P0 | Worker 依赖的五项数据库契约未应用 | 已在新鲜备份后用单事务按序应用，并验证幂等列、原子积分 RPC、支付表和建点奖励 RPC |
| P1 | 视频 Queue/DLQ 已创建但 Worker 未绑定 | 图片/视频 Queue 均为 1 producer / 1 consumer，两个 DLQ 均存在，cron 已发布 |
| P1 | Prompt Hub 依赖 New API 参数转换和幂等能力 | New API 能力版本和只读公开目录已核验，Prompt Hub Worker 已切换 |
| P1 | 本地主树改动未形成审查提交 | `20260803a` 已从审查提交发布，仓库保持干净 |

本轮冻结标记已按授权移除。以后若重新出现冻结标记，发布脚本仍必须硬失败，不能通过手工改生产余额或重复付费调用绕过。

## 本轮已上线

- 卡片库提交后立即出现占位，秒级轮询；上游完成后先展示临时图，归档失败不重做生成。
- 全能模型2/香蕉的 `quality` 与 `resolution` 已分离；香蕉最多 14 张参考图，不再被陈旧 `max_items=0` 禁用。
- 图片与视频只允许单次付费 POST，网络未知、队列重投和 `not_found` 不会自动重提。
- 视频使用独立队列；SD 有 task ID 时允许数百/数千秒 processing，不使用固定生成完成超时。
- 视频只按明确 `billed_duration_seconds` 退时长差价。
- Canvas 建点奖励和 `/wallet` 支付兼容路径已安全收编。
- 卡片库稳定 Grid、失败媒体折叠、生图分页页脚顺序和首屏缩略图优先级已随 `20260803a` 上线。

## 持续观察风险

| 优先级 | 风险 | 判断方式 |
|---|---|---|
| P1 | 上游已完成但客户端长期拿不到图片/视频 | 对照 task ID、poll 时间、归档状态和 Network；不能用重新提交验证 |
| P1 | 退款槽堆积 | 监控 `refund_pending`、credit ledger ref 和 cron 错误 |
| P1 | 历史第三方图片直链失效 | 先查 R2/Storage 是否有持久引用；源站永久 404 不能靠重签恢复 |
| P1 | R2 未回填对象仍走慢速回源 | `media/sign` 单张 >1s、`media/i` >2s 或 `_grid` 现场生成 >5s 即回源未命中；批量用 `run-warehouse-repair.mjs` 回填 |
| P2 | 手机弱网首屏或图片加载回归 | 首批 DOM、图片规格、传输量和滚动增量均需实测；桌面卡片库已不再使用 Masonry 绝对定位 |

## 2026-08-31 实测记录（生产，登录态）

- 生图：`image2-economy`、`seedream-5.0` 提交/出图正常；`sensenova-1.5-一秒出图`
  前端发比例值 `1:1` 被 `400 该模型不支持 1:1 比例` 拒绝（前端尺寸选择器未按目录
  `size` 参数渲染，已在主树修复）；改发像素尺寸后任务被站内接受但执行失败
  «请求被拒绝，请稍后再试» 并退款——属卡藏 New API 站内渠道/上游问题，已报告站长。
- 卡片库慢：`media/sign` 单张约 2–4s、`sign-batch` 8–9s、`media/i` 4–8s、缺失
  `_grid` 现场生成 16–22s，且同一引用被重复签名/重复拉取——根因是历史对象
  R2 未回填（部分 `_grid.jpg` R2 404），已在主树加 R2 回源自愈
  （`scheduleR2Backfill`）并修正回填脚本指向当前 MemFire 库。
- 生产 Worker 实证：`/health` 无 `buildSha` 字段（`environment`+`imageProviders`
  形态），与文档记载的 464e068 构建不一致；发布后必须重新核对。

## 2026-09-05 诊断与修复（主树候选，未发布）

用户复测（生产 `20260901c`）：生图页「最近生成」里来自卡片库的卡片长时间停在加载
占位；卡片库首屏依旧卡。代码核查（非刷新碰运气）结论：

- **生图页慢的独立客户端根因**：`cr_` 卡（含 `__fromWarehouse` 仓库卡）不走
  sign-batch 批量签名（`bindFeed` 的批量预热对 `cr_` 不生效、该图也不等容器签名门），
  且封面选 `pickCreationFeedImage`（原图路径，非 `_grid`）。缓存未命中时逐张
  `/media/sign`（2–4s/张）串行排队，R2 缺对象时叠加服务端回源/物化——首屏几十秒。
  已在主树修复：recent 首屏 `prefetchWarehousePage` 批量预签 + 仓库卡封面走
  `pickWarehouseListThumb`（grid 池）+ `patchImageSrcFromCache` assetId 链补 `cr_`
  剥前缀（详见 `CARD-LOADING.md`「生图 recent 首屏批量预签（2026-09-05）」）。
- **卡片库首屏**：批量链路（bindWarehouse → prefetchList → sign-batch）已在；
  早前怀疑的 `waitForCloudSyncIdle` 同步自旋经核实**不在首屏路径**（仅云端拉取的
  async 流程 `await` 使用），首屏卡顿主因仍指向 R2 存量回源耗时，见下条运营项。
- **运营项仍在**：历史对象 R2 批量回填脚本（`scripts/run-warehouse-repair.mjs`）
  是否已在生产跑过没有证据；自愈只加速"被请求过的对象"。上线本轮候选后若
  `sign-batch` 仍 >2s，先跑回填再查代码。
- **发布后跟进修复（同日 20260905b）**：①`__fromWarehouse` 封面排除临时上游 http
  引用（防 `data-feed-ref` 劣化「填入生图」参考图）；②recent 批量预签改为等
  `bindFeed` 批量落地后再跑，靠 `batchSignPaths` 的缓存过滤去重，消除同屏重复
  sign-batch；③修正本条 `waitForCloudSyncIdle` 误判记录。
- 发布验证：`npm run check:predeploy` 全量通过（构建号 bump `20260905a`）；
  verify-feed-bundle / verify-card-gallery-regression / verify-imagegen-bundle /
  foundation-bundle-vm-smoke / check-js-syntax 全过。20260905a 已发布生产
  （Pages 部署 + 24 项线上冒烟全过，`__APP_BUILD__=20260905a` 核对，`pack-feed.js`/
  `supabase-sync.js` 新代码在线上命中）；Worker/数据库未变更。

## 排查顺序

1. 先确认观察的是生产还是本地主树候选；生产以 Pages build 和 `/health.buildSha` 为证据。
2. 查浏览器 Network、Worker 日志、任务行状态和上游 task ID，保留时间线。
3. 运行相关定向测试，再跑全量 typecheck/test 与根目录预部署检查。
4. 证明根因后修改，并同步更新受影响文档。

“刷新后好了”、清空本地数据、重复提交或等待旧文档里的固定秒数都不算修复证据。
