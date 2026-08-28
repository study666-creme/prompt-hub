# Worker 后端架构

最后核对：2026-08-28。生产 Worker 已部署并核对 `buildSha=464e06883fc8e304280d49826c58436eab05c2dc`；Pages 已发布 `20260828a`。运行版本仍以 `/health.buildSha` 和 Pages 线上冒烟为准。

Canvas 媒体交付候选（2026-08-08）已提交到 `codex/unified-media-delivery-20260808` 并通过本地回归，但尚未部署；它包含媒体归档迁移，需单独完成数据库备份、迁移授权和生产验收。

卡片库提示词首页（2026-08-28）已上线：模型菜单以公开 `GET /api/v1/generate/models` 为唯一实时来源，缓存契约版本为 `20`；首页缓存自愈、卡片库聚焦和列式瀑布流均已进入 Pages。生产生成请求仍使用当前页面配置的同源 Worker。

## 组件

| 层 | 技术 | 职责 |
|---|---|---|
| 路由 | Hono + TypeScript | API、认证、CORS、错误与限流 |
| 数据 | MemFire Postgres/Auth | 用户、积分、社区、任务和运营数据 |
| 图片 | Cloudflare R2 + MemFire Storage | 上传、签名、缩略图、CDN 回源 |
| 模型服务 | 卡藏 New API、Apimart | 文字/图片/视频目录与提交；Apimart 仅用于视觉工具和历史任务 |
| 队列 | Cloudflare Queues + cron | 图片和视频独立提交；poll、归档、退款与支付兜底 |
| 监控 | Workers Observability + KV | 请求、5xx、图片 404、生成失败率与支付事件 |

入口是 `server/src/index.ts`。公开 API 挂在 `/api/v1`，运营 API 挂在 `/api/admin`，认证代理挂在 `/supabase/*`。

## 路由分组

| 路径 | 认证 | 说明 |
|---|---|---|
| `/health` | 无 | readiness、支付配置状态和发布提交 `buildSha` |
| `/api/v1/community/feed` | 无 | 公共社区分页 |
| `/api/v1/media/community/*` | 无 | 已发布社区图片签名/CDN |
| `/api/v1/me`, `/membership`, `/redeem` | Bearer | 账号、积分、会员和兑换 |
| `/api/v1/generate/*` | Bearer | 模型、报价、提交、轮询、恢复和 MJ 动作 |
| `/api/v1/video/*` | Bearer | 视频目录、报价、提交、轮询和受控内容代理 |
| `/api/v1/payments/*`, `/wallet/*` | 商品列表公开，其余 Bearer | 支付主入口与旧 Canvas 兼容别名 |
| `/api/v1/membership/tasks/events/canvas-create-node` | Bearer | 原子记录首次建点并只奖励一次 |
| `/api/v1/media/*` | Bearer | 私有图片上传、批量签名、缩略图和受控上游图片代理 |
| `/api/v1/community/*` | Bearer | 发布、点赞、通知和灵感抽取 |
| `/api/v1/extension/*` | Bearer | 扩展与 Canvas 列表、标签和存卡 |
| `/api/v1/extension/cards/:cardId` | Bearer | 按当前用户精确取卡，响应 `private, no-store` |
| `/api/v1/extension/canvas-results` | Bearer | 将当前用户的 Canvas 已完成生图任务幂等回仓 |
| `/api/v1/chat`, `/prompt-tools` | Bearer | 对话、优化、反推和裂变 |
| `/api/v1/asset-packages/*` | 可选/Bearer | 资产包浏览、领取、导入和发布 |
| `/api/admin/*` | 管理员密钥 | 运营后台、用户、卡片、社区和模型配置 |

具体路由以 `server/src/routes/` 为准，不在文档复制完整端点清单。

## 支付方式边界

`20260730a` 受控发布契约中，`POST /api/v1/payments/checkout` 与 `/wallet/checkout`
新建订单仅接受 `paymentMethod=alipay`。前端支付弹层也只展示支付宝。
`EpayMethod` 仍保留 `wxpay`，仅用于读取、验签和结算已存储的历史微信订单及其
回调；不得据此恢复微信新订单入口。

## 环境变量

非敏感变量在 `server/wrangler.toml`；敏感值使用 Cloudflare Secrets。

