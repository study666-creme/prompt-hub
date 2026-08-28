# 无限画布集成

最后核对：2026-07-30。生成与奖励条目描述 `20260730a` Prompt Hub 侧受控发布契约；生产是否已切换以 `/health.buildSha` 为准。

- Canvas 仓库: <https://github.com/study666-creme/infinite-canvas-jay>
- 正式地址: <https://canvas.prompt-hubs.com>
- 兼容预览地址: <https://infinite-canvas-jay.vercel.app/canvas>
- Prompt Hub: <https://prompt-hubs.com>
- API: <https://api.prompt-hubs.com>

## 能力

| 方向 | 行为 |
|---|---|
| Canvas -> Prompt Hub | 图片/提示词节点存为卡片，图片通过 Worker 写入 R2 |
| Prompt Hub -> Canvas | 卡片库可一键深链插卡；Canvas 也可分页浏览，有图插入图片+提示词，纯文字只插提示词节点 |
| Canvas 生图 | 使用 Prompt Hub 模型目录、报价、扣费、任务轮询和结果代理 |
| Canvas 生视频 | 使用独立视频队列、任务轮询和受控内容代理 |
| 首次建点 | 登录用户首次创建节点时由原子 RPC 自动奖励一次 1 天基础会员 |

Canvas 不保存 New API、Apimart 等上游 Key。它只持有用户 Prompt Hub 会话，扣费和上游提交都在 Worker 完成。

## 主要 API

| 路径 | 用途 |
|---|---|
| `GET /api/v1/extension/cards` | 卡片分页、搜索、分组和标签 |
| `GET /api/v1/extension/cards/:cardId` | 按当前用户精确读取一张卡片，供深链插卡 |
| `GET /api/v1/extension/groups` | 分组 |
| `GET /api/v1/extension/status` | 连接状态和积分 |
| `POST /api/v1/extension/quick-card` | 存回 Prompt Hub |
| `POST /api/v1/extension/canvas-results` | 将 Canvas 生图任务的首张成图幂等保存到卡片库 |
| `GET /api/v1/generate/models` | 当前模型目录 |
| `GET /api/v1/model-catalog` | 图片、视频等公开规范化模型目录 |
| `GET /api/v1/generate/cost` | 报价 |
| `POST /api/v1/generate` | 提交并扣费 |
| `GET /api/v1/generate/jobs/:jobId` | 轮询/结算 |
| `GET /api/v1/generate/jobs/:jobId/image?index=N` | 鉴权代理第 `N` 张成图；省略时为 `0` |
| `POST /api/v1/video` | 幂等提交视频任务并扣费 |
| `GET /api/v1/video/jobs/:jobId` | 视频轮询/结算 |
| `GET /api/v1/video/jobs/:jobId/content` | 鉴权视频播放与 Range 代理 |
| `POST /api/v1/membership/tasks/events/canvas-create-node` | 首次建点一次性奖励事件 |
| `GET /api/v1/payments/products` | 支付商品；`/wallet/products` 为旧客户端别名 |
| `GET /api/v1/media/sign?variant=full` | 插入 Canvas 的原图 |

所有 `/api/v1/extension/*` 请求都使用当前用户的 Prompt Hub Bearer 会话。精确取卡和结果回仓响应均为 `private, no-store`，不能做跨用户或共享缓存。

### 图片参考素材请求

Canvas 生图可使用公开 API 的 `image.v1` 请求形状（验证日期 `2026-08-28`，
`capability_version=image-protocol-2026-08-28.1`）：

```http
POST https://api.prompt-hubs.com/api/v1/generate
Authorization: Bearer <session-token>
Content-Type: application/json
```

```json
{
  "version": "image.v1",
  "model": "nano-banana-2",
  "operation": "image_to_image",
  "prompt": "保持主体和构图，生成新的场景",
  "resolution": "2k",
  "aspect_ratio": "16:9",
  "media_inputs": [
    { "kind": "image", "role": "reference", "url": "https://media.example/reference.png" }
  ]
}
```

`role=reference` 会按现有 `refImageUrls` 路径解析并随任务持久化；`aspect_ratio`
会映射为比例参数。当前图片端点不支持 `style_reference`、`element_reference` 或
`mask`，这些角色会明确返回 `400`，不会在没有参考图的情况下继续生成。旧的
`refImageUrl`、`refImageUrls`、`image`、`images` 字段仍可用于兼容客户端。

Canvas 渲染多图生成结果时使用 `GET /api/v1/generate/jobs/:jobId/image?index=N`。`N` 只能是 `0..7`；MJ 的 `0` 是四宫格封面、`1..4` 是四张单图，普通批量结果按主图后接额外图片的稳定顺序返回。相同 URL 只投影一次，非法索引返回 `400`。结果回仓接口仍只接受首张成图的 `artifactIndex=0`。

