# 自定义 API 域名（解决 workers.dev 打不开）

国内常见现象：`* .workers.dev` 超时，但 **自有域名 + Cloudflare** 往往可以访问。

## 第一步：买域名（需您本人操作，我无法代买）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧 **Domain Registration** → **Register Domains**
3. 搜索并购买（例如 `prompt-hub.cn` / `yourname.com`，约几十元/年起）
4. 域名会自动进入当前账号，无需再「添加站点」

也可在阿里云/腾讯云购买后，把 **DNS 服务器** 改为 Cloudflare 提供的 NS（域名 → 转移/接入 Cloudflare）。

## 第二步：一键改项目配置（本机 PowerShell）

把 `api.你的域名.com` 换成你要用的子域名：

```powershell
cd d:\prompt-hub\server
.\setup-custom-domain.ps1 -ApiHost api.你的域名.com -PagesOrigin https://prompt-hub-hub.pages.dev -Deploy
```

脚本会：

- 写入 `api-domain.config.js`（前端走新 API 地址）
- 更新 `wrangler.toml` 的 `[[routes]]` 与 `CORS_ORIGINS`
- 可选 `-Deploy` 部署 Worker

## 第三步：确认 DNS / Custom Domain

部署后打开 Cloudflare：

**Workers & Pages** → **prompt-hub-api** → **Settings** → **Domains & Routes**

应看到 `api.你的域名.com`。若没有，点 **Add Custom Domain** 手动添加。

浏览器访问：

`https://api.你的域名.com/health`

应返回 `{"ok":true,...}`。

## 第四步：更新静态站

```powershell
cd d:\prompt-hub
git add api-domain.config.js api-config.js index.html
git commit -m "use custom API domain"
git push
```

或 `.\pack-deploy.ps1` 上传到 Pages。

## 第五步：淘宝发货链接

对外主站可继续用 `prompt-hub-hub.pages.dev`，或再给 Pages 绑 `www.你的域名.com`。

兑换/生图只要 **API 自定义域名能打开**，激活码即可用。

## 费用

| 项目 | 大致费用 |
|------|----------|
| 域名 | 约 ¥50–80/年（视后缀） |
| Cloudflare Worker / Pages | 小流量多在免费档 |

## 手动改（不用脚本）

`api-domain.config.js`：

```js
window.CUSTOM_API_HOST = 'api.你的域名.com';
```

`server/wrangler.toml` 增加：

```toml
[[routes]]
pattern = "api.你的域名.com"
custom_domain = true
```

`CORS_ORIGINS` 加上你的 Pages 地址，然后 `npm run deploy`。