| 变量 | 类型 | 用途 |
|---|---|---|
| `SUPABASE_URL` | Secret | MemFire Supabase-compatible API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 服务端数据库权限 |
| `SUPABASE_JWT_SECRET` | Secret，可选 | 本地 JWT 校验回退 |
| `NEWAPI_API_KEY` | Secret | 文字与图片模型；固定绑定其审核分组，目录和价格实时同步 |
| `NEWAPI_VIDEO_API_KEY` | Secret | 视频模型；固定绑定 `视频模型` 分组，不回退到文字/图片 Key |
| `NEWAPI_API_BASE_URL` | 普通变量 | 固定为 `https://newapi.prompt-hubs.com`；不得绑定裸 IP 或 `sslip.io` 临时主机名 |
| `APIMART_API_KEY` | Secret | 视觉工具和历史任务；新 MJ 任务不读取 |
| `ADMIN_API_SECRET` | Secret | 运营后台和造码脚本 |
| `PAYMENT_WEBHOOK_SECRET` | Secret，可选 | 支付 webhook HMAC |
| `EPAY_MERCHANT_ID`, `EPAY_MERCHANT_KEY` | Secret | EasyPay 商户鉴权 |
| `IMAGE_GENERATION_QUEUE` | Queue binding | 图片提交队列 |
| `VIDEO_GENERATION_QUEUE` | Queue binding | 视频提交队列，避免慢建单阻塞图片 |
| `BUILD_SHA` | 发布脚本注入 | `/health` 返回的发布 Git SHA；不要手工维护 |
| `MEDIA_STORAGE_MODE` | 普通变量 | `supabase` / `r2-first` / `r2` |

`IMAGE_API_KEY`、`ITHINK_API_KEY`、`MOOKO_API_KEY` 仅用于恢复数据库中已经存在的旧 provider 任务，不进入新任务目录。确认没有对应历史任务后可从 Worker Secrets 删除。

2026-08-06 迁移核验中，稳定域名解析到新服务器并能返回实时模型目录；旧地址 `43.153.201.78` 的 80/443 端口均已停止服务。Worker 必须通过稳定域名访问 New API，使后续主机迁移只需更新 DNS/TLS，不再要求重新发布 Prompt Hub 才能追随 IP 变化。

## 文字模型边界（2026-08-04 发布契约）

- 资产工作台只公开 `deepseek-v4-flash` 和 `deepseek-v4-pro` 两个精确名称。其他 DeepSeek 变体和 GLM 5.1 系列即使出现在远端目录中，也不得进入 Prompt Hub 的公开目录或解析路径。
- `/api/v1/chat/cost`、`POST /api/v1/chat`、提示词优化和裂变文字阶段共用同一个实时模型目录解析器；报价、提交模型和可用状态来自同一快照，不再读取独立直连变量。
- 两个模型按目录声明的最终 `0.002 元/次` 计价，Worker 按 `1 元 = 100 积分` 得到 `0.2 积分/次`。代码和前端不保留手工 token 单价或本地兜底价；目录或精确价格不可用时必须在提交前失败。
- 文字请求必须显式提供目录解析后的 API 基址和模型；通用 OpenAI-compatible 客户端不允许猜测默认域名或默认模型。

## 图片模型边界

