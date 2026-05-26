# Prompt Hub 后端架构

## 目标

- **可维护**：Hono 模块化路由 + Supabase 迁移 SQL + TypeScript 类型检查
- **可持续运营**：积分流水 `credit_ledger`、激活码核销、生图任务表可审计
- **安全**：积分/会员仅经 `service_role` RPC `apply_credit_delta` 写入；客户端 RLS 只读自己的 `profiles`
- **现代**：Cloudflare Workers 边缘 API + Supabase Auth JWT

## 组件

| 层 | 技术 | 职责 |
|----|------|------|
| 静态前端 | Cloudflare Pages / 任意静态托管 | UI、卡片 JSON 云同步（`user_data`） |
| API | `server/` → Workers `prompt-hub-api` | 积分、兑换、生图扣费、未来支付 webhook |
| 数据 | Supabase Postgres + Auth | `profiles`、`credit_ledger`、`activation_codes`、`generation_requests` |

## 积分汇率

**1 元 = 100 积分**。生图基准价：1K = 10、2K = 20、4K = 40（会员折后 `floor`，最低 10）。

## 数据库

在 Supabase SQL Editor 执行：

`supabase/migrations/20260526000000_backend_core.sql`  
若已执行过旧版，再依次执行：`20260526120000_points_scale_x10.sql`、`20260526140000_generation_meta_webhooks.sql`、`20260526150000_like_milestone_claims.sql`

核心表见迁移文件注释。演示激活码已 seed（生产请轮换并限制 `max_uses`）。

## API 路由（v1）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/health` | 否 | 健康检查 |
| GET | `/api/v1/billing/plans` | 否 | 套餐说明（支付待接） |
| GET | `/api/v1/me` | Bearer | 积分与会员状态 |
| POST | `/api/v1/redeem` | Bearer | 激活码兑换 |
| GET | `/api/v1/generate/cost` | Bearer | 生图报价（含会员折扣） |
| POST | `/api/v1/webhooks/payment` | HMAC 签名 | 支付入账（充值 / 开通会员） |
| GET | `/api/v1/me/ledger` | Bearer | 积分流水（最近 N 条） |
| POST | `/api/v1/community/like-milestone` | Bearer | 作者领取点赞里程碑积分（100/1000 赞） |
| POST | `/api/v1/generate` | Bearer | 扣积分并记录任务；配置 `IMAGE_API_*` 后代理上游 |

## 支付 Webhook

配置 `PAYMENT_WEBHOOK_SECRET` 后，网关 POST 到 `/api/v1/webhooks/payment`：

```http
X-Webhook-Signature: sha256=<hmac_sha256_hex_of_raw_body>
Content-Type: application/json
```

**充值示例：**

```json
{
  "type": "credits.topup",
  "eventId": "pay_20260526_001",
  "userId": "<supabase-user-uuid>",
  "credits": 1000,
  "note": "微信充值 10 元"
}
```

**开通会员示例：**

```json
{
  "type": "membership.grant",
  "eventId": "sub_20260526_001",
  "userId": "<supabase-user-uuid>",
  "tier": "standard",
  "days": 30,
  "credits": 310
}
```

同一 `eventId` 重复投递会幂等返回，不会重复入账。

## 数据库迁移（按顺序）

1. `20260526000000_backend_core.sql`
2. `20260526120000_points_scale_x10.sql`（若已用旧积分）
3. `20260526140000_generation_meta_webhooks.sql`

## 本地开发

```bash
cd server
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

> **Node 版本**：Wrangler 4 需 Node 22+。本项目 `package.json` 已锁定 Wrangler 3.x，**Node 18 / 20 即可本地 `npm run dev`**。若你已装 Node 22，也可自行把 `wrangler` 升到 4.x。

前端 `api-config.local.js`（勿提交）：

```js
window.API_BASE_URL = 'http://127.0.0.1:8787';
```

## 部署 API（Cloudflare）

```bash
cd server
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# 可选
npx wrangler secret put IMAGE_API_KEY
npx wrangler secret put IMAGE_API_BASE_URL
npm run deploy
```

在 `api-config.js` 或生产环境注入 `window.API_BASE_URL = 'https://prompt-hub-api.<account>.workers.dev'`。

`wrangler.toml` 的 `CORS_ORIGINS` 需包含静态站域名。

## 前端对接

- `api-config.js` / `api-config.local.js`：`API_BASE_URL`
- `api-client.js`：`PromptHubApi.syncMe()`、`redeem()`、`generateImage()`
- 登录后 `script.js` 会调用 `syncMe`；兑换码优先走 API（失败再回退本地演示逻辑）
- 卡片数据仍走 `supabase-sync.js` → `user_data`；积分/会员逐步以 API 为准

## 后续迭代

1. 支付 webhook（微信/Stripe）→ 写 `profiles.membership_*` + 积分充值
2. 生图对接真实 Image2（`IMAGE_API_BASE_URL`）
3. Workers Rate Limiting / Turnstile 防刷
4. 将点赞里程碑奖励迁到服务端或队列
