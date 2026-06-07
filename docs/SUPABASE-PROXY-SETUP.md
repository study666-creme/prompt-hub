# Supabase 反代上线 — 修 403 error code 1003（小白版）

> **现象**：线上登录失败；`curl https://api.prompt-hub.cn/supabase/auth/v1/health` 返回 `error code: 1003`。  
> **原因**：Worker Secret `SUPABASE_URL` 填了裸 IP（如 `http://8.148.193.247:80`），Cloudflare 出站 `fetch()` 会拦截裸 IP（SSRF 策略）。  
> **办法**：给 Supabase 服务器加一个 **域名 + 灰云 DNS**，Worker 只 fetch 域名。

浏览器仍用 `https://api.prompt-hub.cn/supabase`（不变）；**只改 Worker 侧 upstream**。

---

## 第 1 步：添加灰云 A 记录

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com)
2. 左侧 **Websites**（网站）→ 点 **prompt-hub.cn**
3. 左侧 **DNS** → **Records**
4. 点 **Add record**
5. 填写：
   - **Type**：`A`
   - **Name**：`sb`（完整域名为 `sb.prompt-hub.cn`）
   - **IPv4 address**：`8.148.193.247`
   - **Proxy status**：点成 **DNS only**（灰色云朵 ☁️，**不要**橙色代理）
6. 点 **Save**

> 灰云 = 仅 DNS 解析，流量不经过 Cloudflare CDN；Worker 能解析域名并直连你的阿里云 Supabase。

---

## 第 2 步：更新 Worker Secret

在项目目录打开 PowerShell：

```powershell
cd d:\prompt-hub\server
npx wrangler secret put SUPABASE_URL
```

提示输入时粘贴（**用域名，不要用 IP**）：

```
http://sb.prompt-hub.cn
```

若 Supabase 监听非 80 端口，写成 `http://sb.prompt-hub.cn:端口`。

---

## 第 3 步：部署 Worker

```powershell
cd d:\prompt-hub\server
npm run deploy
```

---

## 第 4 步：验证

把 `你的_anon_key` 换成 Supabase 项目的 anon key：

```powershell
curl.exe "https://api.prompt-hub.cn/supabase/auth/v1/health" -H "apikey: 你的_anon_key"
```

**成功**：返回 JSON（通常是 `401` 或带 `message` 的 JSON），**不是** `error code: 1003`。  
**仍 1003**：确认 DNS 已灰云、Secret 已改、Worker 已 redeploy；等 1～2 分钟 DNS 生效后再试。

也可先测域名是否通（应返回 JSON，不是 HTML 1003）：

```powershell
curl.exe "http://sb.prompt-hub.cn/auth/v1/health" -H "apikey: 你的_anon_key"
```

---

## 对照表

| 配置项 | 浏览器 / Pages | Worker Secret |
|--------|----------------|---------------|
| Supabase 地址 | `https://api.prompt-hub.cn/supabase` | `http://sb.prompt-hub.cn` |
| 说明 | 走 HTTPS 反代，解决混合内容 | 走灰云域名直连阿里云 HTTP |

---

## 相关文件

- 反代逻辑：`server/src/routes/supabase-proxy.ts`
- 前端配置：`supabase-config.js` 里的 `window.SUPABASE_URL`
