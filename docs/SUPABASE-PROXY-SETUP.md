# 旧 `.cn` Supabase 代理应急说明

> 仅适用于仍需维护 `api.prompt-hub.cn -> 自建 Supabase/RDS` 的旧链路。生产 `.com` 主链路使用 MemFire，不需要执行本文。

## 约束

Cloudflare Worker 不能安全 fetch 裸 IP。旧上游必须提供可解析域名，例如 `sb.prompt-hub.cn`，并在 Worker Secret `SUPABASE_URL` 中使用完整 `http(s)://` URL。

浏览器只访问 Worker：

```text
https://api.prompt-hub.cn/supabase/*
```

Worker 再转发到旧数据库上游。不要把 service role 放进前端。

## 最小检查

1. Cloudflare DNS 中 `sb` 是灰云 DNS-only，指向旧服务器。
2. 旧服务器的 Auth/REST/Storage 端口可从公网访问，并有合法域名/证书或明确的 HTTP 内网策略。
3. Worker Secrets 指向域名而不是 IP。
4. 重新部署 Worker，检查：

```powershell
Invoke-RestMethod https://api.prompt-hub.cn/health
```

## 常见错误

- `error code 1003`: Worker 请求了 Cloudflare 代理域名形成回环；数据库上游应灰云或使用非 Cloudflare 回源域名。
- 522: DNS/端口/防火墙不可达，或 Worker Custom Domain 与普通 A/CNAME 冲突。
- CORS: 先查看 Worker 真正的 4xx/5xx；不要把 `Access-Control-Allow-Origin` 改成 `*` 来掩盖认证错误。

旧链路稳定后仍建议让用户升级到 `.com` 主站，并最终下线这套兼容配置。
