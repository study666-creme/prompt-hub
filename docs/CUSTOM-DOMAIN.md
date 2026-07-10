# 域名与 Cloudflare 路由

## 当前拓扑

| 域名 | 服务 | 状态 |
|---|---|---|
| `prompt-hubs.com` | Cloudflare Pages | 主站 |
| `www.prompt-hubs.com` | Pages/重定向 | 兼容 |
| `api.prompt-hubs.com` | Worker Custom Domain | 主 API/Auth 反代 |
| `prompt-hub.cn` | 旧主站 | 仅兼容或 301 |
| `api.prompt-hub.cn` | Worker Custom Domain | 旧客户端兼容 |

前端域名映射在 `api-domain.config.js`、`api-config.js` 和 `supabase-config.js`；Worker 路由与 CORS 在 `server/wrangler.toml`。

## 修改主域名

1. Cloudflare Pages 项目添加 Custom Domain。
2. Worker `Settings -> Domains & Routes` 添加 `api.<domain>`。
3. 更新 `api-domain.config.js` 和 `server/wrangler.toml` 的 routes/CORS。
4. 更新 `supabase-config.js`、扩展 `config.js`/`manifest.json` 和 Canvas CORS。
5. 更新 `index.html` canonical/OG、`sitemap.xml`、`robots.txt`、隐私/协议链接。
6. 部署 Worker 后再部署 Pages，并验证 `/health` 和 `/supabase/auth/v1/health`。

辅助脚本：

```powershell
cd D:\prompt-hub\server
.\setup-custom-domain.ps1 -ApiHost api.example.com -PagesOrigin https://example.com
```

执行脚本后仍需人工复核 CORS、SEO 和扩展权限，不能直接假设全部入口已更新。

## 522/1003 排查

- Custom Domain 与 DNS 中同名 A/CNAME 冲突时，删除冲突记录，让 Workers 管理该域名。
- Worker 不能 fetch 裸 IP；数据库上游必须是可解析域名。
- CORS 报错先看 Worker 实际响应；500 若缺 CORS 头会被浏览器伪装成纯 CORS 问题。
- `.workers.dev` 国内不可达不代表自定义域也不可达。

旧 `.cn` 自建 Supabase 路线见 `SUPABASE-PROXY-SETUP.md`；新功能只以 `.com` 主链路验收。