- `/api/v1/generate/models` 返回所有已完成协议适配且当前可用的公开图片模型；全能模型2、香蕉、Midjourney 和其他通用型号均按目录项的公开 `uiFamily` 分组，客户端不得把未知或 `generic` 型号伪装成全能模型2。目录数量、公开名称、比例、分辨率和价格来自实时响应，不在前端硬编码当前清单。响应顶层同时返回 `catalogVersion`、`pricingVersion` 和 `catalogStale` 供运行监控；新服务未单独发布价格版本时，`pricingVersion` 使用覆盖完整价格负载的 `catalogVersion`。模型项不得包含上游渠道、主机或内部映射。
- 图片参数语义固定为：`resolution` 只表示 `1k` / `2k` / `4k`，`quality` 只表示质量，但不是每个模型都公开质量控件。香蕉质量选项为 `low` / `medium` / `high`；`image2k4k` 固定 `low`，4K 型号固定 `standard`，`gpt-image-2-ext` 使用上游默认画质且不发送 `quality`。仅兼容历史请求中精确的 `quality=1k|2k|4k`，入口会把它归一到 `resolution`，不能继续生成两个“分辨率”字段。
- 卡藏 API 的图片人民币价格统一调用 `imageRetailCreditsFromYuan()`：卡藏报价已包含上游加价，按 `1 元 = 100 积分` 直接换算，不再重复加价。
- 图片报价和提交读取普通 `/api/model-catalog`，进程内以 single-flight 合并并发请求；完整且精确匹配模型价格的 LKG 最多可信 5 分钟，不再为每次报价发送 `refresh=1`。没有可信价格时必须在创建任务和扣费前失败。
- 卡片库把用户看到的 `quotedCredits` 随生成请求带回。服务端按当前可信目录重算，报价变化时返回 `409 CONFLICT` 且不创建任务、不扣积分；浏览器只清除对应报价缓存，下一次点击重新报价，不自动重发付费 POST。报价 GET 遇到 `500/502/503/504` 只短退避重试一次。
- `gpt-image-2-chat` 是服务端兼容别名，统一归一化到公开模型 `image2-economy`；不要根据别名硬编码端点或能力，当前参数以实时目录为准并支持比例和可选参考图。
- Canvas 当前目录中的稳定版原始 ID `gpt-image-2-ext` 必须在可用性和报价校验前归一化到公开模型 `image2-pro`；归一化只统一模型身份，保留用户选择的 `1k` / `2k` / `4k` 分辨率。
- 运营后台的调用链路由卡藏 API `/api/model-catalog/admin/routes` 提供，并使用 `NEWAPI_CATALOG_ADMIN_SECRET` 与服务端共享密钥鉴权；公开 `/api/model-catalog` 不包含真实渠道信息。
- MJ 8.1、MJ 7 和 Niji 7 与其他公开图片型号一样通过卡藏 New API 提交；固定常规 `relax` 档，单次 40 积分（0.4 元），不公开 Fast / Turbo。
- New API `capability_version=2026-08-04.2` 已核验同时公开 `mj-v81`、`mj-v7`、`mj-niji7`；Worker 必须把这类按次图片型号保留在动态图片目录中，不能把 `quality=0.25/0.5/1/2` 误判成 `resolution` 后过滤。
- MJ 完成结果固定保留四宫格封面和 4 张单图。New API 的 `/v1/tasks/:taskId` 是新任务唯一查询来源；仅历史 `provider=apimart` 任务继续使用旧详情查询。
- 受保护的 `GET /api/v1/generate/jobs/:jobId/image` 通过可选 `index=0..7` 返回单一成图；MJ 顺序固定为四宫格封面后接四张单图，普通批量任务为主图后接额外图片。相同 URL 只保留一个结果，非法索引返回 `400`。
- 旧 GrsAI、iThink、Mooko 和 Apimart 型号只能恢复历史任务，不能通过后台重新上架。新 New API MJ 任务不返回仍会直连旧上游的二次操作按钮。

配置命令示例：

```powershell
cd D:\prompt-hub\server
npm exec wrangler secret put SUPABASE_URL
npm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm exec wrangler secret put NEWAPI_API_KEY
npm exec wrangler secret put NEWAPI_VIDEO_API_KEY
```

## 数据写入边界

- 积分、会员、激活码、生成结算和支付事件只能由 Worker 写入。
- 用户私有 JSON 可由登录用户 RLS 路径同步，但 `cloud-sync-safety` 必须防止空覆盖。
- 管理后台的删除/恢复接口必须先提供预览或显式确认；卡片巡检默认只读。
- 生成扣费与退款由同一任务记录驱动，不能在前端自行补积分。
- 图片和视频付费 POST 只能由 `queued` 状态通过 CAS 领取一次；`running`、`outcome_unknown`、`not_found` 和队列重投都不能重开提交。
- Canvas 首次建点奖励只调用 `grant_canvas_create_node_reward`；任务 claim 与会员延期在一个数据库事务中完成。

## Prompt Hub 与 Canvas 桥接边界

- Prompt Hub 的插卡深链固定为 `phSource=prompt-hub`、`phVersion=1`、`phIntent=insert-card`、`phCardId=<cardId>`。URL 只传 ID，不传卡片正文、图片地址、Bearer Token 或上游凭据。
- Canvas 使用自己的 Prompt Hub Bearer 会话调用 `GET /api/v1/extension/cards/:cardId`。路由只在当前用户的 `user_data.cards` 中精确匹配，并返回规范化卡片和签名缩略图；不存在或不属于该用户统一不可读取。
- `POST /api/v1/extension/canvas-results` 的请求体为 UUID `generationJobId`、只允许 `0` 的可选 `artifactIndex` 和最长 200 字的可选 `title`。任务必须属于当前用户、已完成且带 Canvas 来源标记。
- 结果回仓不接受客户端图片内容或内部存储引用。Worker 通过生成任务解析当前用户的归档引用，并以 `canvas-result:<generationJobId>:0` 保存来源键；重复调用返回已有卡片和 `replayed=true`，不公开到社区。
- Prompt Hub 新窗口打开 Canvas 后记录一次性返回标记；页面恢复可见时立即强制拉取云端一次，接收 Canvas 写回结果。该标记只用于触发同步，不是鉴权凭据。

