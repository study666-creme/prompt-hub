# 数据安全要点（Prompt Hub）

> 对照成熟 SaaS 的常见做法，本仓库已落地的防护与仍须人工遵守的边界。

## 密钥与权限

| 原则 | 本项目 |
|------|--------|
| `service_role` 仅服务端 | 只在 Cloudflare Worker `env`（`server/src/lib/supabase.ts`），**前端无此密钥** |
| 前端 Supabase | 仅 **anon + 用户 JWT**；写 `user_data` 受 RLS 约束 |
| 积分 / 会员 / 生图扣费 | **仅 API**（`apply_credit_delta`、任务领取等 RPC），浏览器不能直接改 `profiles` |

部署：Worker 用 `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`；勿把 `sb_secret_` 写进 Pages 静态文件或 Git。

## 认证与 API

- 受保护路由：`auth` 中间件校验 Supabase JWT（`server/src/middleware/auth.ts`）。
- 敏感操作限流：兑换、任务领取、签到等 `rateLimit`（见 `membership-tasks` 路由）。
- CORS：仅允许配置的站点域名（生产 `prompt-hub.cn`、本地 `localhost`），**不支持 `file://`**（见 `file-origin-guard.js`）。

## 云同步（防误删 / 防覆盖）

`cloud-sync-safety.js`：

- 上传前 `validatePush`：禁止用「空卡片 + 空社区」覆盖云端已有数据。
- `mergePayload`：同 id 按 `updatedAt` 合并，图片字段保留「更有内容」的一方。
- 登录拉取后 `preferLocalCardsImages`，减少签名 URL 丢失导致列表变灰。

## 任务与签到

- 每日 5 积分与连续签到合并：**领取 `daily_bonus_*` 时**服务端写入 `sign_streak` / `checkin_*` 记录，防重复领取靠 `membership_task_claims` 唯一约束。
- 旧版 `POST .../checkin` 仍可用（兼容），与每日领取共用同一套 streak 逻辑。

## 图片与 Storage

- 私有桶路径以 `storage://` 存于 JSON；展示 URL 由 Worker/客户端批量签名，**短时有效**，不当作永久公开链泄露整桶。

## 上线前自检（可复制）

1. 仓库内 `rg service_role` 仅命中 `server/`，无 `*.js` 前端配置。
2. Supabase Dashboard → RLS：`user_data` 仅 `auth.uid()` 可读写自己的行。
3. 生产打开 DevTools → Application：无 `SUPABASE_SERVICE_ROLE`、无完整支付密钥。
4. 改静态资源后 bump `__APP_BUILD__` + `sw.js` CACHE，避免旧 SW 缓存脏数据。

## 相关文档

- `docs/BACKEND.md` — API 与环境变量
- `docs/PROJECT_CONTEXT.md` — 部署与数据拆分
- `cloud-sync-safety.js` — 合并规则实现
