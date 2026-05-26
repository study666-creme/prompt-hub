# 兑换报「服务器内部错误」排查

## 最常见：Worker 密钥填错

`SUPABASE_SERVICE_ROLE_KEY` 必须是 **Secret key**（`sb_secret_` 开头），  
不能填 **Publishable**（`sb_publishable_`）。

### 修复步骤

```powershell
cd d:\prompt-hub\server
npm run secret-service-role
# 粘贴 Supabase → Settings → API Keys → Secret keys → default

npm run deploy
```

### 自检

浏览器打开（需能访问 API 地址）：

`https://prompt-hub-api.2705367723.workers.dev/health`

应看到：

```json
{ "ok": true, "supabase": "ok" }
```

若 `"supabase": "misconfigured"` → 仍是 publishable 密钥。

---

## 第二常见：数据库权限

Supabase SQL Editor 执行 `scripts/apply-grants-once.sql` 全部内容。

---

## 第三：迁移未跑

执行 `supabase/migrations/20260526000000_backend_core.sql`。

---

## 浏览器里看真实原因

F12 → 网络 → 点兑换 → 选 `redeem` → 看 Response。

部署最新 Worker 后，错误信息会更具体（如「需 sb_secret_」）。
