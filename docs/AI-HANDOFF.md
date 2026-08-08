# AI 接手说明

最后核对：2026-08-08。生产发布目标为 `ca8cbf6e658766e5d98e9748c258ca4e6f02dab6`；Worker `/health.buildSha`、Pages production build 和线上冒烟是运行版本证据。

Canvas 媒体交付候选（2026-08-08）：分支 `codex/unified-media-delivery-20260808` 的媒体归档和恢复改动已提交并通过本地回归，尚未部署或执行付费验收；生产仍以 `/health.buildSha` 为准。

## 最小阅读顺序

1. `PROJECT_CONTEXT.md`: 线上拓扑和当前 build。
2. `CURRENT-ISSUES.md`: 当前风险与已关闭问题。
3. `AI-PITFALLS.md`: 会导致白屏、丢数据或高流量的禁区。
4. `FILE-MAP.md`: 按任务定位文件。
5. 涉及跨模块改动时再读 `ARCHITECTURE-CHANGE-GUARD.md`。

不要读取或引用公开文档中的真实测试账号。需要登录验收时，由维护者在本机通过未跟踪环境变量或密码管理器提供凭据。

## 发布状态与守卫

- Worker 唯一发布仓库是 `D:\prompt-hub`；`D:\canvas\prompt-hub` 只保留作历史生产审计，禁止从任一脏目录直接发布。
- 修改 Worker、生成、支付、数据库或发布工具前必须阅读根目录 `AGENTS.md` 和 `docs/RECONCILE-20260726.md`；如果根目录存在 `DO-NOT-DEPLOY.md`，还必须先遵守其中的冻结条件。
- `20260804a` 已发布文字模型目录收敛，`20260804b` 修正 MJ 动态目录解析并统一新任务到 New API。`20260806a` 将 `NEWAPI_API_BASE_URL` 迁移到稳定域名；`20260806b` 新增独立视频 Key 并禁止回退到文字/图片 Key。两次发布均不改 Pages，发布仍必须使用干净 SHA 并以 `/health.buildSha` 取证。
- 本次文字模型清理后，资产工作台仅保留 `deepseek-v4-flash`、`deepseek-v4-pro`，两者统一读取实时目录并通过 New API 调用。New API 的公开目录、定价和带服务令牌的 `/v1/models` 已确认只返回这两个短名、各 `0.002 元/次`，且不返回 GLM 5.1 或内部模型标识。

## 文档时效纪律

- 行为改动只有在代码、测试和受影响文档同时更新后才算完成。
- 文档里的“当前”必须注明是生产状态还是未部署的主树候选；两者不能混写。
- 旧文档与代码冲突时，先用运行时代码、测试、绑定和迁移取证，再在同一任务修正文档。禁止因为旧文档写过某个能力就恢复已经淘汰的模型、参数或付费重试。
- 不复制旧测试数量和构建号；每次收尾后写入本轮实际验证结果。

## 工作流程

1. `git status --short --branch`，先区分用户现有改动。
2. 用 `rg` 定位调用链，只精读相关函数和上下文。
3. 先复现或取得 Network/API/后台监控证据，再修改。
4. 改动范围按根因决定；共享同步、图片和 Feed 模块要补回归验证。
5. 运行根目录预部署检查；改 Worker 时再跑 typecheck 和 tests。
6. 只暂存本次文件，提交前复核没有密钥、凭据或用户数据。
7. 用户要求上线时，按 `DEPLOY-CHECKLIST.md` 部署并做生产冒烟。

## 常用定位

| 问题 | 先看 |
|---|---|
| 卡片库分页/图片 | `legacy/script/part-09.js`、`card-image-loader.js`、`mobile.js` |
| 社区数据/分页 | `community-public-feed.js`、`legacy/features-draft/part-01.js`、`server/src/lib/community-feed.ts` |
| 社区/主页布局 | `feed-layout.js`、`styles/features/` |
| 生图提交/轮询 | `imagegen-submit.js`、`imagegen-job-runner.js`、`server/src/routes/v1/generate.ts` |
| 视频提交/轮询 | `server/src/routes/v1/video.ts`、`server/src/lib/video-provider-*.ts`、`server/src/lib/newapi-video.ts` |
| 图片签名/R2/上游归档代理 | `card-image-loader.js`、`server/src/routes/v1/media.ts`、`server/src/lib/r2-storage.ts` |
| 登录/同步 | `supabase-sync.js`、`cloud-sync-safety.js`、`sync-orchestrator.js` |
| 后台 | `legacy/admin/`、`server/src/routes/admin/` |
| Canvas/扩展 | `app-router.js`、`legacy/script/part-04.js`、`legacy/script/part-09.js`、`legacy/script/part-10.js`、`server/src/routes/v1/extension.ts`、`server/src/lib/extension-card.ts`、`docs/CANVAS-INTEGRATION.md` |