## 一键插卡深链

Prompt Hub 从桌面卡片图标、移动端“到画布”按钮或卡片右键菜单打开：

```text
https://canvas.prompt-hubs.com/canvas?phSource=prompt-hub&phVersion=1&phIntent=insert-card&phCardId=<URL-encoded-card-id>
```

- `phSource` 固定为 `prompt-hub`，`phVersion` 固定为 `1`，`phIntent` 固定为 `insert-card`；Canvas 只消费它明确支持的组合。
- URL 只携带卡片 ID 和路由元数据，不携带提示词、图片 URL、用户 Token 或任何上游凭据。Canvas 用自己的现有 Prompt Hub 会话调用 `GET /api/v1/extension/cards/:cardId`，服务端再次校验卡片归属。
- Prompt Hub 以新窗口和 `noopener,noreferrer` 打开 Canvas。卡片 ID 最长 200 字符，客户端拒绝控制字符，拼入路径时仍须 URL 编码。
- 打开 Canvas 时 Prompt Hub 写入最长 4 小时的一次性返回标记；页面重新可见后消费该标记并立即强制静默拉取一次云端，以接收 Canvas 新回仓的卡片。

## Canvas 生图结果回仓

Canvas 在图片任务完成后提交：

```json
{
  "generationJobId": "00000000-0000-0000-0000-000000000000",
  "artifactIndex": 0,
  "title": "可选标题，最多 200 字"
}
```

- `generationJobId` 必须是 UUID；当前只接受首张成图，`artifactIndex` 可省略但只允许 `0`。
- Worker 只接受属于当前用户、状态为 `completed`，且 `meta.product=canvas` 或带非空 `projectId` / `nodeId` Canvas 来源标记的任务。
- 客户端不能提交 `imageBase64`、任意结果 URL 或内部 `imageRef`。Worker 从生成任务解析当前用户的受控存储引用，优先复用已归档图片；现有归档恢复路径仍取不到图片时返回 `409 RESULT_NOT_READY`，不会另外创建一份客户端上传。
- 稳定幂等键为 `canvas-result:<generationJobId>:0`，保存卡同时记录 `genJobId`。重复提交返回原卡及 `replayed=true`，不重复新增卡片；回仓卡默认不公开到社区。

以上深链与结果回仓协议属于 `D:\prompt-hub` 的 `20260730a` 发布契约。Canvas 仓库仍需消费深链并在生成完成后调用回仓接口，两个仓库必须按同一协议版本上线后才能宣称端到端链路完成。

## Prompt Hub 侧文件

- `app-router.js`, `legacy/script/part-04.js`: 深链构造、打开与返回标记
- `legacy/script/part-09.js`, `legacy/script/part-10.js`: 卡片入口、点击处理与返回后的强制云端拉取
- `server/src/routes/v1/extension.ts`: 列卡、精确取卡和结果回仓端点
- `server/src/lib/extension-card.ts`: 用户 JSON 读写、卡片映射与幂等追加
- `server/src/routes/v1/generate.ts`: 模型、提交、轮询和结果
- `server/src/routes/v1/video.ts`, `server/src/lib/video-provider-*.ts`: 视频提交、轮询、退款和内容
- `server/src/routes/v1/membership-tasks.ts`: 首次建点奖励事件
- `server/src/routes/v1/media.ts`: 原图签名
- `server/wrangler.toml`: Canvas origin CORS

Canvas 侧实现和部署说明以其仓库 `DEPLOY.md` 为准，不在两个仓库复制文件级清单。

## 验收

1. Canvas 设置连接 Prompt Hub 测试账号。
2. 插入纯文字卡，确认不生成空图片节点。
3. 插入单图和多图卡，确认拿到 full 原图。
4. 连接文字/图片参考节点生图，确认提交、扣费、轮询和结果节点。
5. 文生视频和图生视频各验证一次；长时 processing 保持动画与轮询，不能自动重提。
6. 首次建点奖励到账一次，重复事件不再次延期。
7. 把新节点存回 Prompt Hub，跨窗口确认卡片和图片可见。
8. 失败任务核对退款和后台 provider 错误，不重复提交同一 job。

## 授权边界

Canvas 与 Prompt Hub 是独立仓库和独立部署。Canvas 的分发与网络服务需遵守其仓库许可证；Prompt Hub 是否开源、如何商用由本仓库自己的许可证决定。当前 Prompt Hub 尚未提供 `LICENSE`，不能把两者默认视为同一授权。
