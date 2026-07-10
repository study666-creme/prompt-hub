# Worker 后端架构

## 组件

| 层 | 技术 | 职责 |
|---|---|---|
| 路由 | Hono + TypeScript | API、认证、CORS、错误与限流 |
| 数据 | MemFire Postgres/Auth | 用户、积分、社区、任务和运营数据 |
| 图片 | Cloudflare R2 + MemFire Storage | 上传、签名、缩略图、CDN 回源 |
| 上游 | GrsAI、Apimart、New API、iThink 等 | 生图和提示词工具 |
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
| `IMAGE_API_KEY` | Secret | GrsAI |
| `APIMART_API_KEY` | Secret | Apimart/视觉能力 |
| `NEWAPI_API_KEY` | Secret | 自建 New API |
| `ITHINK_API_KEY`, `MOOKO_API_KEY` | Secret，可选 | 其他 provider |
| `CHAT_API_KEY` | Secret | 对话/提示词工具 |
| `ADMIN_API_SECRET` | Secret | 运营后台和造码脚本 |
| `PAYMENT_WEBHOOK_SECRET` | Secret，可选 | 支付 webhook HMAC |
| `MEDIA_STORAGE_MODE` | 普通变量 | `supabase` / `r2-first` / `r2` |

配置命令示例：

```powershell
cd D:\prompt-hub\server
npm exec wrangler secret put SUPABASE_URL
npm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm exec wrangler secret put NEWAPI_API_KEY
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