## 文字模型边界（2026-08-04 发布契约）

- Prompt Hub 的 DeepSeek 公开号只允许 `deepseek-v4-flash` 和 `deepseek-v4-pro`。其余 DeepSeek 后缀型号以及 GLM 5.1 系列必须同时从公开模型投影和模型解析入口排除。
- `/api/v1/chat/cost` 与 `POST /api/v1/chat` 都通过 `server/src/lib/newapi-text.ts` 强制读取新鲜目录；默认模型为 `deepseek-v4-flash`，提交时使用同一解析结果，不存在 Flash 直连特判。
- 提示词优化固定选择 `deepseek-v4-flash`，裂变文字阶段固定选择 `deepseek-v4-pro`，但两者的可用性、调用目标和最终扣费同样来自实时目录。不要恢复 `CHAT_API_KEY`、`CHAT_API_BASE_URL`、`CHAT_MODEL` 或 `FISSION_CHAT_MODEL` 文字直连配置。
- 当前目录最终价格应为两个模型各 `0.002 元/次`，对应 `0.2 积分/次`。前端只展示 `/api/v1/chat/cost` 返回值；不得恢复手工 token 价目表、旧积分估算或无目录价格时的本地兜底。
- 新增文字模型只能先进入审核后的公共目录；不得把内部模型标识、渠道字段、API 基址或凭据写入浏览器资源、普通用户日志或错误响应。

## 当前生图与计费边界

- Worker 只能通过 `https://newapi.prompt-hubs.com` 访问卡藏 New API；不得把 DNS 当前解析出的 IP 或 `sslip.io` 地址写回 `wrangler.toml`。实时目录必须返回非空版本且公开投影不得为 `catalogStale=true`，否则付费提交应在扣费前停止。
- 新任务只允许卡藏 API 的全能模型2、香蕉和 MJ 8.1 / MJ 7 / Niji 7；所有公开 MJ 均为 New API provider，固定 `relax`、40 积分/次，旧 Apimart provider 只恢复历史任务。
- 已核验 New API `capability_version=2026-08-04.2` 的三个 MJ 公开号均为按次 0.4 元 / 40 积分；动态目录解析必须为 MJ 保留固定内部 `1k` 占位，不得把质量档 `0.25/0.5/1/2` 当作分辨率而丢弃模型。
- New API MJ 完成态必须包含四宫格封面和 4 张单图。Worker 直接消费 `/v1/tasks/:taskId` 返回的五个 URL，不得为了新任务读取 `APIMART_API_KEY` 或补查 Apimart 详情。
- 卡藏 API 图片报价已经包含其加价，必须从上游人民币字段按 `1 元 = 100 积分`直接换算；不能再次加价、信任上游 credits 字段或复制一份手工积分表。
- `gpt-image-2-chat` 是内部兼容 ID，统一归一化到公开模型 `image2-economy`；不要根据旧别名硬编码端点或能力，参数必须来自实时目录，当前支持比例和可选参考图。
- Canvas 当前模型目录提交的高质量原始 ID `gpt-image-2-ext` 也必须在可用性和报价校验前归一化到公开 `image2-pro`，但不得改写用户选择的 `1k` / `2k` / `4k` 分辨率。
- 实际 New API 渠道映射只允许运营后台经 `NEWAPI_CATALOG_ADMIN_SECRET` 读取；公开模型目录不得返回渠道、域名或任何凭据字段。
- 报价与提交读取普通卡藏目录并共享进程内 single-flight；只接受完整、精确且最多 5 分钟的目录/LKG，不要恢复逐次 `refresh=1`。目录不可用或模型价格缺失时必须在创建任务和扣费前失败。
- 卡片库提交必须带回用户看到的 `quotedCredits`；服务端重算不一致时返回 `409 CONFLICT`、不扣费且不提交。前端应清除对应的 90 秒报价缓存，让下一次点击重新报价，但不得自动重发生成 POST。报价 GET 的 `500/502/503/504` 最多短退避重试一次。
- 访客无持久草稿时，当前全能模型2家族默认选择公开目录中排序最前的 `image2-economy`；它与标准 `image2` 的价格必须分别从目录读取，不能用旧默认值覆盖。
- `resolution` 只表示 `1k/2k/4k`，`quality` 只表示质量，但不是每个模型都有质量控件。只有香蕉公开 `low/medium/high`；`image2k4k` 固定 `low`，4K 型号固定 `standard`，`gpt-image-2-ext` 省略 `quality` 并使用默认画质。仅历史精确值 `quality=1k|2k|4k` 会在入口转换为 `resolution`。
- 所有香蕉模型支持最多 14 张参考图。不能根据缺字段、陈旧目录或 `max_items=0` 推断香蕉不支持参考图。
- 卡片库点击生成后先同步插入作品占位；New API 只由持久队列提交，页面按秒 poll，cron 每 2 分钟兜底 poll/archive，避免请求结束时再次领取同一 `queued` 任务。上游已出图时前端先写入最近生成并移除 pending，临时图可立即展示，归档独立重试。
- `GET /api/v1/generate/jobs/:jobId/image?index=N` 是 Canvas 的受保护单图读取路径；`N=0` 为主图或 MJ 四宫格封面，MJ 的 `N=1..4` 为四张单图，普通批量任务随后读取额外图片。重复 URL 只投影一次，超出 `0..7` 的索引在读取前返回 `400`。
- Signed-in generated-card saves with `copyStorage` must archive through `archiveGeneratedCardImage` and persist only a verified `storage://` primary reference. A temporary upstream URL or SVG placeholder must not become the durable card image; failed archival removes the new card.