这一桥接契约属于 `20260730a` Prompt Hub 侧发布；Canvas 侧消费深链和调用结果回仓接口仍是跨仓库依赖，只有两侧按同一协议上线后才能宣称端到端可用。

## 视频生成生命周期

视频建单、状态查询、内容下载、队列 consumer 与 cron 兜底统一使用 `NEWAPI_VIDEO_API_KEY`。该 Key 必须在 New API 中固定绑定 `视频模型` 分组；即使 `NEWAPI_API_KEY` 已配置，视频链路也不得回退使用它。

1. `POST /api/v1/video` 校验实时目录和报价，以 `clientRequestId` 幂等创建任务并原子扣费。
2. 任务写入持久 `queued` outbox 后投递 `VIDEO_GENERATION_QUEUE`；队列发送不确定时，cron 只重新投递仍为 `queued` 的记录。
3. 消费者以 `attemptId` 原子把 `queued` 领取为 `running`，且只在此路径调用一次 New API POST。网络结果不确定会记为 `outcome_unknown`，不会重提。
4. 拿到 task ID 后以最多三次数据库写入和读后确认落为 `submitted`；这里只重试 checkpoint，不重试付费 POST。若 checkpoint 仍无法确认，保留 `running` 栅栏并报警，既不进入自动退款 SLA，也不重新提交。
5. 有 `upstreamTaskId` 的 `submitted` 任务若返回 `result_uncertain`（包括 `error.code=result_uncertain`），保持公共状态 `submission_unknown`。后台只读 GET 同一个 NewAPI task ID；显式线路使用任务持久化的 `routeChannelId`，普通公开视频由 NewAPI 持久任务中的原始 `ChannelId` 锁回提交渠道。恢复为 processing/completed/明确 failed 后清除未知标记，任何查询结果都不能触发第二次生成 POST 或重新选路。
6. 带 task ID 的 `result_uncertain`、持续 `not_found` 或未拿到 task ID 的 `outcome_unknown` 都保留各自第一次发生时间。持续 1 小时仍无法确认时进入幂等 `refund_pending`，由退款 RPC 收敛为 `refunded` 和明确失败；重复 cron 或 Worker 重启不得重复退款。
7. cron 每轮必须先 poll 上游状态，再执行 timeout finalize；这样刚恢复 completed/processing/明确 failed 的任务会先离开未知状态，不会与超时退款竞争。
8. 完成后仅在上游明确返回 `billed_duration_seconds` 时核算时长差价；播放内容通过 `/v1/videos/{taskId}/content` 代理，不请求任意结果 URL。

Prompt Hub 的视频契约包含规范化 `duration`、`ratio`、`resolution`、可选 `generate_audio` 和引用素材。`generate_audio` 只接受布尔值或字符串 `true`/`false`，持久化在同一提交 envelope 中，并原样以蛇形字段转发到 New API；它必须参与请求指纹与任何按该字段定义的目录价格档位。具体模型需要 `aspect_ratio` 还是 `ratio`、固定分辨率时忽略什么字段，属于 New API 能力层。目录未声明 `resolution` 时，以 `-480p`、`-720p` 或 `-1080p` 结尾的固定视频模型 ID 必须推导出对应分辨率；目录声明了固定值或可选值时仍以目录为准，不能用 ID 覆盖用户选择。

## 本地与部署

```powershell
cd D:\prompt-hub\server
npm ci
npm run dev -- --ip 127.0.0.1 --port 8787

npm run typecheck
npm test
npm run deploy:dry-run
```

正式发布只能在迁移完成且工作区干净后运行 `npm run deploy`。脚本会注入当前 Git SHA，并拒绝冻结标记或脏工作区。使用仓库锁定的 Wrangler 版本，不要临时安装不兼容的大版本。数据库备份/恢复见 `MEMFIRE-MIGRATION.md`，图片存储见 `R2-MIGRATION.md`。

## 当前公开图像模型契约

