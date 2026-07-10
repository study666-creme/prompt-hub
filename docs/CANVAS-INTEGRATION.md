# 无限画布集成

- Canvas 仓库: <https://github.com/study666-creme/infinite-canvas-jay>
- 当前地址: <https://infinite-canvas-jay.vercel.app/canvas>
- Prompt Hub: <https://prompt-hubs.com>
- API: <https://api.prompt-hubs.com>

## 能力

| 方向 | 行为 |
|---|---|
| Canvas -> Prompt Hub | 图片/提示词节点存为卡片，图片通过 Worker 写入 R2 |
| Prompt Hub -> Canvas | 分页浏览卡片；有图插入图片+提示词，纯文字只插提示词节点 |
| Canvas 生图 | 使用 Prompt Hub 模型目录、报价、扣费、任务轮询和结果代理 |

Canvas 不保存 New API、Apimart 等上游 Key。它只持有用户 Prompt Hub 会话，扣费和上游提交都在 Worker 完成。

## 主要 API

| 路径 | 用途 |
|---|---|
| `GET /api/v1/extension/cards` | 卡片分页、搜索、分组和标签 |
| `GET /api/v1/extension/groups` | 分组 |
| `GET /api/v1/extension/status` | 连接状态和积分 |
| `POST /api/v1/extension/quick-card` | 存回 Prompt Hub |
| `GET /api/v1/generate/models` | 当前模型目录 |
| `GET /api/v1/generate/cost` | 报价 |
| `POST /api/v1/generate` | 提交并扣费 |
| `GET /api/v1/generate/jobs/:jobId` | 轮询/结算 |
| `GET /api/v1/generate/jobs/:jobId/image` | 鉴权代理成图 |
| `GET /api/v1/media/sign?variant=full` | 插入 Canvas 的原图 |

## Prompt Hub 侧文件

- `server/src/routes/v1/extension.ts`: 列卡和存卡端点
- `server/src/lib/extension-card.ts`: 用户 JSON 读写与图片上传
- `server/src/routes/v1/generate.ts`: 模型、提交、轮询和结果
- `server/src/routes/v1/media.ts`: 原图签名
- `server/wrangler.toml`: Canvas origin CORS

Canvas 侧实现和部署说明以其仓库 `DEPLOY.md` 为准，不在两个仓库复制文件级清单。

## 验收

1. Canvas 设置连接 Prompt Hub 测试账号。
2. 插入纯文字卡，确认不生成空图片节点。
3. 插入单图和多图卡，确认拿到 full 原图。
4. 连接文字/图片参考节点生图，确认提交、扣费、轮询和结果节点。
5. 把新节点存回 Prompt Hub，跨窗口确认卡片和图片可见。
6. 失败任务核对退款和后台 provider 错误，不重复提交同一 job。

## 授权边界

Canvas 与 Prompt Hub 是独立仓库和独立部署。Canvas 的分发与网络服务需遵守其仓库许可证；Prompt Hub 是否开源、如何商用由本仓库自己的许可证决定。当前 Prompt Hub 尚未提供 `LICENSE`，不能把两者默认视为同一授权。