## Generation Delivery Contract (2026-08-03)

The Worker and browser now share one completion rule: `completed` requires a
deliverable image reference. A provider response that says completed before a
URL is exposed stays pending and is confirmed again. Legacy rows recover
durable URL checkpoints before failing; unrecoverable rows use idempotent
`upstream_no_image` or `upstream_not_configured` failure/refund paths. Recent
feed cards use `CardImageLoader` with `_grid` variants and never fetch a 4K
source merely to render a list card.
- 付费提交只允许原子领取一次；网络结果未知、任务 `not_found` 或队列重投都不得触发第二次上游 POST。稳定幂等键与 1 小时未知结果退款 SLA 必须保留。
- 视频使用独立 `VIDEO_GENERATION_QUEUE`。有上游 task ID 的正常 `processing` 可以持续数百或数千秒，不按生成时长判失败；进入 `result_uncertain`（包括 `error.code=result_uncertain`）后则保留 `submitted` 和公开投影 `submission_unknown`，由后台只读 GET 同一个 NewAPI task ID。显式线路任务继续使用持久化 `routeChannelId`；普通公开模型由 NewAPI 任务记录中的原始 `ChannelId` 固定渠道。两种情况都绝不重发生成 POST 或重新选路。
- 视频建单、轮询、内容下载、队列 consumer 和 cron 只读取 `NEWAPI_VIDEO_API_KEY`。该 Key 固定属于 `视频模型` 分组；`NEWAPI_API_KEY` 仅服务文字/图片，视频不得回退到它或依赖 `auto` 猜测分组。
- Canvas 视频的可选 `generate_audio` 参数在 Prompt Hub 入口规范化、持久化并以同名蛇形字段转发给 New API；Worker 提交排障按同一 `clientRequestId` 记录 `received`、`newapi_submit` 和 `accepted`，日志不含提示词、令牌或素材 URL。
- 带 `upstreamTaskId` 的 `result_uncertain` 持续 1 小时仍无法恢复为 processing/completed/明确 failed 时，必须以幂等 `refund_pending` -> `refunded` 收敛为失败并退款。cron 必须先 poll，再执行 timeout finalize，避免任务刚成功却先被退款的竞态。
- 上游已返回 task ID 后，checkpoint 最多重试三次并读后确认，绝不重试付费 POST。若 task ID 仍未可靠落库，保留 `running` 栅栏并报警；未拿到 task ID 的 `outcome_unknown` 和持续 `not_found` 继续遵循同一小时级幂等退款 SLA。
- Prompt Hub 只提交规范化的视频参数。模型专属比例格式、固定分辨率或应忽略的可选参数由 New API 转换，不能在这里按渠道复制适配分支。目录未声明 `resolution` 的 `*-480p` / `*-720p` / `*-1080p` 固定模型从 ID 推导分辨率；目录声明了 `resolution` 时必须保留其固定值或用户选择，避免覆盖 `sd2.0-720p-pro` 一类可选型号。
- GrsAI、iThink、Mooko 适配器只服务已落库历史任务恢复；删除前先确认生产库没有对应未完成任务。
- 后台存储巡检按需触发且只读；不得按全桶字节回填用户配额。
- 新支付订单只接受 `paymentMethod=alipay`；历史 `wxpay` 类型只保留给已落库订单的回调验签和结算，前端不得重新展示微信新订单入口。

