# 修 api.prompt-hub.cn 打不开（522）— 小白版

> 我已在电脑上帮你改好了代码并部署了 Worker。  
> **还差你在 Cloudflare 网页里点 4 步**（约 3 分钟）。做完后 `/health` 应能打开。

---

## 第 1 步：删掉写错的域名

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com)
2. 左侧 **Workers & Pages**
3. 点 **prompt-hub-api**
4. 上方 **Settings** → **Domains & Routes**
5. 找到 **`api.prompt-hub.cn.prompt-hub.cn`**（多写了一遍的那个）→ 点 **Delete** 删除
6. 若列表里**没有** `api.prompt-hub.cn`，点 **Add** → **Custom Domain**，只填：

   ```
   api.prompt-hub.cn
   ```

   （不要加 `https://`，不要重复 `prompt-hub.cn`）

---

## 第 2 步：删掉冲突的 DNS 记录（最关键）

1. 左侧 **Websites**（网站）
2. 点 **prompt-hub.cn**
3. 左侧 **DNS** → **Records**
4. 找 **Name** 为 `api` 或 `api.prompt-hub.cn` 的记录
5. 若是 **A** 或 **CNAME**（不是 Worker 类型）→ 每条都点 **Delete** 删掉

删完后，回到 **第 1 步** 的 Domains & Routes，确认 `api.prompt-hub.cn` 显示为 **Active**（有时要等 1～5 分钟）。

---

## 第 3 步：验证 API 是否通了

浏览器新开标签，访问：

```
https://api.prompt-hub.cn/health
```

**成功**：看到类似 `{"ok":true,...}` 的 JSON。  
**仍 522**：等 5 分钟再试；或截图 DNS 列表发给我。

---

## 第 4 步：让网站也用新 API 地址

本地已生成部署包（或自己运行 `pack-deploy.ps1`）：

1. Cloudflare → **Workers & Pages** → 你的 **Pages 项目**（如 prompt-hub-hub）
2. **Create deployment** → **Upload assets**
3. 上传项目根目录的 **`prompt-hub-deploy.zip`**
4. **Save and deploy**

---

## 以后一键重部署 API（可选）

在 PowerShell 里：

```powershell
cd d:\prompt-hub\server
npm run deploy
```

若又报 DNS 冲突，先重复 **第 2 步** 再 deploy。

---

## 我已在代码里帮你做好的事

- `api-domain.config.js` → 已指向 `api.prompt-hub.cn`
- `server/wrangler.toml` → 已加自定义域名路由
- Worker 代码 → 已上传 Cloudflare（`npm run deploy`）

你完成上面 4 步后，兑换码、积分同步在国内就能走自有域名，不再依赖 `workers.dev`。
