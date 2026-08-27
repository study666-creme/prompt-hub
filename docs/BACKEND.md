# Worker 后端架构

## 组件

| 层 | 技术 | 职责 |
|---|---|---|
| 路由 | Hono + TypeScript | API、认证、CORS、错误与限流 |
| 数据 | MemFire Postgres/Auth | 用户、积分、社区、任务和运营数据 |
| 图片 | Cloudflare R2 + MemFire Storage | 上传、签名、缩略图、CDN 回源 |
| 上游 | 卡藏 New API、Apimart、DeepSeek | 全能模型2/香蕉、MJ/视觉、对话工具 |
| 监控 | Workers Observability + KV | 请求、5xx、图片 404 与生成失败率 |

入口是 `server/src/index.ts`。公开 API 挂在 `/api/v1`，运营 API 挂在 `/api/admin`，认证代理挂在 `/supabase/*`。

## 路由分组

| 路径 | 认证 | 说明 |
|---|---|---|
| `/health` | 无 | 数据库和生图 provider 配置状态 |
| `/api/v1/community/feed` | 无 | 公共社区分页 |
| `/api/v1/media/community/*` | 无 | 已发布社区图片签名/CDN |
| `/api/v1/me`, `/membership`, `/redeem` | Bearer | 账号、积分、会员和兑换 |
| `/api/v1/generate/*` | Bearer | 模型、报价、提交、轮询、恢复和 MJ 动作 |
| `/api/v1/media/*` | Bearer | 私有图片上传、批量签名和缩略图 |
| `/api/v1/community/*` | Bearer | 发布、点赞、通知和灵感抽取 |
| `/api/v1/extension/*` | Bearer | 扩展与 Canvas 列表、标签和存卡 |
| `/api/v1/chat`, `/prompt-tools` | Bearer | 对话、优化、反推和裂变 |
| `/api/v1/asset-packages/*` | 可选/Bearer | 资产包浏览、领取、导入和发布 |
| `/api/admin/*` | 管理员密钥 | 运营后台、用户、卡片、社区和模型配置 |

具体路由以 `server/src/routes/` 为准，不在文档复制完整端点清单。

## 环境变量

非敏感变量在 `server/wrangler.toml`；敏感值使用 Cloudflare Secrets。

| 变量 | 类型 | 用途 |
|---|---|---|
| `SUPABASE_URL` | Secret | MemFire Supabase-compatible API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 服务端数据库权限 |
| `SUPABASE_JWT_SECRET` | Secret，可选 | 本地 JWT 校验回退 |
| `NEWAPI_API_KEY` | Secret | New API 图片/通用线路；目录和价格实时同步 |
| `NEWAPI_VIDEO_API_KEY` | Secret，可选 | New API 视频专用令牌；配置后视频优先使用，未配置时兼容回退通用令牌 |
| `APIMART_API_KEY` | Secret | MJ 与视觉能力 |
| `CHAT_API_KEY` | Secret | 对话/提示词工具 |
| `ADMIN_API_SECRET` | Secret | 运营后台和造码脚本 |
| `PAYMENT_WEBHOOK_SECRET` | Secret，可选 | 支付 webhook HMAC |
| `MEDIA_STORAGE_MODE` | 普通变量 | `supabase` / `r2-first` / `r2` |

`IMAGE_API_KEY`、`ITHINK_API_KEY`、`MOOKO_API_KEY` 仅用于恢复数据库中已经存在的旧 provider 任务，不进入新任务目录。确认没有对应历史任务后可从 Worker Secrets 删除。

## 图片模型边界

