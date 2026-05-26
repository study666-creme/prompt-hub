# 淘宝卖积分 · 运营手册

## 一次性配置

1. Supabase 已执行全部 `supabase/migrations/*.sql`
2. Workers API 已部署：`https://prompt-hub-api.2705367723.workers.dev`
3. 配置管理员密钥（仅做一次）：

```powershell
cd server
npx wrangler secret put ADMIN_API_SECRET
# 输入一串长随机密码，记下来
```

4. 复制 `scripts/admin.local.env.example` → `scripts/admin.local.env`，填入同一密钥
5. 确认 `api-config.js` 中 Pages 域名已指向上述 API（已内置 `prompt-hub-hub.pages.dev`）
6. 推送前端或 ZIP 部署 Pages，让用户访问最新站

> **重要**：`SUPABASE_SERVICE_ROLE_KEY` 必须是 Supabase 控制台 **service_role** 密钥，不能填 `anon` / `publishable` 密钥。

## 每卖出一单

```powershell
cd d:\prompt-hub\scripts
# 10 元面值 = 1000 积分，一码一单
.\generate-codes.ps1 -Count 1 -Credits 1000 -Note "淘宝-订单12345" -OutFile ".\last-order.txt"
```

把脚本输出的「淘宝发货文案」复制到旺旺/自动发货。

## 批量备货（20 个 10 元码）

```powershell
.\generate-codes.ps1 -Count 20 -Credits 1000 -Note "淘宝备货20260526" -OutFile ".\codes-batch.csv"
```

## 定价对照

| 售价 | credits 参数 |
|------|----------------|
| 1 元 | 100 |
| 5 元 | 500 |
| 10 元 | 1000 |
| 50 元 | 5000 |

## 不用脚本时（Supabase SQL）

```sql
insert into public.activation_codes (code, credits, max_uses, active, note)
values ('PH-手动订单号', 1000, 1, true, '淘宝-xxx');
```

## 商品页建议文案

- 虚拟商品，付款后发卡密/兑换码
- 需注册 https://prompt-hub-hub.pages.dev 后兑换
- 卡密仅可使用一次，兑换后不退
- 链接《用户协议》《隐私政策》
