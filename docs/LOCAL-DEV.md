# 本地开发与预览

## 不要用 file:// 打开

**不要**在资源管理器里双击 `index.html`（地址栏会是 `file:///D:/...`）。

| 方式 | 结果 |
|------|------|
| `file://` 打开 | 浏览器拦截 API（CORS），积分/任务/生图接口失败；`localStorage` 与 **https://prompt-hub.cn 不是同一份数据**，卡片/社区可能显示为 0 |
| `http://127.0.0.1:5500` | 可正常请求 API（若已配置 `api-config.js`） |
| **https://prompt-hub.cn** | 正式环境，数据与线上一致 |

页面会在 `file://` 下自动弹出全屏提示（`file-origin-guard.js`）。

---

## 本机预览静态站（改前端后）

**第 1 步** 在项目根目录打开 PowerShell：

```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

**第 2 步** 浏览器打开：**http://127.0.0.1:5500**

（没有 Python 时会自动用 `npx http-server`。）

---

## 对接本地 API（可选）

**第 1 步** 另开终端：

```powershell
cd D:\prompt-hub\server
copy .dev.vars.example .dev.vars
npm install
npm run dev
```

**第 2 步** 根目录创建 `api-config.local.js`（已在 `.gitignore`）：

```javascript
window.API_BASE_URL = 'http://127.0.0.1:8787';
```

**第 3 步** 用 `serve-local.ps1` 打开前端，不要用 `file://`。

---

## 出现「暂时无法连接」

这是 **Service Worker** 在页面拉取失败时的离线提示（常见于：本地 5500 没开服务、或旧 SW 缓存异常）。

**处理步骤：**

1. 打开 http://127.0.0.1:5500/auto-fix.html（需先 `.\serve-local.ps1`）
2. 点 **「清除缓存」**
3. 再打开 http://127.0.0.1:5500/ 或 https://prompt-hub.cn ，`Ctrl+Shift+R` 强刷

线上站：F12 → Application → Service Workers → **Unregister** → Clear site data。

## 验证构建号

浏览器控制台：

```javascript
window.__APP_BUILD__
```

部署到 Pages 后应为当前 `index.html` 里的版本（如 `20260606j`）。

---

## 部署到线上

```powershell
cd D:\prompt-hub
.\deploy-pages.ps1
```

部署后：F12 → Application → Service Workers → **Unregister** → **Clear site data** → 硬刷新。
