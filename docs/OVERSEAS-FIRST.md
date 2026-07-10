# 生产域名与兼容路线

> 文件名为历史兼容保留。当前结论是 `.com` 主站优先，数据库使用 MemFire，不再执行“迁回境外 Supabase”的旧计划。

## 主链路

```text
prompt-hubs.com (Cloudflare Pages)
  -> api.prompt-hubs.com (Cloudflare Worker)
     -> MemFire Auth/Postgres/Storage
     -> Cloudflare R2
     -> configured image/chat providers
```

所有新功能、性能审计和文档以这条链路为准。

## 旧 `.cn` 链路

`prompt-hub.cn` 和 `api.prompt-hub.cn` 仅用于旧书签、旧扩展版本和过渡用户。建议主站做 301 到 `.com`；API 兼容路由可保留到旧客户端升级完成。

旧自建 Supabase/RDS 代理如果仍运行，配置见 `SUPABASE-PROXY-SETUP.md`。它不应成为新代码默认数据库。

## 配置真源

- Pages/API 映射：`api-domain.config.js`, `api-config.js`
- Auth 反代和 anon key：`supabase-config.js`
- Worker routes/CORS：`server/wrangler.toml`
- 扩展：`extension/config.js`, `extension/manifest.json`
- Canvas 允许源：`server/wrangler.toml` 和 `server/src/lib/cors-headers.ts`

## 换域名或数据库时

先备份，再更新 Worker Secrets，最后更新前端和扩展。不要只改 `api-config.js`：登录反代、CORS、扩展权限、canonical 和 Canvas 都需要同步。完整步骤见 `CUSTOM-DOMAIN.md` 与 `MEMFIRE-MIGRATION.md`。
