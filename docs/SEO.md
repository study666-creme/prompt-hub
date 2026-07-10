# SEO 与站点元数据

## 当前主域

所有 canonical、Open Graph、Twitter、结构化数据、sitemap 和 robots 都应使用：

```text
https://prompt-hubs.com
```

旧 `prompt-hub.cn` 应做 301 或兼容入口，不能和 `.com` 同时声明自己为 canonical，否则会分散索引信号。

## 仓库文件

| 文件 | 作用 |
|---|---|
| `index.html` | title、description、canonical、OG、JSON-LD |
| `sitemap.xml` | 可索引页面 |
| `robots.txt` | crawler 规则和 sitemap 地址 |
| `favicon.ico`, `assets/favicon-*.png` | 搜索结果和浏览器图标 |
| `privacy.html`, `terms.html` | 信任与合规页面 |

## 发布后检查

```powershell
Invoke-WebRequest https://prompt-hubs.com -UseBasicParsing
Invoke-WebRequest https://prompt-hubs.com/sitemap.xml -UseBasicParsing
Invoke-WebRequest https://prompt-hubs.com/robots.txt -UseBasicParsing
Invoke-WebRequest https://prompt-hubs.com/favicon.ico -UseBasicParsing
```

检查首页源代码只出现一个 canonical，OG URL 与 canonical 一致，所有资源返回正确 Content-Type。

## 搜索平台

- Google Search Console：添加 `prompt-hubs.com` Domain property，DNS TXT 验证，提交 `sitemap.xml`。
- Bing Webmaster Tools：可从 Search Console 导入或单独验证。
- 百度搜索资源平台：若面向国内流量，单独验证 `.com`，不要继续只提交旧 `.cn`。

提交不等于立即收录或排名。优先用 `site:prompt-hubs.com` 检查索引，再观察品牌词“Prompt Hub 卡藏”。

## 变更域名

换域名时必须同步更新首页元数据、sitemap、robots、Pages/Worker 路由、扩展、隐私链接和搜索平台，并让旧域长期 301 到新域。详见 `CUSTOM-DOMAIN.md`。