`GET /api/v1/generate/models` 是模型名称、参数和价格的唯一运行时来源。2026-08-28 以普通用户只读核验公开响应时，目录同时包含 `image2-economy`、`image2-pro`、`image2-A`、`lingtu-pro`、`lingtu-2`、`seedream-5.0`、`sensenova-1.5-一秒出图`、`mj-v82`、`mj-v81`、`mj-v7` 和 `mj-niji7` 等公开身份；这只是核验快照，不是允许客户端硬编码的白名单。

公开请求示例只使用公共基址：

```powershell
Invoke-RestMethod 'https://api.prompt-hubs.com/api/v1/generate/models'
```

客户端按每个目录项的 `aspectRatios`、`resolutions`、`qualityOptions`、参考图能力和可用状态呈现控件。全能模型2与香蕉产品约定的首页比例菜单保持完整 16 项；其他通用型号保留自己的公开 ID 和目录能力。不要在客户端恢复 `Adobe`、旧 MJ、`极速 4K` 或旧的 `全能模型4K` 名称；兼容别名只允许留在服务端归一化映射中。

## 卡片库生图生命周期

1. 前端先生成稳定的 `clientRequestId` 并同步插入作品占位，再取得可信报价、记录 `quotedCredits`、解析参考图并提交；点击后第一帧即可看到生成状态。
2. Worker 先按同一可信目录重算并核对 `quotedCredits`，确认一致后才以请求键创建任务并幂等扣费，再把 New API 提交写入持久队列；队列投递不确定时保留数据库 outbox，由 cron 补投队列消息。New API 的 durable queue 是唯一付费 submit owner，请求响应和普通页面 poll 都不直接领取 `queued` 行。
3. 队列消费只允许从 `queued` 原子领取一次。上游 HTTP 不确定、`running`、`outcome_unknown` 或任务查询 `not_found` 都不得重新发起付费 POST。
4. 页面按秒轮询；服务端 cron 每 2 分钟兜底推进 submit、poll 和 archive。上游返回临时图后先把任务标为完成并立即给客户端展示，前端先写入“最近生成”并移除 pending，占用较慢的 R2/Storage 归档在后台独立重试，不重做生成。
5. Signed-in `copyStorage` saves must complete `archiveGeneratedCardImage` and return a verified `storage://` primary reference before a generated card is persisted. SVG placeholders and temporary upstream URLs are display-only; a failed archive removes the newly created card.

### 生图列表缩略图与预热（2026-08-09）

- 生产 Worker 无 Canvas 且 MemFire 不支持 `render/image`，**服务端缩略图生成恒失败**；`_grid` 由浏览器端生成上传（`finishImageGenRun` → `uploadGeneratedGridThumb`，640px JPEG 经 `/api/v1/media/upload` 写入 R2，失败静默）。
- 服务端预热 `warmJobGridImage` **默认关闭**（`GRID_WARM_ENABLED` 未设或非 `"1"` 时直接返回），避免每个完成任务空耗一次原图下载；重新启用只需设置 `GRID_WARM_ENABLED=1`。
- `GET /api/v1/generate/jobs/recent` 的列表图片优先签名 R2 中已存在的 `_grid` 缩略图（快速存在性检查，不触发现场生成）；`_grid` 不存在时签名原图。
- `ensureGridPathForSigning` 在缩略图现场生成失败时降级返回已确认存在的原图路径，绝不返回不存在的 `_grid` 签名 URL；`requireExistingPrimary` 时仍按原契约抛 `NOT_FOUND` / `GRID_UNAVAILABLE`。
- 归档下载重试退避从 `400ms × attempt` 调整为 `1200ms × attempt`：New API 图片代理（`console.prompt-hubs.com`，Cloudflare 边缘 → 源站）偶发瞬时 502，较长的退避让重试落在上游临时图 token 仍有效的窗口内；归档仍受 `maxAttempts` 上限约束，不属于付费操作重试。

## Generation Delivery Contract (2026-08-03)

The Worker now separates upstream completion from media delivery. A public
`completed` response always carries a non-empty `imageUrl`; terminal upstream
responses without a URL remain pollable. Legacy completed rows first recover
`syncImageUrl`, `upstreamImageUrl`, or `upstreamResultUrls`; rows with no
recoverable source end as `upstream_no_image` or `upstream_not_configured` and
are refunded idempotently.
6. 未知上游结果超过 1 小时进入幂等退款 SLA。发布前必须验证队列 binding、cron、幂等迁移和原子积分 RPC 已同步存在。
