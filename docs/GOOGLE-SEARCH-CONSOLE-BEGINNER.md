# Google 提交与收录（小白分步）

> 站点：**https://prompt-hub.cn**  
> 目标：让 Google **知道有你这个站**，并逐步出现在搜索结果里（含图标）。  
> **不能保证**搜「提示词仓库」就排第一——大站（GitHub、DeepSeek 等）已占前列，新站要靠**品牌词 + 时间 + 外链**。

---

## 先认清两件事

| 误区 | 事实 |
|------|------|
| 提交了 Google 就立刻能搜到 | 通常要 **几天～几周**，有时 1～2 个月才有稳定排名 |
| 搜「提示词仓库」就要第一 | 这是**泛词**，竞争极强；你先争取搜 **「Prompt Hub」**、**`site:prompt-hub.cn`** 有结果 |
| 百度提交了 Google 也会有 | **两套系统**，必须分别在 [Search Console](https://search.google.com/search-console) 提交 |

你截图里 Google 没有 prompt-hub.cn，说明 **Google 还没收录或排名极低**，按下面做即可。

---

## 第 1 步：打开 Google Search Console

1. 浏览器打开：https://search.google.com/search-console/welcome  
2. 用 **Google 账号**登录（建议用你长期用的 Gmail）。  
3. 左侧选 **「添加资源」**（Add property）。

---

## 第 2 步：添加网站（推荐「网域」或「网址前缀」）

两种方式任选一种（小白推荐 **网址前缀**，更简单）：

### 方式 A：网址前缀（推荐）

1. 选 **「网址前缀」**。  
2. 只填一行（不要多空格、不要结尾斜杠也可，建议统一）：

   ```
   https://prompt-hub.cn
   ```

3. 点 **继续**。

### 方式 B：网域（整站含子域名）

1. 选 **「网域」**，填：

   ```
   prompt-hub.cn
   ```

2. 验证要在 DNS 加 TXT，见第 3 步 B。

---

## 第 3 步：验证你拥有这个网站

Google 会给出几种验证方式，**推荐按顺序试**：

### 验证方式 1：DNS 记录（最稳，域名在 Cloudflare 时）

1. Google 页面选 **「DNS 记录」**，会显示一条 **TXT**，例如：

   ```
   google-site-verification=xxxxxxxxxxxxxxxx
   ```

2. 打开 [Cloudflare 控制台](https://dash.cloudflare.com) → 选站点 **prompt-hub.cn**。  
3. 左侧 **DNS** → **Records** → **Add record**：  
   - **Type**：`TXT`  
   - **Name**：`@`（或留空，表示根域名）  
   - **Content**：粘贴 Google 给的整段（含 `google-site-verification=`）  
   - **TTL**：Auto  
4. 保存后回到 Google，点 **验证**。  
5. 若失败：等 **10～30 分钟** 再点一次（DNS 传播需要时间）。

### 验证方式 2：HTML 文件（和百度验证类似）

1. Google 给文件名，例如 `google1234567890abcdef.html`。  
2. 把该文件**原样**放到项目根目录 `d:\prompt-hub\`（与 `index.html` 同级）。  
3. 运行部署：

   ```powershell
   cd d:\prompt-hub
   .\deploy-pages.ps1
   ```

4. 浏览器访问 `https://prompt-hub.cn/google1234567890abcdef.html`，应能看到 Google 要求的内容。  
5. 回到 Search Console 点 **验证**。

### 验证方式 3：HTML 元标记

1. Google 给一行 `<meta name="google-site-verification" content="..." />`。  
2. 放进 `index.html` 的 `<head>` 里（`charset` 后面即可）。  
3. 部署 `.\deploy-pages.ps1` 后点验证。

验证成功后会显示 **「所有权已验证」**。

---

## 第 4 步：提交站点地图（Sitemap）

1. Search Console 左侧 **「站点地图」**（Sitemaps）。  
2. **「添加新的站点地图」** 输入：

   ```
   sitemap.xml
   ```

   （不要填完整 URL，只填这一条即可；Google 会拼成 `https://prompt-hub.cn/sitemap.xml`）

3. 点 **提交**。  
4. 状态变成 **「成功」** 或 **「已发现网址」** 即可。若暂时「无法抓取」，等 1～2 天再试。

---

## 第 5 步：请求编入首页（加快收录）

1. 左侧 **「网址检查」**（URL Inspection）。  
2. 顶部输入：

   ```
   https://prompt-hub.cn/
   ```

3. 回车后点 **「请求编入索引」**（Request indexing）。  
4. 每天可对首页请求 1 次，**不要狂点**（无助于更快）。

可选：对 `https://prompt-hub.cn/terms.html`、`privacy.html` 各请求一次。

---

## 第 6 步：确认 Google 能抓到站标（小图标）

1. 浏览器打开：https://prompt-hub.cn/favicon.ico  
   - 必须 **能打开小图**，不是 404。  
2. 若 404：先在本机确认有 `favicon.ico`，再 `.\deploy-pages.ps1`。  
3. Google 图标更新比收录更慢，收录后 **再等 2～4 周** 常见。

---

## 第 7 步：怎么判断「Google 已经能搜到了」

用 **无痕窗口**（避免个人历史干扰）：

| 搜什么 | 说明 |
|--------|------|
| `site:prompt-hub.cn` | **最重要**：有任意结果 = 已收录 |
| `Prompt Hub 提示词仓库` | 品牌词，比泛词「提示词仓库」更容易出现 |
| `prompt-hub.cn` | 域名直达型搜索 |

若 `site:prompt-hub.cn` **完全没有**，继续等 + 重复第 5 步，并检查 `robots.txt` 是否为 `Allow: /`（本站已是）。

---

## 想排在前列？现实路线（新站 3～6 个月）

Google **不会**因为提交就给你第一。你截图里的 GitHub / AiShort / DeepSeek 有：**多年域名、大量外链、高权重**。

按优先级做：

### 1. 技术（你已基本具备）

- [x] HTTPS、`robots.txt`、`sitemap.xml`  
- [x] 每页 `title` / `description`  
- [ ] 确保 `favicon.ico` 已部署（见第 6 步）  
- [ ] Search Console 无「覆盖率」大面积错误  

### 2. 先拿「品牌词」排名

统一对外写法：**Prompt Hub 提示词仓库** — https://prompt-hub.cn  

在以下位置反复出现同一句话：

- 网站标题、关于页、扩展商店说明  
- 知乎 / B 站 / 公众号简介里的**可点击链接**  

### 3. 内容 + 外链（最关键）

- 写 2～5 篇教程：「我用 Prompt Hub 管理 Midjourney 提示词」，文末放官网链接。  
- 浏览器扩展商店页、GitHub README（若有）链回官网。  
- 不要买「快速上首页」服务，易被惩罚。

### 4. 泛词「提示词仓库」

短期很难超过 GitHub 开源库。中期可：

- 做专题页/博客（例如「提示词仓库怎么用」），长尾词慢慢进前页。  
- 持续更新社区内容，让 Google 常来爬。

### 5. 国内用户

Google 在国内访问不稳定，**国内流量主要靠百度**。Google 主要服务：**海外用户、用 VPN 的开发者、Chrome 默认搜索**。

---

## 和百度一起做的对照表

| 平台 | 地址 | 你要做的 |
|------|------|----------|
| **百度** | https://ziyuan.baidu.com | sitemap + 抓取诊断 + 重新抓取 |
| **Google** | https://search.google.com/search-console | 本文第 1～5 步 |
| **必应** | https://www.bing.com/webmasters | 可导入 Google 数据或单独验证 |

---

## 常见问题

**Q：验证失败？**  
DNS 是否加在**根域名** `@`；Cloudflare 是否橙色云误解析；等 30 分钟重试。

**Q：站点地图「无法读取」？**  
浏览器直接打开 https://prompt-hub.cn/sitemap.xml 应看到 XML；若 404 说明未部署。

**Q：请求编入索引后仍搜不到？**  
正常，等 1～2 周再查 `site:prompt-hub.cn`。

**Q：只有 Edge/必应能搜到？**  
见 `docs/ERROR-LOG.md` §9、`docs/SEO-SEARCH-ENGINES.md`。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `sitemap.xml` | 告诉 Google 有哪些页面 |
| `robots.txt` | 允许爬虫 |
| `favicon.ico` | 搜索结果小图标 |
| `docs/SEO-SEARCH-ENGINES.md` | 百度/必应/多设备差异 |
