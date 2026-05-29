# 部署与验证清单

> 用户为小白时请写清：**第 1 步 / 第 2 步**，并给可复制命令。  
> Cloudflare 菜单路径见 `docs/CUSTOM-DOMAIN.md`、`docs/FIX-API-522-BEGINNER.md`。

---

## 何时需要部署什么

| 改了什么 | 部署 |
|----------|------|
| `index.html`, `*.js`, `*.css`, `sw.js` | **Pages** `.\deploy-pages.ps1` |
| `server/src/**` | **Worker** `cd server && npm run deploy` |
| `supabase/migrations/*.sql` | **Supabase SQL Editor** 手动执行 |
| 仅文档 | 无需部署 |

改静态资源时 **必须** 同时 bump：

1. `index.html` → `window.__APP_BUILD__`
2. `sw.js` → `CACHE = 'prompt-hub-v…'`
3. `index.html` 里脚本 `?v=`（若有）

---

## Pages 部署（Windows）

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
```

或 Git 连 Cloudflare Pages 自动构建（仓库根目录即站点，无 npm build）。

---

## Worker 部署

```powershell
cd d:\prompt-hub\server
npm run deploy
```

生产 API：**https://api.prompt-hub.cn**  
Worker 名：**prompt-hub-api**

---

## 用户浏览器清缓存（每次大改后）

1. 打开 https://prompt-hub.cn  
2. F12 → **Application** → **Service Workers** → **Unregister**  
3. **Ctrl+F5** 强刷  
4. 左下角应显示当前构建号（如 `版本 20260614b`）

---

## 验证项

| 检查 | 方法 |
|------|------|
| 构建号 | 侧栏底部 `appBuildLabel` 或 Console：`window.__APP_BUILD__` |
| API 健康 | 打开 `https://api.prompt-hub.cn/health` |
| 社区 Feed | `https://api.prompt-hub.cn/api/v1/community/feed?limit=10` → `ok:true` |
| 登录 | 侧栏显示邮箱；非「登录/注册」 |
| 社区加载 | 游客/登录均不应无限「正在加载…」 |

---

## 环境配置（勿提交密钥）

| 文件 | 用途 |
|------|------|
| `supabase-config.js` / `.local.js` | Supabase URL + anon key |
| `api-config.js` / `.local.js` | `API_BASE_URL` |
| `server/.dev.vars` / Wrangler secrets | `SUPABASE_SERVICE_ROLE_KEY`, `IMAGE_API_KEY` 等 |

---

## 本地预览

```powershell
cd d:\prompt-hub
.\serve-local.ps1
```

访问 http://127.0.0.1:5500（**不要** file:// 双击 html）。  
详见 `docs/LOCAL-DEV.md`。

---

## 当前生产构建（文档编写时）

| 项 | 值 |
|----|-----|
| `__APP_BUILD__` | `20260614b` |
| SW CACHE | `prompt-hub-v208` |
| 站点 | https://prompt-hub.cn |
| API | https://api.prompt-hub.cn |

（以 `index.html` / `sw.js` 为准，部署后可能落后仓库。）