- `/api/v1/generate/models` 只返回已完成协议适配的卡藏 API 全能模型2/香蕉型号，以及 5 个公开 MJ 型号：`Midjourney v8.2 高速`、`mj-v82`、`mj-v81`、`mj-v7` 和 `mj-niji7`。`Midjourney v8.2 高速` 是合法的 UTF-8 公共模型 ID，调用时必须原样传递；它与其他 MJ 型号一样走专用 Midjourney 适配路径。当前为 8 个卡藏图片模型（含特价 1K）和 5 个 MJ。
- 卡藏 API 的图片人民币价格统一调用 `imageRetailCreditsFromYuan()`：卡藏报价已包含上游加价，按 `1 元 = 100 积分` 直接换算，不再重复加价；报价或提交时无法取得新鲜目录会在扣费前失败。
- `gpt-image-2-chat` 走 `/v1/chat/completions` 并从消息内容提取图片，不支持参考图、比例和多张参数。
- 运营后台的调用链路由卡藏 API `/api/model-catalog/admin/routes` 提供，并使用 `NEWAPI_CATALOG_ADMIN_SECRET` 与服务端共享密钥鉴权；公开 `/api/model-catalog` 不包含真实渠道信息。
- 视频提交使用同一份管理渠道目录决定可执行性：零渠道不发布、单渠道按稳定公开 ID 绑定、多渠道发布独立线路 ID。管理渠道目录暂不可读时公共目录保留基础模型，付费提交在扣费前失败，不能退回 distributor 猜路由。
- Canvas 视频请求将 `clientRequestId` 持久化为幂等身份；重复 POST 返回原任务，`GET /api/v1/video/requests/:clientRequestId` 只读恢复原任务。数据库唯一索引防止同一用户同一请求产生两次扣费。
- 视频提交、状态和内容接口均优先使用 `NEWAPI_VIDEO_API_KEY`，不得因为令牌名称或用途把视频改发到图片端点；视频始终走 `/v1/videos`。上游完成后内容短暂返回 `404`、`425`、`429` 或 `5xx` 时只做有界读取重试，不重放生成 POST。
- 迁移 `20260817150000_video_request_idempotency.sql` 必须在目标 Supabase 执行后，数据库层唯一索引才正式生效；在迁移窗口前，Worker 的同请求查询仍会阻止普通重复提交。
- 已发布的 `mj-v82` 和 `Midjourney v8.2 高速` 使用 API 站的
  `/v1/midjourney/generations` 契约；请求中的 `model` 必须分别原样传递为
  `mj-v82` 或 `Midjourney v8.2 高速`。两个模型都要求 `prompt`，固定
  `n: 1`，并接受目录声明的 `size`、`image`/`images` 和 `raw`；`mj-v82`
  另外接受 `resolution: 1K | 2K`。一次 API 站请求返回四张候选图，不能将
  四张结果当成四次提交或四次扣费。旧的 `mj-v81`、`mj-v7` 和 `mj-niji7`
  仅保留历史 APIMart 任务恢复路径。
- 旧 GrsAI、iThink、Mooko 和非 MJ Apimart 型号只能恢复历史任务，不能通过后台重新上架。

### 图片兼容协议

`image.v1` 是图片请求的内部兼容层，统一表达文生图、参考图生图和编辑图
意图。它使用 `resolution`、`aspect_ratio`、`quality`、`count` 和带有
`reference`、`style_reference`、`element_reference`、`mask` 角色的
`media_inputs`。Prompt Hub 的 `/api/v1/generate` 在校验前接受该协议并
投影到现有公开请求字段；不带版本的旧请求保持原样。

New API 中继在根据实时目录组装图片请求时也先建立同一份语义请求，再按目录
声明的参数路径写入兼容字段。投影只发生一次，不新增任务、不重复扣费，也不
改写已存在的 `generation_requests`、`genJobId`、卡片图片引用或历史任务恢复
路径。Card Library 继续使用原有任务、归档和缩略图流程，因此在线用户无需重新
接入。

### API 站 MJ 参数契约

两个公开 8.2 模型都使用同一个 POST 路径：

```http
POST /v1/midjourney/generations
Content-Type: application/json
```

`Midjourney v8.2 高速` 的请求字段为：

```json
{
  "model": "Midjourney v8.2 高速",
  "prompt": "提示词",
  "size": "16:9",
  "raw": false,
  "n": 1
}
```

`mj-v82` 在此基础上可以增加 `resolution`，值只能是 `1K` 或 `2K`：

```json
{
  "model": "mj-v82",
  "prompt": "提示词",
  "size": "16:9",
  "raw": false,
  "resolution": "2K",
  "n": 1
}
```

参考图使用 `image`（单张）或 `images`（多张，最多 5 张），两者不能同时
出现。任务状态统一通过 `GET /v1/tasks/{task_id}` 查询，结果从
`image_urls` 读取。Canvas 的 `image.v1` 请求会在服务端投影到上述字段。

配置命令示例：

```powershell
cd D:\prompt-hub\server
npm exec wrangler secret put SUPABASE_URL
npm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm exec wrangler secret put NEWAPI_API_KEY
npm exec wrangler secret put NEWAPI_VIDEO_API_KEY
npm exec wrangler secret put APIMART_API_KEY
```

## 数据写入边界

- 积分、会员、激活码、生成结算和支付事件只能由 Worker 写入。
- 用户私有 JSON 可由登录用户 RLS 路径同步，但 `cloud-sync-safety` 必须防止空覆盖。
- 管理后台的删除/恢复接口必须先提供预览或显式确认；卡片巡检默认只读。
- 生成扣费与退款由同一任务记录驱动，不能在前端自行补积分。

## 本地与部署

```powershell
cd D:\prompt-hub\server
npm ci
npm run dev -- --ip 127.0.0.1 --port 8787

npm run typecheck
npm test
npm run deploy
```

使用仓库锁定的 Wrangler 版本，不要临时安装不兼容的大版本。数据库备份/恢复见 `MEMFIRE-MIGRATION.md`，图片存储见 `R2-MIGRATION.md`。