## 必跑命令

```powershell
cd D:\prompt-hub
npm run check:predeploy

cd server
npm run typecheck
npm test
```

正式发布前从干净提交运行 `npm run deploy:dry-run`。正式 `npm run deploy` 会拒绝冻结标记或脏工作区，并自动把当前 Git SHA 注入 `/health.buildSha`。

静态站生产冒烟由 `deploy-pages.ps1` 自动执行。该脚本拒绝冻结标记和脏工作区，明确发布到 `main` production 分支，并在别名传播期间重试自定义域名冒烟；先单独运行 `scripts/bump-build.ps1`、验证并提交，再从该干净 SHA 发布。只改文档或未部署的维护脚本时，不需要递增 Pages build。

## 交付要求

- 说明改了什么、为何这样改、验证了什么。
- 未运行的测试必须明确说出。
- 不删除用户卡片、图片或数据库记录来“验证修复”。
- 不把本地 `.env`、账号、UUID、token、Cloudflare 缓存文件提交到公开仓库。

## 当前生产生图契约（2026-08-03）

以下规则优先于本文档中较早的模型兼容性描述；运行状态以 `/health.buildSha` 和实时模型目录为准：

- `全能模型2 · 特价 1K` 公开 ID 为 `image2-economy`；价格读取实时目录，支持比例和可选参考图，不公开质量控件。
- `全能模型2 · 4K` 公开 ID 为 `image2-4k-fast`，固定发送 `resolution=4k`、`quality=standard`、`n=1`；纯文生图不需要参考图。
- `全能模型2 · 高质量 1K/2K/4K` 只用 `resolution` 选择 `1k`、`2k`、`4k`，省略 `quality` 并使用模型默认画质；`image2k4k` 固定发送 `quality=low`。
- 所有香蕉型号最多接收 14 张参考图，分辨率与质量字段必须独立，且只有香蕉公开 `quality=low/medium/high` 选择。
- 前端质量文案只使用“低 / 中 / 高”，上游别名（包括 Adobe）不得泄漏到公开模型目录。

## 主树目标 Canvas 桥接契约（2026-07-27）

本节描述 Prompt Hub 侧桥接契约；生产版本以 `/health.buildSha` 为准：

- 卡片库到 Canvas 的 URL 只允许 `phSource=prompt-hub`、`phVersion=1`、`phIntent=insert-card` 和 `phCardId`；不得把提示词、图片 URL、Token 或上游信息放入查询参数。
- Canvas 使用现有 Prompt Hub Bearer 会话调用 `GET /api/v1/extension/cards/:cardId` 精确取当前用户的卡。卡片入口覆盖桌面图标、移动端“到画布”和右键“插入无限画布”。
- Canvas 生图完成后调用 `POST /api/v1/extension/canvas-results`，只传 UUID `generationJobId`、固定 `artifactIndex=0` 和可选标题。Worker 只接受当前用户的已完成 Canvas 任务，并从生成记录解析受控归档引用。
- 回仓幂等键固定为 `canvas-result:<generationJobId>:0`；重复提交返回原卡，不重复上传图片或公开社区。Prompt Hub 从 Canvas 返回可见时会消费一次性标记并强制拉云端一次。
- Canvas 仓库仍需实现深链消费与结果回仓调用；Prompt Hub 侧发布不等于跨仓库链路已经完成，只有两侧按同一协议上线后才能宣称端到端可用。
